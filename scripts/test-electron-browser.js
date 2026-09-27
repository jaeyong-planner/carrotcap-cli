// Browser mode E2E (task-015): a local test site with console errors and a button.
// Checks layout, URL validation, console error capture, PC/mobile emulation, element
// annotation, and that a chat message carries the browser context + a screenshot.
//
// Usage: node scripts/test-electron-browser.js   (npm run test:browser)

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { launchApp, sleep, waitFor } = require('./lib/cdp-app');

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else      { console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail++; }
}

const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CC Test Shop</title></head><body style="margin:0;font-family:sans-serif">
<h1 id="hello">Hello</h1>
<button id="buy" class="btn primary" style="margin:40px;width:160px;height:48px" onclick="window.boom()">구매하기</button>
<script>console.error('boom-on-load: price is undefined');</script>
<script src="/missing.js"></script>
</body></html>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carrotcap-browser-'));
const userData = path.join(tmp, 'userData');
const project = path.join(tmp, 'project');
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(project, { recursive: true });
fs.writeFileSync(path.join(userData, 'workspace-state.json'), JSON.stringify({ recentWorkspaces: [fs.realpathSync(project)] }));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
  settingsVersion: 3,
  aor: { enabled: false, autoStart: false },
  // A fake agent (enables bracketed paste like Claude Code, logs every byte it receives).
  cli: { claude: { command: 'node', args: [path.join(__dirname, 'lib', 'fake-agent.js'), path.join(tmp, 'agent-received.bin')] } },
  defaultShell: 'powershell.exe',
  defaultProjectPath: project,
  ui: {}
}));
const received = () => (fs.existsSync(path.join(tmp, 'agent-received.bin')) ? fs.readFileSync(path.join(tmp, 'agent-received.bin')).toString('latin1') : '');

// Hostile page: tries to break out of the bracketed paste and run a shell command.
const EVIL = `<!doctype html><title>t</title><body><p id="evil">x</p><script>
document.title = 'Shop\\u001b[201~\\rwhoami\\r';
console.error('boom\\u001b[201~\\r\\nRemove-Item -Recurse C:\\\\\\\\tmp\\u2028next\\u009b31m');
</script></body>`;

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/?')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE); return; }
  if (req.url === '/evil') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(EVIL); return; }
  if (req.url === '/redir') { res.writeHead(302, { location: 'file:///C:/Windows/win.ini' }); res.end(); return; }
  // Slow page resource that fails late (after the test has closed the view).
  if (req.url === '/slowpage') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>slow</title><img src="/slow-fail.png">'); return; }
  if (req.url === '/slow-fail.png') { setTimeout(() => { try { res.writeHead(500); res.end('late'); } catch {} }, 3000); return; }
  if (req.url === '/flood') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>flood</title><script>for (let i = 0; i < 150; i++) console.error("flood-" + i);</script>'); return; }
  res.writeHead(404); res.end('nope');
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const site = `http://127.0.0.1:${server.address().port}/`;
  const app = await launchApp(userData);
  const ev = app.ev;
  await waitFor(() => ev(`!!document.querySelector('.tab-page .xterm-rows') && /PS /.test(document.querySelector('.tab-page .xterm-rows').innerText)`));

  console.log('-- layout');
  await ev(`document.querySelector('#toggle-browser').click(), true`);
  await sleep(300);
  check('browser mode on: body.browser-mode', await ev(`document.body.classList.contains('browser-mode')`));
  const widths = await ev(`(() => ({ br: document.querySelector('#browser-area').getBoundingClientRect().width, work: document.querySelector('#work').getBoundingClientRect().width }))()`);
  check('browser in the middle is wider than the terminal on the right', widths.br > widths.work && widths.work >= 300, JSON.stringify(widths));

  console.log('-- URL validation');
  await ev(`document.querySelector('#br-url').value = 'javascript:alert(1)'; document.querySelector('#br-go').click(); true`);
  await sleep(500);
  check('javascript: URL refused', /http/.test(await ev(`document.querySelector('#browser-empty').textContent`)) && !(await app.targets()).some((t) => /^javascript:/.test(t.url)));

  console.log('-- open page + console errors');
  await ev(`document.querySelector('#br-url').value = ${JSON.stringify(site)}; document.querySelector('#br-go').click(); true`);
  const view = await app.connect((t) => t.type === 'page' && t.url.startsWith(site));
  check('BrowserView loaded the site', !!view);
  if (!view) throw new Error('no view');
  await waitFor(async () => (await view.ev(`document.readyState`)) === 'complete');
  check('page script cannot see the app bridge', (await view.ev(`typeof window.carrotcap`)) === 'undefined');
  check('console errors captured (console.error + missing script)', await waitFor(async () => Number(await ev(`document.querySelector('#br-err-count').textContent`)) >= 2),
    await ev(`document.querySelector('#br-err-count').textContent`));
  check('new-error badge highlighted', await ev(`document.querySelector('#br-err-count').classList.contains('has')`));
  await ev(`document.querySelector('#br-console').click(), true`);
  await sleep(400);
  check('console panel lists the error text', /boom-on-load/.test(await ev(`document.querySelector('#browser-console').innerText`)));
  await ev(`document.querySelector('#br-console').click(), true`);

  console.log('-- PC / mobile');
  const pcWidth = await view.ev(`innerWidth`);
  await ev(`document.querySelector('#br-mobile').click(), true`);
  check('mobile: viewport 390 wide', await waitFor(async () => (await view.ev(`innerWidth`)) === 390), String(await view.ev(`innerWidth`)));
  check('mobile: mobile user agent', /iPhone/.test(await view.ev(`navigator.userAgent`)));
  check('mobile: touch enabled', (await view.ev(`navigator.maxTouchPoints`)) > 0);
  await ev(`document.querySelector('#br-desktop').click(), true`);
  check('back to PC width', await waitFor(async () => (await view.ev(`innerWidth`)) === pcWidth), `${pcWidth} vs ${await view.ev(`innerWidth`)}`);

  console.log('-- annotation');
  await ev(`document.querySelector('#br-annotate').click(), true`);
  await sleep(500);
  const r = await view.ev(`(() => { const b = document.querySelector('#buy').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await view.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  }
  check('pin chip for the clicked button', await waitFor(async () => /button/.test(await ev(`[...document.querySelectorAll('#br-pins .br-pin')].map((p) => p.textContent + ' ' + p.title).join('|')`))),
    await ev(`document.querySelector('#br-pins').innerText`));
  check('pin selector names the element', /#buy/.test(await ev(`(document.querySelector('#br-pins .br-pin') || {}).title || ''`)));
  check('numbered pin drawn in the page', (await view.ev(`document.querySelectorAll('[data-cc-pin]').length`)) === 1);
  check('clicking while annotating did not trigger the page handler', !(await view.ev(`window.__boomed === true`)));
  check('annotation mode stays on for the next pin', await ev(`document.querySelector('#br-annotate').classList.contains('active')`));

  console.log('-- plain shell never receives browser context (review C3)');
  const screen = () => ev(`(document.querySelector('.tab-page.active .xterm-rows') || {}).innerText || ''`);
  console.log('-- console errors are attached to the chat input by button (task-019)');
  const notice = () => ev(`document.querySelector('#composer-notice').textContent`);
  const composerVal = () => ev(`document.querySelector('#composer-input').value`);
  const attachText = () => ev(`(() => { const a = document.querySelector('#composer-attach'); return a && !a.hidden ? a.innerText : ''; })()`);
  check('errors button shows the new-error count', /새 콘솔 에러 \d+건/.test(await ev(`document.querySelector('#br-errors-to-chat').textContent`)) && !(await ev(`document.querySelector('#br-errors-to-chat').disabled`)));
  await ev(`document.querySelector('#composer-input').value = '1번 버튼 눌러도 결제가 안 돼'; const b = document.querySelector('#br-errors-to-chat'); b.click(); b.click(); true`); // fast double click
  check('click attaches the new console errors to the chat input', await waitFor(async () => /boom-on-load/.test(await attachText())), await attachText());
  check('attachment shows the count', /콘솔 에러 \d+건 첨부/.test(await attachText()));
  check('typed text untouched — page text never enters the editable input', (await composerVal()) === '1번 버튼 눌러도 결제가 안 돼');
  check('one attachment after a fast double click', (await ev(`document.querySelectorAll('#composer-attach .composer-attach-head').length`)) === 1);
  check('attachment is not selectable text', (await ev(`getComputedStyle(document.querySelector('#composer-attach')).userSelect`)) === 'none');
  check('errors stay "new" until actually sent', await ev(`document.querySelector('#br-err-count').classList.contains('has')`));
  await ev(`document.querySelector('#composer-attach-remove').click(), true`);
  check('✕ removes the attachment', (await attachText()) === '' && !(await ev(`window.CarrotcapBrowser.hasAttachment()`)));
  check('focus goes back to the input after ✕', (await ev(`document.activeElement && document.activeElement.id`)) === 'composer-input');
  await ev(`document.querySelector('#br-errors-to-chat').click(), true`);
  await waitFor(async () => /boom-on-load/.test(await attachText()));

  await ev(`document.querySelector('#composer-notice').textContent = ''; document.querySelector('#composer-send').click(); true`);
  await sleep(800);
  check('send to a plain PowerShell pane is refused', /에이전트 페인에만/.test(await notice()));
  check('typed text and attachment kept', (await composerVal()) === '1번 버튼 눌러도 결제가 안 돼' && /boom-on-load/.test(await attachText()));
  check('pins not consumed by the refused send', (await ev(`document.querySelectorAll('#br-pins .br-pin').length`)) === 1);
  check('nothing pasted into the shell', !/브라우저 컨텍스트|boom-on-load/.test(await screen()));
  // decorate() failing must not let an attachment fall through to the plain path.
  await ev(`window.__ccDecorate = window.CarrotcapBrowser.decorate; window.CarrotcapBrowser.decorate = async () => { throw new Error('simulated IPC failure'); }; true`);
  await ev(`document.querySelector('#composer-notice').textContent = ''; document.querySelector('#composer-send').click(); true`);
  await sleep(800);
  check('decorate failure with an attachment is fail-closed (refused, all kept)', /만들지 못했습니다/.test(await notice()) && /boom-on-load/.test(await attachText()) && !/boom-on-load/.test(await screen()), await notice());
  await ev(`window.CarrotcapBrowser.decorate = window.__ccDecorate; delete window.__ccDecorate; true`);
  await ev(`document.querySelector('#composer-input').value = '1번 버튼 눌러도 결제가 안 돼'; true`);

  console.log('-- agent pane receives the browser context');
  await ev(`document.querySelector('.btn-cli[data-cli="claude"]').click(), true`);
  check('fake agent started', await waitFor(async () => /fake-agent ready/.test(await screen())));
  await sleep(500);
  // ✕ between preparing the send and delivering it: nothing is sent (review r4).
  fs.writeFileSync(path.join(tmp, 'agent-received.bin'), '');
  await ev(`window.__ccDecorate = window.CarrotcapBrowser.decorate; window.CarrotcapBrowser.decorate = async (...a) => { const r = await window.__ccDecorate(...a); const x = document.querySelector('#composer-attach-remove'); if (x) x.click(); return r; }; true`);
  await ev(`document.querySelector('#composer-notice').textContent = ''; document.querySelector('#composer-send').click(); true`);
  await sleep(1200);
  check('attachment removed while the send was prepared → nothing sent', /첨부가 바뀌어/.test(await notice()) && received() === '' && (await composerVal()) === '1번 버튼 눌러도 결제가 안 돼', `${await notice()} | ${JSON.stringify(received().slice(0, 60))}`);
  check('pins kept by the cancelled send', (await ev(`document.querySelectorAll('#br-pins .br-pin').length`)) === 1);
  await ev(`window.CarrotcapBrowser.decorate = window.__ccDecorate; delete window.__ccDecorate; document.querySelector('#br-errors-to-chat').click(); true`);
  await waitFor(async () => /boom-on-load/.test(await attachText()));
  // Refresh clicked right as the send starts: held until the send is over (review r5).
  await ev(`document.querySelector('#composer-send').click(); const rb = document.querySelector('#br-errors-to-chat'); window.__ccRefreshDisabled = rb.disabled; rb.click(); true`);
  check('attach button is disabled while a send is in flight', await ev(`window.__ccRefreshDisabled === true`));
  check('agent received the [브라우저 컨텍스트] block', await waitFor(() => /\[\S*\s?\S*\]|CARROTCAP/.test(received()) && received().includes('\x1b[201~')), JSON.stringify(received().slice(0, 120)));
  const got = Buffer.from(received(), 'latin1').toString('utf8');
  check('context names the pinned element and the request', /#buy/.test(got) && /결제가 안 돼/.test(got) && /boom-on-load/.test(got), JSON.stringify(got.slice(0, 300)));
  check('sent as ONE bracketed paste (exactly one 200~/201~ pair)', got.split('\x1b[200~').length === 2 && got.split('\x1b[201~').length === 2);
  const shotsDir = path.join(userData, 'browser-shots');
  const shots = fs.existsSync(shotsDir) ? fs.readdirSync(shotsDir) : [];
  check('screenshot with pins saved in the app data dir', shots.some((f) => /^shot-.*\.png$/.test(f)), shots.join(','));
  check('context points the agent at that screenshot', got.includes(shotsDir.replace(/\\/g, '\\')) || /browser-shots/.test(got));
  check('nothing written into the project folder (review r3 C2)', fs.readdirSync(project).length === 0, fs.readdirSync(project).join(','));
  check('sent pins are consumed (list and page cleared)', await waitFor(async () => (await ev(`document.querySelectorAll('#br-pins .br-pin').length`)) === 0 && (await view.ev(`document.querySelectorAll('[data-cc-pin]').length`)) === 0));
  check('sent errors no longer flagged as new', await waitFor(async () => !(await ev(`document.querySelector('#br-err-count').classList.contains('has')`))));
  check('errors button disabled again after sending', await waitFor(async () => await ev(`document.querySelector('#br-errors-to-chat').disabled`)));
  check('no attachment left after the send (nothing to deliver twice)', (await attachText()) === '' && !(await ev(`window.CarrotcapBrowser.hasAttachment()`)));

  console.log('-- hostile page text cannot break out of the paste (review C3)');
  fs.writeFileSync(path.join(tmp, 'agent-received.bin'), '');
  await ev(`document.querySelector('#br-url').value = ${JSON.stringify(site + 'evil')}; document.querySelector('#br-go').click(); true`);
  // Wait until the hostile console error itself is recorded (not just any new error).
  await waitFor(async () => (await ev(`window.carrotcap.browserErrors()`)).some((e) => /boom/.test(e.message)));
  await sleep(300);
  if (process.env.CC_DEBUG) console.log('   before send:', await ev(`document.querySelector('#br-err-count').className`), JSON.stringify(await ev(`window.carrotcap.browserErrors()`)).slice(0, 300));
  await ev(`document.querySelector('#composer-input').value = 'check errors'; true`);
  await waitFor(async () => !(await ev(`document.querySelector('#br-errors-to-chat').disabled`)));
  await ev(`document.querySelector('#br-errors-to-chat').click(), true`);
  await waitFor(async () => /boom/.test(await attachText()));
  check('hostile error text never enters the editable input', (await composerVal()) === 'check errors');
  check('attachment preview is plain text (no markup from the page)', (await ev(`document.querySelectorAll('#composer-attach *:not(div):not(span):not(button)').length`)) === 0);
  // Reverse race: a refresh already requested, then send — the send still goes (review r6).
  await ev(`document.querySelector('#composer-notice').textContent = ''; document.querySelector('#br-errors-to-chat').click(); document.querySelector('#composer-send').click(); true`);
  check('agent got the hostile page context', await waitFor(() => received().includes('\x1b[201~')));
  check('a refresh in flight does not cancel the send', !/첨부가 바뀌어/.test(await notice()), await notice());
  await sleep(800);
  check('and leaves no attachment behind', (await attachText()) === '' && !(await ev(`window.CarrotcapBrowser.hasAttachment()`)));
  check('annotation mode survived the navigation (review r2 M4)', await ev(`document.querySelector('#br-annotate').classList.contains('active')`));
  const evil = Buffer.from(received(), 'latin1').toString('utf8');
  const inner = evil.slice(evil.indexOf('\x1b[200~') + 6, evil.lastIndexOf('\x1b[201~'));
  check('no ESC inside the pasted block (page ESC stripped)', !inner.includes('\x1b'), JSON.stringify(inner.slice(0, 200)));
  check('exactly one paste terminator', evil.split('\x1b[201~').length === 2);
  check('no C1 / U+2028 from the page', !/[\u0080-\u009F\u{2028}\u{2029}]/u.test(inner));
  check('page text still readable', /boom/.test(inner) && /Remove-Item/.test(inner), JSON.stringify(inner.slice(0, 600)));

  console.log('-- an attachment belongs to its document (task-019)');
  await ev(`document.querySelector('#composer-input').value = ''; document.querySelector('#br-reload').click(), true`);
  await waitFor(async () => !(await ev(`document.querySelector('#br-errors-to-chat').disabled`)));
  await ev(`document.querySelector('#br-errors-to-chat').click(), true`);
  await waitFor(async () => /boom/.test(await attachText()));
  await ev(`document.querySelector('#composer-notice').textContent = ''; document.querySelector('#br-reload').click(), true`);
  check('navigation drops the attachment', await waitFor(async () => (await attachText()) === '' && !(await ev(`window.CarrotcapBrowser.hasAttachment()`))));
  check('and says so', /콘솔 에러 첨부를 뺐습니다/.test(await notice()), await notice());
  fs.writeFileSync(path.join(tmp, 'agent-received.bin'), '');
  await ev(`document.querySelector('#composer-input').value = 'still here?'; document.querySelector('#composer-send').click(); true`);
  await waitFor(() => received().includes('still here?'));
  check('a later send carries no error from the old document', !/boom/.test(received()));

  console.log('-- redirect to file: is blocked (review C1)');
  await ev(`document.querySelector('#br-url').value = ${JSON.stringify(site + 'redir')}; document.querySelector('#br-go').click(); true`);
  await sleep(2500);
  const urls = (await app.targets()).map((t) => t.url);
  check('view never lands on a file: URL', !urls.some((u) => /^file:\/\/\/C:\/Windows/i.test(u)), JSON.stringify(urls));

  console.log('-- project junctions are never followed; one send = one context (review C2, r3)');
  const outside = path.join(tmp, 'outside');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'shot-2000-01-01T00-00-00-000Z.png'), 'victim');
  fs.mkdirSync(path.join(project, '.carrotcap'), { recursive: true });
  fs.symlinkSync(outside, path.join(project, '.carrotcap', 'browser'), 'junction'); // hostile repo layout
  await ev(`document.querySelector('#br-url').value = ${JSON.stringify(site)}; document.querySelector('#br-go').click(); true`);
  let view2 = await app.connect((t) => t.type === 'page' && t.url === site);
  await waitFor(async () => (await view2.ev(`!!document.querySelector('#buy')`)) === true);
  await ev(`document.querySelector('#br-annotate').classList.contains('active') || document.querySelector('#br-annotate').click(), true`);
  await sleep(800);
  const r2 = await view2.ev(`(() => { const b = document.querySelector('#buy').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await view2.send('Input.dispatchMouseEvent', { type, x: r2.x, y: r2.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  }
  await waitFor(async () => (await ev(`document.querySelectorAll('#br-pins .br-pin').length`)) > 0);
  fs.writeFileSync(path.join(tmp, 'agent-received.bin'), '');
  // Double send: the second click must not deliver the same context again.
  await ev(`document.querySelector('#composer-input').value = 'pin via junction'; document.querySelector('#composer-send').click(); document.querySelector('#composer-send').click(); true`);
  await waitFor(() => received().includes('[201~'));
  await sleep(1500);
  const once = Buffer.from(received(), 'latin1').toString('utf8');
  check('double click delivers the context once', once.split('[브라우저 컨텍스트').length === 2, String(once.split('[브라우저 컨텍스트').length - 1));
  check('nothing written through the project junction', fs.readdirSync(outside).length === 1, fs.readdirSync(outside).join(','));
  check('file behind the junction not pruned', fs.existsSync(path.join(outside, 'shot-2000-01-01T00-00-00-000Z.png')));
  check('screenshot still taken (app data dir)', /browser-shots/.test(once));

  console.log('-- same-URL reload drops old pins (review r4)');
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await view2.send('Input.dispatchMouseEvent', { type, x: r2.x, y: r2.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  }
  await waitFor(async () => (await ev(`document.querySelectorAll('#br-pins .br-pin').length`)) > 0);
  await ev(`document.querySelector('#br-reload').click(), true`);
  check('pins cleared after reloading the same URL', await waitFor(async () => (await ev(`document.querySelectorAll('#br-pins .br-pin').length`)) === 0));
  check('annotation mode still on after reload', await ev(`document.querySelector('#br-annotate').classList.contains('active')`));

  console.log('-- page-made clicks never create pins; pins are capped (review r11)');
  await sleep(800);
  await view2.ev(`(async () => {
    for (let i = 0; i < 40; i++) {
      for (const d of document.querySelectorAll('div')) if (d.style.cursor === 'crosshair') d.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: ${r2.x}, clientY: ${r2.y} }));
      await new Promise((r) => setTimeout(r, 20));
    }
    return true;
  })()`);
  await sleep(500);
  check('synthetic clicks from the page add no pin', (await ev(`document.querySelectorAll('#br-pins .br-pin').length`)) === 0
    && (await view2.ev(`document.querySelectorAll('[data-cc-pin]').length`)) === 0);
  let made = 0;
  for (let i = 0; i < 21; i++) {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await view2.send('Input.dispatchMouseEvent', { type, x: r2.x, y: r2.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    }
    const want = Math.min(i + 1, 20);
    await waitFor(async () => (await ev(`document.querySelectorAll('#br-pins .br-pin').length`)) >= want, { timeoutMs: 3000 });
    made = await ev(`document.querySelectorAll('#br-pins .br-pin').length`);
  }
  await sleep(500);
  check('pins stop at 20', made === 20 && (await view2.ev(`document.querySelectorAll('[data-cc-pin]').length`)) === 20, String(made));
  check('annotation mode turns off at the cap', !(await ev(`document.querySelector('#br-annotate').classList.contains('active')`)));
  await ev(`document.querySelector('#br-clear').click(), true`);
  await waitFor(async () => (await ev(`document.querySelectorAll('#br-pins .br-pin').length`)) === 0);
  check('clear removes every pin from the page', await waitFor(async () => (await view2.ev(`document.querySelectorAll('[data-cc-pin]').length`)) === 0));
  await ev(`document.querySelector('#br-annotate').click(), true`);
  await sleep(500);

  console.log('-- context token is refused after the page changes (review r6)');
  const agentPty = await ev(`document.querySelector('.tab-page.active .pane.active').dataset.ptyId`);
  await for_pin();
  async function for_pin() {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await view2.send('Input.dispatchMouseEvent', { type, x: r2.x, y: r2.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    }
    await waitFor(async () => (await ev(`document.querySelectorAll('#br-pins .br-pin').length`)) > 0);
  }
  const gen = await ev(`(async () => { const s = await new Promise((r) => { const off = window.carrotcap.onBrowserState((x) => { off(); r(x); }); window.carrotcap.browserNav('reload'); }); return s.pageGen; })()`);
  await sleep(1500);
  const ctx = await ev(`window.carrotcap.browserContext({ screenshot: false, includeErrors: false, gen: ${Number(gen) + 0} })`).catch(() => null);
  const liveGen = await ev(`window.carrotcap.browserContext({ screenshot: false, includeErrors: false, gen: -99 })`);
  check('stale generation gets no context', !!liveGen && liveGen.stale === true);
  // Take a fresh, valid context token, then change the page before redeeming it.
  const cur = await ev(`(async () => { for (let g = 0; g < 200; g++) { const c = await window.carrotcap.browserContext({ screenshot: false, includeErrors: false, gen: g }); if (c && !c.stale) return c; } return null; })()`);
  check('a valid context token is issued', !!cur && typeof cur.token === 'string', JSON.stringify(ctx));
  await ev(`window.carrotcap.browserNav('reload'), true`);
  await sleep(1500);
  fs.writeFileSync(path.join(tmp, 'agent-received.bin'), '');
  const redeemed = await ev(`window.carrotcap.pasteGuarded(${JSON.stringify(agentPty)}, '# stale context', ${JSON.stringify(cur && cur.token)})`);
  check('paste with a token from an older document is refused', redeemed === false);
  check('nothing reached the agent', !received().includes('stale context'));
  const cur2 = await ev(`(async () => { for (let g = 0; g < 400; g++) { const c = await window.carrotcap.browserContext({ screenshot: false, includeErrors: false, gen: g }); if (c && !c.stale) return c; } return null; })()`);
  const ok = await ev(`window.carrotcap.pasteGuarded(${JSON.stringify(agentPty)}, '# fresh context', ${JSON.stringify(cur2 && cur2.token)})`);
  check('same call with a current token succeeds', ok === true && await waitFor(() => received().includes('fresh context')));
  const reuse = await ev(`window.carrotcap.pasteGuarded(${JSON.stringify(agentPty)}, '# replay', ${JSON.stringify(cur2 && cur2.token)})`);
  check('a token works only once', reuse === false);
  // Attaching console errors (a lookup that is never pasted) must not replace the ticket of a
  // send in flight (review r4).
  const cur5 = await ev(`(async () => { for (let g = 0; g < 400; g++) { const c = await window.carrotcap.browserContext({ screenshot: false, includeErrors: false, gen: g }); if (c && !c.stale) return c; } return null; })()`);
  const lookup = await ev(`(async () => { for (let g = 0; g < 400; g++) { const c = await window.carrotcap.browserContext({ screenshot: false, includeErrors: true, noToken: true, gen: g }); if (c && !c.stale) return c; } return null; })()`);
  check('error lookup with noToken hands out no token', !!lookup && lookup.token === undefined);
  const afterLookup = await ev(`window.carrotcap.pasteGuarded(${JSON.stringify(agentPty)}, '# after lookup', ${JSON.stringify(cur5 && cur5.token)})`);
  check('a pending send token survives an error lookup', afterLookup === true && await waitFor(() => received().includes('after lookup')));
  // Redeem right behind a reload request: the IPC can land before
  // did-start-navigation bumps pageGen (review r10).
  const cur3 = await ev(`(async () => { for (let g = 0; g < 400; g++) { const c = await window.carrotcap.browserContext({ screenshot: false, includeErrors: false, gen: g }); if (c && !c.stale) return c; } return null; })()`);
  const racing = await ev(`(() => { window.carrotcap.browserNav('reload'); return window.carrotcap.pasteGuarded(${JSON.stringify(agentPty)}, '# racing context', ${JSON.stringify(cur3 && cur3.token)}); })()`);
  check('a token redeemed as a navigation starts is refused', !!cur3 && racing === false);
  await sleep(300);
  check('nothing from the racing send reached the agent', !received().includes('racing context'));
  await sleep(1200);

  console.log('-- error cursor survives ring-buffer overflow (review r5/r6)');
  await ev(`document.querySelector('#br-url').value = ${JSON.stringify(site + 'flood')}; document.querySelector('#br-go').click(); true`);
  const flood = await app.connect((t) => t.type === 'page' && t.url === site + 'flood');
  await waitFor(async () => (await ev(`window.carrotcap.browserErrors()`)).some((e) => /flood-149/.test(e.message)));
  const fctx = await ev(`(async () => { for (let g = 0; g < 400; g++) { const c = await window.carrotcap.browserContext({ screenshot: false, includeErrors: true, gen: g }); if (c && !c.stale) return c; } return null; })()`);
  check('only the newest 8 attached, the rest of the 100-entry buffer counted', fctx && fctx.errors.length === 8 && fctx.errorsSkipped === 92, fctx && `${fctx.errors.length} / skipped ${fctx.errorsSkipped}`);
  await flood.ev(`console.error('after-mark-1'), true`);
  await sleep(500);
  await ev(`window.carrotcap.browserCommit(${fctx ? fctx.errorMark : -1})`);
  await sleep(300);
  const after1 = await ev(`(async () => { for (let g = 0; g < 400; g++) { const c = await window.carrotcap.browserContext({ screenshot: false, includeErrors: true, gen: g }); if (c && !c.stale) return c; } return null; })()`);
  check('an error logged after the context stays new after commit', after1 && after1.errors.length === 1 && /after-mark-1/.test(after1.errors[0].message), JSON.stringify(after1 && after1.errors));
  flood.close();

  console.log('-- previous document\'s late request is not blamed on the new page (review r9)');
  await ev(`document.querySelector('#br-url').value = ${JSON.stringify(site + 'slowpage')}; document.querySelector('#br-go').click(); true`);
  await sleep(600);
  await ev(`document.querySelector('#br-url').value = ${JSON.stringify(site + 'flood')}; document.querySelector('#br-go').click(); true`); // same view, new document
  await sleep(4500);
  const sameView = await ev(`(async () => { for (let g = 0; g < 600; g++) { const c = await window.carrotcap.browserContext({ screenshot: false, includeErrors: true, gen: g }); if (c && !c.stale) return c; } return null; })()`);
  check('new page context carries no error from the previous document', !!sameView && !sameView.errors.some((e) => /slow-fail|slowpage/.test(e.message)), JSON.stringify(sameView && sameView.errors.map((e) => e.message).slice(0, 3)));

  console.log('-- late network errors of a closed view are ignored (review r6)');
  await ev(`document.querySelector('#br-url').value = ${JSON.stringify(site + 'slowpage')}; document.querySelector('#br-go').click(); true`);
  await sleep(600);
  await ev(`document.querySelector('#toggle-browser').click(), true`); // close while /slow-fail.png is pending
  await sleep(300);
  await ev(`document.querySelector('#toggle-browser').click(), true`);
  await ev(`document.querySelector('#br-url').value = ${JSON.stringify(site)}; document.querySelector('#br-go').click(); true`);
  await sleep(4500); // the old request fails at ~3s
  check('late 500 of the closed view is not reported for the new page', !(await ev(`window.carrotcap.browserErrors()`)).some((e) => /slow-fail/.test(e.message)));
  const view3 = await app.connect((t) => t.type === 'page' && t.url === site);
  await ev(`document.querySelector('#br-annotate').classList.contains('active') || document.querySelector('#br-annotate').click(), true`);
  await sleep(600);
  const view2Old = view2;
  view2Old.close();
  // continue the next sections on the reopened view
  view2 = view3;

  console.log('-- agent exits back to the shell: context never executes (review r5 C3)');
  check('context lines are shell comments ("# ")', got.split(/\r|\n/).filter((l) => /브라우저 컨텍스트|URL:|주석:|콘솔 에러/.test(l)).every((l) => /^(\x1b\[200~)?# /.test(l)));
  await ev(`document.querySelector('#composer-input').value = 'QUIT'; document.querySelector('#composer-send').click(); true`);
  check('fake agent exited', await waitFor(async () => /fake-agent bye/.test(await screen())));
  await waitFor(async () => /PS [^\n]*>\s*$/.test((await screen()).trimEnd() + ' '));
  await sleep(1500);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await view2.send('Input.dispatchMouseEvent', { type, x: r2.x, y: r2.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  }
  await waitFor(async () => (await ev(`document.querySelectorAll('#br-pins .br-pin').length`)) > 0);
  const before = await screen();
  await ev(`document.querySelector('#composer-input').value = 'Write-Output typed-by-user'; document.querySelector('#composer-send').click(); true`);
  await sleep(2500);
  const after = (await screen()).slice(before.length > 200 ? before.length - 200 : 0);
  const target = await ev(`document.querySelector('#composer-notice').textContent`);
  const refused = /전송 실패|에이전트 페인에만/.test(target);
  // Either main refused (bracketed off in the shell) or, if the shell has bracketed paste on,
  // every context line reached PowerShell as a comment — nothing may run as a command.
  check('shell did not execute page text (refused, or only comments arrived)',
    refused || !/is not recognized|인식되지 않습니다|CommandNotFound/.test(after), `target=${target} tail=${JSON.stringify(after.slice(-300))}`);
  if (process.env.CC_DEBUG) console.log('   shell case:', refused ? 'refused by guard' : 'delivered as comments');
  view2.close();

  console.log('-- closing the browser drops the attachment; history holds typed text only (task-019)');
  await ev(`document.querySelector('#br-reload').click(), true`);
  await waitFor(async () => !(await ev(`document.querySelector('#br-errors-to-chat').disabled`)));
  await sleep(1000); // let the reload's navigation events settle (they would drop a new attachment)
  await ev(`document.querySelector('#br-errors-to-chat').click(), true`);
  await waitFor(async () => /boom-on-load/.test(await attachText()));
  await sleep(300);

  check('attachment present before closing', /boom-on-load/.test(await attachText()), `${await attachText()} | btn=${await ev(`document.querySelector('#br-errors-to-chat').textContent`)} disabled=${await ev(`document.querySelector('#br-errors-to-chat').disabled`)}`);

  console.log('-- close');
  // Refresh the attachment and close in the same tick: the late lookup must not re-attach (review r4).
  await ev(`document.querySelector('#br-errors-to-chat').click(); document.querySelector('#toggle-browser').click(); true`);
  check('browser view destroyed on close', await waitFor(async () => !(await app.targets()).some((t) => t.url.startsWith(site))));
  check('layout back to terminal only', !(await ev(`document.body.classList.contains('browser-mode')`)));
  await sleep(1000);
  check('closing the browser drops the attachment (and a late lookup does not bring it back)', (await attachText()) === '' && !(await ev(`window.CarrotcapBrowser.hasAttachment()`)));
  check('and says so', /브라우저를 닫아 콘솔 에러 첨부를 뺐습니다/.test(await notice()), await notice());
  // Real history recall (↑ in an empty input box): only what was typed, never page text.
  await ev(`document.querySelector('#composer-input').value = ''; document.querySelector('#composer-input').focus(), true`);
  const seen = [];
  for (let i = 0; i < 20; i++) {
    await app.key('ArrowUp', 'ArrowUp', 38);
    seen.push(await composerVal());
  }
  check('history recalls typed messages', seen.some((v) => /결제가 안 돼/.test(v)));
  check('history never contains page text', !seen.some((v) => /boom/.test(v)), JSON.stringify(seen.filter((v) => /boom/.test(v)).slice(0, 1)));
  await ev(`document.querySelector('#composer-input').value = 'Write-Output plain-ok'; document.querySelector('#composer-send').click(); true`);
  check('ordinary text still goes to the shell', await waitFor(async () => /plain-ok[\s\S]*plain-ok/.test(await screen())));
  view.close();
  await app.close();
})()
  .catch((e) => { console.log('  FAIL  harness ::', e.message); fail++; })
  .finally(() => {
    server.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* locked temp files */ }
    console.log('');
    console.log(`Summary: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
