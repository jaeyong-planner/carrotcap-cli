// Electron integration smoke test (task-007 review follow-up).
// Boots the real app with a CDP port, then checks from inside the renderer:
//   - sandboxed preload bridge exists, Node APIs are not exposed
//   - xterm renders and a PTY session is spawned
//   - hostile IPC payloads are rejected or neutralised
//   - CLAUDE.md save -> reload roundtrip (user data dir, restored afterwards)
//
// Usage: node scripts/test-electron-smoke.js     (npm run test:smoke)
// Exits 0 on all pass, 1 on any failure.

const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const electronBin = require(path.join(root, 'node_modules', 'electron'));
const port = 9333 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else      { console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail++; }
}

const child = spawn(electronBin, ['.', `--remote-debugging-port=${port}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
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
  console.log('-- renderer errors');
  check('no exceptions / console errors on load', logs.length === 0, logs.join(' | '));
  ws.close();
})()
  .catch((e) => { console.log('  FAIL  smoke harness ::', e.message); fail++; })
  .finally(async () => {
    child.kill();
    await sleep(500);
    if (fail) { console.log('--- main process log'); console.log(mainLog.trim().split('\n').slice(-20).join('\n')); }
    console.log('');
    console.log(`Summary: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
