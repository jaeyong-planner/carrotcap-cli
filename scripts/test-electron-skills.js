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
  // with the flag file present the machine "does not know" the official marketplace yet
  `if "%2"=="marketplace" if "%3"=="list" if exist "${path.join(tmp, 'no-market')}" (echo Configured marketplaces:& exit /b 0)`,
  'if "%2"=="marketplace" (echo Configured marketplaces:& echo   claude-plugins-official& exit /b 0)',
  'if "%3"=="skill-creator@claude-plugins-official" (echo Failed to install plugin 1>&2& exit /b 1)',
  // a slow one, to see that a second install waits its turn
  'if "%3"=="claude-md-management@claude-plugins-official" ping -n 4 127.0.0.1 >nul',
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
put('plugins/security-guidance/hooks/hooks.json', JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'python3 check.py' }] }] } }));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
  settingsVersion: 4,
  aor: { enabled: false, autoStart: false },
  cli: { claude: { command: fakeClaude, args: [] }, codex: { command: 'codex', args: [] }, grok: { command: 'grok', args: [] } },
  defaultProjectPath: project,
  ui: {},
}));
fs.writeFileSync(path.join(userData, 'workspace-state.json'), JSON.stringify({ recentWorkspaces: [fs.realpathSync(project)] }));
const calls = () => (fs.existsSync(callLog) ? fs.readFileSync(callLog, 'utf8').split(/\r?\n/).filter(Boolean) : []);
const state = () => { try { return JSON.parse(fs.readFileSync(path.join(project, '.carrotcap', 'skills.json'), 'utf8')); } catch { return null; } };

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
    check('a remote plugin offers "구성 불러오기" before anything else', /구성 불러오기/.test(await inspectOf('superpowers')) && /896224c/.test(await inspectOf('superpowers')));

    console.log('-- third-party plugins need explicit consent (review r1)');
    await ev(`document.querySelector('#skills-list input[value="playwright"]').click(), true`);
    check('ticking a third-party plugin shows the consent line', await ev(`!document.querySelector('#skills-third').hidden && /playwright/.test(document.querySelector('#skills-third-text').textContent)`));
    check('install is disabled until consent', await ev(`document.querySelector('#skills-install').disabled`));
    const noConsent = await ev(`window.carrotcap.skillsInstall(${JSON.stringify(project)}, ['playwright'])`);
    check('main refuses a third-party install without consent', noConsent && noConsent.ok === false && /외부 제작/.test(noConsent.error || '') && calls().length === 0, JSON.stringify(noConsent));
    await ev(`document.querySelector('#skills-third-ok').click(), true`);
    check('consent enables install', !(await ev(`document.querySelector('#skills-install').disabled`)));
    await ev(`document.querySelector('#skills-list input[value="playwright"]').click(), true`); // untick again
    check('unticking hides the consent line', await ev(`document.querySelector('#skills-third').hidden && !document.querySelector('#skills-install').disabled`));

    console.log('-- a remote plugin is installable only after its pinned commit was inspected (review r2)');
    await ev(`document.querySelector('#skills-list input[value="superpowers"]').click(), true`);
    check('consent is not even possible before "구성 불러오기"', await ev(`document.querySelector('#skills-third-ok').disabled && document.querySelector('#skills-install').disabled && /구성 불러오기/.test(document.querySelector('#skills-third-text').textContent)`));
    const noInspect = await ev(`window.carrotcap.skillsInstall(${JSON.stringify(project)}, ['superpowers'], true)`);
    check('main refuses it even with consent', noInspect && noInspect.ok === false && /확인/.test(noInspect.error || '') && calls().length === 0, JSON.stringify(noInspect));
    await ev(`document.querySelector('#skills-list input[value="superpowers"]').click(), true`);

    // pick the backend preset, then add skill-creator (which the fake fails)
    await ev(`[...document.querySelectorAll('#skills-presets button')].find((b) => b.textContent === '백엔드·API').click(); document.querySelector('#skills-list input[value="skill-creator"]').click(); true`);
    await ev(`document.querySelector('#skills-install').click(), true`);
    check('install runs and reports a partial failure', await waitFor(async () => /skill-creator/.test(await ev(`document.querySelector('#skills-progress').innerText`)) && /✗/.test(await ev(`document.querySelector('#skills-progress').innerText`)), { timeoutMs: 30000 }), await ev(`document.querySelector('#skills-progress').innerText`));
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

    console.log('-- the main side only takes catalog ids and allowed folders');
    const bad = await ev(`window.carrotcap.skillsInstall(${JSON.stringify(project)}, ['evil & calc', '__proto__'])`);
    check('unknown ids refused', bad && bad.ok === false);
    const outside = await ev(`window.carrotcap.skillsInstall(${JSON.stringify(tmp)}, ['code-review'])`);
    check('folder outside the allowed workspaces refused', outside && outside.ok === false && /폴더/.test(outside.error || ''));

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
