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
//   getPowerShellExePath: PATH-poisoning resistant launcher (Major M1)
function getSystem32Path() {
  // Defense in depth: even if SystemRoot is poisoned with a relative or empty
  // value, fall back to the canonical absolute path.
  const envRoot = process.env.SystemRoot;
  const root = (typeof envRoot === 'string' && path.isAbsolute(envRoot)) ? envRoot : 'C:\\Windows';
  return path.join(root, 'System32');
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
    if ('consoleShims' in input.aor) aor.consoleShims = !!input.aor.consoleShims;
    if ('compressHook' in input.aor) aor.compressHook = !!input.aor.compressHook;
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

  if (Number.isInteger(input.settingsVersion) && input.settingsVersion > 0 && input.settingsVersion < 1000) {
    out.settingsVersion = input.settingsVersion;
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

// Each step runs once per settings file (settingsVersion), so a later user choice
// (removing grok, unchecking AIOps) is not overridden on every launch.
//   v2 (task-012): Gemini/Antigravity (Google) CLIs removed; Grok handles images/videos.
//   v3: AIOps mode on by default (it used to default to off, so nobody had chosen "off").
const SETTINGS_VERSION = 4;
// Terminal font order (task-020): JetBrains Mono first, then the Windows/macOS fallbacks.
const DEFAULT_MONO_FONT = "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'IBM Plex Mono', 'SF Mono', Consolas, monospace";
const OLD_DEFAULT_MONO_FONT = 'Cascadia Code, Consolas, monospace';
const REMOVED_CLI_NAMES = new Set(['gemini', 'antigravity', 'agy']);
function migrateSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return { settings, changed: false };
  // Only a real integer counts as "already migrated" — '2', 2.5, null etc. migrate.
  const version = Number.isInteger(settings.settingsVersion) ? settings.settingsVersion : 1;
  if (version >= SETTINGS_VERSION) return { settings, changed: false };
  const next = { ...settings, settingsVersion: SETTINGS_VERSION };
  if (version < 2) {
    const cli = {};
    const srcCli = (settings.cli && typeof settings.cli === 'object' && !Array.isArray(settings.cli)) ? settings.cli : {};
    for (const [key, val] of Object.entries(srcCli)) {
      const cmd = val && typeof val.command === 'string' ? val.command.toLowerCase() : '';
      if (REMOVED_CLI_NAMES.has(key.toLowerCase()) || REMOVED_CLI_NAMES.has(cmd)) continue;
      cli[key] = val;
    }
    if (!cli.grok) cli.grok = { command: 'grok', args: [] };
    next.cli = cli;
  }
  if (version < 3) {
    const aor = (settings.aor && typeof settings.aor === 'object' && !Array.isArray(settings.aor)) ? settings.aor : {};
    // v1 files come from builds where "off" was merely the default → turn on.
    // v2 files may hold a choice the user made in v0.2 → keep a real boolean.
    const keep = version === 2 && typeof aor.autoStart === 'boolean';
    next.aor = { ...aor, autoStart: keep ? aor.autoStart : true };
  }
  if (version < 4) {
    // Only the untouched old default moves to the new font order; a chosen font stays.
    const ui = (settings.ui && typeof settings.ui === 'object' && !Array.isArray(settings.ui)) ? settings.ui : null;
    if (ui && (ui.fontFamily === OLD_DEFAULT_MONO_FONT || ui.fontFamily === undefined)) next.ui = { ...ui, fontFamily: DEFAULT_MONO_FONT };
  }
  return { settings: next, changed: true };
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
  // Returns true (written) / false (destination already exists — kept as is).
  // A missing or unreadable template THROWS so callers never report a partial setup
  // as success (Codex task-014 r5).
  let content;
  try { content = fs.readFileSync(sourcePath, 'utf8'); }
  catch (e) {
    throw new Error(`aiops template unreadable: ${sourcePath} (${e.message})`);
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
const PTY_READY_QUIET_MS  = 700;          // shell printed its prompt and went quiet
const PTY_READY_MAX_MS    = 10000;        // give up waiting (silent shells)

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

// ---- Session history (task-013) — pure helpers, file I/O lives near the IPC handlers ----
// Stores only what is needed to resume: tab/pane layout, which CLI ran in each pane,
// the last backlog task and timestamps. No terminal output, no keystrokes.
const HISTORY_MAX_SESSIONS   = 5;
const HISTORY_MAX_TABS       = 8;
const HISTORY_MAX_PANES      = 8;
const HISTORY_RETENTION_MS   = 30 * 24 * 60 * 60 * 1000;
const TASK_NAME_RE           = /^task-[A-Za-z0-9._-]{1,60}$/;

function sanitizeHistoryLayout(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.tabs)) return null;
  const tabs = [];
  for (const t of input.tabs.slice(0, HISTORY_MAX_TABS)) {
    if (!t || !Array.isArray(t.panes)) continue;
    const panes = [];
    for (const p of t.panes.slice(0, HISTORY_MAX_PANES)) {
      if (!p || typeof p !== 'object') continue;
      const cli = (typeof p.cli === 'string' && CLI_KEY_RE.test(p.cli) && !RESERVED_OBJECT_KEYS.has(p.cli)) ? p.cli : null;
      panes.push({ mode: PTY_MODES.has(p.mode) ? p.mode : 'plain', cli });
    }
    if (panes.length) tabs.push({ panes });
  }
  return tabs.length ? { tabs } : null;
}

// Files on disk are re-validated on every read (task-012/013 review): a corrupted or
// hand-edited record must not reach the renderer unbounded or crash it.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
function sanitizeHistorySession(s) {
  if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(s.id)) return null;
  const iso = (v) => (typeof v === 'string' && ISO_RE.test(v) ? v : null);
  const out = {
    id: s.id,
    startedAt: iso(s.startedAt),
    endedAt: iso(s.endedAt),
    clean: s.clean === true,
    lastTask: (typeof s.lastTask === 'string' && TASK_NAME_RE.test(s.lastTask)) ? s.lastTask : null,
    tabCount: clampInt(s.tabCount, 0, HISTORY_MAX_TABS, 0),
    paneCount: clampInt(s.paneCount, 0, HISTORY_MAX_TABS * HISTORY_MAX_PANES, 0),
    clis: Array.isArray(s.clis)
      ? s.clis.filter((c) => typeof c === 'string' && CLI_KEY_RE.test(c) && !RESERVED_OBJECT_KEYS.has(c)).slice(0, 8)
      : []
  };
  if (!out.startedAt) return null;
  const layout = sanitizeHistoryLayout(s.layout);
  if (layout) out.layout = layout;
  return out;
}
function sanitizeHistoryRecord(rec) {
  if (!rec || typeof rec !== 'object' || !Array.isArray(rec.sessions)) return null;
  const sessions = rec.sessions.slice(0, HISTORY_MAX_SESSIONS * 2).map(sanitizeHistorySession).filter(Boolean).slice(0, HISTORY_MAX_SESSIONS);
  return {
    v: 1,
    projectRoot: typeof rec.projectRoot === 'string' ? rec.projectRoot.slice(0, 1024) : null,
    updatedAt: typeof rec.updatedAt === 'string' && ISO_RE.test(rec.updatedAt) ? rec.updatedAt : null,
    sessions
  };
}

function summarizeLayout(layout) {
  const clis = new Set();
  let paneCount = 0;
  for (const t of (layout && layout.tabs) || []) {
    for (const p of t.panes) { paneCount++; if (p.cli) clis.add(p.cli); }
  }
  return { tabCount: ((layout && layout.tabs) || []).length, paneCount, clis: [...clis].sort() };
}

function applyHistorySnapshot(record, { sessionId, projectRoot, layout, nowIso, lastTask }) {
  const base = (record && Array.isArray(record.sessions)) ? record : { v: 1, sessions: [] };
  const sessions = base.sessions.filter((s) => s && s.id !== sessionId);
  const prev = base.sessions.find((s) => s && s.id === sessionId);
  sessions.unshift({
    id: sessionId,
    startedAt: prev ? prev.startedAt : nowIso,
    endedAt: null,
    clean: false,
    lastTask: (typeof lastTask === 'string' && TASK_NAME_RE.test(lastTask)) ? lastTask : (prev ? prev.lastTask || null : null),
    ...summarizeLayout(layout),
    layout
  });
  return { v: 1, projectRoot, updatedAt: nowIso, sessions: sessions.slice(0, HISTORY_MAX_SESSIONS) };
}

// Clean end of an app run: close this run's sessions, keep the layout only on the
// newest session (the one a later resume would use), cap the list.
function finalizeHistoryRecord(record, currentIds, nowIso) {
  if (!record || !Array.isArray(record.sessions)) return record;
  const sessions = record.sessions
    .filter(Boolean)
    .map((s) => (currentIds.has(s.id) ? { ...s, endedAt: nowIso, clean: true } : { ...s }))
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .slice(0, HISTORY_MAX_SESSIONS)
    .map((s, i) => { if (i > 0) delete s.layout; return s; });
  return { ...record, updatedAt: nowIso, sessions };
}

function dropResumableLayouts(record, keepIds) {
  if (!record || !Array.isArray(record.sessions)) return record;
  return {
    ...record,
    sessions: record.sessions.map((s) => {
      if (!s || keepIds.has(s.id)) return s;
      const { layout, ...rest } = s;
      return rest;
    })
  };
}

function pickResumableSession(record, excludeIds) {
  if (!record || !Array.isArray(record.sessions)) return null;
  const s = record.sessions.find((x) => x && !excludeIds.has(x.id) && x.layout && x.layout.tabs && x.layout.tabs.length);
  if (!s) return null;
  return { startedAt: s.startedAt, endedAt: s.endedAt, clean: !!s.clean, lastTask: s.lastTask || null, clis: s.clis || [], layout: s.layout };
}

function isHistoryExpired(record, nowMs) {
  const t = Date.parse(record && record.updatedAt);
  return !Number.isFinite(t) || nowMs - t > HISTORY_RETENTION_MS;
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

// `carrotcap` in any terminal opens THIS app (task-018).
// Cream CLI (a separate product) rewrites WindowsApps\carrotcap.cmd + aor.cmd on every
// launch, and WindowsApps sits in the machine PATH before anything we could add to the
// user PATH. Within one folder Windows tries PATHEXT in order (.COM;.EXE;.BAT;.CMD), so
// our carrotcap.bat wins over Cream's carrotcap.cmd in cmd / PowerShell 5.1 / pwsh 7,
// and an extensionless `carrotcap` covers Git Bash. Cream's files (and `aor`) are never
// touched. The user PATH is not edited: it is long on this kind of machine and a
// truncating write would be destructive. Assumes the default PATHEXT order and
// WindowsApps on PATH (Windows 10/11 defaults).
// Ownership (review task-018 r1): our launchers carry LAUNCH_SHIM_MARK on line 2 —
// byte-identical to what build/installer.nsh writes. A same-named file without it, a
// link or a folder is never overwritten.
const LAUNCH_SHIM_NAMES = ['carrotcap.bat', 'carrotcap'];
const LAUNCH_SHIM_MARK = 'CARROTCAP-CLI-LAUNCHER';
function buildLaunchShims(exePath) {
  if (typeof exePath !== 'string' || !path.win32.isAbsolute(exePath) || /["\r\n]/.test(exePath)) return null;
  const shq = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
  return {
    // cmd expands %NAME% even inside quotes: a literal % is written as %%.
    // DisableDelayedExpansion: under `cmd /V:ON` a ! in the path would otherwise expand.
    'carrotcap.bat': `@echo off\r\nrem ${LAUNCH_SHIM_MARK}\r\nsetlocal DisableDelayedExpansion\r\nstart "" "${exePath.replace(/%/g, '%%')}" %*\r\n`,
    carrotcap: `#!/bin/sh\n# ${LAUNCH_SHIM_MARK}\n${shq(exePath.replace(/\\/g, '/'))} "$@" >/dev/null 2>&1 &\n`,
  };
}
// true when `content` is one of our launchers (marker on the second line).
function isOwnLaunchShim(content) {
  if (typeof content !== 'string') return false;
  const second = content.split('\n')[1];
  return typeof second === 'string' && ['rem ', '# '].some((p) => second.replace(/\r$/, '') === p + LAUNCH_SHIM_MARK);
}
// Only the installed copy may (re)register the command — an old copy elsewhere must not
// repoint `carrotcap` at itself. realpath == the canonical path also rules out links on
// the way (review task-018 r4).
function isCanonicalInstall(exePath, localAppData) {
  if (typeof exePath !== 'string' || typeof localAppData !== 'string' || !localAppData) return false;
  const canonical = path.win32.join(localAppData, 'Programs', 'carrotcap-cli', 'carrotcap.exe');
  let real;
  try { real = fs.realpathSync.native(exePath); } catch { return false; }
  return real.toLowerCase() === canonical.toLowerCase() && exePath.toLowerCase() === canonical.toLowerCase();
}
// Problem found by the last self-heal (shown by the renderer via aor:status), or null.
let cliRegistrationProblem = null;
// Self-heal the `carrotcap` command on every launch of the installed app (installer may
// have been blocked, a launcher deleted...).
function ensureCliRegistration() {
  if (process.platform !== 'win32') return;
  if (!app.isPackaged) return; // dev runs (npm start) must not touch the user's commands
  if (!process.env.LOCALAPPDATA) return;
  const exePath = process.execPath;
  if (!isCanonicalInstall(exePath, process.env.LOCALAPPDATA)) return;
  const shims = buildLaunchShims(exePath);
  if (!shims) return;
  const problems = [];
  try {
    const shimDir = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps');
    if (!fs.existsSync(shimDir)) fs.mkdirSync(shimDir, { recursive: true });
    for (const name of LAUNCH_SHIM_NAMES) {
      const shimPath = path.join(shimDir, name);
      let current = null;
      let exists = true;
      try {
        if (!fs.lstatSync(shimPath).isFile()) { problems.push(`${shimPath} is a folder or link`); continue; }
      } catch { exists = false; }
      if (exists) {
        try { current = fs.readFileSync(shimPath, 'utf8'); } catch (e) { problems.push(`${shimPath}: ${e.message}`); continue; }
        if (!isOwnLaunchShim(current)) { problems.push(`${shimPath} belongs to another program`); continue; }
      }
      if (current !== shims[name]) {
        fs.writeFileSync(shimPath, shims[name], 'utf8');
        console.log('[carrotcap] CLI shim ensured:', shimPath);
      }
    }
  } catch (err) {
    problems.push(err.message);
  }
  cliRegistrationProblem = problems.length
    ? `${problems.join('; ')} — fix it, then run: powershell -ExecutionPolicy Bypass -File "${path.join(process.resourcesPath, 'repair-cli.ps1')}"`
    : null;
  if (cliRegistrationProblem) console.warn('[carrotcap] carrotcap command not fully registered:', cliRegistrationProblem);
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
    settingsVersion: SETTINGS_VERSION,
    aor: {
      enabled: true,
      engineRoot: '',
      engineRootCandidates: [
        '%USERPROFILE%\\Desktop\\WINDOWS\\WINDOWS',
        '%USERPROFILE%\\WINDOWS',
        'C:\\WINDOWS\\carrotcap'
      ],
      autoStart: true,
      consoleShims: false,
      compressHook: true
    },
    cli: {
      claude: { command: 'claude', args: [] },
      codex: { command: 'codex', args: [] },
      grok: { command: 'grok', args: [] }
    },
    defaultShell: defaultShell(),
    defaultProjectPath: os.homedir(),
    ui: { theme: 'dark', fontSize: 14, fontFamily: DEFAULT_MONO_FONT }
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
  {
    const { settings, changed } = migrateSettings(loadSettings());
    if (changed) {
      saveSettings(settings);
      console.log('[carrotcap] settings migrated to version', SETTINGS_VERSION);
    }
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
const aorPrunedAt = new Map();
function bundledAorRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'AOR') : path.join(APP_ROOT, 'AOR');
}

// ---- Output-compression hook for Claude Code (task-017) ----
// A claude started from CARROTCAP gets `--settings <file>` holding one PostToolUse hook
// (AOR/carrotcap/compress-hook.js) that routes noisy test/build/install output through
// the AOR engine. The user's own ~/.claude settings are never touched; hooks from
// --settings are added on top of theirs. Needs node on PATH (the hook is a node script).
// Functions, not constants: this block is also evaluated by the unit tests.
const hookDir = () => path.join(USER_DATA_ROOT, 'aor-hook');
const hookSettingsPath = () => path.join(hookDir(), 'claude-settings.json');
let compressHookCache = null; // { nodePath, hookScript } — reset on settings:set
function findNodeSync() {
  const { execFileSync } = require('child_process');
  const [file, args] = process.platform === 'win32'
    ? [path.join(getSystem32Path(), 'where.exe'), ['node']]
    : ['/usr/bin/which', ['node']];
  try {
    const out = execFileSync(file, args, { timeout: 3000, windowsHide: true, encoding: 'utf8' });
    const first = String(out).split(/\r?\n/).map((l) => l.trim())
      .find((l) => l && path.isAbsolute(l) && /[\\/]node(\.exe)?$/i.test(l));
    return first && fs.existsSync(first) ? first : null;
  } catch { return null; }
}
function buildCompressHookSettings(nodePath, hookScript) {
  // Hook commands run in Git Bash on Windows / sh elsewhere: single-quoted, forward slashes.
  const q = (p) => "'" + String(p).replace(/\\/g, '/').replace(/'/g, "'\\''") + "'";
  return { hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `${q(nodePath)} ${q(hookScript)}`, timeout: 30 }] }] } };
}
function hookDirIsSafe() {
  try {
    const lst = fs.lstatSync(hookDir());
    if (lst.isSymbolicLink() || !lst.isDirectory()) return false;
    return isPathInsideRoot(fs.realpathSync.native(hookDir()), USER_DATA_ROOT);
  } catch { return false; }
}
function hookSettingsFileIsSafe() {
  try {
    if (!fs.lstatSync(hookSettingsPath()).isFile() || !hookDirIsSafe()) return false; // a link is not a file to lstat
    return isPathInsideRoot(fs.realpathSync.native(hookSettingsPath()), fs.realpathSync.native(hookDir()));
  } catch { return false; }
}
// Writes the --settings file if its content differs. Unpredictable temp name + 'wx', so a
// planted link cannot redirect the write; the result is re-checked (review task-016 r1).
function writeHookSettings(body) {
  const file = hookSettingsPath();
  if (!fs.existsSync(hookDir())) fs.mkdirSync(hookDir(), { recursive: true });
  if (!hookDirIsSafe()) throw new Error('aor-hook is not a plain directory inside userData');
  let current = null;
  if (hookSettingsFileIsSafe()) { try { current = fs.readFileSync(file, 'utf8'); } catch { /* rewrite */ } }
  if (current !== body) {
    const tmp = path.join(hookDir(), '.claude-settings.' + require('crypto').randomBytes(6).toString('hex') + '.tmp');
    try {
      fs.writeFileSync(tmp, body, { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(tmp, file);
    } finally {
      try { fs.rmSync(tmp, { force: true }); } catch { /* renamed away */ }
    }
  }
  if (!hookSettingsFileIsSafe()) throw new Error('claude-settings.json is not a plain file inside aor-hook');
}
// Path of the --settings file, or null when the hook is off or cannot run here.
// Only the node lookup is cached; the file itself is verified (and rewritten) every call.
function resolveCompressHook(settings) {
  if (settings && settings.aor && settings.aor.compressHook === false) return null;
  if (!compressHookCache) {
    const root = bundledAorRoot();
    const hookScript = path.join(root, 'carrotcap', 'compress-hook.js');
    const engine = process.platform === 'win32'
      ? path.join(root, 'engine', 'windows', 'bin', 'aor-engine-win.exe')
      : path.join(root, 'engine', 'macos', 'bin', 'aor-engine-macos');
    const nodePath = fs.existsSync(hookScript) && fs.existsSync(engine) ? findNodeSync() : null;
    compressHookCache = { nodePath, hookScript };
  }
  const { nodePath, hookScript } = compressHookCache;
  if (!nodePath) return null;
  try {
    writeHookSettings(JSON.stringify(buildCompressHookSettings(nodePath, hookScript), null, 2));
    return hookSettingsPath();
  } catch (e) {
    console.warn('[carrotcap] compress hook unavailable:', e.message);
    return null;
  }
}
// claude invocations that must not get the hook: the user's own --settings (either form)
// or any management subcommand anywhere in the arguments (review task-016 r1).
const CLAUDE_SUBCOMMANDS = new Set(['mcp', 'config', 'update', 'doctor', 'install', 'migrate-installer', 'setup-token', 'plugin', 'plugins', 'auth']);
function claudeArgsTakeHook(args) {
  const list = Array.isArray(args) ? args.filter((a) => typeof a === 'string') : [];
  return !list.some((a) => a === '--settings' || a.startsWith('--settings=') || CLAUDE_SUBCOMMANDS.has(a));
}
function resolveAorEngineRoot(settings) {
  // The bundled engine scripts are PowerShell (Windows only); elsewhere panes open a plain
  // shell instead of trying to run powershell.exe (review task-016 r1).
  if (process.platform !== 'win32') return null;
  const candidates = [];
  // Highest priority: bundled AOR shipped with the installer.
  // Production: <install-dir>/resources/AOR (electron-builder extraResources).
  // Development: <repo>/AOR.
  candidates.push(bundledAorRoot());
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
// AOR engine runtime (task-016): the engine keeps a raw log per compressed command,
// a metrics line per command and a report per session. Keep what the dashboard and
// "read the full log" need, drop the rest. Only plain files with the engine's own
// name patterns are touched; links are never followed.
const AOR_RAW_KEEP = 200;
const AOR_RAW_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const AOR_REPORT_KEEP = 20;
const AOR_METRICS_MAX_AGE_DAYS = 30;
function pruneAorRuntime(runtimeRoot, now = Date.now()) {
  const removed = { raw: 0, reports: 0, metrics: 0 };
  try { if (!fs.lstatSync(runtimeRoot).isDirectory()) return removed; } catch { return removed; }
  const realRoot = safeRealpath(runtimeRoot);
  if (!realRoot) return removed;
  const listFiles = (sub, re) => {
    const dir = path.join(runtimeRoot, sub);
    try { if (!fs.lstatSync(dir).isDirectory()) return []; } catch { return []; } // a junction is not a directory to lstat
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
    return ents.filter((d) => d.isFile() && re.test(d.name)).map((d) => {
      const p = path.join(dir, d.name);
      let t = 0;
      try { t = fs.lstatSync(p).mtimeMs; } catch { /* vanished */ }
      return { p, name: d.name, t };
    }).sort((a, b) => b.t - a.t);
  };
  const rm = (f, key) => {
    try {
      if (!fs.lstatSync(f.p).isFile() || !isPathInsideRoot(fs.realpathSync.native(f.p), realRoot)) return;
      fs.rmSync(f.p, { force: true });
      removed[key]++;
    } catch { /* next time */ }
  };
  listFiles('raw', /^[0-9TZ-]+-[0-9a-f]{6,64}\.log$/).forEach((f, i) => {
    if (i >= AOR_RAW_KEEP || now - f.t > AOR_RAW_MAX_AGE_MS) rm(f, 'raw');
  });
  listFiles('reports', /^session-report-\d{8}-\d{6}\.txt$/).forEach((f, i) => {
    if (i >= AOR_REPORT_KEEP) rm(f, 'reports');
  });
  const cutoff = now - AOR_METRICS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  listFiles('metrics', /^\d{4}-\d{2}-\d{2}\.jsonl$/).forEach((f) => {
    const day = Date.parse(f.name.slice(0, 10) + 'T00:00:00Z');
    if (Number.isFinite(day) && day < cutoff) rm(f, 'metrics');
  });
  return removed;
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
  const mediaLogsDir = path.join(logsDir, 'media');
  const reviewLogsDir = path.join(logsDir, 'review');
  const backlogDir = path.join(realRoot, 'backlog');
  try {
    safeMkdir(agentsDir, realRoot);
    safeMkdir(mediaLogsDir, realRoot);
    safeMkdir(reviewLogsDir, realRoot);
    safeMkdir(backlogDir, realRoot);
  } catch (e) {
    console.warn('[carrotcap] aiops setup refused:', e.message);
    return null;
  }

  // task-009: setup documents live in templates/aiops/ (editable, shipped via build.files);
  // media/reviewer contracts come from agents/ (task-005, task-012). writeIfMissing (inside
  // copyTemplateIfMissing) preserves any existing project file.
  // A write-protected project must not break pane creation (AIOps is on by default):
  // a failed copy ends setup with null like every other refusal path.
  try {
    copyTemplateIfMissing(tmpl.supervisor, path.join(agentsDir, 'supervisor.md'), realRoot);
    copyTemplateIfMissing(tmpl.media, path.join(agentsDir, 'media.md'), realRoot);
    copyTemplateIfMissing(tmpl.reviewer, path.join(agentsDir, 'reviewer.md'), realRoot);
    copyTemplateIfMissing(tmpl.task001, path.join(backlogDir, 'task-001.md'), realRoot);
    copyTemplateIfMissing(tmpl.workflow, path.join(backlogDir, 'workflow.md'), realRoot);
  } catch (e) {
    console.warn('[carrotcap] aiops template deployment failed:', e.message);
    return null;
  }

  // task-005: deploy the helper PowerShell scripts so the project can run the
  // media/reviewer cycle with the same auto-loading and output shaping the
  // PM uses. The scripts are copy-only (no template variables); writeIfMissing
  // preserves any user-modified project copy.
  const projectScriptsDir = path.join(realRoot, 'scripts');
  let warning;
  try {
    safeMkdir(projectScriptsDir, realRoot);
    copyTemplateIfMissing(tmpl.runMedia, path.join(projectScriptsDir, 'run-media.ps1'), realRoot);
    copyTemplateIfMissing(tmpl.runReviewer, path.join(projectScriptsDir, 'run-reviewer.ps1'), realRoot);
  } catch (e) {
    // Non-fatal (e.g. projectRoot/scripts is a symlink): the agents/logs/backlog
    // structure still works, but the caller must tell the user (Codex task-014 r6).
    console.warn('[carrotcap] aiops scripts deployment failed:', e.message);
    warning = 'AIOps 구조는 만들었지만 scripts/run-media.ps1·run-reviewer.ps1을 복사하지 못했습니다 (scripts 폴더 권한/링크 확인).';
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
  return warning
    ? { agentsDir, logsDir, backlogDir, claudePath, root: realRoot, warning }
    : { agentsDir, logsDir, backlogDir, claudePath, root: realRoot };
}

// Bundled sources copied by ensureAiopsProjectStructure (task-009 review).
function getAiopsTemplateSources() {
  const root = getTemplateRoot();
  return {
    supervisor:    path.join(root, 'templates', 'aiops', 'supervisor.md'),
    task001:       path.join(root, 'templates', 'aiops', 'task-001.md'),
    workflow:      path.join(root, 'templates', 'aiops', 'workflow.md'),
    claudeBlock:   path.join(root, 'templates', 'aiops', 'CLAUDE-block.md'),
    media:         path.join(root, 'agents', 'media.md'),
    reviewer:      path.join(root, 'agents', 'reviewer.md'),
    runMedia:      path.join(root, 'scripts', 'run-media.ps1'),
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
    // A folder IS selected but setup failed (read-only, symlink...): a real problem → warning.
    const aiopsSetupWarning = isAiops && requestedProjectRoot && !aiopsStructure
      ? 'AIOps 구조를 만들지 못했습니다 — 프로젝트 폴더의 쓰기 권한이나 심볼릭 링크를 확인하세요.'
      : (aiopsStructure && aiopsStructure.warning) || undefined;
    const engineRoot = resolveAorEngineRoot(settings);
    if (!engineRoot) {
      // AOR 엔진이 없으면 조용히 plain 셸로 연다 — 엔진이 없는 PC에서는 정상 상태라
      // 경고를 띄우지 않는다. 사유는 페인 헤더 툴팁(note)으로만 남긴다.
      const out = {
        file: defaultShell(),
        args: process.platform === 'win32' ? ['-NoLogo'] : [],
        cwd,
        kind: isAiops ? 'aiops' : 'plain',
        note: 'AOR 엔진이 없어 일반 셸로 실행 중 (settings.json의 aor.engineRoot로 지정 가능)'
      };
      if (aiopsSetupWarning) out.warning = aiopsSetupWarning;
      else if (isAiops && !aiopsStructure) out.note = '프로젝트 폴더를 선택하면 AIOps 구조가 자동으로 만들어집니다. ' + out.note;
      return out;
    }
    const shellInit = path.join(engineRoot, 'engine', 'windows', '_internal', 'shell-init.ps1');
    const invoke = path.join(engineRoot, 'engine', 'windows', '_internal', 'invoke-aor.ps1');
    const claudeInt = path.join(engineRoot, 'engine', 'windows', '_internal', 'claude-integration.ps1');
    // Console shims (npm/git/node/python → engine) buffer a command's whole output
    // until it exits — a dev server shows nothing — and only compress what the human
    // sees, never what an agent reads. Off unless aor.consoleShims is true (task-016).
    const shimDir = settings.aor && settings.aor.consoleShims === true
      ? path.join(engineRoot, 'engine', 'windows', 'shims')
      : '';
    const runtimeRoot = path.join(engineRoot, 'engine', 'windows', 'bin', '.router-output');
    const sessionFile = path.join(runtimeRoot, 'session-status.json');
    const reportsDir = path.join(runtimeRoot, 'reports');
    fs.mkdirSync(reportsDir, { recursive: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });
    // At most once an hour per engine: keeps raw logs/reports/metrics bounded.
    const lastPrune = aorPrunedAt.get(runtimeRoot) || 0;
    if (Date.now() - lastPrune > 60 * 60 * 1000) {
      aorPrunedAt.set(runtimeRoot, Date.now());
      pruneAorRuntime(runtimeRoot);
    }
    const isoStart = new Date().toISOString();
    return {
      file: getPowerShellExePath(),
      args: [
        '-NoExit', '-ExecutionPolicy', 'Bypass',
        '-File', shellInit,
        '-ProjectPath', cwd,
        '-SessionFile', sessionFile,
        ...(shimDir ? ['-ShimDir', shimDir] : []),
        '-InvokeScript', invoke,
        '-ClaudeIntegration', claudeInt,
        '-SessionStartIso', isoStart,
        '-ReportsDir', reportsDir,
        '-OpenDashboard', 'false'
      ],
      cwd,
      kind: isAiops ? 'aiops' : 'aor',
      // 안내는 툴팁(note)으로만 — 실제 실패(aiopsSetupWarning)만 헤더 ⚠·상태줄 경고로.
      warning: aiopsSetupWarning,
      note: isAiops
        ? `${aiopsStructure ? 'AIOps 구조 준비됨.' : '프로젝트 폴더를 선택하면 AIOps 구조가 자동으로 만들어집니다.'} Claude=코딩, Codex=리뷰, Grok=이미지·영상`
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
    // Only when the command really is Claude Code (a custom command may not take --settings).
    const hookSettings = opts.cliKey === 'claude' && /^claude(\.exe|\.cmd)?$/i.test(cli.command) ? resolveCompressHook(settings) : null;
    if (hookSettings && claudeArgsTakeHook(cliArgs)) cliArgs.unshift('--settings', hookSettings);
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

const MAX_SESSIONS = 32; // bounds pre-ready buffers and processes a renderer can create

// Drops the ready-gate timers and any held input (kill, window close, exit).
function disposeReadyGate(session) {
  clearTimeout(session.quietTimer);
  clearTimeout(session.maxTimer);
  session.quietTimer = null;
  session.maxTimer = null;
  session.pending = '';
  session.pendingBytes = 0;
}

// Last ESC[?2004h / ESC[?2004l in the output wins. A short tail is kept so a sequence
// split across two chunks is still seen.
function trackBracketedPaste(session, data) {
  const text = session.tail + data;
  const on = text.lastIndexOf('\x1b[?2004h');
  const off = text.lastIndexOf('\x1b[?2004l');
  if (on !== -1 || off !== -1) session.bracketed = on > off;
  session.tail = text.slice(-8);
}

function spawnSession(rawPayload) {
  if (sessions.size >= MAX_SESSIONS) return { error: `터미널은 최대 ${MAX_SESSIONS}개까지 열 수 있습니다.` };
  const payload = sanitizeSpawnPayload(rawPayload);
  const settings = loadSettings() || {};
  const resolved = resolvePtyArgs({ ...payload, settings });
  if (resolved.error) return { error: resolved.error };
  const { file, args, cwd, kind } = resolved;

  const { cols, rows } = payload;
  const env = { ...process.env, TERM: 'xterm-256color', CARROTCAP: '1' };
  // The AOR shell's `claude` wrapper adds --settings from this (task-017).
  const hookSettings = resolveCompressHook(settings);
  if (hookSettings) env.CARROTCAP_CLAUDE_SETTINGS = hookSettings;
  else delete env.CARROTCAP_CLAUDE_SETTINGS;

  let proc;
  try {
    if (ptyAvailable) {
      proc = pty.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env });
    } else {
      // 폴백: 진짜 PTY가 아니라 child_process pipe. 인터랙티브 라인 에디터(prompt/history)는 약하지만,
      // 명령 실행+출력은 가능. 키 입력은 그대로 stdin으로 보내고, 사용자에게 echo가 안 보일 수 있음을 경고.
      const child = spawn(file, args, { cwd, env, windowsHide: false, stdio: ['pipe', 'pipe', 'pipe'] });
      // An unhandled 'error' (spawn failure, EAGAIN, EPIPE on stdin) would crash the main
      // process. Listen right away; the session reports it as a normal exit.
      let exitCb = null;
      let exited = false;
      const finish = (exitCode) => {
        if (exited) return;
        exited = true;
        if (exitCb) exitCb({ exitCode });
      };
      child.on('error', (err) => {
        console.warn('[carrotcap] fallback shell error:', err && err.message);
        finish(-1);
      });
      if (child.stdin) child.stdin.on('error', () => { /* EPIPE after exit — ignore */ });
      child.on('exit', (code) => finish(code));
      proc = {
        _child: child,
        write: (data) => {
          try { if (child.stdin && !child.stdin.destroyed) child.stdin.write(String(data)); } catch (e) { /* ignore */ }
        },
        resize: () => {},
        // Report failure like node-pty does (throw) so pty:kill keeps the session.
        kill: () => {
          if (exited) return;
          if (!child.kill()) throw new Error('fallback shell did not accept the kill signal');
        },
        // pty.spawn API 모방: onData / onExit
        onData: (cb) => {
          child.stdout.on('data', (b) => cb(b.toString()));
          child.stderr.on('data', (b) => cb(b.toString()));
        },
        onExit: (cb) => {
          exitCb = cb;
          if (exited) cb({ exitCode: -1 }); // failed before the listener was attached
        }
      };
    }
  } catch (e) {
    return { error: `Failed to spawn: ${e.message}` };
  }

  const id = `pty_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // Ready gate: PowerShell/PSReadLine throws away input that arrives while it is still
  // starting (measured: anything sent in the first ~2s of a new pane was lost). Input is
  // queued until the shell has printed something and then gone quiet, then flushed in order.
  // One string buffer (not an array of chunks) so a flood of tiny writes stays bounded.
  // bracketed: whether the app in this PTY currently has bracketed paste on (tracked from
  // its own output, ESC[?2004h / ESC[?2004l) — checked at write time for guarded pastes.
  const session = { proc, kind, ready: false, pending: '', pendingBytes: 0, quietTimer: null, maxTimer: null, bracketed: false, tail: '' };
  sessions.set(id, session);
  const markReady = () => {
    if (session.ready) return;
    const pending = session.pending;
    disposeReadyGate(session);
    session.ready = true;
    if (pending) {
      try { proc.write(pending); } catch (err) { console.warn('[carrotcap] pty write fail', err && err.message); }
    }
  };
  session.maxTimer = setTimeout(markReady, PTY_READY_MAX_MS);

  const wireData = (chunk) => {
    const data = typeof chunk === 'string' ? chunk : chunk.toString();
    if (!session.ready) {
      clearTimeout(session.quietTimer);
      session.quietTimer = setTimeout(markReady, PTY_READY_QUIET_MS);
    }
    trackBracketedPaste(session, data);
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('pty:data', { id, data });
  };
  // 폴백 모드일 땐 spawnSession에서 직접 만든 proc도 동일한 onData/onExit 인터페이스를 갖도록 위에서 셋업했음.
  proc.onData(wireData);
  proc.onExit(({ exitCode }) => {
    disposeReadyGate(session);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pty:exit', { id, code: exitCode });
    }
    sessions.delete(id);
  });

  // task-011: warnings (e.g. AOR fallback) are returned to the renderer and shown in
  // the pane header. Writing them into xterm out-of-band desyncs ConPTY's screen
  // model from xterm, so the shell/TUI redraws land on the wrong lines.
  const out = { id, kind };
  if (resolved.warning) out.warning = resolved.warning;
  if (resolved.note) out.note = resolved.note;
  return out;
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
    // The BrowserView belongs to this window; drop our reference so a new window
    // (macOS activate) starts clean (review task-015).
    try { browserMode.destroyView(); } catch { /* window already gone */ }
    mainWindow = null;
    for (const [, s] of sessions) {
      disposeReadyGate(s);
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
handle('settings:set', (_e, next) => {
  saveSettings(validateSettings(next));
  cliStatusCache = { at: 0, value: null }; // CLI commands may have changed
  compressHookCache = null;                // aor.compressHook may have changed
  return true;
});

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
// Returns true when the data was written (or queued behind the ready gate).
function writeToSession(id, data) {
  const s = sessions.get(id);
  if (!s || typeof data !== 'string' || !isWithinByteCap(data, MAX_PTY_WRITE_BYTES)) return false;
  if (!s.ready) {
    // Held until the shell is ready (see spawnSession). Capped like a single write.
    const size = Buffer.byteLength(data, 'utf8');
    if (s.pendingBytes + size > MAX_PTY_WRITE_BYTES) return false;
    s.pending += data;
    s.pendingBytes += size;
    return true;
  }
  try {
    s.proc.write(data);
    return true;
  } catch (err) {
    console.warn('[carrotcap] pty write fail', err && err.message);
    return false;
  }
}
on('pty:write', (_e, { id, data }) => { writeToSession(id, data); });
// Same, with an answer — for sends whose side effects depend on delivery (browser context).
handle('pty:write-ack', (_e, payload) => {
  const p = (payload && typeof payload === 'object') ? payload : {};
  return isValidPtyId(p.id) ? writeToSession(p.id, p.data) : false;
});
// Browser context (page-derived text): written ONLY if, at this very moment, the app in
// the PTY has bracketed paste on (an interactive agent, not a bare shell). main builds the
// paste itself and strips ESC, so the text cannot end the paste early (review r5 C3).
// With submit: the paste and its Enter are one transaction — the Enter is written only if
// the same session still has bracketed paste on right then (the agent did not exit in
// between), and the call reports success only when both went out (review r8).
handle('pty:paste-guarded', async (_e, payload) => {
  const p = (payload && typeof payload === 'object') ? payload : {};
  if (!isValidPtyId(p.id) || typeof p.text !== 'string') return false;
  const s = sessions.get(p.id);
  if (!s || !s.ready || !s.bracketed) return false;
  // The browser page must still be the document this context describes (one-time token).
  if (!browserMode.redeemContextToken(p.token)) return false;
  const body = p.text.replace(/\x1b/g, '').replace(/\r?\n/g, '\r');
  if (!writeToSession(p.id, '\x1b[200~' + body + '\x1b[201~')) return false;
  if (!p.submit) return true;
  const delay = Math.min(600, 60 + Math.floor(body.length / 20)); // let the CLI take the paste
  await new Promise((r) => setTimeout(r, delay));
  if (sessions.get(p.id) !== s || !s.bracketed) return false;
  return writeToSession(p.id, '\r');
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
  // Dispose the ready gate only once the kill succeeded — a live session must keep it.
  try { s.proc.kill(); disposeReadyGate(s); sessions.delete(id); }
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
  if (!sessions.has(id)) return;
  const send = (command) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('term-menu:command', { id, command });
  };
  Menu.buildFromTemplate([
    { label: '복사', accelerator: 'Ctrl+Shift+C', enabled: hasSelection === true, click: () => send('copy') },
    { label: '붙여넣기', accelerator: 'Ctrl+Shift+V', click: () => send('paste') },
    { type: 'separator' },
    { label: '보이는 화면 복사', click: () => send('copyScreen') },
    { label: '전체 출력 복사', click: () => send('copyAll') },
    { type: 'separator' },
    { label: '모두 선택', click: () => send('selectAll') },
    { label: '화면 지우기', click: () => send('clear') }
  ]).popup({ window: BrowserWindow.fromWebContents(e.sender) || mainWindow });
});

// ---- Session history I/O (task-013) ----
// %APPDATA%\carrotcap-cli\history\<hash of project path>.json, one small file per project.
const HISTORY_DIR = path.join(USER_DATA_ROOT, 'history');
const HISTORY_FILE_RE = /^[0-9a-f]{16}\.json$/;
const historySessionIds = new Map(); // history file path -> session id of THIS app run

function historyFileFor(realRoot) {
  const hash = require('crypto').createHash('sha1').update(normalizePath(realRoot)).digest('hex').slice(0, 16);
  return path.join(HISTORY_DIR, `${hash}.json`);
}
const HISTORY_MAX_FILE_BYTES = 64 * 1024; // real records are 1-2KB
function readHistory(file) {
  if (!historyDirIsSafe()) return null;
  try {
    const lst = fs.lstatSync(file);
    if (!lst.isFile() || lst.size > HISTORY_MAX_FILE_BYTES) return null; // pruned at next boot
  } catch { return null; }
  return sanitizeHistoryRecord(readJsonFile(file));
}
let historyQuitting = false;
// The history dir must be a real directory inside the user data dir — never a
// symlink/junction that would point prune/write somewhere else (review r4).
function historyDirIsSafe() {
  try {
    const lst = fs.lstatSync(HISTORY_DIR);
    if (lst.isSymbolicLink() || !lst.isDirectory()) return false;
    return isPathInsideRoot(fs.realpathSync.native(HISTORY_DIR), USER_DATA_ROOT);
  } catch { return false; }
}
function ensureHistoryDir() {
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
  return historyDirIsSafe();
}
function writeHistory(file, record) {
  // Write to a temp file and rename over the target: a crash mid-write must not
  // corrupt the record that "resume after a crash" depends on.
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    if (!ensureHistoryDir()) throw new Error('history dir is not a plain directory inside userData');
    fs.writeFileSync(tmp, JSON.stringify(record), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    console.warn('[carrotcap] history write failed:', e.message);
    return false;
  }
}
function latestBacklogTask(realRoot) {
  // The most recently edited backlog/task-*.md — a hint for "where was I".
  try {
    const dir = path.join(realRoot, 'backlog');
    let best = null;
    for (const name of fs.readdirSync(dir)) {
      if (!/^task-.*\.md$/i.test(name)) continue;
      const m = fs.statSync(path.join(dir, name)).mtimeMs;
      if (!best || m > best.m) best = { name: name.replace(/\.md$/i, ''), m };
    }
    return best ? best.name : null;
  } catch { return null; }
}
function currentHistoryIds() {
  return new Set(historySessionIds.values());
}
// Boot-time cleanup: expired records, records of deleted project folders, stray files.
function pruneHistory() {
  if (!historyDirIsSafe()) return; // missing, or a link we refuse to follow
  let entries;
  try { entries = fs.readdirSync(HISTORY_DIR, { withFileTypes: true }); } catch { return; }
  const now = Date.now();
  for (const ent of entries) {
    if (!ent.isFile()) continue; // never delete directories or links
    const file = path.join(HISTORY_DIR, ent.name);
    const rec = HISTORY_FILE_RE.test(ent.name) ? readHistory(file) : null;
    const gone = !rec || isHistoryExpired(rec, now) || typeof rec.projectRoot !== 'string' || !fs.existsSync(rec.projectRoot);
    if (gone) { try { fs.rmSync(file, { force: true }); } catch { /* next boot retries */ } }
  }
}
function finalizeHistory() {
  const now = new Date().toISOString();
  const ids = currentHistoryIds();
  for (const file of historySessionIds.keys()) {
    const rec = readHistory(file);
    if (rec) writeHistory(file, finalizeHistoryRecord(rec, ids, now));
  }
}

handle('history:save', (_e, payload) => {
  const p = (payload && typeof payload === 'object') ? payload : {};
  const realRoot = resolveAllowedDir(p.projectRoot);
  if (!realRoot) return { ok: false };
  const file = historyFileFor(realRoot);
  // No panes left for this project (all closed): this run's session is no longer
  // resumable — drop its layout, keep the one-line summary (review r5).
  if (p.layout && Array.isArray(p.layout.tabs) && p.layout.tabs.length === 0) {
    const id = historySessionIds.get(file);
    const rec = id ? readHistory(file) : null;
    if (!rec) return { ok: true };
    const sessions = rec.sessions.map((s) => {
      if (s.id !== id) return s;
      const { layout: _drop, ...rest } = s;
      return rest;
    });
    return { ok: writeHistory(file, { ...rec, updatedAt: new Date().toISOString(), sessions }) };
  }
  const layout = sanitizeHistoryLayout(p.layout);
  if (!layout) return { ok: false };
  if (!historySessionIds.has(file)) {
    historySessionIds.set(file, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  }
  const nowIso = new Date().toISOString();
  let record = applyHistorySnapshot(readHistory(file), {
    sessionId: historySessionIds.get(file),
    projectRoot: realRoot,
    layout,
    nowIso,
    lastTask: latestBacklogTask(realRoot)
  });
  // The window's last flush can land after before-quit already finalized — keep it
  // a clean exit instead of reopening the session as "crashed".
  if (historyQuitting) record = finalizeHistoryRecord(record, currentHistoryIds(), nowIso);
  return { ok: writeHistory(file, record) };
});
handle('history:get', (_e, projectRoot) => {
  const realRoot = resolveAllowedDir(projectRoot);
  if (!realRoot) return null;
  return pickResumableSession(readHistory(historyFileFor(realRoot)), currentHistoryIds());
});
// The user resumed or dismissed the offer: older layouts are no longer needed.
handle('history:dismiss', (_e, projectRoot) => {
  const realRoot = resolveAllowedDir(projectRoot);
  if (!realRoot) return false;
  const file = historyFileFor(realRoot);
  const rec = readHistory(file);
  return rec ? writeHistory(file, dropResumableLayouts(rec, currentHistoryIds())) : true;
});

// task-012: which configured CLIs are actually installed (on PATH). Cached briefly —
// the sidebar asks on boot and whenever settings change.
let cliStatusCache = { at: 0, value: null };
function whichCommand(cmd) {
  const { execFile } = require('child_process');
  const [file, args] = process.platform === 'win32'
    ? [path.join(getSystem32Path(), 'where.exe'), [cmd]]
    : ['/usr/bin/which', [cmd]];
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 4000, windowsHide: true }, (err, stdout) => {
      resolve(!err && String(stdout).trim().length > 0);
    });
  });
}
handle('cli:status', async () => {
  if (cliStatusCache.value && Date.now() - cliStatusCache.at < 30000) return cliStatusCache.value;
  const settings = loadSettings() || {};
  const cli = (settings.cli && typeof settings.cli === 'object') ? settings.cli : {};
  const out = {};
  await Promise.all(Object.entries(cli).map(async ([key, val]) => {
    if (!CLI_KEY_RE.test(key) || RESERVED_OBJECT_KEYS.has(key)) return;
    const cmd = val && typeof val.command === 'string' ? val.command : '';
    out[key] = CMD_NAME_RE.test(cmd) ? await whichCommand(cmd) : false;
  }));
  cliStatusCache = { at: Date.now(), value: out };
  return out;
});

// Is a usable AOR engine present? The renderer hides the AOR badge when not.
handle('aor:status', () => {
  const settings = loadSettings() || {};
  return { engineFound: !!resolveAorEngineRoot(settings), compressHook: resolveCompressHook(settings), cliRegistrationProblem };
});

handle('app:platform', () => process.platform);
handle('app:pty-available', () => ptyAvailable);

// Browser mode (task-015): BrowserView + annotations + console errors, see main-browser.js.
const browserMode = require('./main-browser').setupBrowser({
  handle,
  getWindow: () => mainWindow,
  safeMkdir,
  assertAncestorsClean,
  isPathInsideRoot,
  userDataRoot: USER_DATA_ROOT
});

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
    // task-013: forget workspaces whose folder no longer exists (keeps the file small)
    const alive = state.recentWorkspaces.filter((r) => addAllowedWorkspace(r));
    if (alive.length !== state.recentWorkspaces.length) saveWorkspaceState({ recentWorkspaces: alive });
  }
  try { pruneHistory(); } catch (e) { console.warn('[carrotcap] pruneHistory failed:', e.message); }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// task-013: a clean exit closes this run's sessions and compacts older ones.
// A crash skips this, so the next launch can offer "이전 세션 이어하기 (비정상 종료)".
app.on('before-quit', () => {
  historyQuitting = true;
  try { finalizeHistory(); } catch (e) { console.warn('[carrotcap] finalizeHistory failed:', e.message); }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
