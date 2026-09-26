// Integration test for the `carrotcap` launchers (task-018), Windows only.
// The launchers main.js writes are put in a temp dir that plays WindowsApps, next to a
// Cream-style carrotcap.cmd. A fake carrotcap.exe (a tiny windowless program compiled
// with the .NET Framework csc that ships with Windows; it logs its arguments) sits in a
// folder whose name has a space and an apostrophe. Each shell then runs `carrotcap` by
// name, the way a user would.
// Usage: node scripts/test-launchers.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

if (process.platform !== 'win32') { console.log('Summary: 0 passed, 0 failed (Windows only)'); process.exit(0); }

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else      { console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail++; }
}

// Pull buildLaunchShims + its constants out of main.js (same code the app runs).
const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const start = src.indexOf('const LAUNCH_SHIM_NAMES');
const end = src.indexOf('// true when `content` is one of our launchers');
if (start < 0 || end < start) { console.error('FATAL: launcher helpers not found in main.js'); process.exit(2); }
const { buildLaunchShims } = new Function('path', src.slice(start, end) + '\nreturn { buildLaunchShims };')(path);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-launch-'));
const shimDir = path.join(root, 'WindowsApps');
// Space, apostrophe, %VAR% and !VAR! (neither may be expanded by cmd — CC_X is set below).
const appDir = path.join(root, "my app's %CC_X% !CC_X! dir");
fs.mkdirSync(shimDir);
fs.mkdirSync(appDir);
const log = path.join(root, 'args.log');

// A batch file cannot stand in for the exe: `start "" "<quoted path with spaces>.cmd" args`
// mangles the arguments, while the real target is an .exe.
const fakeExe = path.join(appDir, 'carrotcap.exe');
const csc = path.join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
if (!fs.existsSync(csc)) { console.error('FATAL: .NET Framework csc.exe not found (needed for the fake carrotcap.exe)'); process.exit(2); }
const cs = path.join(root, 'fake.cs');
fs.writeFileSync(cs, [
  'class P {',
  '  static void Main(string[] a) {',
  '    var l = new System.Text.StringBuilder();',
  '    foreach (var x in a) l.Append("[" + x + "]\\n");',
  '    System.IO.File.WriteAllText(System.Environment.GetEnvironmentVariable("CC_FAKE_LOG"), l.ToString());',
  '  }',
  '}',
].join('\n'));
const built = spawnSync(csc, ['/nologo', '/target:winexe', `/out:${fakeExe}`, cs], { encoding: 'utf8' });
if (built.status !== 0) { console.error('FATAL: could not build the fake exe', built.stdout); process.exit(2); }

const shims = buildLaunchShims(fakeExe);
for (const [name, body] of Object.entries(shims)) fs.writeFileSync(path.join(shimDir, name), body);
// What Cream CLI writes (it must lose).
fs.writeFileSync(path.join(shimDir, 'carrotcap.cmd'), `@echo off\r\n> "${log}" echo CREAM\r\n`);

const env = { ...process.env, PATH: `${shimDir};${process.env.PATH}`, CC_FAKE_LOG: log, CC_X: 'EXPANDED' };
const sleep = (ms) => spawnSync(process.execPath, ['-e', `setTimeout(()=>{},${ms})`]);
const waitLog = () => {
  for (let i = 0; i < 60; i++) {
    if (fs.existsSync(log)) {
      const t = fs.readFileSync(log, 'utf8').trim();
      if (t) return t.split(/\r?\n/).map((l) => l.trim());
    }
    sleep(100);
  }
  return null;
};
const cmdExe = path.join(process.env.SystemRoot, 'System32', 'cmd.exe');
const run = (file, args, extraEnv = {}) => {
  fs.rmSync(log, { force: true });
  // cmd needs its /c line verbatim (Node would escape the inner quotes as \").
  const verbatim = file === cmdExe;
  spawnSync(file, verbatim ? [args.join(' ')] : args, {
    env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 20000, windowsHide: true, windowsVerbatimArguments: verbatim,
  });
  return waitLog();
};

const expectArgs = JSON.stringify(['[C:\\my project]', '[second]']);
const cases = [
  ['cmd', cmdExe, ['/d', '/c', 'carrotcap "C:\\my project" second']],
  ['cmd /V:ON (delayed expansion)', cmdExe, ['/d', '/v:on', '/c', 'carrotcap "C:\\my project" second']],
  ['PowerShell 5.1', path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-Command', "carrotcap 'C:\\my project' second"]],
];
const pwsh7 = spawnSync('where.exe', ['pwsh'], { encoding: 'utf8' });
if (pwsh7.status === 0) cases.push(['pwsh 7', pwsh7.stdout.split(/\r?\n/)[0].trim(), ['-NoProfile', '-Command', "carrotcap 'C:\\my project' second"]]);
// Git Bash = <git>\bin\bash.exe next to git's cmd\git.exe (`where bash` may find WSL's).
let bash = null;
const gitWhere = spawnSync('where.exe', ['git'], { encoding: 'utf8' });
for (const g of (gitWhere.status === 0 ? gitWhere.stdout.split(/\r?\n/) : []).map((l) => l.trim()).filter(Boolean)) {
  const cand = path.join(path.dirname(path.dirname(g)), 'bin', 'bash.exe');
  if (fs.existsSync(cand)) { bash = cand; break; }
}
let skipped = 0;

console.log("-- default PATHEXT: our launcher wins over Cream's carrotcap.cmd, arguments intact");
for (const [label, file, args] of cases) {
  const got = run(file, args);
  check(`${label}: runs our launcher with both arguments`, JSON.stringify(got) === expectArgs, JSON.stringify(got));
}
if (bash) {
  const got = run(bash, ['-c', "carrotcap 'C:\\my project' second"]);
  check('Git Bash: extensionless launcher, path with space + apostrophe, arguments intact', JSON.stringify(got) === expectArgs, JSON.stringify(got));
} else {
  console.log('  SKIP  Git Bash: not installed (no git.exe with bin\\bash.exe on PATH)');
  skipped++;
}

console.log('-- changed PATHEXT (.CMD before .BAT): documented limitation');
const swappedExt = { PATHEXT: '.COM;.EXE;.CMD;.BAT' };
for (const [label, file] of cases) {
  const got = run(file, file === cmdExe ? ['/d', '/c', 'carrotcap'] : ['-NoProfile', '-Command', 'carrotcap'], swappedExt);
  check(`${label} with .CMD first picks carrotcap.cmd (why INSTALLER.md requires the default order)`, JSON.stringify(got) === '["CREAM"]', JSON.stringify(got));
}

sleep(300);
fs.rmSync(root, { recursive: true, force: true });
console.log('');
console.log(`Summary: ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ""}`);
process.exit(fail === 0 ? 0 : 1);
