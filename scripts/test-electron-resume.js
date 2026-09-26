// Session history / resume E2E (task-013). Two launches share one throwaway user data dir:
//   run 1: open project, split a pane, start a CLI, then crash (kill)
//   run 2: resume offer shows "비정상 종료", 이어하기 restores the layout and sends the
//          CLI's continue command, then a normal close compacts the history file.
// A harmless stand-in ('where') is configured as the claude command so no real CLI starts.
//
// Usage: node scripts/test-electron-resume.js   (npm run test:resume)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, sleep, waitFor } = require('./lib/cdp-app');

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else      { console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail++; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carrotcap-resume-'));
const userData = path.join(tmp, 'userData');
const project = path.join(tmp, 'project');
fs.mkdirSync(path.join(project, 'backlog'), { recursive: true });
fs.writeFileSync(path.join(project, 'backlog', 'task-042.md'), '# task-042\n');
fs.mkdirSync(userData, { recursive: true });
// The project is a folder the user already picked (allowlist) and the default project.
fs.writeFileSync(path.join(userData, 'workspace-state.json'), JSON.stringify({ recentWorkspaces: [fs.realpathSync(project)] }));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
  settingsVersion: 3, // current version: no migration touches this fixture
  aor: { enabled: false, autoStart: false },
  cli: { claude: { command: 'where', args: [] } },
  defaultShell: 'powershell.exe',
  defaultProjectPath: project,
  ui: { theme: 'dark', fontSize: 14, fontFamily: 'Consolas' }
}));
const historyDir = path.join(userData, 'history');
const readRecord = () => {
  const files = fs.existsSync(historyDir) ? fs.readdirSync(historyDir) : [];
  return files.length === 1 ? JSON.parse(fs.readFileSync(path.join(historyDir, files[0]), 'utf8')) : { files };
};
const screen = (app) => app.ev(`[...document.querySelectorAll('.tab-page.active .xterm-rows')].map((r) => r.innerText).join('\\n')`);

(async () => {
  console.log('-- run 1: work, then crash');
  let app = await launchApp(userData);
  await sleep(3500);
  check('no resume offer on the very first run', await app.ev(`document.querySelector('#resume-box').classList.contains('hidden')`));
  await app.ev(`document.querySelector('.btn-cli[data-cli="claude"]').click(), true`);
  await sleep(500);
  await app.key('ArrowRight', 'ArrowRight', 39, 1 | 8); // Alt+Shift+→ split
  await sleep(2000);
  const rec1 = readRecord();
  check('history file written for the project', rec1.sessions && rec1.sessions.length === 1, JSON.stringify(rec1).slice(0, 200));
  const s1 = (rec1.sessions || [])[0] || {};
  check('layout: 1 tab, 2 panes, first runs claude',
    s1.layout && s1.layout.tabs.length === 1 && s1.layout.tabs[0].panes.length === 2 && s1.layout.tabs[0].panes[0].cli === 'claude',
    JSON.stringify(s1.layout));
  check('last backlog task recorded', s1.lastTask === 'task-042');
  check('no terminal output stored', !JSON.stringify(rec1).includes('PS ') && JSON.stringify(rec1).length < 2000, `${JSON.stringify(rec1).length} bytes`);
  await app.kill();

  console.log('-- run 2: resume after crash');
  app = await launchApp(userData);
  await waitFor(() => app.ev(`!document.querySelector('#resume-box').classList.contains('hidden')`));
  const offer = await app.ev(`document.querySelector('#resume-box').classList.contains('hidden') ? '' : document.querySelector('#resume-text').textContent`);
  check('resume offer shown', offer.length > 0, offer);
  check('offer says it was not a clean exit', /비정상 종료/.test(offer), offer);
  check('offer shows layout, CLI and last task', /페인 2/.test(offer) && /claude/.test(offer) && /task-042/.test(offer), offer);
  // The start tab may already be in use: type something there first (once its shell is up —
  // the offer can appear before the first pane has a PTY).
  const startTabText = () => app.ev(`(document.querySelector('.tab-page .xterm-rows') || {}).innerText || ''`);
  await waitFor(async () => /PS /.test(await startTabText()));
  await app.ev(`document.querySelector('#composer-input').value = 'echo still-alive'; document.querySelector('#composer-send').click(); true`);
  await waitFor(async () => /still-alive[\s\S]*still-alive/.test(await startTabText()));
  await app.ev(`(() => { const b = document.querySelector('#resume-go'); b.click(); b.click(); return true; })()`); // double click
  await sleep(4000);
  check('existing start tab is kept (never killed by resume)', (await app.ev(`document.querySelectorAll('.tab').length`)) === 2);
  const startText = await startTabText();
  check('its shell is still alive', /still-alive[\s\S]*still-alive/.test(startText) && !/session ended/.test(startText), JSON.stringify(startText.slice(-200)));
  check('double click restores only once', (await app.ev(`document.querySelectorAll('.pane').length`)) === 3);
  check('restored tab has 2 panes', (await app.ev(`document.querySelectorAll('.tab-page.active .pane').length`)) === 2);
  check('claude pane got its continue command', await waitFor(async () => /'where' '--continue'/.test(await screen(app))));
  check('offer hidden after resuming', await app.ev(`document.querySelector('#resume-box').classList.contains('hidden')`));
  await sleep(1200); // let the debounced snapshot land
  const panesInRecord = () => { const s = (readRecord().sessions || [])[0]; return s && s.layout ? s.layout.tabs.reduce((n, t) => n + t.panes.length, 0) : 0; };
  const beforeClose = panesInRecord();
  await app.key('w', 'KeyW', 87, 2 | 8); // Ctrl+Shift+W closes the active pane
  await sleep(1500);
  check('closing a pane updates the record (closed pane not kept)', panesInRecord() === beforeClose - 1, `${beforeClose} -> ${panesInRecord()}`);
  await app.close();

  console.log('-- after a normal close: compacted');
  const rec2 = readRecord();
  const sessions = rec2.sessions || [];
  check('two sessions kept (crashed + current)', sessions.length === 2, JSON.stringify(sessions.map((s) => s.id)));
  check('newest session closed cleanly', sessions[0] && sessions[0].clean === true && !!sessions[0].endedAt);
  check('only the newest keeps a layout', sessions[0] && !!sessions[0].layout && sessions.slice(1).every((s) => !s.layout));
  check('crashed session kept only as a summary', sessions[1] && sessions[1].clean === false && Array.isArray(sessions[1].clis));

  console.log('-- run 3: "새로 시작" drops the offer');
  app = await launchApp(userData);
  check('resume offered for the clean previous session', await waitFor(() => app.ev(`!document.querySelector('#resume-box').classList.contains('hidden')`)));
  await app.ev(`document.querySelector('#resume-dismiss').click(), true`);
  await sleep(500);
  const rec3 = readRecord();
  check('dismiss removes old layouts', (rec3.sessions || []).filter((s) => s.layout).length <= 1);
  await app.close();

  console.log('-- run 4: quit right after a change (< 800ms), junk files pruned');
  fs.writeFileSync(path.join(historyDir, '0123456789abcdef.json'), 'x'.repeat(100 * 1024)); // oversized
  fs.writeFileSync(path.join(historyDir, 'fedcba9876543210.json'), '{ not json');           // corrupt
  app = await launchApp(userData);
  await sleep(3000);
  check('oversized / corrupt history files pruned at boot',
    !fs.existsSync(path.join(historyDir, '0123456789abcdef.json')) && !fs.existsSync(path.join(historyDir, 'fedcba9876543210.json')));
  // A project with no panes left: an empty layout clears this run's resumable layout.
  await app.ev(`window.carrotcap.saveHistory(${JSON.stringify(project)}, { tabs: [] })`);
  await sleep(300);
  check('empty layout clears the current session layout', !((readRecord().sessions || [])[0] || {}).layout);
  await app.ev(`document.querySelector('.btn-cli[data-cli="claude"]').click(), true`);
  await app.close(); // immediately
  const rec4 = readRecord();
  const newest = (rec4.sessions || [])[0] || {};
  check('CLI started just before closing is recorded', Array.isArray(newest.clis) && newest.clis.includes('claude'), JSON.stringify(newest));
  check('and it is marked as a clean exit', newest.clean === true);

  console.log('-- run 5: a junctioned history folder is never followed');
  const outside = path.join(tmp, 'outside');
  fs.mkdirSync(outside, { recursive: true });
  const victim = path.join(outside, 'aaaaaaaaaaaaaaaa.json');
  fs.writeFileSync(victim, 'not a history record');
  fs.rmSync(historyDir, { recursive: true, force: true });
  fs.symlinkSync(outside, historyDir, 'junction');
  app = await launchApp(userData);
  await sleep(3000);
  await app.close();
  check('file behind the junction not deleted by prune', fs.existsSync(victim));
  check('nothing written through the junction', fs.readdirSync(outside).length === 1, fs.readdirSync(outside).join(','));
})()
  .catch((e) => { console.log('  FAIL  harness ::', e.message); fail++; })
  .finally(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* locked cache files in temp */ }
    console.log('');
    console.log(`Summary: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
