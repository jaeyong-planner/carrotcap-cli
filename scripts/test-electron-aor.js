// E2E: AOR engine connection + Claude output-compression hook (task-016/017).
// Launches the dev app with isolated user data and a fake `claude` first on PATH, then
// checks: the pane boots through the engine, console shims are off, the hook settings
// file is generated, and `claude` in the AOR shell gets `--settings <file>`.
// Usage: node scripts/test-electron-aor.js
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-aor-e2e-'));
const userData = path.join(tmp, 'user');
const project = path.join(tmp, 'project');
const bin = path.join(tmp, 'bin');
for (const d of [userData, project, bin]) fs.mkdirSync(d, { recursive: true });
const argsLog = path.join(tmp, 'claude-args.txt');
// Fake claude: records its arguments, one per line.
fs.writeFileSync(path.join(bin, 'claude.cmd'), `@echo off\r\n(for %%a in (%*) do @echo %%~a) > "${argsLog}"\r\n`);
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
  settingsVersion: 3,
  aor: { enabled: true, autoStart: true },
  cli: { claude: { command: 'claude', args: [] } },
  defaultProjectPath: project,
  ui: {},
}));

(async () => {
  const app = await launchApp(userData);
  const ev = app.ev;
  const rows = () => ev(`(document.querySelector('.tab-page.active .xterm-rows')||{}).innerText||''`);
  const ptyId = () => ev(`document.querySelector('.tab-page.active .pane.active').dataset.ptyId`);
  const type = async (line) => ev(`window.carrotcap.writePty(${JSON.stringify(await ptyId())}, ${JSON.stringify(line + '\r')}), true`);

  console.log('-- engine boot (task-016)');
  check('pane boots through the AOR engine', await waitFor(async () => /\[AOR\] Ready/.test(await rows()), { timeoutMs: 30000 }));
  check('console shims off by default', /Console auto-capture off/.test(await rows()));
  await sleep(1000);
  await type(`if ($env:PATH -split ';' | Where-Object { $_ -like '*\\shims' }) { 'SHIMS-ON' } else { 'SHIMS-OFF' }`);
  check('shim dir not on PATH', await waitFor(async () => /^SHIMS-OFF/m.test(await rows()), { timeoutMs: 8000 }));
  const trustFile = path.join(userData, 'claude-config', '.claude.json');
  check('workspace trust written to the isolated config only', fs.existsSync(trustFile));

  console.log('-- compress hook (task-017)');
  const st = await ev(`window.carrotcap.aorStatus()`);
  check('aor:status reports engine + hook', st.engineFound === true && typeof st.compressHook === 'string', JSON.stringify(st));
  let hookCfg = null;
  try { hookCfg = JSON.parse(fs.readFileSync(st.compressHook, 'utf8')); } catch { /* checked below */ }
  const h = hookCfg && hookCfg.hooks && hookCfg.hooks.PostToolUse && hookCfg.hooks.PostToolUse[0];
  check('hook settings file is inside userData', !!st.compressHook && st.compressHook.startsWith(userData));
  check('one PostToolUse hook on Bash, nothing else', !!h && h.matcher === 'Bash' && Object.keys(hookCfg.hooks).length === 1 && Object.keys(hookCfg).length === 1);
  check('hook command points at the bundled script', !!h && /compress-hook\.js'$/.test(h.hooks[0].command), h && h.hooks[0].command);
  await type(`"ENV=$env:CARROTCAP_CLAUDE_SETTINGS"`);
  check('pane env carries the settings path', await waitFor(async () => (await rows()).replace(/\s+/g, '').includes(('ENV=' + st.compressHook).replace(/\s+/g, '')), { timeoutMs: 8000 }));

  // shell-init puts %APPDATA%\npm (the real claude) first — put the fake in front of it.
  await type(`$env:PATH = '${bin.replace(/'/g, "''")};' + $env:PATH`);
  await sleep(500);
  await type('claude --version');
  check('AOR wrapper adds --settings for claude', await waitFor(() => fs.existsSync(argsLog) && /--settings/.test(fs.readFileSync(argsLog, 'utf8')), { timeoutMs: 15000 }));
  const args1 = fs.existsSync(argsLog) ? fs.readFileSync(argsLog, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  check('--settings is followed by the hook file, user args kept', args1[0] === '--settings' && args1[1] === st.compressHook && args1.includes('--version'), JSON.stringify(args1));
  fs.rmSync(argsLog, { force: true });
  await type('claude mcp list');
  await waitFor(() => fs.existsSync(argsLog), { timeoutMs: 15000 });
  const args2 = fs.existsSync(argsLog) ? fs.readFileSync(argsLog, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  check('subcommands are left alone', args2[0] === 'mcp' && !args2.includes('--settings'), JSON.stringify(args2));
  fs.rmSync(argsLog, { force: true });
  await type(`claude --settings 'x.json' --version`);
  await waitFor(() => fs.existsSync(argsLog), { timeoutMs: 15000 });
  const args3 = fs.existsSync(argsLog) ? fs.readFileSync(argsLog, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  check("user's own --settings wins", args3.filter((a) => a === '--settings').length === 1 && args3.includes('x.json'), JSON.stringify(args3));
  const runFake = async (line) => {
    fs.rmSync(argsLog, { force: true });
    await type(line);
    await waitFor(() => fs.existsSync(argsLog), { timeoutMs: 15000 });
    return fs.existsSync(argsLog) ? fs.readFileSync(argsLog, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  };
  const args5 = await runFake(`claude --settings=x.json --version`);
  // (cmd's `for` splits "--settings=x.json" at "=", so look for the hook path, not the token.)
  check("user's --settings=<file> form wins too (review r1)", !args5.includes(st.compressHook) && args5.includes('x.json'), JSON.stringify(args5));
  const args6 = await runFake(`claude --verbose mcp list`);
  check('subcommand after an option is left alone (review r1)', !args6.includes('--settings') && args6.includes('mcp'), JSON.stringify(args6));

  console.log('-- hook settings file is re-verified (review r1)');
  fs.rmSync(st.compressHook, { force: true });
  const st3 = await ev(`window.carrotcap.aorStatus()`);
  check('deleted settings file is written again', st3.compressHook === st.compressHook && fs.existsSync(st.compressHook));
  fs.rmSync(st.compressHook, { force: true });
  fs.mkdirSync(st.compressHook); // something that is not a plain file
  const st4 = await ev(`window.carrotcap.aorStatus()`);
  check('a non-file in its place → no hook (not a stale path)', st4.compressHook === null, JSON.stringify(st4));
  fs.rmSync(st.compressHook, { recursive: true, force: true });
  const st5 = await ev(`window.carrotcap.aorStatus()`);
  check('recovers once the path is free', st5.compressHook === st.compressHook && fs.lstatSync(st.compressHook).isFile());
  check('no temp files left in aor-hook', fs.readdirSync(path.dirname(st.compressHook)).every((n) => !n.endsWith('.tmp')), fs.readdirSync(path.dirname(st.compressHook)).join(','));

  console.log('-- real engine behind the hook');
  const bigOut = Array.from({ length: 300 }, (_, i) => `  PASS  case ${i} works`).join('\n') + '\n  FAIL  case 301 :: boom\n';
  const hookScript = h.hooks[0].command.match(/'([^']*compress-hook\.js)'$/)[1];
  const r = require('child_process').spawnSync(process.execPath, [hookScript], {
    encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', cwd: project, tool_input: { command: 'npm test' }, tool_response: { stdout: bigOut, stderr: '', interrupted: false, isImage: false, noOutputExpected: false } }),
  });
  let replaced = null;
  try { replaced = JSON.parse(r.stdout).hookSpecificOutput.updatedToolOutput.stdout; } catch { /* checked below */ }
  check('bundled engine summarizes and keeps the failure line', !!replaced && replaced.includes('[Layer 1]') && replaced.includes('FAIL  case 301 :: boom') && replaced.length < bigOut.length / 3, r.stderr || String(replaced && replaced.length));

  fs.rmSync(argsLog, { force: true });
  const clicked = await ev(`(() => { const b = document.querySelector('[data-cli="claude"]'); if (!b) return false; b.click(); return true; })()`);
  await waitFor(() => fs.existsSync(argsLog), { timeoutMs: 15000 });
  const args4 = fs.existsSync(argsLog) ? fs.readFileSync(argsLog, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  check('CLI button launches claude with the hook exactly once', clicked && args4.filter((a) => a === '--settings').length === 1 && args4.includes(st.compressHook), JSON.stringify(args4));

  console.log('-- hook off via settings');
  const cur = await ev(`window.carrotcap.getSettings()`);
  await ev(`window.carrotcap.setSettings(${JSON.stringify({ ...cur, aor: { ...cur.aor, compressHook: false } })})`);
  const st2 = await ev(`window.carrotcap.aorStatus()`);
  check('aor.compressHook=false → no hook', st2.compressHook === null, JSON.stringify(st2));

  await app.close();
  console.log('');
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* a pane may still hold a file */ }
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
