// E2E (Windows): a pane closed while it waits for the registered PATH leaves no shell behind
// (task-027 review r3). The dev-tree registry file is read with a delay, so a new tab waits in
// pty:spawn; the tab is closed during that wait. Usage: node scripts/test-electron-winpath.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { launchApp, waitFor, sleep } = require('./lib/cdp-app');

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else      { console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail++; }
}
if (process.platform !== 'win32') { console.log('Windows only — skipped'); process.exit(0); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-winpath-'));
const userData = path.join(tmp, 'user');
fs.mkdirSync(userData, { recursive: true });
// Quick CLI fixtures: CLAUDE = a fake that prints a marker (absolute path); GROK = a bare command
// that is NOT installed when the app starts and gets "installed" (registered) later
const bin = path.join(tmp, 'bin');
const lateDir = path.join(tmp, 'late tool');
for (const d of [bin, lateDir]) fs.mkdirSync(d, { recursive: true });
const fakeClaude = path.join(bin, 'fake-claude.cmd');
const fakeCodex = path.join(bin, 'fake-codex.cmd');
fs.writeFileSync(fakeCodex, ['@echo off', 'echo FAKE-REVIEW-RAN', ''].join(String.fromCharCode(13, 10)));
const project = path.join(tmp, 'project');
fs.mkdirSync(project, { recursive: true });
fs.writeFileSync(fakeClaude, ['@echo off', 'echo FAKE-CLI-RAN', ''].join(String.fromCharCode(13, 10)));
fs.writeFileSync(path.join(lateDir, 'zzlategrok.cmd'), ['@echo off', 'echo LATE-GROK-RAN', ''].join(String.fromCharCode(13, 10)));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ settingsVersion: 4, aor: { enabled: false, autoStart: false },
  cli: { claude: { command: fakeClaude, args: [] }, codex: { command: fakeCodex, args: [] }, grok: { command: 'zzlategrok', args: [] } },
  defaultProjectPath: project, ui: {} }));
fs.writeFileSync(path.join(userData, 'workspace-state.json'), JSON.stringify({ recentWorkspaces: [fs.realpathSync(project)] }));
const regFile = path.join(tmp, 'registered-path.json');
fs.writeFileSync(regFile, JSON.stringify({ machine: '', user: '' }));
process.env.CARROTCAP_TEST_REGISTRY_PATH = regFile;
process.env.CARROTCAP_TEST_REGISTRY_DELAY_MS = '2500';

// shells the app started: PowerShell processes anywhere under the app's process tree
function shellsUnder(rootPid) {
  const out = execFileSync(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId),$($_.Name)" }'],
    { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  const rows = out.split(/\r?\n/).filter(Boolean).map((l) => l.split(','));
  const kids = new Map();
  for (const [pid, ppid] of rows) { if (!kids.has(ppid)) kids.set(ppid, []); kids.get(ppid).push(pid); }
  const names = new Map(rows.map(([pid, , name]) => [pid, name]));
  const seen = new Set();
  const stack = [String(rootPid)];
  let n = 0;
  while (stack.length) {
    const p = stack.pop();
    for (const c of kids.get(p) || []) {
      if (seen.has(c)) continue;
      seen.add(c);
      if (/^(powershell|pwsh)\.exe$/i.test(names.get(c) || '')) n++;
      stack.push(c);
    }
  }
  return n;
}

(async () => {
  const app = await launchApp(userData);
  const ev = app.ev;
  const rows = () => ev(`(document.querySelector('.tab-page.active .xterm-rows')||{}).innerText||''`);
  try {
    check('first pane starts (after the slow registry read)', await waitFor(async () => /PS /.test(await rows()), { timeoutMs: 40000 }));
    await sleep(1500);
    const before = shellsUnder(app.pid);
    check('one shell for the one pane', before >= 1, String(before));

    console.log('-- a tab closed while its terminal waits for the registered PATH');
    await sleep(5600); // registry cache expired → the next spawn waits ~2.5 s
    const tabs0 = await ev(`document.querySelectorAll('.tab').length`);
    await ev(`document.querySelector('#new-tab').click(), true`);
    await sleep(600);
    check('the new tab exists and is still waiting (no shell yet)', (await ev(`document.querySelectorAll('.tab').length`)) === tabs0 + 1
      && (await ev(`!document.querySelector('.tab-page.active .pane.active').dataset.ptyId`)) === true);
    await ev(`document.querySelector('.tab.active .x').click(), true`);
    check('closed', (await ev(`document.querySelectorAll('.tab').length`)) === tabs0);
    await sleep(5000); // the spawn completes after the wait; its shell must be killed right away
    const after = shellsUnder(app.pid);
    check('no shell left behind for the closed tab', after === before, `before ${before}, after ${after}`);

    console.log('-- a tab kept open while it waits gets its shell as usual');
    await sleep(5600);
    await ev(`document.querySelector('#new-tab').click(), true`);
    check('it starts once the read is done', await waitFor(async () => /PS /.test(await rows()) && !!(await ev(`document.querySelector('.tab-page.active .pane.active').dataset.ptyId`)), { timeoutMs: 20000 }));
    check('one more shell', await waitFor(async () => shellsUnder(app.pid) === before + 1, { timeoutMs: 8000 }), String(shellsUnder(app.pid)));

    console.log('-- Quick CLI clicked while the new pane is still starting (review r4)');
    const count = (re) => ev(`((document.querySelector('.tab-page.active .xterm-rows')||{}).innerText||'').split(${JSON.stringify('FAKE-CLI-RAN')}).length - 1`);
    await sleep(5600);
    await ev(`document.querySelector('#new-tab').click(), true`);
    await sleep(300);
    check('the pane is still starting when CLAUDE is clicked', (await ev(`!document.querySelector('.tab-page.active .pane.active').dataset.ptyId`)) === true);
    await ev(`document.querySelector('.btn-cli[data-cli="claude"]').click(), true`);
    check('it waits, then the CLI runs exactly once in that pane', await waitFor(async () => (await count()) === 1, { timeoutMs: 15000 }) && (await sleep(1500), (await count()) === 1), String(await count()));

    console.log('-- a flow (REVIEW) clicked while the new pane is starting');
    const countIn = (marker) => ev(`((document.querySelector('.tab-page.active .xterm-rows')||{}).innerText||'').split(${JSON.stringify(marker)}).length - 1`);
    await sleep(5600);
    await ev(`document.querySelector('#new-tab').click(), true`);
    await sleep(300);
    await ev(`document.querySelector('.btn-flow[data-flow="review"]').click(), true`);
    check('REVIEW waits, then runs once in that pane', await waitFor(async () => (await countIn('FAKE-REVIEW-RAN')) === 1, { timeoutMs: 20000 }) && (await sleep(1500), (await countIn('FAKE-REVIEW-RAN')) === 1), String(await countIn('FAKE-REVIEW-RAN')));

    console.log('-- another pane picked during the wait: nothing runs anywhere (review r5)');
    const allText = () => ev(`[...document.querySelectorAll('.xterm-rows')].map((r) => r.innerText).join(' | ')`);
    const ranBefore = ((await allText()).split('FAKE-CLI-RAN').length - 1);
    await sleep(5600);
    await ev(`document.querySelector('#new-tab').click(), true`);
    await sleep(300);
    await ev(`document.querySelector('.btn-cli[data-cli="claude"]').click(), true`);
    await sleep(200);
    await ev(`document.querySelectorAll('.tab')[0].click(), true`); // the user switches away while it starts
    await sleep(5000);
    check('not sent to the other pane, not sent later either', ((await allText()).split('FAKE-CLI-RAN').length - 1) === ranBefore, String(((await allText()).split('FAKE-CLI-RAN').length - 1)));
    check('the user is told why', /다른 페인을 선택해서 실행하지 않았습니다/.test(await ev(`document.querySelector('#flow-status').textContent`)), await ev(`document.querySelector('#flow-status').textContent`));

    console.log('-- GROK: not installed at start → installed → new tab → click (the reported case)');
    await ev(`window.dispatchEvent(new Event('focus')), true`);
    check('GROK is marked missing at first', await waitFor(async () => ev(`document.querySelector('.btn-cli[data-cli="grok"]').classList.contains('missing')`), { timeoutMs: 8000 }));
    fs.writeFileSync(regFile, JSON.stringify({ machine: '', user: lateDir })); // the installer registers it
    await sleep(5600);
    await ev(`document.querySelector('#new-tab').click(), true`);
    await waitFor(async () => !!(await ev(`document.querySelector('.tab-page.active .pane.active').dataset.ptyId`)) && /PS /.test(await rows()), { timeoutMs: 20000 });
    await ev(`document.querySelector('.btn-cli[data-cli="grok"]').click(), true`); // no focus event, no restart
    check('the click re-checks, finds it and runs it', await waitFor(async () => /LATE-GROK-RAN/.test(await rows()), { timeoutMs: 15000 }), (await rows()).slice(-300));
    check('…and the missing mark is gone', (await ev(`document.querySelector('.btn-cli[data-cli="grok"]').classList.contains('missing')`)) === false);

    console.log('-- another pane picked while the click re-checks a missing CLI (review r6)');
    // count the command itself in every pane: the other tab's shell predates the install, so a
    // misrouted command would only print "not recognized" there, never the tool's output
    const grokRuns = async () => ((await allText()).split('zzlategrok').length - 1);
    fs.writeFileSync(regFile, JSON.stringify({ machine: '', user: '' })); // "uninstalled" again
    await sleep(5600);
    await ev(`window.dispatchEvent(new Event('focus')), true`);
    check('GROK marked missing again', await waitFor(async () => ev(`document.querySelector('.btn-cli[data-cli="grok"]').classList.contains('missing')`), { timeoutMs: 8000 }));
    fs.writeFileSync(regFile, JSON.stringify({ machine: '', user: lateDir })); // installed again
    await sleep(5600); // the next status check waits for the (slow) registry read
    const runs0 = await grokRuns();
    await ev(`document.querySelector('.btn-cli[data-cli="grok"]').click(), true`);
    await sleep(200);
    await ev(`document.querySelectorAll('.tab')[0].click(), true`); // switched away during the re-check
    await sleep(5000);
    check('found after the re-check, but not run in the other pane (nor anywhere)', (await grokRuns()) === runs0, `${runs0} → ${await grokRuns()}`);
    check('the reason is shown', /다른 페인을 선택해서 실행하지 않았습니다/.test(await ev(`document.querySelector('#flow-status').textContent`)), await ev(`document.querySelector('#flow-status').textContent`));
  } finally {
    await app.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* shell may hold a file */ }
  }
  console.log('');
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
