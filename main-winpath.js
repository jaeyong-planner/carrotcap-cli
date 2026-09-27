// CARROTCAP CLI — the PATH terminals get on Windows (task-027).
// The app inherits PATH from whatever launched it (Explorer, a terminal, another app), and that
// copy never changes while the app runs. A tool installed later — or a PATH entry the launcher did
// not have — is then "not found" in every pane (`grok` 2026-09-28) although it is installed for
// the user. Each terminal spawn and each CLI check therefore adds the entries Windows has
// registered now (Machine, then User) that the app's own PATH lacks. The app's PATH keeps its
// order and stays in front, so nothing that resolved before resolves differently.

const fs = require('fs');
const { execFile } = require('child_process');

const REFRESH_MS = 5000;
const READ_TIMEOUT_MS = 4000;
const SPLIT = '<<CARROTCAP-PATH-SPLIT>>';

function splitPath(s) {
  return String(s || '').split(';').map((p) => p.trim()).filter(Boolean);
}
// case and a trailing slash do not matter — except for a drive root: "C:\" is the root, while
// "C:" means the current directory on C: (review task-027 r1)
function keyOf(p) {
  const t = p.replace(/[\\/]+$/, '');
  if (t === '') return '\\'; // "\" alone: the root of the current drive (review task-027 r2)
  if (/^[a-z]:$/i.test(t) && t.length < p.length) return (t + '\\').toLowerCase();
  return t.toLowerCase();
}

// REG_EXPAND_SZ entries like %USERPROFILE%\bin → real paths (review task-027 r3). Names are
// case-insensitive; an unknown %NAME% is left as it is (Windows does the same). Already-expanded
// text passes through unchanged, so this is safe whether or not the reader expanded it.
function expandVars(s, env = process.env) {
  const lookup = {};
  for (const [k, v] of Object.entries(env || {})) if (typeof v === 'string') lookup[k.toUpperCase()] = v;
  return String(s || '').replace(/%([^%;]+)%/g, (m, name) => (Object.prototype.hasOwnProperty.call(lookup, name.toUpperCase()) ? lookup[name.toUpperCase()] : m));
}

// current first (unchanged order), then registered entries it does not have yet; no duplicates
function mergePath(current, machine, user) {
  const out = [];
  const seen = new Set();
  for (const p of [...splitPath(current), ...splitPath(machine), ...splitPath(user)]) {
    const k = keyOf(p);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out.join(';');
}

// Windows env names are case-insensitive: keep exactly one PATH entry (its existing spelling)
function pathKey(env) {
  return Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'Path';
}
function withPath(env, value) {
  const key = pathKey(env);
  const next = { ...env };
  for (const k of Object.keys(next)) if (k.toUpperCase() === 'PATH' && k !== key) delete next[k];
  next[key] = value;
  return next;
}

// Reads the registered Machine / User PATH through PowerShell as UTF-8, so paths with
// Korean or other non-ASCII names survive (reg.exe prints the OEM code page). The command is a
// constant. testFile: dev-tree E2E only — {"machine": "...", "user": "..."} instead of the registry.
function createRegisteredPath({ powershell, testFile = null, testDelayMs = 0, now = Date.now, run = execFile } = {}) {
  let cache = null;
  let attemptAt = -Infinity; // last read started — success or not (review task-027 r1)
  let inflight = null;
  function read() {
    return new Promise((resolve) => {
      if (testFile) {
        // async, so even an odd test path never blocks the main process (review task-027 r2)
        // testDelayMs: a slow registry, to test panes closed while they wait
        new Promise((r) => setTimeout(r, testDelayMs)).then(() => fs.promises.readFile(testFile, 'utf8')).then((text) => {
          const j = JSON.parse(text);
          resolve({ machine: String(j.machine || ''), user: String(j.user || '') });
        }).catch(() => resolve(null));
        return;
      }
      const script = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Environment]::GetEnvironmentVariable('Path','Machine'); '" + SPLIT + "'; [Environment]::GetEnvironmentVariable('Path','User')";
      run(powershell(), ['-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: READ_TIMEOUT_MS, windowsHide: true, encoding: 'utf8', maxBuffer: 1 << 20 },
        (err, stdout) => {
          if (err) return resolve(null);
          const parts = String(stdout).split(SPLIT);
          if (parts.length !== 2) return resolve(null);
          resolve({ machine: parts[0].trim(), user: parts[1].trim() });
        });
    });
  }
  // The last good reading; null if it could never be read (then callers keep the app's own PATH,
  // exactly as before). At most one read per maxAgeMs whether it worked or not, so a machine where
  // PowerShell cannot run does not slow every new pane down.
  function get({ maxAgeMs = REFRESH_MS } = {}) {
    if (inflight) return inflight;
    if (now() - attemptAt < maxAgeMs) return Promise.resolve(cache);
    attemptAt = now();
    inflight = read().then((r) => {
      inflight = null;
      if (r) cache = r;
      return cache;
    });
    return inflight;
  }
  // env for a child process: the app's PATH plus what Windows has registered and it lacks
  function envFor(baseEnv) {
    if (!cache) return baseEnv;
    return withPath(baseEnv, mergePath(baseEnv[pathKey(baseEnv)] || '', expandVars(cache.machine, baseEnv), expandVars(cache.user, baseEnv)));
  }
  return { get, envFor, peek: () => cache };
}

module.exports = { createRegisteredPath, mergePath, splitPath, pathKey, withPath, expandVars, REFRESH_MS };
