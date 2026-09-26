// Electron integration smoke test (task-007 review follow-up).
// Boots the real app with a CDP port, then checks from inside the renderer:
//   - sandboxed preload bridge exists, Node APIs are not exposed
//   - xterm renders and a PTY session is spawned
//   - hostile IPC payloads are rejected or neutralised
//   - CLAUDE.md save -> reload roundtrip (user data dir, restored afterwards)
//
// Usage: node scripts/test-electron-smoke.js                (npm run test:smoke — dev app)
//        node scripts/test-electron-smoke.js <path-to-exe>  (packaged build)
//        add --corrupt-settings to start from an unparsable settings.json
// The app runs with a throwaway user data dir (CARROTCAP_USER_DATA_DIR), so real
// user settings are never touched.
// For a packaged build, rename carrotcap.exe first: ensureCliRegistration only runs
// for a binary named carrotcap.exe and would otherwise edit the user's PATH.
// Exits 0 on all pass, 1 on any failure.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const argv = process.argv.slice(2);
// --corrupt-settings: start with an unparsable settings.json (backup + re-seed path).
// Without it the user data dir does not exist at launch (fresh-profile path).
const corruptSettings = argv.includes('--corrupt-settings');
const exeArg = argv.find((a) => !a.startsWith('--'));
const packagedExe = exeArg ? path.resolve(exeArg) : null;
const port = 9333 + Math.floor(Math.random() * 500);
const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'carrotcap-smoke-'));
const userDataDir = path.join(appData, 'userData');
const CORRUPT_TEXT = '{ "aor": { broken json';
if (corruptSettings) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), CORRUPT_TEXT);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else      { console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail++; }
}

if (packagedExe && /(^|[\\/])carrotcap\.exe$/i.test(packagedExe)) {
  console.error('Refusing to run carrotcap.exe directly (it would register itself on PATH). Copy/rename it first.');
  process.exit(2);
}
const [cmd, args] = packagedExe
  ? [packagedExe, [`--remote-debugging-port=${port}`]]
  : [require(path.join(root, 'node_modules', 'electron')), ['.', `--remote-debugging-port=${port}`]];
const child = spawn(cmd, args, {
  cwd: packagedExe ? path.dirname(packagedExe) : root,
  env: { ...process.env, CARROTCAP_USER_DATA_DIR: userDataDir },
  stdio: ['ignore', 'pipe', 'pipe']
});
let mainLog = '';
child.stdout.on('data', (d) => (mainLog += d));
child.stderr.on('data', (d) => (mainLog += d));

async function connect() {
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch { /* not up yet */ }
  }
  throw new Error('renderer page target not found');
}

const PROBE = `(async () => {
  const c = window.carrotcap;
  const r = {};
  r.bridge = typeof c;
  r.nodeRequire = typeof require;
  r.nodeProcess = typeof process;
  r.xterm = document.querySelectorAll('.xterm').length;
  r.paneKinds = [...document.querySelectorAll('.kind')].map((e) => e.textContent);
  r.ptyAvailable = await c.ptyAvailable();

  // hostile payloads — must not throw, must be rejected or neutralised
  c.writePty(null, 'x');
  c.resizePty('__proto__', 1, 1);
  c.killPty({});
  r.mdObj = await c.setClaudeMd({ x: 1 });
  r.mdBig = await c.setClaudeMd('a'.repeat(600000));
  r.spawnEvil = await c.spawnPty({ mode: 'evil', cwd: 'C:\\\\Windows', cols: 1e9, cliKey: 'constructor' });
  r.treeOutside = await c.getFolderTree('C:\\\\Windows');
  r.aiopsOutside = await c.setupAiops('C:\\\\Windows');
  r.windowOpen = window.open('file:///C:/');

  // CLAUDE.md roundtrip in the user data dir
  const original = await c.getClaudeMd();
  const marker = original + '\\n<!-- smoke ' + Date.now() + ' -->';
  r.mdSave = await c.setClaudeMd(marker);
  r.mdRoundtrip = (await c.getClaudeMd()) === marker;
  r.mdRestore = await c.setClaudeMd(original);
  r.mdRestored = (await c.getClaudeMd()) === original;

  // clipboard roundtrip (task-009) — the user's clipboard text is restored
  const clipBefore = await c.readClipboard();
  const probe = 'carrotcap-smoke-' + Date.now();
  r.clipWrite = await c.writeClipboard(probe);
  r.clipRoundtrip = ((await c.readClipboard()) || {}).text === probe;
  r.clipBadType = await c.writeClipboard({ x: 1 });
  if (clipBefore && clipBefore.ok) await c.writeClipboard(clipBefore.text);
  r.termMenuApi = typeof c.showTermMenu === 'function' && typeof c.onTermMenuCommand === 'function';
  return r;
})()`;

(async () => {
  const page = await connect();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let seq = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (msg.params.exceptionDetails.exception || {}).description);
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') logs.push('ERROR ' + msg.params.entry.text);
  });
  const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.reload'); // capture CSP / runtime errors from a fresh load
  await sleep(4000);

  const res = await send('Runtime.evaluate', { expression: PROBE, awaitPromise: true, returnByValue: true });
  const r = res.result && res.result.result && res.result.result.value;
  if (!r) throw new Error('probe failed: ' + JSON.stringify(res.result && res.result.exceptionDetails));

  console.log('-- sandbox / bridge');
  check('preload bridge exposed', r.bridge === 'object');
  check('require not exposed', r.nodeRequire === 'undefined');
  check('process not exposed', r.nodeProcess === 'undefined');
  console.log('-- terminal');
  check('xterm rendered', r.xterm >= 1);
  check('pane spawned with a kind label', r.paneKinds.length >= 1, JSON.stringify(r.paneKinds));
  check('native pty available', r.ptyAvailable === true);
  console.log('-- hostile IPC');
  check('CLAUDE.md non-string rejected', r.mdObj && r.mdObj.ok === false);
  check('CLAUDE.md > 512KB rejected', r.mdBig && r.mdBig.ok === false);
  check('evil spawn neutralised to plain', r.spawnEvil && r.spawnEvil.kind === 'plain', JSON.stringify(r.spawnEvil));
  check('folder tree outside workspace -> null', r.treeOutside === null);
  check('aiops setup outside workspace refused', r.aiopsOutside && r.aiopsOutside.ok === false);
  check('window.open denied', r.windowOpen === null);
  console.log('-- CLAUDE.md roundtrip');
  check('save ok', r.mdSave && r.mdSave.ok === true);
  check('reload returns saved content', r.mdRoundtrip === true);
  check('original restored', r.mdRestore && r.mdRestore.ok === true && r.mdRestored === true);
  console.log('-- clipboard / terminal menu');
  check('clipboard write ok', r.clipWrite && r.clipWrite.ok === true);
  check('clipboard read returns written text', r.clipRoundtrip === true);
  check('clipboard non-string rejected', r.clipBadType && r.clipBadType.ok === false);
  check('terminal menu API exposed', r.termMenuApi === true);
  // ---- real keyboard input (task-010) ----
  const ev = async (expression) => {
    const out = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    return out.result && out.result.result ? out.result.result.value : undefined;
  };
  const key = async (k, code, vk, modifiers = 0, text) => {
    await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers, text });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
  };
  const typeText = async (s) => { for (const ch of s) await key(ch, '', ch.toUpperCase().charCodeAt(0), 0, ch); };
  const screenText = () => ev(`(document.querySelector('.tab-page.active .xterm-rows') || {}).innerText || ''`);
  const paneState = () => ev(`JSON.stringify([...document.querySelectorAll('.tab-page.active .pane')].length)`);
  const CTRL = 2, SHIFT = 8, ALT = 1;

  console.log('-- keyboard: terminal keys are not hijacked (task-010)');
  await ev(`document.querySelector('.tab-page.active .xterm-helper-textarea').focus(), true`);
  const tabsBefore = await ev(`document.querySelectorAll('.tab').length`);
  const panesBefore = await paneState();
  await typeText('echo keep');
  await key('w', 'KeyW', 87, CTRL);            // readline: delete previous word
  await key('t', 'KeyT', 84, CTRL);            // readline: transpose — must not open a tab
  await sleep(800);
  check('Ctrl+W keeps the pane', (await paneState()) === panesBefore);
  check('Ctrl+T does not open a tab', (await ev(`document.querySelectorAll('.tab').length`)) === tabsBefore);
  await key('Escape', 'Escape', 27);
  await key('t', 'KeyT', 84, CTRL | SHIFT);    // app: new tab
  await sleep(1200);
  check('Ctrl+Shift+T opens a tab', (await ev(`document.querySelectorAll('.tab').length`)) === tabsBefore + 1);
  await key('ArrowRight', 'ArrowRight', 39, ALT | SHIFT); // app: split right
  await sleep(1200);
  check('Alt+Shift+→ splits the pane', (await paneState()) === '2');
  await key('w', 'KeyW', 87, CTRL | SHIFT);    // app: close active pane
  await sleep(800);
  check('Ctrl+Shift+W closes the active pane', (await paneState()) === '1');

  console.log('-- input box (task-010)');
  await ev(`document.querySelector('#composer-input').focus(), true`);
  await typeText('garbage text');
  await key('a', 'KeyA', 65, CTRL);            // select all
  await key('Delete', 'Delete', 46);
  check('Ctrl+A + Delete empties the input box', (await ev(`document.querySelector('#composer-input').value`)) === '');
  for (const [steps, commit] of [[['ㅎ', '하', '한'], '한'], [['ㄱ', '그', '글'], '글']]) {
    for (const c of steps) await send('Input.imeSetComposition', { text: c, selectionStart: c.length, selectionEnd: c.length });
    await send('Input.insertText', { text: commit });
  }
  check('Korean IME composes in the input box', (await ev(`document.querySelector('#composer-input').value`)) === '한글');
  await key('a', 'KeyA', 65, CTRL);
  await key('Backspace', 'Backspace', 8);
  await typeText('echo composer-ok');
  await key('Enter', 'Enter', 13, 0, '\r');
  await sleep(1500);
  check('Enter sends the text to the active terminal', /composer-ok[\s\S]*composer-ok/.test(await screenText()));
  check('input box cleared after send', (await ev(`document.querySelector('#composer-input').value`)) === '');

  console.log('-- focus recovery (task-010)');
  await ev(`document.querySelector('#new-tab').blur(), document.querySelector('.btn-split').focus(), true`);
  await typeText('x');
  check('typing on a focused button lands in the input box',
    (await ev(`document.activeElement.id + ':' + document.querySelector('#composer-input').value`)) === 'composer-input:x');

  console.log('-- terminal copy (task-011)');
  const clipSaved = await ev(`window.carrotcap.readClipboard()`);
  const drag = async (modifiers) => {
    const b = await ev(`(() => { const r = document.querySelector('.tab-page.active .xterm-screen').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; })()`);
    const y = b.y + 8;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x + 2, y, button: 'left', buttons: 1, clickCount: 1, modifiers });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x + b.w - 4, y, button: 'left', buttons: 1, modifiers });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x + b.w - 4, y, button: 'left', buttons: 0, clickCount: 1, modifiers });
    await sleep(400);
  };
  const clip = async () => ((await ev(`window.carrotcap.readClipboard()`)) || {}).text || '';
  await ev(`window.carrotcap.writeClipboard('')`);
  await drag(0);
  check('drag selection is copied on mouse-up (no Ctrl+C needed)', (await clip()).length > 0);
  await ev(`window.carrotcap.writeClipboard('')`);
  await drag(0);
  await ev(`window.carrotcap.writeClipboard('')`); // prove Ctrl+C copies, not copy-on-select
  await ev(`document.querySelector('.tab-page.active .xterm-helper-textarea').focus(), true`);
  await key('c', 'KeyC', 67, CTRL);
  await sleep(300);
  check('Ctrl+C with a selection copies it', (await clip()).length > 0);

  // Stale selection must not swallow the interrupt Ctrl+C (task-010/011 review).
  await drag(0);
  await ev(`document.querySelector('.tab-page.active .xterm-helper-textarea').focus(), true`);
  await typeText('a');
  await ev(`window.carrotcap.writeClipboard('')`);
  await key('c', 'KeyC', 67, CTRL);
  await sleep(300);
  check('after typing, Ctrl+C interrupts instead of copying a stale selection', (await clip()) === '');
  if (clipSaved && clipSaved.ok) await ev(`window.carrotcap.writeClipboard(${JSON.stringify(clipSaved.text)})`);

  console.log('-- review fixes (task-010/011)');
  const tabsNow = await ev(`document.querySelectorAll('.tab').length`);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 't', code: 'KeyT', windowsVirtualKeyCode: 84, modifiers: CTRL | SHIFT });
  for (let i = 0; i < 3; i++) {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 't', code: 'KeyT', windowsVirtualKeyCode: 84, modifiers: CTRL | SHIFT, autoRepeat: true });
  }
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 't', code: 'KeyT', windowsVirtualKeyCode: 84, modifiers: CTRL | SHIFT });
  await sleep(1200);
  check('held Ctrl+Shift+T opens exactly one tab', (await ev(`document.querySelectorAll('.tab').length`)) === tabsNow + 1);
  await ev(`document.querySelector('.btn-split').focus(), document.querySelector('#composer-input').value = '', true`);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Process', code: 'KeyG', windowsVirtualKeyCode: 229 });
  check('IME keydown (Process) on a button moves focus to the input box',
    (await ev(`document.activeElement.id`)) === 'composer-input');
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Process', code: 'KeyG', windowsVirtualKeyCode: 229 });
  // Exited session: the input box keeps its text instead of silently dropping it.
  await ev(`document.querySelector('#composer-input').value = 'exit'; document.querySelector('#composer-send').click(); true`);
  await sleep(2500);
  await ev(`document.querySelector('#composer-input').value = 'after-exit'; document.querySelector('#composer-send').click(); true`);
  await sleep(300);
  check('after the shell exits, input box keeps unsent text',
    (await ev(`document.querySelector('#composer-input').value`)) === 'after-exit');
  check('exited pane is labelled', /종료됨/.test(await ev(`document.querySelector('#composer-target').textContent`)));

  console.log('-- no out-of-band terminal writes (task-011)');
  // Warnings used to be injected into xterm behind ConPTY's back, garbling redraws.
  check('fallback warning not written into the terminal', !/\[carrotcap\] AOR engineRoot/.test(await screenText()));
  // A missing AOR engine is normal on machines without it: no warning anywhere (user request).
  check('no AOR warning in pane headers', (await ev(`[...document.querySelectorAll('.pane .kind')].every((k) => !/⚠|FALLBACK/.test(k.textContent))`)) === true);
  check('no AOR warning in the flow status', !/engineRoot|AOR 엔진/.test(await ev(`document.querySelector('#flow-status').textContent`)));

  console.log('-- CLI line-up (task-012)');
  const cliKeys = await ev(`[...document.querySelectorAll('.btn-cli')].map((b) => b.dataset.cli).join(',')`);
  check('QUICK CLI is claude,codex,grok (no gemini)', cliKeys === 'claude,codex,grok', cliKeys);
  const flows = await ev(`[...document.querySelectorAll('.btn-flow[data-flow]')].map((b) => b.dataset.flow).join(',')`);
  check('flow buttons are start,review,media', flows === 'start,review,media', flows);
  const status = await ev(`window.carrotcap.cliStatus()`);
  check('cli:status reports every configured CLI', status && ['claude', 'codex', 'grok'].every((k) => typeof status[k] === 'boolean'), JSON.stringify(status));
  check('cli:status finds installed claude', status && status.claude === true);
  const seededCli = await ev(`window.carrotcap.getSettings().then((s) => Object.keys(s.cli).join(','))`);
  check('seeded settings have no gemini', !/gemini|agy|antigravity/.test(seededCli) && /grok/.test(seededCli), seededCli);

  console.log('-- AOR badge / AIOps default');
  const engineFound = (await ev(`window.carrotcap.aorStatus()`)).engineFound;
  check('AOR badge hidden when no engine (shown when present)', (await ev(`document.querySelector('#aor-status').hidden`)) === !engineFound, `engineFound=${engineFound}`);
  check('AIOps mode checked by default on a fresh profile', (await ev(`document.querySelector('#aor-toggle').checked`)) === true);

  console.log('-- renderer errors');
  check('no exceptions / console errors on load', logs.length === 0, logs.join(' | '));
  console.log(`-- user data dir (task-008, ${corruptSettings ? 'corrupt settings' : 'fresh profile'})`);
  let seeded = null;
  try { seeded = JSON.parse(fs.readFileSync(path.join(userDataDir, 'settings.json'), 'utf8')); } catch {}
  check('valid settings.json seeded in userData', !!(seeded && seeded.cli), userDataDir);
  check('CLAUDE.md seeded in userData', fs.existsSync(path.join(userDataDir, 'CLAUDE.md')));
  if (corruptSettings) {
    const backups = fs.readdirSync(userDataDir).filter((f) => f.startsWith('settings.json.corrupt-'));
    check('corrupt settings backed up, not lost', backups.length === 1 &&
      fs.readFileSync(path.join(userDataDir, backups[0]), 'utf8') === CORRUPT_TEXT, backups.join(','));
  }
  ws.close();
})()
  .catch((e) => { console.log('  FAIL  smoke harness ::', e.message); fail++; })
  .finally(async () => {
    child.kill();
    await sleep(800);
    try { fs.rmSync(appData, { recursive: true, force: true }); } catch { /* locked cache files — temp dir */ }
    if (fail) { console.log('--- main process log'); console.log(mainLog.trim().split('\n').slice(-20).join('\n')); }
    console.log('');
    console.log(`Summary: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
