// Launch the CARROTCAP app (dev tree) with a CDP port and an isolated user data dir,
// and return small helpers to drive the renderer. Used by the Electron tests.
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Poll an async predicate instead of guessing a fixed delay (machine load varies).
async function waitFor(pred, { timeoutMs = 15000, intervalMs = 250 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if (await pred()) return true; } catch { /* keep polling */ }
    await sleep(intervalMs);
  }
  return false;
}

// Open a CDP session to one target and return { send, ev, close }.
async function connectTarget(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let seq = 0;
  const pending = new Map();
  let closed = false;
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
  });
  // A closed socket must settle every waiter — otherwise Node's event loop can run dry
  // mid-test and the process exits silently without a summary.
  ws.addEventListener('close', () => {
    closed = true;
    for (const [, p] of pending) p.reject(new Error('CDP socket closed'));
    pending.clear();
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    if (closed) return reject(new Error('CDP socket closed'));
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expression) => {
    const out = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    return out.result && out.result.result ? out.result.result.value : undefined;
  };
  return { send, ev, close: () => { try { ws.close(); } catch {} } };
}

async function listTargets(port) {
  try { return await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { return []; }
}

// exe: a packaged build to test instead of the dev tree (copy it first — carrotcap.exe self-registers on PATH).
async function launchApp(userDataDir, { port = 9400 + Math.floor(Math.random() * 400), exe = null } = {}) {
  const cmd = exe || require(path.join(root, 'node_modules', 'electron'));
  const args = exe ? [`--remote-debugging-port=${port}`] : ['.', `--remote-debugging-port=${port}`];
  const child = spawn(cmd, args, {
    cwd: root,
    // CLAUDE_CONFIG_DIR: the AOR shell auto-trusts the project in Claude's state file — keep
    // test folders out of the real ~/.claude.json (task-016).
    env: { ...process.env, CARROTCAP_USER_DATA_DIR: userDataDir, CLAUDE_CONFIG_DIR: path.join(userDataDir, 'claude-config') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const exited = new Promise((r) => child.on('exit', r));

  // The app page is the local index.html (a BrowserView target may appear later).
  let page;
  for (let i = 0; i < 60 && !page; i++) {
    await sleep(500);
    page = (await listTargets(port)).find((t) => t.type === 'page' && /^file:/.test(t.url));
  }
  if (!page) { child.kill(); throw new Error('renderer page target not found'); }
  const app = await connectTarget(page);
  const key = async (k, code, vk, modifiers = 0) => {
    await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers });
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
  };
  return {
    send: app.send, ev: app.ev, key, port, log: () => log,
    // Connect to another target (e.g. the browser-mode BrowserView) matching pred(target).
    connect: async (pred, timeoutMs = 15000) => {
      let t;
      await waitFor(async () => (t = (await listTargets(port)).find(pred)), { timeoutMs });
      return t ? connectTarget(t) : null;
    },
    targets: () => listTargets(port),
    // Simulated crash: no before-quit handlers run.
    kill: async () => { app.close(); child.kill(); await exited; },
    // Normal close: the window closes, the app quits through before-quit.
    close: async () => {
      app.ev('window.close(), true').catch(() => {}); // the reply may never come: the window is gone
      const t = setTimeout(() => child.kill(), 8000);
      await exited;
      clearTimeout(t);
      app.close();
    }
  };
}

module.exports = { launchApp, sleep, waitFor };
