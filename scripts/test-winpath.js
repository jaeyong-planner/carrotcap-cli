// Unit tests for main-winpath.js (task-027). Usage: node scripts/test-winpath.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const wp = require('../main-winpath.js');

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else      { console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail++; }
}

console.log('-- merge');
const cur = 'C:\\tests\\fake-bin;C:\\Windows\\system32;C:\\Users\\U\\AppData\\Roaming\\npm';
const merged = wp.mergePath(cur, 'C:\\Windows\\system32;C:\\Windows', 'C:\\Users\\U\\.grok\\bin;C:\\Users\\U\\AppData\\Roaming\\npm\\');
check('the app PATH keeps its order in front (nothing that resolved before changes)', merged.startsWith(cur + ';'), merged);
check('registered entries it lacked are added after it', merged.endsWith(';C:\\Windows;C:\\Users\\U\\.grok\\bin'), merged);
check('no duplicates — case and trailing backslash ignored', wp.splitPath(merged).length === 5 && !/npm\\;|npm\\$/.test(merged), merged);
check('empty / missing parts are fine', wp.mergePath('', '', '') === '' && wp.mergePath(null, undefined, 'C:\\a;;  ;C:\\b') === 'C:\\a;C:\\b');
check('drive root: "C:\\" and "C:" stay distinct, "C:\\" and "c:/" are one', wp.mergePath('C:\\', '', 'C:;c:/') === 'C:\\;C:', wp.mergePath('C:\\', '', 'C:;c:/'));
check('a lone "\\" (current drive root) is kept, once', wp.mergePath('C:\\a;\\', '', '\\;/') === 'C:\\a;\\', wp.mergePath('C:\\a;\\', '', '\\;/'));
check('non-ASCII paths pass through untouched', wp.mergePath('C:\\a', '', 'C:\\Users\\USER\\MCP\\바탕화면\\tools') === 'C:\\a;C:\\Users\\USER\\MCP\\바탕화면\\tools');

console.log('-- %VAR% entries (REG_EXPAND_SZ)');
const venv = { USERPROFILE: 'C:\\Users\\U', ProgramFiles: 'C:\\Program Files' };
check('expanded, names case-insensitive', wp.expandVars('%userprofile%\\bin;%PROGRAMFILES%\\Tool', venv) === 'C:\\Users\\U\\bin;C:\\Program Files\\Tool');
check('unknown %NAME% left as it is; already-expanded text unchanged', wp.expandVars('%NOPE%\\x;C:\\a', venv) === '%NOPE%\\x;C:\\a');
{
  const rpv = wp.createRegisteredPath({ powershell: () => 'x', run: (f, a, o, cb) => cb(null, '%ProgramFiles%\\Tool\n<<CARROTCAP-PATH-SPLIT>>\n%USERPROFILE%\\.grok\\bin;C:\\Users\\U\\.grok\\bin') });
  check.pendingExpand = rpv.get().then(() => rpv.envFor({ Path: 'C:\\a', ...venv }).Path);
}

console.log('-- one PATH key in the env');
const env = wp.withPath({ Path: 'x', PATH: 'y', Other: '1' }, 'new');
check('keeps the existing spelling, drops the other variants', JSON.stringify(Object.keys(env).filter((k) => k.toUpperCase() === 'PATH')) === '["Path"]' && env.Path === 'new' && env.Other === '1');
check('no PATH at all → "Path" is added', wp.withPath({ A: '1' }, 'p').Path === 'p');

(async () => {
  const ex = await check.pendingExpand;
  check('registered %VAR% entries reach the pane expanded, one copy only', ex === 'C:\\a;C:\\Program Files\\Tool;C:\\Users\\U\\.grok\\bin', ex);
  console.log('-- reading the registered PATH');
  let calls = 0;
  let t = 1000;
  const reply = { err: null, out: 'C:\\Windows\r\n<<CARROTCAP-PATH-SPLIT>>\r\nC:\\Users\\U\\.grok\\bin;C:\\Users\\U\\MCP\\바탕화면\\bin\r\n' };
  const run = (file, args, opts, cb) => { calls++; setTimeout(() => cb(reply.err, reply.out), 5); check.last = { file, args, opts }; };
  const rp = wp.createRegisteredPath({ powershell: () => 'C:\\ps.exe', now: () => t, run });
  check('nothing read yet → env unchanged', rp.envFor({ Path: 'C:\\a' }).Path === 'C:\\a' && rp.peek() === null);
  const [g1, g2] = await Promise.all([rp.get(), rp.get()]);
  check('parallel callers share one read', calls === 1 && g1 === g2 && g1.machine === 'C:\\Windows' && /바탕화면/.test(g1.user), JSON.stringify(g1));
  check('a constant PowerShell command, no profile, UTF-8 output, bounded', check.last.file === 'C:\\ps.exe' && check.last.args[0] === '-NoProfile' && /OutputEncoding = \[Text\.Encoding\]::UTF8/.test(check.last.args[3]) && check.last.opts.timeout === 4000 && check.last.opts.windowsHide === true);
  check('envFor: the app PATH plus what was missing', rp.envFor({ Path: 'C:\\Windows;C:\\app' }).Path === 'C:\\Windows;C:\\app;C:\\Users\\U\\.grok\\bin;C:\\Users\\U\\MCP\\바탕화면\\bin');
  await rp.get();
  check('cached within 5 s', calls === 1);
  t += 6000;
  reply.out = 'C:\\Windows\n<<CARROTCAP-PATH-SPLIT>>\nC:\\newly\\installed';
  await rp.get();
  check('re-read after 5 s — a tool installed meanwhile shows up', calls === 2 && /C:\\newly\\installed/.test(rp.envFor({ Path: 'C:\\a' }).Path));
  t += 6000;
  reply.err = new Error('powershell missing');
  const g3 = await rp.get();
  check('a failed read keeps the last good one', calls === 3 && g3 && /newly/.test(g3.user));
  await rp.get();
  await rp.get();
  check('after a failed read: no retry for 5 s (new panes are not slowed down again)', calls === 3);
  t += 6000;
  await rp.get();
  check('…then it tries again', calls === 4);
  let badRuns = 0;
  const bad = wp.createRegisteredPath({ powershell: () => 'x', now: () => t, run: (f, a, o, cb) => { badRuns++; cb(null, 'no split marker'); } });
  check('unreadable output → null, env stays the app PATH', (await bad.get()) === null && bad.envFor({ Path: 'C:\\a' }).Path === 'C:\\a');
  await bad.get();
  await bad.get();
  check('never read successfully: still one attempt per 5 s', badRuns === 1);

  console.log('-- dev-tree test file instead of the registry');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-wp-')), 'reg.json');
  fs.writeFileSync(f, JSON.stringify({ machine: 'C:\\m', user: 'C:\\u' }));
  let ran = false;
  const tf = wp.createRegisteredPath({ powershell: () => 'x', testFile: f, run: () => { ran = true; } });
  const g4 = await tf.get();
  check('reads the file, never runs PowerShell', g4.machine === 'C:\\m' && g4.user === 'C:\\u' && ran === false);
  fs.rmSync(path.dirname(f), { recursive: true, force: true });

  if (process.platform === 'win32') {
    console.log('-- the real registry on this machine');
    const real = wp.createRegisteredPath({ powershell: () => path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') });
    const r = await real.get();
    check('reads the registered PATH (two strings)', !!r && typeof r.machine === 'string' && typeof r.user === 'string', r ? `machine ${r.machine.length} / user ${r.user.length} chars` : 'null');
    if (r) console.log(`  (info) machine PATH has System32: ${/system32/i.test(r.machine)} · user entries: ${wp.splitPath(r.user).length}`);
  }

  console.log('');
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
