// CARROTCAP CLI — Electron main process
// 책임: BrowserWindow 띄우기, node-pty로 실제 셸 스폰, IPC로 렌더러와 통신,
//      폴더 다이얼로그/트리/검색, AOR 엔진(routed shell) 통합 진입점.

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Some Windows GPU drivers crash Electron's GPU process before the window is usable.
// CARROTCAP is terminal UI only, so software rendering is the safer default.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

// PTY: prebuilt multi-arch fork ships native binaries — no electron-rebuild needed on consumer machines.
// Falls back to child_process if the binary doesn't match the current Electron ABI.
let pty;
let ptyAvailable = true;
try {
  pty = require('@homebridge/node-pty-prebuilt-multiarch');
} catch (err) {
  ptyAvailable = false;
  console.warn('[carrotcap] pty load failed, falling back to child_process:', err.message);
}
const { spawn } = require('child_process');

const APP_ROOT = __dirname;
// task-008: mutable state lives in a per-user data dir, never next to the code.
// Packaged builds cannot write into app.asar, and dev runs must not dirty the
// tracked settings.json / CLAUDE.md. A fixed dir name keeps CARROTCAP separate
// from other Electron apps (e.g. Cream CLI uses %APPDATA%\cream-cli).
// CARROTCAP_USER_DATA_DIR (absolute path) isolates test runs (scripts/test-electron-smoke.js).
const userDataOverride = process.env.CARROTCAP_USER_DATA_DIR;
const USER_DATA_ROOT = (userDataOverride && path.isAbsolute(userDataOverride))
  ? userDataOverride
  : path.join(app.getPath('appData'), app.isPackaged ? 'carrotcap-cli' : 'carrotcap-cli-dev');
// app.setPath may throw for a directory that does not exist yet (fresh profile).
try { fs.mkdirSync(USER_DATA_ROOT, { recursive: true }); } catch { /* setPath/initUserState surface it */ }
app.setPath('userData', USER_DATA_ROOT);
// Bundled, read-only defaults shipped with the app.
const BUNDLED_SETTINGS_PATH  = path.join(APP_ROOT, 'settings.json');
const BUNDLED_CLAUDE_MD_PATH = path.join(APP_ROOT, 'CLAUDE.md');
const SETTINGS_PATH  = path.join(USER_DATA_ROOT, 'settings.json');
const CLAUDE_MD_PATH = path.join(USER_DATA_ROOT, 'CLAUDE.md');
// Workspace state is stored separately from settings.json so that the renderer
// cannot escalate by stuffing arbitrary paths into the allowlist via settings:set.
// Only the main process reads/writes this file (task-004 reflection).
const WORKSPACE_STATE_PATH = path.join(USER_DATA_ROOT, 'workspace-state.json');
// v0.1.0 dev runs wrote workspace grants next to the code; migrated once at boot.
const LEGACY_WORKSPACE_STATE_PATH = path.join(APP_ROOT, 'workspace-state.json');

let mainWindow = null;
const sessions = new Map(); // ptyId -> { proc, kind }

// ---------- Security helpers (task-003) ----------
// Hardens IPC inputs and shell invocations against a compromised renderer.
//   validateSettings: whitelist-based settings sanitizer (Critical #2)
//   pwshSingleQuote / posixShellQuote: shell-safe argument escaping (Critical #3)
//   getRegExePath / getPowerShellExePath: PATH-poisoning resistant launchers (Major M1)
function getSystem32Path() {
  // Defense in depth: even if SystemRoot is poisoned with a relative or empty
  // value, fall back to the canonical absolute path.
  const envRoot = process.env.SystemRoot;
  const root = (typeof envRoot === 'string' && path.isAbsolute(envRoot)) ? envRoot : 'C:\\Windows';
  return path.join(root, 'System32');
}
function getRegExePath() {
  return path.join(getSystem32Path(), 'reg.exe');
}
function getPowerShellExePath() {
  return path.join(getSystem32Path(), 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

const CMD_NAME_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const CLI_KEY_RE  = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const UI_THEMES   = ['dark', 'light', 'system'];
// Reserved object keys that must never be written into a dynamic-key map,
// even though they happen to match CLI_KEY_RE.
const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_RECENT_WORKSPACES = 16;
const MAX_QUERY_LEN         = 256;

// Workspace allowlist (task-004): folder:* and aiops:setup may only operate inside
// paths the user has explicitly selected (folder:pick) or persisted as recent.
// Stored as canonical realpath strings.
const allowedWorkspaces = new Set();

function clipString(s, maxLen) {
  // Drop control chars (incl. NUL, CR, LF, BEL, ESC) then cap length.
  return String(s).replace(/[\x00-\x1F]/g, '').slice(0, maxLen);
}

function validateSettings(input) {
  // Whitelist-based clone. Unknown keys and malformed values are dropped silently.
  // Threat model: a compromised renderer cannot use settings:set as a write-anywhere
  // primitive nor as a vector for command injection (cli.command).
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;

  if (input.aor && typeof input.aor === 'object' && !Array.isArray(input.aor)) {
    const aor = {};
    if ('enabled' in input.aor)   aor.enabled = !!input.aor.enabled;
    if ('autoStart' in input.aor) aor.autoStart = !!input.aor.autoStart;
    if (typeof input.aor.engineRoot === 'string') aor.engineRoot = clipString(input.aor.engineRoot, 1024);
    if (Array.isArray(input.aor.engineRootCandidates)) {
      aor.engineRootCandidates = input.aor.engineRootCandidates
        .filter((s) => typeof s === 'string')
        .slice(0, 32)
        .map((s) => clipString(s, 1024));
    }
    out.aor = aor;
  }

  if (input.cli && typeof input.cli === 'object' && !Array.isArray(input.cli)) {
    const cli = {};
    for (const [key, val] of Object.entries(input.cli)) {
      if (RESERVED_OBJECT_KEYS.has(key)) continue;
      if (!CLI_KEY_RE.test(key)) continue;
      if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
      const cmd = typeof val.command === 'string' ? val.command : '';
      if (!CMD_NAME_RE.test(cmd)) continue;
      const args = Array.isArray(val.args)
        ? val.args.filter((a) => typeof a === 'string').slice(0, 32).map((a) => clipString(a, 256))
        : [];
      cli[key] = { command: cmd, args };
    }
    out.cli = cli;
  }

  if (typeof input.defaultShell === 'string')       out.defaultShell = clipString(input.defaultShell, 256);
  if (typeof input.defaultProjectPath === 'string') out.defaultProjectPath = clipString(input.defaultProjectPath, 1024);
  // recentWorkspaces is INTENTIONALLY NOT in this whitelist. It is workspace
  // grant state, not user settings, and lives in workspace-state.json (main-only).

  if (input.ui && typeof input.ui === 'object' && !Array.isArray(input.ui)) {
    const ui = {};
    if (typeof input.ui.theme === 'string' && UI_THEMES.includes(input.ui.theme)) ui.theme = input.ui.theme;
    if (typeof input.ui.fontSize === 'number' && Number.isFinite(input.ui.fontSize) && input.ui.fontSize >= 8 && input.ui.fontSize <= 64) {
      ui.fontSize = Math.floor(input.ui.fontSize);
    }
    if (typeof input.ui.fontFamily === 'string') ui.fontFamily = clipString(input.ui.fontFamily, 256);
    out.ui = ui;
  }

  return out;
}

function pwshSingleQuote(s) {
  // PowerShell single-quoted strings: no expansion; only `''` escapes a literal `'`.
  return "'" + String(s).replace(/'/g, "''") + "'";
}
function posixShellQuote(s) {
  // POSIX single-quoted strings: only `'` is special; `'\''` closes/escapes/reopens.
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function safeRealpath(p) {
  // Resolve symlinks if possible; otherwise return the lexically resolved path
  // so callers can still compare against the allowlist. Downstream fs ops will
  // surface their own errors for non-existent inputs.
  try { return fs.realpathSync.native(p); }
  catch { try { return path.resolve(p); } catch { return null; } }
}

function normalizePath(p) {
  // Windows is case-insensitive on file systems; POSIX is case-sensitive.
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInsideRoot(target, root) {
  if (typeof target !== 'string' || typeof root !== 'string' || !target || !root) return false;
  if (/[\x00]/.test(target) || /[\x00]/.test(root)) return false;
  const t = safeRealpath(target);
  const r = safeRealpath(root);
  if (!t || !r) return false;
  const tn = normalizePath(t);
  const rn = normalizePath(r);
  if (tn === rn) return true;
  return tn.startsWith(rn + path.sep);
}

function isPathInsideAllowedWorkspace(target) {
  if (typeof target !== 'string' || !target) return false;
  for (const root of allowedWorkspaces) {
    if (isPathInsideRoot(target, root)) return true;
  }
  return false;
}

function addAllowedWorkspace(p) {
  if (typeof p !== 'string' || !p) return null;
  let real;
  try { real = fs.realpathSync.native(p); } catch { return null; }
  if (!real) return null;
  try {
    const st = fs.statSync(real);
    if (!st.isDirectory()) return null;
  } catch { return null; }
  allowedWorkspaces.add(real);
  return real;
}

function loadWorkspaceState(filePath = WORKSPACE_STATE_PATH) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { recentWorkspaces: [] };
    const recent = Array.isArray(parsed.recentWorkspaces)
      ? parsed.recentWorkspaces.filter((s) => typeof s === 'string').slice(0, MAX_RECENT_WORKSPACES)
      : [];
    return { recentWorkspaces: recent };
  } catch { return { recentWorkspaces: [] }; }
}

function saveWorkspaceState(state) {
  try { fs.writeFileSync(WORKSPACE_STATE_PATH, JSON.stringify(state, null, 2), 'utf8'); return true; }
  catch (e) { console.warn('[carrotcap] saveWorkspaceState failed:', e.message); return false; }
}

function getTemplateRoot() {
  // In dev (npm start) APP_ROOT is the source tree.
  // In packaged builds, build.files puts agents/ and scripts/run-*.ps1 inside the
  // asar archive, also accessible via __dirname / APP_ROOT.
  return APP_ROOT;
}

function copyTemplateIfMissing(sourcePath, destPath, projectRoot) {
  // Reads a template from the bundled app and writes it to the project workspace
  // via writeIfMissing (which already enforces ancestor symlink + post-write realpath).
  // Silently skips when the template is missing in this build (warn for diagnostics).
  if (!fs.existsSync(sourcePath)) {
    console.warn('[carrotcap] aiops template missing:', sourcePath);
    return false;
  }
  let content;
  try { content = fs.readFileSync(sourcePath, 'utf8'); }
  catch (e) {
    console.warn('[carrotcap] aiops template read failed:', sourcePath, e.message);
    return false;
  }
  return writeIfMissing(destPath, content, projectRoot);
}

function persistRecentWorkspace(real) {
  // Stored in workspace-state.json (main-process-only). Renderer cannot inject
  // entries here because it does not have an IPC bridge that writes this file.
  if (typeof real !== 'string' || !real) return;
  const state = loadWorkspaceState();
  const realKey = normalizePath(real);
  // Dedupe by normalized path (Windows case/separator insensitive).
  const filtered = state.recentWorkspaces.filter((r) => normalizePath(r) !== realKey);
  filtered.unshift(real);
  state.recentWorkspaces = filtered.slice(0, MAX_RECENT_WORKSPACES);
  saveWorkspaceState(state);
}

// IPC payload validation (task-007): pty:* and aor:set-claude-md.
const PTY_MODES = new Set(['plain', 'aor', 'aiops', 'cli']);
const PTY_ID_RE = /^pty_\d{1,16}_[a-z0-9]{1,16}$/;
const MAX_PTY_WRITE_BYTES = 1024 * 1024;  // 1MB (UTF-8) per write / clipboard transfer
const MAX_CLAUDE_MD_BYTES = 512 * 1024;   // 512KB

function clampInt(v, min, max, fallback) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

function resolveAllowedDir(p) {
  // Returns the canonical realpath of p only if it is an existing directory
  // inside an allowed workspace; otherwise null.
  if (typeof p !== 'string' || !p || !isPathInsideAllowedWorkspace(p)) return null;
  const real = safeRealpath(p);
  if (!real) return null;
  try { return fs.statSync(real).isDirectory() ? real : null; } catch { return null; }
}

function sanitizeSpawnPayload(input) {
  // Whitelist clone of the renderer's pty:spawn payload. cwd outside the
  // workspace allowlist is dropped (spawn falls back to the home directory) so
  // AIOps auto-setup can never write outside a folder the user picked.
  const p = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
  const out = {
    mode: PTY_MODES.has(p.mode) ? p.mode : 'plain',
    cols: clampInt(p.cols, 2, 1000, 80),
    rows: clampInt(p.rows, 1, 500, 24)
  };
  if (typeof p.cliKey === 'string' && CLI_KEY_RE.test(p.cliKey) && !RESERVED_OBJECT_KEYS.has(p.cliKey)) {
    out.cliKey = p.cliKey;
  }
  const cwd = resolveAllowedDir(p.cwd);
  if (cwd) out.cwd = cwd;
  return out;
}

function isValidPtyId(id) {
  return typeof id === 'string' && PTY_ID_RE.test(id);
}

function isWithinByteCap(s, maxBytes) {
  // Cheap reject first: a UTF-8 string is never shorter in bytes than in UTF-16 units.
  return typeof s === 'string' && s.length <= maxBytes && Buffer.byteLength(s, 'utf8') <= maxBytes;
}

function validateClaudeMdContent(content) {
  if (typeof content !== 'string') return false;
  if (content.includes('\x00')) return false;
  return isWithinByteCap(content, MAX_CLAUDE_MD_BYTES);
}
// ---------- end security helpers ----------

// Self-heal the global `carrotcap` / `aor` CLI registration on every packaged launch.
// Why: NSIS installer can fail to create the shim (antivirus quarantine, locked
// WindowsApps folder, sysadmin running a portable copy, manual exe copy, etc.).
// A user who can launch the GUI from Start Menu must always end up with a
// working command afterwards in any new shell.
function ensureCliRegistration() {
  if (process.platform !== 'win32') return;
  if (!app.isPackaged) return; // dev runs (npm start) shouldn't poke registry/PATH
  if (!process.env.LOCALAPPDATA) return;
  const exePath = process.execPath;
  if (!/carrotcap\.exe$/i.test(exePath)) return; // safety: only when running the real binary

  const { execFileSync } = require('child_process');

  // 1) Shim: %LOCALAPPDATA%\Microsoft\WindowsApps\carrotcap.cmd and aor.cmd
  //    This folder is on the per-user PATH by default on Windows 10/11.
  try {
    const shimDir = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps');
    const expected = `@echo off\r\nstart "" "${exePath}" %*\r\n`;
    if (!fs.existsSync(shimDir)) fs.mkdirSync(shimDir, { recursive: true });
    for (const name of ['carrotcap.cmd', 'aor.cmd']) {
      const shimPath = path.join(shimDir, name);
      let needWrite = true;
      if (fs.existsSync(shimPath)) {
        try {
          const current = fs.readFileSync(shimPath, 'utf8');
          if (current === expected) needWrite = false;
        } catch (_) { /* unreadable -> rewrite */ }
      }
      if (needWrite) {
        fs.writeFileSync(shimPath, expected, 'utf8');
        console.log('[carrotcap] CLI shim ensured:', shimPath);
      }
    }
  } catch (err) {
    console.warn('[carrotcap] CLI shim self-heal failed:', err.message);
  }

  // 2) PATH fallback: append install dir to HKCU\Environment\Path if missing.
  //    Belt-and-suspenders for environments where WindowsApps is not on PATH.
  try {
    const installDir = path.dirname(exePath);
    const regExe  = getRegExePath();
    const pwshExe = getPowerShellExePath();
    let current = '';
    try {
      const out = execFileSync(regExe, ['query', 'HKCU\\Environment', '/v', 'Path'], { encoding: 'utf8' });
      const m = out.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/);
      if (m) current = m[1].trim();
    } catch (_) { /* Path value may not exist yet */ }
    const norm = (s) => s.replace(/[\\/]+$/, '').toLowerCase();
    const parts = current.split(';').map((s) => s.trim()).filter(Boolean);
    const already = parts.some((p) => norm(p) === norm(installDir));
    if (!already) {
      const next = current ? `${current};${installDir}` : installDir;
      execFileSync(regExe, ['add', 'HKCU\\Environment', '/v', 'Path', '/t', 'REG_EXPAND_SZ', '/d', next, '/f'], { stdio: 'ignore' });
      console.log('[carrotcap] added install dir to user PATH:', installDir);
      // Notify shells/Explorer of env change. Best-effort; do not fail launch on error.
      try {
        execFileSync(pwshExe, [
          '-NoProfile', '-NonInteractive', '-Command',
          "$sig='[DllImport(\"user32.dll\", SetLastError=true, CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);'; $t=Add-Type -MemberDefinition $sig -Name Win32SendMessageTimeout -Namespace Win32Functions -PassThru; [UIntPtr]$out=[UIntPtr]::Zero; [void]$t::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 3000, [ref]$out)"
        ], { stdio: 'ignore' });
      } catch (_) { /* broadcast is best-effort */ }
    }
  } catch (err) {
    console.warn('[carrotcap] PATH self-heal failed:', err.message);
  }
}

function readJsonFile(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function loadSettings() {
  return readJsonFile(SETTINGS_PATH);
}

function saveSettings(next) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf8');
}

function buildDefaultSettings() {
  return {
    aor: {
      enabled: true,
      engineRoot: '',
      engineRootCandidates: [
        '%USERPROFILE%\\Desktop\\WINDOWS\\WINDOWS',
        '%USERPROFILE%\\WINDOWS',
        'C:\\WINDOWS\\carrotcap'
      ],
      autoStart: false
    },
    cli: {
      claude: { command: 'claude', args: [] },
      gemini: { command: 'gemini', args: [] },
      codex: { command: 'codex', args: [] }
    },
    defaultShell: defaultShell(),
    defaultProjectPath: os.homedir(),
    ui: { theme: 'dark', fontSize: 14, fontFamily: 'Cascadia Code, Consolas, monospace' }
  };
}

// task-008: first run seeds the user data dir from the bundled defaults.
// Existing user files are never overwritten.
function initUserState() {
  fs.mkdirSync(USER_DATA_ROOT, { recursive: true });
  if (fs.existsSync(SETTINGS_PATH) && !loadSettings()) {
    // Unreadable/corrupt user settings: keep the original for recovery, then re-seed.
    const backup = `${SETTINGS_PATH}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.renameSync(SETTINGS_PATH, backup);
    console.warn('[carrotcap] settings.json was unreadable; backed up to', backup);
  }
  if (!fs.existsSync(SETTINGS_PATH)) {
    const seeded = validateSettings(readJsonFile(BUNDLED_SETTINGS_PATH));
    saveSettings(seeded.cli && Object.keys(seeded.cli).length ? seeded : buildDefaultSettings());
  }
  if (!fs.existsSync(CLAUDE_MD_PATH)) {
    try { fs.copyFileSync(BUNDLED_CLAUDE_MD_PATH, CLAUDE_MD_PATH); }
    catch (e) { console.warn('[carrotcap] CLAUDE.md seed failed:', e.message); }
  }
  if (!fs.existsSync(WORKSPACE_STATE_PATH) && fs.existsSync(LEGACY_WORKSPACE_STATE_PATH)) {
    if (saveWorkspaceState(loadWorkspaceState(LEGACY_WORKSPACE_STATE_PATH))) {
      console.log('[carrotcap] migrated workspace-state.json to', WORKSPACE_STATE_PATH);
    }
  }
}

function defaultShell() {
  if (process.platform === 'win32') return getPowerShellExePath();
  return process.env.SHELL || '/bin/bash';
}

// AOR engineRoot 후보들을 순서대로 검사해서 첫 번째 존재하는 경로를 돌려준다.
// 사용자 PC마다 경로가 달라서 settings.json 한 줄로는 못 맞춤 → 자동 탐지.
function expandEnv(p) {
  if (!p || typeof p !== 'string') return p;
  return p.replace(/%([^%]+)%/g, (_, name) => process.env[name] || '');
}
function resolveAorEngineRoot(settings) {
  const candidates = [];
  // Highest priority: bundled AOR shipped with the installer.
  // Production: <install-dir>/resources/AOR (electron-builder extraResources).
  // Development: <repo>/AOR.
  const bundledAor = app.isPackaged
    ? path.join(process.resourcesPath, 'AOR')
    : path.join(APP_ROOT, 'AOR');
  candidates.push(bundledAor);
  // User overrides from settings.
  if (settings && settings.aor && settings.aor.engineRoot) candidates.push(settings.aor.engineRoot);
  if (settings && settings.aor && Array.isArray(settings.aor.engineRootCandidates)) {
    candidates.push(...settings.aor.engineRootCandidates);
  }
  // Common fallback locations.
  candidates.push(
    path.join(os.homedir(), 'Desktop', 'WINDOWS', 'WINDOWS'),
    path.join(os.homedir(), 'WINDOWS'),
    path.join(APP_ROOT, 'engine'),
    'C:\\WINDOWS\\carrotcap',
  );
  for (const raw of candidates) {
    const c = expandEnv(raw);
    if (c && fs.existsSync(c) && fs.existsSync(path.join(c, 'engine', 'windows', '_internal', 'shell-init.ps1'))) {
      return c;
    }
  }
  return null;
}

const AIOPS_CLAUDE_BLOCK_START = '<!-- CARROTCAP:AIOPS:START -->';
const AIOPS_CLAUDE_BLOCK_END = '<!-- CARROTCAP:AIOPS:END -->';

function assertAncestorsClean(targetPath, projectRoot) {
  // FAIL-CLOSED ancestor walk (task-004-r3 reflection): every termination path
  // other than "reached realRoot" throws. The caller will not write.
  // Note: a residual TOCTOU window remains between this check and the actual
  // writeFileSync — that is documented as a known limitation of path-string-based
  // write; aiops:setup is only invoked on workspaces the user explicitly chose.
  if (!projectRoot) throw new Error('assertAncestorsClean: missing projectRoot');
  const realRoot = safeRealpath(projectRoot);
  if (!realRoot) throw new Error(`assertAncestorsClean: cannot resolve projectRoot ${projectRoot}`);
  let cursor = path.dirname(targetPath);
  let safety = 64;
  while (cursor) {
    if (safety-- <= 0) {
      throw new Error(`assertAncestorsClean: safety counter exhausted at ${cursor}`);
    }
    const cursorReal = safeRealpath(cursor);
    if (cursorReal && normalizePath(cursorReal) === normalizePath(realRoot)) return; // OK
    if (fs.existsSync(cursor)) {
      const lst = fs.lstatSync(cursor);
      if (lst.isSymbolicLink()) {
        throw new Error(`assertAncestorsClean: symlink ancestor: ${cursor}`);
      }
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      throw new Error(`assertAncestorsClean: reached fs root without finding projectRoot`);
    }
    cursor = parent;
  }
  throw new Error(`assertAncestorsClean: walk terminated unexpectedly`);
}

function writeIfMissing(filePath, content, projectRoot) {
  // task-004 reflection (Critical reflect): walk ALL ancestor directories before
  // writing, refuse if any is a symlink/junction. This eliminates the TOCTOU
  // window where a directory was swapped for a symlink between safeMkdir and write.
  // Post-write realpath check stays as redundant defense.
  if (fs.existsSync(filePath)) {
    try {
      const lst = fs.lstatSync(filePath);
      if (lst.isSymbolicLink()) return false; // do not overwrite a symlink
    } catch { return false; }
    return false;
  }
  if (projectRoot) {
    assertAncestorsClean(filePath, projectRoot);
  }
  fs.writeFileSync(filePath, content, 'utf8');
  if (projectRoot) {
    const real = safeRealpath(filePath);
    if (!real || !isPathInsideRoot(real, projectRoot)) {
      try { fs.unlinkSync(filePath); } catch {}
      throw new Error(`writeIfMissing: created path escapes workspace: ${filePath}`);
    }
  }
  return true;
}

function safeMkdir(dirPath, projectRoot) {
  // Refuse to operate on a symlink at this path (would escape projectRoot).
  // Recursively check all ancestors up to projectRoot for symlinks/junctions.
  if (projectRoot) {
    let cursor = dirPath;
    const realRoot = safeRealpath(projectRoot);
    while (cursor && cursor !== realRoot) {
      if (fs.existsSync(cursor)) {
        try {
          const lst = fs.lstatSync(cursor);
          if (lst.isSymbolicLink()) {
            throw new Error(`safeMkdir: refusing symlink ancestor: ${cursor}`);
          }
        } catch (e) {
          if (e && e.message && e.message.startsWith('safeMkdir:')) throw e;
          // ignore other stat errors and let mkdir surface them
        }
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  fs.mkdirSync(dirPath, { recursive: true });
  if (projectRoot) {
    const real = safeRealpath(dirPath);
    if (!real || !isPathInsideRoot(real, projectRoot)) {
      throw new Error(`safeMkdir: created path escapes workspace: ${dirPath}`);
    }
  }
}
// ---------- end aiops fs helpers ----------

function ensureAiopsProjectStructure(projectRoot) {
  if (!projectRoot || !fs.existsSync(projectRoot)) return null;
  // Resolve to canonical realpath once and use it as the boundary for all
  // subsequent symlink/junction checks (TOCTOU-resistant).
  const realRoot = safeRealpath(projectRoot);
  if (!realRoot || !fs.existsSync(realRoot)) return null;

  // task-009 review: verify every bundled template BEFORE writing anything, so a
  // broken build never leaves a half-created structure reported as success.
  const missing = findMissingAiopsTemplates();
  if (missing.length) {
    console.warn('[carrotcap] aiops setup refused: missing templates:', missing.join(', '));
    return null;
  }
  const tmpl = getAiopsTemplateSources();
  let aiopsBlockBody;
  try { aiopsBlockBody = fs.readFileSync(tmpl.claudeBlock, 'utf8'); }
  catch (e) {
    console.warn('[carrotcap] aiops setup refused: CLAUDE block template unreadable:', e.message);
    return null;
  }

  const agentsDir = path.join(realRoot, 'agents');
  const logsDir = path.join(realRoot, 'logs');
  const researchLogsDir = path.join(logsDir, 'research');
  const reviewLogsDir = path.join(logsDir, 'review');
  const backlogDir = path.join(realRoot, 'backlog');
  try {
    safeMkdir(agentsDir, realRoot);
    safeMkdir(researchLogsDir, realRoot);
    safeMkdir(reviewLogsDir, realRoot);
    safeMkdir(backlogDir, realRoot);
  } catch (e) {
    console.warn('[carrotcap] aiops setup refused:', e.message);
    return null;
  }

  // task-009: setup documents live in templates/aiops/ (editable, shipped via build.files);
  // researcher/reviewer come from agents/ (task-005). writeIfMissing (inside
  // copyTemplateIfMissing) preserves any existing project file.
  copyTemplateIfMissing(tmpl.supervisor, path.join(agentsDir, 'supervisor.md'), realRoot);
  copyTemplateIfMissing(tmpl.researcher, path.join(agentsDir, 'researcher.md'), realRoot);
  copyTemplateIfMissing(tmpl.reviewer, path.join(agentsDir, 'reviewer.md'), realRoot);
  copyTemplateIfMissing(tmpl.task001, path.join(backlogDir, 'task-001.md'), realRoot);
  copyTemplateIfMissing(tmpl.workflow, path.join(backlogDir, 'workflow.md'), realRoot);

  // task-005: deploy the helper PowerShell scripts so the project can run the
  // researcher/reviewer cycle with the same auto-loading and output shaping the
  // PM uses. The scripts are copy-only (no template variables); writeIfMissing
  // preserves any user-modified project copy.
  const projectScriptsDir = path.join(realRoot, 'scripts');
  try {
    safeMkdir(projectScriptsDir, realRoot);
    copyTemplateIfMissing(tmpl.runResearcher, path.join(projectScriptsDir, 'run-researcher.ps1'), realRoot);
    copyTemplateIfMissing(tmpl.runReviewer, path.join(projectScriptsDir, 'run-reviewer.ps1'), realRoot);
  } catch (e) {
    // Non-fatal: setup continues with the agents/logs/backlog structure even if
    // scripts/ deployment fails (e.g. existing symlink at projectRoot/scripts).
    console.warn('[carrotcap] aiops scripts deployment failed:', e.message);
  }

  const claudePath = path.join(realRoot, 'CLAUDE.md');
  const aiopsBlock = `${AIOPS_CLAUDE_BLOCK_START}\n${aiopsBlockBody.replace(/\s*$/, '\n')}${AIOPS_CLAUDE_BLOCK_END}\n`;

  // task-004-r3 reflection: apply the same ancestor guard to CLAUDE.md write
  // since this block bypasses writeIfMissing.
  try {
    if (fs.existsSync(claudePath)) {
      const lst = fs.lstatSync(claudePath);
      if (lst.isSymbolicLink()) {
        console.warn('[carrotcap] aiops setup refused: CLAUDE.md is a symlink');
        return null;
      }
      assertAncestorsClean(claudePath, realRoot);
      const current = fs.readFileSync(claudePath, 'utf8');
      if (!current.includes(AIOPS_CLAUDE_BLOCK_START)) {
        fs.writeFileSync(claudePath, current.replace(/\s*$/, '\n\n') + aiopsBlock + '\n', 'utf8');
      }
    } else {
      assertAncestorsClean(claudePath, realRoot);
      fs.writeFileSync(claudePath, aiopsBlock + '\n', 'utf8');
    }
    // Post-write realpath verification: residual defense against parent-symlink swap
    // in the gap between assertAncestorsClean and writeFileSync.
    const claudeReal = safeRealpath(claudePath);
    if (!claudeReal || !isPathInsideRoot(claudeReal, realRoot)) {
      try { fs.unlinkSync(claudePath); } catch {}
      console.warn('[carrotcap] aiops setup refused: CLAUDE.md escaped workspace');
      return null;
    }
  } catch (e) {
    console.warn('[carrotcap] aiops CLAUDE.md write failed:', e.message);
    return null;
  }

  // Final realpath verification on every returned path (task-004-r2 reflection).
  // If any leaf escaped the workspace via a swapped ancestor, refuse.
  for (const p of [agentsDir, logsDir, backlogDir, claudePath]) {
    if (!fs.existsSync(p)) continue; // missing CLAUDE.md is acceptable on early failure paths
    const real = safeRealpath(p);
    if (!real || !isPathInsideRoot(real, realRoot)) {
      console.warn('[carrotcap] aiops setup refused: returned path escapes workspace:', p);
      return null;
    }
  }
  return { agentsDir, logsDir, backlogDir, claudePath, root: realRoot };
}

// Bundled sources copied by ensureAiopsProjectStructure (task-009 review).
function getAiopsTemplateSources() {
  const root = getTemplateRoot();
  return {
    supervisor:    path.join(root, 'templates', 'aiops', 'supervisor.md'),
    task001:       path.join(root, 'templates', 'aiops', 'task-001.md'),
    workflow:      path.join(root, 'templates', 'aiops', 'workflow.md'),
    claudeBlock:   path.join(root, 'templates', 'aiops', 'CLAUDE-block.md'),
    researcher:    path.join(root, 'agents', 'researcher.md'),
    reviewer:      path.join(root, 'agents', 'reviewer.md'),
    runResearcher: path.join(root, 'scripts', 'run-researcher.ps1'),
    runReviewer:   path.join(root, 'scripts', 'run-reviewer.ps1')
  };
}

function findMissingAiopsTemplates() {
  const root = getTemplateRoot();
  return Object.values(getAiopsTemplateSources())
    .filter((p) => !fs.existsSync(p))
    .map((p) => path.relative(root, p));
}

function resolvePtyArgs(opts) {
  // opts: { mode: 'plain' | 'aor' | 'aiops' | 'cli', cliKey?, cwd, settings }
  const settings = opts.settings || {};
  // task-007: both sources must be inside the workspace allowlist — AIOps mode
  // writes project files under this root.
  const requestedProjectRoot = resolveAllowedDir(opts.cwd) || resolveAllowedDir(settings.defaultProjectPath);
  const cwd = requestedProjectRoot || os.homedir();
  if (opts.mode === 'aor' || opts.mode === 'aiops') {
    const isAiops = opts.mode === 'aiops';
    const aiopsStructure = isAiops && requestedProjectRoot ? ensureAiopsProjectStructure(requestedProjectRoot) : null;
    const engineRoot = resolveAorEngineRoot(settings);
    if (!engineRoot) {
      // AOR 부팅 불가 → plain 셸로 폴백하되 kind에 사유 표시. 사용자 페인이 죽지 않게.
      return {
        file: defaultShell(),
        args: process.platform === 'win32' ? ['-NoLogo'] : [],
        cwd,
        kind: isAiops ? 'aiops-fallback(plain)' : 'aor-fallback(plain)',
        warning: isAiops
          ? `${aiopsStructure ? 'AIOps project structure is ready.' : 'Select a project folder to create the AIOps project structure.'} AOR engineRoot not found — falling back to plain shell. Configure aor.engineRoot in settings.json.`
          : 'AOR engineRoot not found — falling back to plain shell. Configure aor.engineRoot in settings.json.'
      };
    }
    const shellInit = path.join(engineRoot, 'engine', 'windows', '_internal', 'shell-init.ps1');
    const invoke = path.join(engineRoot, 'engine', 'windows', '_internal', 'invoke-aor.ps1');
    const claudeInt = path.join(engineRoot, 'engine', 'windows', '_internal', 'claude-integration.ps1');
    const shimDir = path.join(engineRoot, 'engine', 'windows', 'shims');
    const runtimeRoot = path.join(engineRoot, 'engine', 'windows', 'bin', '.router-output');
    const sessionFile = path.join(runtimeRoot, 'session-status.json');
    const reportsDir = path.join(runtimeRoot, 'reports');
    fs.mkdirSync(reportsDir, { recursive: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });
    const isoStart = new Date().toISOString();
    return {
      file: getPowerShellExePath(),
      args: [
        '-NoExit', '-ExecutionPolicy', 'Bypass',
        '-File', shellInit,
        '-ProjectPath', cwd,
        '-SessionFile', sessionFile,
        '-ShimDir', shimDir,
        '-InvokeScript', invoke,
        '-ClaudeIntegration', claudeInt,
        '-SessionStartIso', isoStart,
        '-ReportsDir', reportsDir,
        '-OpenDashboard', 'false'
      ],
      cwd,
      kind: isAiops ? 'aiops' : 'aor',
      warning: isAiops
        ? `${aiopsStructure ? 'AIOps project structure is ready.' : 'Select a project folder to create the AIOps project structure.'} Claude is supervisor, Gemini is researcher, Codex is reviewer.`
        : undefined
    };
  }
  if (opts.mode === 'cli' && opts.cliKey) {
    if (!CLI_KEY_RE.test(opts.cliKey)) {
      return { error: `CLI key '${opts.cliKey}' rejected: invalid identifier` };
    }
    const cli = settings.cli && settings.cli[opts.cliKey];
    if (!cli) return { error: `CLI key '${opts.cliKey}' not configured in settings.json` };
    // Defense in depth: validateSettings already enforces these on write, but settings.json
    // could have been edited manually before the validator existed.
    if (!CMD_NAME_RE.test(cli.command || '')) {
      return { error: `CLI command '${cli.command}' rejected: must match ${CMD_NAME_RE}` };
    }
    const cliArgs = Array.isArray(cli.args) ? cli.args.filter((a) => typeof a === 'string') : [];
    if (process.platform === 'win32') {
      const pwshLine = '& ' + [pwshSingleQuote(cli.command), ...cliArgs.map(pwshSingleQuote)].join(' ');
      return {
        file: getPowerShellExePath(),
        args: ['-NoExit', '-NoLogo', '-Command', pwshLine],
        cwd,
        kind: `cli:${opts.cliKey}`
      };
    }
    const shellArg = process.env.SHELL || '/bin/bash';
    const cmdLine = [posixShellQuote(cli.command), ...cliArgs.map(posixShellQuote)].join(' ') + '; exec $SHELL';
    return { file: shellArg, args: ['-c', cmdLine], cwd, kind: `cli:${opts.cliKey}` };
  }
  // plain — Windows에서는 -NoLogo만 주고 인터랙티브 모드. PowerShell은 PTY 없이도 conpty(node-pty) 위에서 라인 입력이 정상.
  const plainArgs = process.platform === 'win32' ? ['-NoLogo'] : [];
  return { file: defaultShell(), args: plainArgs, cwd, kind: 'plain' };
}

function spawnSession(rawPayload) {
  const payload = sanitizeSpawnPayload(rawPayload);
  const settings = loadSettings() || {};
  const resolved = resolvePtyArgs({ ...payload, settings });
  if (resolved.error) return { error: resolved.error };
  const { file, args, cwd, kind } = resolved;

  const { cols, rows } = payload;
  const env = { ...process.env, TERM: 'xterm-256color', CARROTCAP: '1' };

  let proc;
  try {
    if (ptyAvailable) {
      proc = pty.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env });
    } else {
      // 폴백: 진짜 PTY가 아니라 child_process pipe. 인터랙티브 라인 에디터(prompt/history)는 약하지만,
      // 명령 실행+출력은 가능. 키 입력은 그대로 stdin으로 보내고, 사용자에게 echo가 안 보일 수 있음을 경고.
      const child = spawn(file, args, { cwd, env, windowsHide: false, stdio: ['pipe', 'pipe', 'pipe'] });
      proc = {
        _child: child,
        write: (data) => {
          try { if (child.stdin && !child.stdin.destroyed) child.stdin.write(String(data)); } catch (e) { /* ignore */ }
        },
        resize: () => {},
        kill: () => {
          try { child.kill(); } catch (e) { /* ignore */ }
        },
        // pty.spawn API 모방: onData / onExit
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
  // 폴백 모드일 땐 spawnSession에서 직접 만든 proc도 동일한 onData/onExit 인터페이스를 갖도록 위에서 셋업했음.
  proc.onData(wireData);
  proc.onExit(({ exitCode }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pty:exit', { id, code: exitCode });
    }
    sessions.delete(id);
  });

  // AOR 폴백 같은 경고 메시지가 있으면 PTY 시작 직후 한 줄 출력
  if (resolved.warning) {
    setTimeout(() => wireData(`\r\n\x1b[33m[carrotcap] ${resolved.warning}\x1b[0m\r\n`), 100);
  }
  return { id, kind };
}

function buildFolderTree(rootPath, maxDepth = 4) {
  if (!rootPath || !fs.existsSync(rootPath)) return null;
  const root = { name: path.basename(rootPath) || rootPath, path: rootPath, type: 'dir', children: [] };
  const walk = (node, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(node.path, { withFileTypes: true }); }
    catch { return; }
    entries.sort((a, b) => {
      if (a.isDirectory() === b.isDirectory()) return a.name.localeCompare(b.name);
      return a.isDirectory() ? -1 : 1;
    });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (['node_modules', 'dist', 'out', '__pycache__'].includes(entry.name)) continue;
      // Skip symlinks: they could leak info or escape the workspace boundary.
      if (entry.isSymbolicLink && entry.isSymbolicLink()) continue;
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
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (['node_modules', 'dist', 'out', '__pycache__'].includes(entry.name)) continue;
      if (entry.isSymbolicLink && entry.isSymbolicLink()) continue;
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
      // task-007: preload only uses contextBridge/ipcRenderer, which are
      // available in the sandboxed preload, so the renderer runs sandboxed.
      sandbox: true,
      webviewTags: false
    }
  });
  // task-007: the UI is a single local page. Block in-app navigation and new
  // windows; hand http(s) links (xterm web-links addon) to the OS browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => {
    mainWindow = null;
    for (const [, s] of sessions) {
      try { s.proc.kill(); } catch {}
    }
    sessions.clear();
  });
}

// ---------- IPC ----------
// task-007: every channel only answers the app's own top-level frame. Anything
// else (a navigated/foreign frame) gets `undefined` / is ignored.
function isTrustedSender(e) {
  if (!mainWindow || mainWindow.isDestroyed() || !e) return false;
  const wc = mainWindow.webContents;
  return e.sender === wc && e.senderFrame === wc.mainFrame;
}
function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => (isTrustedSender(e) ? fn(e, ...args) : undefined));
}
function on(channel, fn) {
  ipcMain.on(channel, (e, payload) => {
    if (!isTrustedSender(e)) return;
    if (!payload || typeof payload !== 'object' || !isValidPtyId(payload.id)) return;
    fn(e, payload);
  });
}

handle('settings:get', () => loadSettings());
handle('settings:set', (_e, next) => { saveSettings(validateSettings(next)); return true; });

handle('aor:get-claude-md', () => {
  for (const p of [CLAUDE_MD_PATH, BUNDLED_CLAUDE_MD_PATH]) {
    try { return fs.readFileSync(p, 'utf8'); } catch { /* try next */ }
  }
  return '';
});
handle('aor:set-claude-md', (_e, content) => {
  if (!validateClaudeMdContent(content)) {
    return { ok: false, error: '텍스트만, 512KB 이하로 저장할 수 있습니다.' };
  }
  try {
    fs.writeFileSync(CLAUDE_MD_PATH, content, 'utf8');
    return { ok: true };
  } catch (err) {
    console.warn('[carrotcap] aor:set-claude-md failed:', err && err.message);
    return { ok: false, error: `파일 쓰기 실패: ${(err && err.message) || 'unknown'}` };
  }
});

handle('folder:pick', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const picked = r.filePaths[0];
  const real = addAllowedWorkspace(picked);
  if (real) persistRecentWorkspace(real);
  return picked;
});
handle('folder:tree', (_e, rootPath) => {
  if (!isPathInsideAllowedWorkspace(rootPath)) return null;
  return buildFolderTree(rootPath);
});
handle('folder:search', (_e, rootPath, query) => {
  if (!isPathInsideAllowedWorkspace(rootPath)) return [];
  if (typeof query !== 'string' || !query) return [];
  return searchFiles(rootPath, clipString(query, MAX_QUERY_LEN));
});
handle('folder:open-in-os', (_e, p) => {
  if (!isPathInsideAllowedWorkspace(p)) return false;
  try {
    if (!fs.existsSync(p)) return false;
    shell.showItemInFolder(p);
    return true;
  } catch (err) {
    console.warn('[carrotcap] folder:open-in-os failed:', err && err.message);
    return false;
  }
});

handle('aiops:setup', (_e, projectRoot) => {
  // Reject if the requested root is not inside an explicitly allowed workspace.
  // The renderer must call folder:pick first; defaultProjectPath is NOT a permission
  // grant — only paths persisted to workspace-state.json (main-only file) are seeded
  // into allowedWorkspaces at boot.
  if (!isPathInsideAllowedWorkspace(projectRoot)) {
    return { ok: false, error: '먼저 폴더를 선택하세요. (allowed workspace 외부)' };
  }
  // Resolve to canonical realpath before writing — defends against symlink swap-after-check.
  const real = safeRealpath(projectRoot);
  if (!real || !fs.existsSync(real)) {
    return { ok: false, error: '프로젝트 폴더가 존재하지 않습니다.' };
  }
  const missing = findMissingAiopsTemplates();
  if (missing.length) {
    return { ok: false, error: `앱 설치가 불완전합니다. 누락된 템플릿: ${missing.join(', ')}` };
  }
  const result = ensureAiopsProjectStructure(real);
  if (!result) return { ok: false, error: 'AIOps 구조를 만들지 못했습니다. (심볼릭 링크 또는 쓰기 권한 확인)' };
  return { ok: true, root: real, ...result };
});

handle('pty:spawn', (_e, payload) => spawnSession(payload));
on('pty:write', (_e, { id, data }) => {
  const s = sessions.get(id);
  if (!s || typeof data !== 'string' || !isWithinByteCap(data, MAX_PTY_WRITE_BYTES)) return;
  try {
    s.proc.write(data);
  } catch (err) {
    console.warn('[carrotcap] pty write fail', err && err.message);
  }
});
on('pty:resize', (_e, { id, cols, rows }) => {
  const s = sessions.get(id);
  if (!s || !s.proc.resize) return;
  const c = clampInt(cols, 2, 1000, 80);
  const r = clampInt(rows, 1, 500, 24);
  try { s.proc.resize(c, r); }
  catch (err) { console.warn(`[carrotcap] pty resize fail ${id} ${c}x${r}:`, err && err.message); }
});
on('pty:kill', (_e, { id }) => {
  const s = sessions.get(id);
  if (!s) return;
  // Keep the session if kill throws so the pane can retry; onExit removes it.
  try { s.proc.kill(); sessions.delete(id); }
  catch (err) { console.warn(`[carrotcap] pty kill fail ${id}:`, err && err.message); }
});

// Clipboard + terminal context menu (task-009). xterm renders to a canvas, so
// the native Edit roles cannot see terminal text — the renderer copies the
// xterm selection itself and pastes via term.paste() (bracketed-paste aware).
handle('clipboard:read-text', () => {
  try {
    const text = clipboard.readText() || '';
    if (!isWithinByteCap(text, MAX_PTY_WRITE_BYTES)) return { ok: false, error: '클립보드 텍스트가 1MB를 넘습니다.' };
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'clipboard read failed' };
  }
});
handle('clipboard:write-text', (_e, text) => {
  if (typeof text !== 'string' || !isWithinByteCap(text, MAX_PTY_WRITE_BYTES)) return { ok: false, error: 'invalid clipboard text' };
  try { clipboard.writeText(text); return { ok: true }; }
  catch (err) { return { ok: false, error: (err && err.message) || 'clipboard write failed' }; }
});
on('term-menu:show', (e, { id, hasSelection }) => {
  const send = (command) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('term-menu:command', { id, command });
  };
  Menu.buildFromTemplate([
    { label: '복사', accelerator: 'Ctrl+Shift+C', enabled: hasSelection === true, click: () => send('copy') },
    { label: '붙여넣기', accelerator: 'Ctrl+Shift+V', click: () => send('paste') },
    { type: 'separator' },
    { label: '모두 선택', click: () => send('selectAll') },
    { label: '화면 지우기', click: () => send('clear') }
  ]).popup({ window: BrowserWindow.fromWebContents(e.sender) || mainWindow });
});

handle('app:platform', () => process.platform);
handle('app:pty-available', () => ptyAvailable);

app.whenReady().then(() => {
  // Self-heal the `carrotcap` CLI registration. Runs only when packaged.
  // This makes a single GUI launch sufficient to repair a broken CLI install
  // on any future PC, without re-running the installer.
  try { ensureCliRegistration(); } catch (e) { console.warn('[carrotcap] ensureCliRegistration threw:', e.message); }

  // 사용자 데이터 폴더(settings.json / CLAUDE.md / workspace-state.json) 준비
  try { initUserState(); } catch (e) { console.warn('[carrotcap] initUserState failed:', e.message); }
  // Seed the workspace allowlist (task-004 reflection) ONLY from workspace-state.json,
  // which is written exclusively by the main process via folder:pick. Settings fields
  // like defaultProjectPath are NOT used as a permission grant — renderer must not be
  // able to escalate the allowlist via settings:set.
  {
    const state = loadWorkspaceState();
    for (const r of state.recentWorkspaces) addAllowedWorkspace(r);
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
