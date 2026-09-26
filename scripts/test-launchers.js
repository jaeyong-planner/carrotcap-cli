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
const appDir = path.join(root, "my app's dir");
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

const env = { ...process.env, PATH: `${shimDir};${process.env.PATH}`, CC_FAKE_LOG: log };
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
  ['PowerShell 5.1', path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-Command', "carrotcap 'C:\\my project' second"]],
];
const pwsh7 = spawnSync('where.exe', ['pwsh'], { encoding: 'utf8' });
if (pwsh7.status === 0) cases.push(['pwsh 7', pwsh7.stdout.split(/\r?\n/)[0].trim(), ['-NoProfile', '-Command', "carrotcap 'C:\\my project' second"]]);
const bash = ['C:\\Program Files\\Git\\bin\\bash.exe'].find((p) => fs.existsSync(p));

console.log("-- default PATHEXT: our launcher wins over Cream's carrotcap.cmd, arguments intact");
for (const [label, file, args] of cases) {
  const got = run(file, args);
  check(`${label}: runs our launcher with both arguments`, JSON.stringify(got) === expectArgs, JSON.stringify(got));
}
if (bash) {
  const got = run(bash, ['-c', "carrotcap 'C:\\my project' second"]);
  check('Git Bash: extensionless launcher, path with space + apostrophe, arguments intact', JSON.stringify(got) === expectArgs, JSON.stringify(got));
} else {
  console.log('  (Git Bash not installed — its launcher is covered by the unit tests only)');
}

console.log('-- changed PATHEXT (.CMD before .BAT): documented limitation');
const swapped = run(cmdExe, ['/d', '/c', 'carrotcap'], { PATHEXT: '.COM;.EXE;.CMD;.BAT' });
check('cmd with .CMD first picks carrotcap.cmd (why INSTALLER.md requires the default order)', JSON.stringify(swapped) === '["CREAM"]', JSON.stringify(swapped));

sleep(300);
fs.rmSync(root, { recursive: true, force: true });
console.log('');
console.log(`Summary: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
