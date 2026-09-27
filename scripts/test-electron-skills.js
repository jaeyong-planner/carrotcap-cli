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
  'if "%2"=="marketplace" (echo Configured marketplaces:& echo   claude-plugins-official& exit /b 0)',
  'if "%3"=="skill-creator@claude-plugins-official" (echo Failed to install plugin 1>&2& exit /b 1)',
  'echo Successfully installed plugin %3 (scope: project)',
  'exit /b 0',
].join('\r\n') + '\r\n');
fs.writeFileSync(path.join(project, 'CLAUDE.md'), '# My project\n\nOwn rules.\n');
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
  const app = await launchApp(userData);
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
    const listed = await ev(`[...document.querySelectorAll('#skills-list .skill-row')].map((r) => ({ id: r.querySelector('input').value, on: r.querySelector('input').checked, third: !!r.querySelector('.skill-maker.third') }))`);
    check('whole catalog listed with makers', listed.length >= 8 && listed.some((r) => r.id === 'superpowers' && r.third) && listed.some((r) => r.id === 'code-review' && !r.third), JSON.stringify(listed.slice(0, 3)));
    check('web preset preselected', ['superpowers', 'code-review', 'feature-dev', 'frontend-design', 'playwright'].every((id) => listed.find((r) => r.id === id && r.on)) && !listed.find((r) => r.id === 'skill-creator' && r.on));
    check('nothing ran before the user chose', calls().length === 0);
    // pick the backend preset, then add skill-creator (which the fake fails)
    await ev(`[...document.querySelectorAll('#skills-presets button')].find((b) => b.textContent === '백엔드·API').click(); document.querySelector('#skills-list input[value="skill-creator"]').click(); true`);
    await ev(`document.querySelector('#skills-install').click(), true`);
    check('install runs and reports a partial failure', await waitFor(async () => /skill-creator/.test(await ev(`document.querySelector('#skills-progress').innerText`)) && /✗/.test(await ev(`document.querySelector('#skills-progress').innerText`)), { timeoutMs: 30000 }), await ev(`document.querySelector('#skills-progress').innerText`));
    const c = calls();
    const installs = c.filter((l) => / plugin install /.test(l));
    check('marketplace checked first (already known → not added)', / plugin marketplace list/.test(c[0] || '') && !c.some((l) => /marketplace add/.test(l)), JSON.stringify(c.slice(0, 2)));
    check('one install per chosen plugin, project scope, in the project folder', installs.length === 6 && installs.every((l) => l.includes(fs.realpathSync(project)) && /@claude-plugins-official --scope project$/.test(l)), JSON.stringify(installs));
    const st = state();
    check('skills.json records only what installed', !!st && JSON.stringify(st.installed) === JSON.stringify(['superpowers', 'code-review', 'feature-dev', 'security-guidance', 'pr-review-toolkit']), JSON.stringify(st));
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

    console.log('-- SKILLS button: re-run keeps one block');
    await ev(`document.querySelector('#skills-open').click(), true`);
    check('SKILLS opens the window', await waitFor(modalOpen));
    check('installed ones are shown as installed', await ev(`[...document.querySelectorAll('#skills-list .skill-row')].filter((r) => r.querySelector('.skill-done')).length`) === 5);
    await ev(`document.querySelectorAll('#skills-list input').forEach((c) => { c.checked = c.value === 'frontend-design'; }); document.querySelector('#skills-install').click(); true`);
    check('single install closes the window', await waitFor(async () => !(await modalOpen()), { timeoutMs: 20000 }));
    const md2 = fs.readFileSync(path.join(project, 'CLAUDE.md'), 'utf8');
    check('block replaced, not duplicated; now includes frontend-design too', md2.split('CARROTCAP:SKILLS:START').length === 2 && /frontend-design/.test(md2) && /\/code-review/.test(md2));
    check('skills.json merged', (state().installed || []).includes('frontend-design') && state().installed.includes('superpowers'));

    console.log('-- the main side only takes catalog ids and allowed folders');
    const bad = await ev(`window.carrotcap.skillsInstall(${JSON.stringify(project)}, ['evil & calc', '__proto__'])`);
    check('unknown ids refused', bad && bad.ok === false);
    const outside = await ev(`window.carrotcap.skillsInstall(${JSON.stringify(tmp)}, ['code-review'])`);
    check('folder outside the allowed workspaces refused', outside && outside.ok === false && /폴더/.test(outside.error || ''));

    console.log('-- "don\'t ask again" sticks');
    const project2 = path.join(tmp, 'second');
    fs.mkdirSync(project2);
    // not selectable from here without the folder dialog; the IPC is what the button calls
    const skip = await ev(`window.carrotcap.skillsSkip(${JSON.stringify(project)})`);
    check('skip recorded', skip === true && state().skipped === true && state().installed.length === 6);
  } finally {
    await app.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* shell may hold a file */ }
  }
  console.log('');
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
