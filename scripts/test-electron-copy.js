// E2E: text can be selected and copied in a pane even while the program in it has mouse
// tracking on (task-022). Claude Code turns on ?1000h/?1006h; a small node program does the
// same here (ConPTY passes it through for VT output), then the test drags across its text.
// Usage: node scripts/test-electron-copy.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, waitFor, sleep } = require('./lib/cdp-app');

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else      { console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail++; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-copy-'));
const userData = path.join(tmp, 'user');
fs.mkdirSync(userData);
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
  settingsVersion: 4, aor: { enabled: false, autoStart: false }, cli: { claude: { command: 'claude', args: [] } }, ui: {},
}));
const mouseApp = path.join(tmp, 'mouse-app.js');
// Raw (VT) input first, like a TUI — ConPTY forwards the mouse modes only then.
fs.writeFileSync(mouseApp, [
  "process.stdin.setRawMode && process.stdin.setRawMode(true);",
  "process.stdin.resume();",
  "setTimeout(() => { process.stdout.write('\\x1b[?1000h\\x1b[?1006h'); process.stdout.write('MOUSE-APP-TEXT-9876 copy me please\\n'); }, 300);",
  // every byte the program receives is logged, to see which clicks reach it
  "process.stdin.on('data', (d) => { require('fs').appendFileSync(process.env.CC_MOUSE_LOG, d); if (d.includes(3) || d.includes(113)) { process.stdout.write('\\x1b[?1000l\\x1b[?1006l'); process.exit(0); } });",
].join('\n'));
const mouseLog = path.join(tmp, 'mouse-in.log');
process.env.CC_MOUSE_LOG = mouseLog; // inherited by the app and its panes

(async () => {
  const app = await launchApp(userData);
  const ev = app.ev;
  const write = (s) => ev(`window.carrotcap.writePty(document.querySelector('.pane.active').dataset.ptyId, ${JSON.stringify(s)}), true`);
  const rows = () => ev(`(document.querySelector('.tab-page .xterm-rows')||{}).innerText||''`);
  const mouseOn = () => ev(`document.querySelector('.tab-page.active .xterm').classList.contains('enable-mouse-events')`);
  const drag = async (fromX, fromY, toX, modifiers = 0) => {
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fromX, y: fromY, button: 'left', buttons: 1, clickCount: 1, modifiers });
    for (let i = 1; i <= 8; i++) await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fromX + ((toX - fromX) * i) / 8, y: fromY, button: 'left', buttons: 1, modifiers });
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y: fromY, button: 'left', buttons: 0, clickCount: 1, modifiers });
    await sleep(600);
  };
  const clip = async () => ((await ev(`window.carrotcap.readClipboard()`)) || {}).text || '';
  // where the app's text line is on screen
  const lineBox = () => ev(`(() => {
    const rowsEl = [...document.querySelectorAll('.tab-page.active .xterm-rows > div')];
    const row = rowsEl.find((d) => d.textContent.includes('MOUSE-APP-TEXT-9876'));
    if (!row) return null;
    const r = row.getBoundingClientRect();
    return { x: r.left, y: r.top + r.height / 2 };
  })()`);
  const clipBefore = await ev(`window.carrotcap.readClipboard()`);
  try {
    await waitFor(async () => /PS /.test(await rows()), { timeoutMs: 30000 });
    await write(`& '${process.execPath.replace(/'/g, "''")}' '${mouseApp.replace(/'/g, "''")}'\r`);
    check('program with mouse tracking is running', await waitFor(async () => /MOUSE-APP-TEXT-9876/.test(await rows()) && await mouseOn(), { timeoutMs: 15000 }));
    const box = await lineBox();
    check('its text is on screen', !!box);

    console.log('-- plain drag selects and copies (task-022)');
    await ev(`window.carrotcap.writeClipboard('')`);
    await drag(box.x + 2, box.y, box.x + 260);
    const c1 = await clip();
    check('plain drag copies the text (copy-on-select)', /MOUSE-APP-TEXT/.test(c1), JSON.stringify(c1));
    check('the program keeps its mouse tracking', await mouseOn());

    console.log('-- Ctrl+C with a selection copies');
    await ev(`window.carrotcap.writeClipboard('')`);
    await app.key('c', 'KeyC', 67, 2);
    await sleep(500);
    check('Ctrl+C copies the selection', /MOUSE-APP-TEXT/.test(await clip()));
    check('Ctrl+C with a selection did not stop the program', await mouseOn() && /MOUSE-APP-TEXT/.test(await rows()));

    console.log('-- double click selects a word');
    await ev(`window.carrotcap.writeClipboard('')`);
    const wx = box.x + 30;
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: wx, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: wx, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: wx, y: box.y, button: 'left', buttons: 1, clickCount: 2 });
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: wx, y: box.y, button: 'left', buttons: 0, clickCount: 2 });
    await sleep(600);
    const word = await clip();
    check('double click copies the word under the mouse', word.trim() === 'MOUSE-APP-TEXT-9876', JSON.stringify(word));
    check('focus stays in the terminal', await ev(`document.activeElement && document.activeElement.classList.contains('xterm-helper-textarea')`));

    console.log('-- triple click selects the line');
    await ev(`window.carrotcap.writeClipboard('')`);
    for (const n of [1, 2, 3]) {
      await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: wx, y: box.y, button: 'left', buttons: 1, clickCount: n });
      await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: wx, y: box.y, button: 'left', buttons: 0, clickCount: n });
    }
    await sleep(600);
    check('triple click copies the whole line', /MOUSE-APP-TEXT-9876 copy me please/.test(await clip()), JSON.stringify(await clip()));

    console.log('-- which clicks reach the program');
    const logText = () => (fs.existsSync(mouseLog) ? fs.readFileSync(mouseLog, 'latin1') : '');
    fs.writeFileSync(mouseLog, '');
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: wx, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: wx, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(600);
    check('a plain left click is used for selection, not sent to the program', !/\x1b\[</.test(logText()), JSON.stringify(logText()));
    fs.writeFileSync(mouseLog, '');
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: wx, y: box.y, button: 'left', buttons: 1, clickCount: 1, modifiers: 2 });
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: wx, y: box.y, button: 'left', buttons: 0, clickCount: 1, modifiers: 2 });
    await sleep(600);
    check('Ctrl+click still goes to the program (SGR mouse report)', /\x1b\[<\d+;\d+;\d+M/.test(logText()), JSON.stringify(logText()));
    fs.writeFileSync(mouseLog, '');
    await app.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: wx, y: box.y, deltaX: 0, deltaY: -120 });
    await sleep(600);
    check('the wheel still goes to the program', /\x1b\[<6[45];/.test(logText()), JSON.stringify(logText()));
    fs.writeFileSync(mouseLog, '');
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: wx, y: box.y, button: 'right', buttons: 2, clickCount: 1 });
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: wx, y: box.y, button: 'right', buttons: 0, clickCount: 1 });
    await sleep(600);
    check('right click is not turned into a selection (it reaches the program)', /\x1b\[<2;\d+;\d+M/.test(logText()), JSON.stringify(logText()));
    await app.key('Escape', 'Escape', 27); // close the pane menu if it opened
    await sleep(300);

    console.log('-- Shift+drag still selects');
    await ev(`window.carrotcap.writeClipboard('')`);
    await drag(box.x + 2, box.y, box.x + 200, 8);
    check('Shift+drag copies too', /MOUSE-APP-TEXT/.test(await clip()));

    await write('q');
    await waitFor(async () => !(await mouseOn()), { timeoutMs: 5000 });
  } finally {
    if (clipBefore && clipBefore.ok) await ev(`window.carrotcap.writeClipboard(${JSON.stringify(clipBefore.text)})`).catch(() => {});
    await app.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* shell may hold a file */ }
  }
  console.log('');
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
