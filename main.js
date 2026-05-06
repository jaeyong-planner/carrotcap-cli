// CARROTCAP CLI — Electron main process
// Responsibilities: BrowserWindow, node-pty shell spawn, IPC bridge to renderer,
//                   folder dialog/tree/search.

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// --- Pre-init: force English logs and isolate user-data so GPU cache access errors disappear.
//   '0x5 access denied' on cache_util_win.cc happens when Electron is launched from an
//   elevated shell (VS Developer PowerShell) but tries to write into a non-elevated cache dir.
//   Pinning userData to %LOCALAPPDATA%\carrotcap fixes it without requiring elevation.
try {
  app.commandLine.appendSwitch('lang', 'en-US');
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  const userData = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'carrotcap')
    : path.join(os.homedir(), '.carrotcap');
  fs.mkdirSync(userData, { recursive: true });
  app.setPath('userData', userData);
} catch (e) { /* non-fatal */ }

// node-pty is a native module; needs electron-rebuild. Fall back to child_process if missing.
let pty;
let ptyAvailable = true;
try {
  pty = require('node-pty');
} catch (err) {
  ptyAvailable = false;
  console.warn('[carrotcap] node-pty load failed, falling back to child_process:', err.message);
}
const { spawn } = require('child_process');

const APP_ROOT = __dirname;
const SETTINGS_PATH = path.join(APP_ROOT, 'settings.json');

let mainWindow = null;
const sessions = new Map(); // ptyId -> { proc, kind }

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function saveSettings(next) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf8');
}

function defaultShell() {
  if (process.platform === 'win32') {
    // Pin PowerShell by absolute path so PATH order / COMSPEC=cmd never wins.
    const candidates = [
      process.env.PWSH_EXE,
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Program Files\\PowerShell\\6\\pwsh.exe',
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      path.join(process.env.SystemRoot || 'C:\\Windows', 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    ].filter(Boolean);
    for (const c of candidates) {
      try { if (fs.existsSync(c)) return c; } catch (e) {}
    }
    return 'powershell.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

function resolvePtyArgs(opts) {
  const settings = opts.settings || {};
  const cwd = opts.cwd && fs.existsSync(opts.cwd) ? opts.cwd : (settings.defaultProjectPath || os.homedir());
  if (opts.mode === 'cli' && opts.cliKey) {
    const cli = settings.cli && settings.cli[opts.cliKey];
    if (!cli) return { error: `CLI key '${opts.cliKey}' not configured in settings.json` };
    const shellArg = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
    const argList = process.platform === 'win32'
      ? ['-NoExit', '-NoLogo', '-Command', [cli.command, ...(cli.args || [])].join(' ')]
      : ['-c', [cli.command, ...(cli.args || [])].join(' ') + '; exec $SHELL'];
    return { file: shellArg, args: argList, cwd, kind: `cli:${opts.cliKey}` };
  }
  const plainArgs = process.platform === 'win32' ? ['-NoLogo'] : [];
  return { file: defaultShell(), args: plainArgs, cwd, kind: 'plain' };
}

function spawnSession(payload) {
  const settings = loadSettings() || {};
  const resolved = resolvePtyArgs({ ...payload, settings });
  if (resolved.error) return { error: resolved.error };
  const { file, args, cwd, kind } = resolved;

  const cols = payload.cols || 80;
  const rows = payload.rows || 24;
  const env = { ...process.env, TERM: 'xterm-256color', CARROTCAP: '1' };

  let proc;
  try {
    if (ptyAvailable) {
      proc = pty.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env });
    } else {
      const child = spawn(file, args, { cwd, env, windowsHide: false, stdio: ['pipe', 'pipe', 'pipe'] });
      proc = {
        _child: child,
        write: (data) => {
          try { if (child.stdin && !child.stdin.destroyed) child.stdin.write(String(data)); } catch (e) {}
        },
        resize: () => {},
        kill: () => {
          try { child.kill(); } catch (e) {}
        },
        onData: (cb) => {
          child.stdout.on('data', (b) => cb(b.toString()));
          child.stderr.on('data', (b) => cb(b.toString()));
        },
        onExit: (cb) => {
          child.on('exit', (code) => cb({ exitCode: code }));
        }
      };
    }
  } catch (e) {
    return { error: `Failed to spawn: ${e.message}` };
  }

  const id = `pty_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  sessions.set(id, { proc, kind });

  const wireData = (chunk) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('pty:data', { id, data: typeof chunk === 'string' ? chunk : chunk.toString() });
  };
  proc.onData(wireData);
  proc.onExit(({ exitCode }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pty:exit', { id, code: exitCode });
    }
    sessions.delete(id);
  });

  // (Diagnostic line removed — same info is on the pane header tag now.
  //  If you ever need it back, check pty-mode via ipcMain.handle('app:pty-available').)

  return { id, kind, shell: file, ptyMode: ptyAvailable ? 'PTY' : 'pipe-fallback' };
}

function buildFolderTree(rootPath, maxDepth = 4) {
  if (!rootPath || !fs.existsSync(rootPath)) return null;
  const root = { name: path.basename(rootPath) || rootPath, path: rootPath, type: 'dir', children: [] };
  const walk = (node, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(node.path, { withFileTypes: true }); }
    catch (e) { return; }
    entries.sort((a, b) => {
      if (a.isDirectory() === b.isDirectory()) return a.name.localeCompare(b.name);
      return a.isDirectory() ? -1 : 1;
    });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (['node_modules', 'dist', 'out', '__pycache__'].includes(entry.name)) continue;
      const childPath = path.join(node.path, entry.name);
      const child = { name: entry.name, path: childPath, type: entry.isDirectory() ? 'dir' : 'file', children: [] };
      node.children.push(child);
      if (entry.isDirectory()) walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return root;
}

function searchFiles(rootPath, query, limit = 200) {
  const lower = (query || '').toLowerCase();
  if (!rootPath || !fs.existsSync(rootPath) || !lower) return [];
  const results = [];
  const walk = (dir, depth) => {
    if (results.length >= limit || depth > 6) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (['node_modules', 'dist', 'out', '__pycache__'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.name.toLowerCase().includes(lower)) {
        results.push({ name: entry.name, path: full, type: entry.isDirectory() ? 'dir' : 'file' });
        if (results.length >= limit) return;
      }
      if (entry.isDirectory()) walk(full, depth + 1);
    }
  };
  walk(rootPath, 0);
  return results;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f0f12',
    title: 'CARROTCAP CLI',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(APP_ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => {
    mainWindow = null;
    for (const [, s] of sessions) {
      try { s.proc.kill(); } catch (e) {}
    }
    sessions.clear();
  });
}

// ---------- IPC ----------
ipcMain.handle('settings:get', () => loadSettings());
ipcMain.handle('settings:set', (_e, next) => { saveSettings(next); return true; });

ipcMain.handle('folder:pick', async () => {
  try {
    const parent = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : null;
    const r = parent
      ? await dialog.showOpenDialog(parent, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return r.filePaths[0];
  } catch (err) {
    console.error('[carrotcap main] folder:pick failed:', err && (err.stack || err.message || err));
    return null;
  }
});
ipcMain.handle('folder:tree', (_e, rootPath) => buildFolderTree(rootPath));
ipcMain.handle('folder:search', (_e, rootPath, query) => searchFiles(rootPath, query));
ipcMain.handle('folder:open-in-os', (_e, p) => { shell.showItemInFolder(p); });

ipcMain.handle('pty:spawn', (_e, payload) => spawnSession(payload || {}));
ipcMain.on('pty:write', (_e, { id, data }) => {
  const s = sessions.get(id);
  if (!s) return;
  try {
    s.proc.write(typeof data === 'string' ? data : String(data));
  } catch (err) {
    console.warn('[carrotcap] pty write fail', err && err.message);
  }
});
ipcMain.on('pty:resize', (_e, { id, cols, rows }) => {
  const s = sessions.get(id);
  if (s && s.proc.resize) {
    try { s.proc.resize(cols, rows); } catch (e) {}
  }
});
ipcMain.on('pty:kill', (_e, { id }) => {
  const s = sessions.get(id);
  if (s) { try { s.proc.kill(); } catch (e) {} sessions.delete(id); }
});

ipcMain.handle('app:platform', () => process.platform);
ipcMain.handle('app:pty-available', () => ptyAvailable);

app.whenReady().then(() => {
  if (!loadSettings()) {
    const defaults = {
      cli: {
        claude: { command: 'claude', args: [] },
        gemini: { command: 'gemini', args: [] },
        codex: { command: 'codex', args: [] }
      },
      defaultShell: defaultShell(),
      defaultProjectPath: os.homedir(),
      ui: { theme: 'dark', fontSize: 14, fontFamily: 'Cascadia Code, Consolas, monospace' }
    };
    saveSettings(defaults);
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
