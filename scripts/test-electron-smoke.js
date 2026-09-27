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
// task-027: the registered PATH comes from this file (dev tree) — a tool folder is "installed"
// into it while the app runs; the app's own PATH never has it
const regFile = path.join(appData, 'registered-path.json');
const probeDir = path.join(appData, 'late tool');
fs.mkdirSync(probeDir, { recursive: true });
fs.writeFileSync(path.join(probeDir, 'zzccprobe.cmd'), '@echo CC-PROBE-OK' + String.fromCharCode(13, 10));
fs.writeFileSync(regFile, JSON.stringify({ machine: '', user: '' }));
if (corruptSettings) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), CORRUPT_TEXT);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// task-026: poll until cond() is truthy (or time runs out) — returns the last result
async function waitFor(cond, { timeoutMs = 5000, stepMs = 100 } = {}) {
  const end = Date.now() + timeoutMs;
  let v;
  do { v = await cond(); if (v) return v; await sleep(stepMs); } while (Date.now() < end);
  return v;
}

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
  env: { ...process.env, CARROTCAP_USER_DATA_DIR: userDataDir, CARROTCAP_TEST_REGISTRY_PATH: regFile },
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
  // bundled JetBrains Mono (task-021): all four faces loaded from the app, used by xterm
  await document.fonts.ready;
  r.fontFaces = [...document.fonts].filter((f) => f.family.replace(/"/g, '') === 'JetBrains Mono').map((f) => f.weight + '/' + f.style + ':' + f.status);
  r.fontReady = document.fonts.check('400 14px "JetBrains Mono"') && document.fonts.check('700 14px "JetBrains Mono"');
  const xt = document.querySelector('.xterm-rows');
  r.xtermFont = xt ? getComputedStyle(xt).fontFamily : '';
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
  console.log('-- bundled font (task-021)');
  check('four JetBrains Mono faces declared', r.fontFaces.length === 4, JSON.stringify(r.fontFaces));
  check('regular and bold loaded from the app', r.fontReady && r.fontFaces.filter((f) => /^(400|normal)\/normal:loaded$|^(700|bold)\/normal:loaded$/.test(f)).length === 2, JSON.stringify(r.fontFaces));
  check('terminal uses JetBrains Mono first', /^['"]?JetBrains Mono/.test(r.xtermFont), r.xtermFont);
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
  // Poll: the shell echo can take a while when the machine is busy.
  let sent = false;
  for (let i = 0; i < 40 && !sent; i++) { await sleep(250); sent = /composer-ok[\s\S]*composer-ok/.test(await screenText()); }
  check('Enter sends the text to the active terminal', sent, sent ? '' : JSON.stringify((await screenText()).slice(-300)));
  check('input box cleared after send', (await ev(`document.querySelector('#composer-input').value`)) === '');

  console.log('-- input right after a new pane opens (ready gate)');
  // PowerShell drops input typed while it is starting; main queues it until the prompt is up.
  await key('t', 'KeyT', 84, CTRL | SHIFT);
  await sleep(100);
  await ev(`document.querySelector('#composer-input').value = 'echo early-bird'; document.querySelector('#composer-send').click(); true`);
  let early = false;
  for (let i = 0; i < 60 && !early; i++) { await sleep(250); early = /early-bird[\s\S]*early-bird/.test(await screenText()); }
  check('input sent 100ms after opening a tab is not lost', early, early ? '' : JSON.stringify((await screenText()).slice(-200)));

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
  check('exited pane is flagged (notice / placeholder)', /종료/.test(await ev(`document.querySelector('#composer-notice').textContent + ' ' + document.querySelector('#composer-input').placeholder`)));

  console.log('-- no out-of-band terminal writes (task-011)');
  // Warnings used to be injected into xterm behind ConPTY's back, garbling redraws.
  check('fallback warning not written into the terminal', !/\[carrotcap\] AOR engineRoot/.test(await screenText()));
  // A missing AOR engine is normal on machines without it: no warning anywhere (user request).
  check('no AOR warning in pane headers', (await ev(`[...document.querySelectorAll('.pane .kind')].every((k) => !/⚠|FALLBACK/.test(k.textContent))`)) === true);
  check('no AOR warning in the flow status', !/engineRoot|AOR 엔진/.test(await ev(`document.querySelector('#flow-status').textContent`)));

  console.log('-- CLI line-up (task-012)');
  const cliKeys = await ev(`[...document.querySelectorAll('.btn-cli')].map((b) => b.dataset.cli).join(',')`);
  check('QUICK CLI is claude,codex,grok + JEV (claude with the Jev skill, no gemini)', cliKeys === 'claude,codex,grok,claude', cliKeys);
  check('the 4th QUICK CLI button is JEV', (await ev(`[...document.querySelectorAll('.btn-cli')][3].dataset.skill + '/' + [...document.querySelectorAll('.btn-cli')][3].textContent`)) === 'jev/JEV');
  const flows = await ev(`[...document.querySelectorAll('.btn-flow[data-flow]')].map((b) => b.dataset.flow).join(',')`);
  check('flow buttons are start,review,media,clm', flows === 'start,review,media,clm', flows);
  const status = await ev(`window.carrotcap.cliStatus()`);
  check('cli:status reports every configured CLI', status && ['claude', 'codex', 'grok'].every((k) => typeof status[k] === 'boolean'), JSON.stringify(status));
  check('cli:status finds installed claude', status && status.claude === true);
  const seededCli = await ev(`window.carrotcap.getSettings().then((s) => Object.keys(s.cli).join(','))`);
  check('seeded settings have no gemini', !/gemini|agy|antigravity/.test(seededCli) && /grok/.test(seededCli), seededCli);

  console.log('-- settings panel and themes (task-026)');
  const readUi = () => { try { return JSON.parse(fs.readFileSync(path.join(userDataDir, 'settings.json'), 'utf8')).ui || {}; } catch { return {}; } };
  check('⚙ is the first thing in the tab bar (top-left)', (await ev(`document.querySelector('#tabbar').firstElementChild.id`)) === 'settings-open');
  check('settings moved into the panel; header and sidebar no longer have them',
    await ev(`['toggle-browser','toggle-composer','open-aor-editor','aor-toggle','aor-mode-toggle','keys-open'].every((id) => document.getElementById(id) && document.getElementById(id).closest('#settings-panel'))
      && !document.querySelector('#tabbar #toggle-browser') && ![...document.querySelectorAll('#sidebar .side-head')].some((h) => /MODE/.test(h.textContent))`));
  check('panel starts closed', await ev(`document.querySelector('#settings-panel').classList.contains('hidden') && document.querySelector('#settings-open').getAttribute('aria-expanded') === 'false'`));
  await ev(`document.querySelector('#settings-open').click(), true`);
  check('⚙ opens it; dark is the default choice', await ev(`!document.querySelector('#settings-panel').classList.contains('hidden') && document.querySelector('#settings-open').getAttribute('aria-expanded') === 'true'
    && document.querySelector('[data-theme-choice="dark"]').classList.contains('active') && document.documentElement.dataset.theme === 'dark'`));
  const uiBefore = JSON.parse(fs.readFileSync(path.join(userDataDir, 'settings.json'), 'utf8'));
  await ev(`document.querySelector('[data-theme-choice="light"]').click(), true`);
  check('white theme: page and every terminal turn white at once', await waitFor(async () => ev(`document.documentElement.dataset.theme === 'light' && getComputedStyle(document.body).backgroundColor === 'rgb(255, 255, 255)'
    && [...document.querySelectorAll('.xterm-viewport')].length > 0 && [...document.querySelectorAll('.xterm-viewport')].every((v) => getComputedStyle(v).backgroundColor === 'rgb(255, 255, 255)')`), { timeoutMs: 3000 }));
  check('terminal text is dark on white', await ev(`/rgb\\((3[01]|2\\d), (3[0-9]|2\\d), (4[0-9]|3\\d)\\)/.test(getComputedStyle(document.querySelector('.xterm-rows')).color)`), await ev(`getComputedStyle(document.querySelector('.xterm-rows')).color`));
  const afterLight = JSON.parse(fs.readFileSync(path.join(userDataDir, 'settings.json'), 'utf8'));
  check('saved as ui.theme = light; cli / aor untouched', afterLight.ui.theme === 'light' && JSON.stringify(afterLight.cli) === JSON.stringify(uiBefore.cli) && JSON.stringify(afterLight.aor) === JSON.stringify(uiBefore.aor));
  const size0 = await ev(`Number(document.querySelector('#font-size-value').textContent)`);
  await ev(`document.querySelector('#font-inc').click(), true`);
  check('font +1: every terminal and settings.json follow', await waitFor(async () => readUi().fontSize === size0 + 1, { timeoutMs: 3000 })
    && (await ev(`Number(document.querySelector('#font-size-value').textContent)`)) === size0 + 1
    && (await waitFor(async () => ev(`[...document.querySelectorAll('.tab-page.active .xterm-rows')].every((r) => getComputedStyle(r).fontSize === '${size0 + 1}px')`), { timeoutMs: 3000 })), JSON.stringify(readUi())); // hidden tabs re-render when shown
  // a terminal opened after the change and one in another tab get the same theme and size (review task-026 r2)
  const nPanes = await ev(`document.querySelectorAll('.tab-page.active .xterm').length`);
  await ev(`document.querySelector('.btn-split[data-dir="right"]').click(), true`);
  check('a new split terminal opens white and at the new size', await waitFor(async () => ev(`(() => { const x = [...document.querySelectorAll('.tab-page.active .xterm')]; if (x.length !== ${nPanes} + 1) return false;
    const last = x[x.length - 1]; return getComputedStyle(last.querySelector('.xterm-viewport')).backgroundColor === 'rgb(255, 255, 255)' && getComputedStyle(last.querySelector('.xterm-rows')).fontSize === '${size0 + 1}px'; })()`), { timeoutMs: 8000 }));
  await ev(`document.querySelector('#close-pane').click(), true`);
  const otherTab = await ev(`(() => { const t = [...document.querySelectorAll('.tab')].find((el) => !el.classList.contains('active')); if (!t) return false; t.click(); return true; })()`);
  if (otherTab) {
    check('another tab, once shown, has the new size and the white palette', await waitFor(async () => ev(`[...document.querySelectorAll('.tab-page.active .xterm')].every((x) => getComputedStyle(x.querySelector('.xterm-rows')).fontSize === '${size0 + 1}px' && getComputedStyle(x.querySelector('.xterm-viewport')).backgroundColor === 'rgb(255, 255, 255)')`), { timeoutMs: 3000 }));
    await ev(`[...document.querySelectorAll('.tab')][0].click(), true`);
    await sleep(400); // a tab switch focuses its terminal on a short timer — let it land first
  }
  await ev(`document.querySelector('#settings-open').getAttribute('aria-expanded') === 'true' || document.querySelector('#settings-open').click(), true`);
  await ev(`document.querySelector('#font-dec').click(), true`);
  await waitFor(async () => readUi().fontSize === size0, { timeoutMs: 3000 });
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true`);
  check('Esc closes the panel; focus back on ⚙', await ev(`document.querySelector('#settings-panel').classList.contains('hidden') && document.activeElement.id === 'settings-open'`), await ev(`JSON.stringify({ hidden: document.querySelector('#settings-panel').classList.contains('hidden'), active: document.activeElement.id || document.activeElement.className, expanded: document.querySelector('#settings-open').getAttribute('aria-expanded') })`));
  await ev(`document.querySelector('#settings-open').click(), true`);
  check('opening moves focus into the panel (the chosen theme)', await ev(`document.activeElement.dataset.themeChoice === 'light'`));
  await ev(`document.querySelector('#pane-area').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })), true`);
  check('a click outside closes it; focus not left in the hidden panel', await ev(`document.querySelector('#settings-panel').classList.contains('hidden') && !document.querySelector('#settings-panel').contains(document.activeElement)`));
  // the OS switching dark ↔ light while "system" is chosen (CDP media emulation fires the change listener)
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await ev(`document.querySelector('#settings-open').click(); document.querySelector('[data-theme-choice="system"]').click(); true`);
  check('system theme: OS dark → dark', await waitFor(async () => (await ev(`document.documentElement.dataset.theme`)) === 'dark' && readUi().theme === 'system', { timeoutMs: 3000 }));
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  check('…the OS turns light → page and open terminals turn white without a click', await waitFor(async () => ev(`document.documentElement.dataset.theme === 'light'
    && [...document.querySelectorAll('.tab-page.active .xterm-viewport')].every((v) => getComputedStyle(v).backgroundColor === 'rgb(255, 255, 255)')`), { timeoutMs: 3000 }));
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  check('…and back to dark', await waitFor(async () => ev(`document.documentElement.dataset.theme === 'dark'`), { timeoutMs: 3000 }));
  await send('Emulation.setEmulatedMedia', { features: [] });
  await ev(`document.querySelector('[data-theme-choice="dark"]').click(), true`);
  check('back to dark', await waitFor(async () => (await ev(`document.documentElement.dataset.theme`)) === 'dark' && readUi().theme === 'dark', { timeoutMs: 3000 }));
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true`);

  console.log('-- a tool installed after the app started is found in a new pane (task-027)');
  // Windows only: the registered PATH exists there (and the probe is a .cmd) — review r3
  if (process.platform === 'win32' && !packagedExe) {
    // The GROK button checks cli.grok on disk: point it at the probe command, which is not installed yet.
    const sPath = path.join(userDataDir, 'settings.json');
    const disk = JSON.parse(fs.readFileSync(sPath, 'utf8'));
    const grokWas = disk.cli.grok;
    disk.cli.grok = { command: 'zzccprobe', args: [] };
    fs.writeFileSync(sPath, JSON.stringify(disk, null, 2));
    await ev(`window.carrotcap.getSettings().then((s) => window.carrotcap.setSettings(s)).then(() => true)`); // new cli entry → fresh status
    await ev(`window.dispatchEvent(new Event('focus')), true`);
    check('before: the CLI shows as not installed', (await ev(`window.carrotcap.cliStatus()`)).grok === false
      && await waitFor(async () => ev(`document.querySelector('.btn-cli[data-cli="grok"]').classList.contains('missing')`), { timeoutMs: 3000 }));
    // "installed" now: registered in the user PATH — no new pane, no settings save (review r2)
    fs.writeFileSync(regFile, JSON.stringify({ machine: '', user: probeDir }));
    await sleep(5600); // past the 5 s registry cache
    check('cli:status sees it by itself (the status cache follows the registered PATH)', (await ev(`window.carrotcap.cliStatus()`)).grok === true);
    await ev(`window.dispatchEvent(new Event('focus')), true`);
    check('the button is no longer marked missing once the window is focused', await waitFor(async () => ev(`!document.querySelector('.btn-cli[data-cli="grok"]').classList.contains('missing')`), { timeoutMs: 3000 }));
    disk.cli.grok = grokWas;
    fs.writeFileSync(sPath, JSON.stringify(disk, null, 2));
    await ev(`window.carrotcap.getSettings().then((s) => window.carrotcap.setSettings(s)).then(() => true)`);
    const tabs0 = await ev(`document.querySelectorAll('.tab').length`);
    await ev(`document.querySelector('#new-tab').click(), true`);
    await waitFor(async () => (await ev(`document.querySelectorAll('.tab').length`)) === tabs0 + 1 && /PS /.test(await ev(`(document.querySelector('.tab-page.active .xterm-rows')||{}).innerText||''`)), { timeoutMs: 20000 });
    const pid = await ev(`document.querySelector('.tab-page.active .pane.active').dataset.ptyId`);
    await ev(`window.carrotcap.writePty(${JSON.stringify(pid)}, ${JSON.stringify('zzccprobe\r')}), true`);
    check('new pane runs it without restarting the app', await waitFor(async () => /CC-PROBE-OK/.test(await ev(`(document.querySelector('.tab-page.active .xterm-rows')||{}).innerText||''`)), { timeoutMs: 8000 }),
      await ev(`(document.querySelector('.tab-page.active .xterm-rows')||{}).innerText.slice(-300)`));
    await ev(`document.querySelector('.tab.active .x') && document.querySelector('.tab.active .x').click(), true`);
  }

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
