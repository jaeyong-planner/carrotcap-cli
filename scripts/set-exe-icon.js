// task-029: put build/icon.ico on the packaged carrotcap.exe.
//
// electron-builder does this itself when build.win.signAndEditExecutable is true, but turning
// that on makes it extract the winCodeSign toolchain, which contains macOS symlinks — and
// Windows refuses to create those without Developer Mode or admin rights:
//
//   ERROR: Cannot create symbolic link : ...winCodeSign\...\darwin\10.12\lib\libcrypto.dylib
//
// So the flag stays false and the icon is set here instead, with the rcedit that ships inside
// that same cache. If rcedit is not on this machine the build still succeeds — the app just
// keeps the default Electron icon, and the installer icon (set by NSIS) is unaffected.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const exe = path.join(__dirname, '..', 'release', 'win-unpacked', 'carrotcap.exe');
const ico = path.join(__dirname, '..', 'build', 'icon.ico');

function findRcedit() {
  const cache = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'electron-builder', 'Cache', 'winCodeSign');
  let dirs;
  try { dirs = fs.readdirSync(cache); } catch { return null; }
  const name = process.arch === 'ia32' ? 'rcedit-ia32.exe' : 'rcedit-x64.exe';
  for (const d of dirs) {
    const p = path.join(cache, d, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

if (process.platform !== 'win32') process.exit(0);
for (const [what, p] of [['packaged exe', exe], ['build/icon.ico', ico]]) {
  if (!fs.existsSync(p)) {
    console.error(`[carrotcap] set-exe-icon: ${what} not found (${p}) — run the packaging step first`);
    process.exit(1);
  }
}
const rcedit = findRcedit();
if (!rcedit) {
  console.warn('[carrotcap] set-exe-icon: rcedit not found in the electron-builder cache — '
    + 'app icon left as the Electron default. Run a build once with network access, or turn on '
    + 'Windows Developer Mode and set build.win.signAndEditExecutable to true.');
  process.exit(0);
}
execFileSync(rcedit, [exe, '--set-icon', ico], { stdio: 'inherit' });
console.log('[carrotcap] set-exe-icon: icon applied to carrotcap.exe');
