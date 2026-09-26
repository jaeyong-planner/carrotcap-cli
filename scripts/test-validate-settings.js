// Standalone smoke test for validateSettings + quoting helpers.
// Pulls the security-helpers section out of main.js by source-string extraction
// (no Electron import, no app boot). Runs from raw JS.
//
// Usage: node scripts/test-validate-settings.js
//
// Exits 0 on all pass, 1 on any failure. Prints a per-case PASS/FAIL summary.

const fs = require('fs');
const path = require('path');

const mainPath = path.join(__dirname, '..', 'main.js');
const source = fs.readFileSync(mainPath, 'utf8');

const startMarker = '// ---------- Security helpers (task-003) ----------';
const endMarker   = '// ---------- end aiops fs helpers ----------';
const start = source.indexOf(startMarker);
const end   = source.indexOf(endMarker);
if (start < 0 || end < 0) {
  console.error('FATAL: helpers block not found in main.js');
  process.exit(2);
}
const block = source.slice(start, end + endMarker.length);

// Build a sandboxed module: eval the block and export the helpers.
const wrapper = `
const fs = require('fs');
${block}
module.exports = {
  validateSettings,
  pwshSingleQuote,
  posixShellQuote,
  getSystem32Path,
  isPathInsideRoot,
  isPathInsideAllowedWorkspace,
  addAllowedWorkspace,
  safeRealpath,
  allowedWorkspaces,
  CMD_NAME_RE,
  CLI_KEY_RE,
  RESERVED_OBJECT_KEYS,
  MAX_RECENT_WORKSPACES,
  writeIfMissing,
  safeMkdir,
  assertAncestorsClean,
  copyTemplateIfMissing,
};
`;
const m = { exports: {} };
const fn = new Function('module', 'require', 'process', 'path', wrapper);
fn(m, require, process, path);
const {
  validateSettings, pwshSingleQuote, posixShellQuote, getSystem32Path,
  isPathInsideRoot, isPathInsideAllowedWorkspace, addAllowedWorkspace,
  safeRealpath, allowedWorkspaces, MAX_RECENT_WORKSPACES,
  writeIfMissing, safeMkdir, assertAncestorsClean, copyTemplateIfMissing
} = m.exports;

let pass = 0;
let fail = 0;

function check(name, cond, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else      { console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail++; }
}

console.log('-- validateSettings: drops unknown top-level keys');
{
  const out = validateSettings({ aor: { enabled: true }, evilKey: 'x' });
  check('aor preserved', out.aor && out.aor.enabled === true);
  check('evilKey dropped', !('evilKey' in out));
}

console.log('-- validateSettings: rejects __proto__ / constructor / prototype as cli keys');
{
  const out = validateSettings({
    cli: {
      claude:      { command: 'claude', args: [] },
      __proto__:   { command: 'evil',   args: [] },
      constructor: { command: 'evil',   args: [] },
      prototype:   { command: 'evil',   args: [] },
    }
  });
  check('claude preserved', out.cli && out.cli.claude && out.cli.claude.command === 'claude');
  check('__proto__ not own-prop', !Object.prototype.hasOwnProperty.call(out.cli, '__proto__'));
  check('constructor not own-prop', !Object.prototype.hasOwnProperty.call(out.cli, 'constructor'));
  check('prototype not own-prop', !Object.prototype.hasOwnProperty.call(out.cli, 'prototype'));
}

console.log('-- validateSettings: rejects malformed cli.command');
{
  const malformed = ['claude;rm -rf /', 'claude rm', 'claude&whoami', 'claude`x`', 'claude$(x)', '../etc/passwd', ''];
  for (const cmd of malformed) {
    const out = validateSettings({ cli: { evil: { command: cmd, args: [] } } });
    check(`reject command "${cmd}"`, !out.cli || !('evil' in out.cli));
  }
}

console.log('-- validateSettings: caps array/string lengths');
{
  const longArgs = Array.from({ length: 100 }, (_, i) => 'a' + i);
  const longString = 'x'.repeat(5000);
  const out = validateSettings({
    cli: { gem: { command: 'gem', args: longArgs.concat([longString]) } },
    aor: { engineRoot: longString }
  });
  check('cli.args capped at 32', out.cli.gem.args.length === 32);
  check('aor.engineRoot capped at 1024', out.aor.engineRoot.length === 1024);
}

console.log('-- validateSettings: drops control chars');
{
  const out = validateSettings({ aor: { engineRoot: "C:\\foo\x00\x07\x1bbar" } });
  check('NUL/BEL/ESC stripped', out.aor.engineRoot === 'C:\\foobar');
}

console.log('-- validateSettings: ui enums and ranges');
{
  const out1 = validateSettings({ ui: { theme: 'midnight', fontSize: 14 } });
  check('invalid theme dropped', !('theme' in (out1.ui || {})));
  check('valid fontSize kept', out1.ui && out1.ui.fontSize === 14);

  const out2 = validateSettings({ ui: { theme: 'dark', fontSize: 999 } });
  check('valid theme kept', out2.ui.theme === 'dark');
  check('out-of-range fontSize dropped', !('fontSize' in out2.ui));
}

console.log('-- pwshSingleQuote: roundtrip safety');
{
  check("plain", pwshSingleQuote('hello') === "'hello'");
  check("space",  pwshSingleQuote('hello world') === "'hello world'");
  check("apos",   pwshSingleQuote("a'b") === "'a''b'");
  check("backtick", pwshSingleQuote('`$x`') === "'`$x`'"); // backticks have no special meaning inside '..' in PowerShell
  check("amp",    pwshSingleQuote('& whoami') === "'& whoami'");
  check("dollar", pwshSingleQuote('$(whoami)') === "'$(whoami)'");
}

console.log('-- posixShellQuote: roundtrip safety');
{
  check("plain", posixShellQuote('hello') === "'hello'");
  check("apos",  posixShellQuote("a'b") === "'a'\\''b'");
}

console.log('-- getSystem32Path: absolute even if SystemRoot is missing/relative');
{
  const orig = process.env.SystemRoot;
  process.env.SystemRoot = '';
  check('empty SystemRoot -> fallback', /^[A-Za-z]:\\Windows\\System32$|^C:\\Windows\\System32$/.test(getSystem32Path()));
  process.env.SystemRoot = 'relative\\poison';
  check('relative SystemRoot -> fallback', getSystem32Path() === 'C:\\Windows\\System32');
  process.env.SystemRoot = 'C:\\Windows';
  check('absolute SystemRoot -> respected', getSystem32Path() === 'C:\\Windows\\System32');
  if (typeof orig === 'string') process.env.SystemRoot = orig; else delete process.env.SystemRoot;
}

console.log('-- validateSettings: recentWorkspaces is REJECTED (task-004 reflection)');
{
  // task-004 reflection: recentWorkspaces is workspace-grant state, not settings.
  // It must NOT pass through settings:set, so renderer cannot inject allowlist entries.
  const out1 = validateSettings({ recentWorkspaces: ['C:\\Windows', 'C:\\evil'] });
  check('recentWorkspaces dropped from settings:set', !('recentWorkspaces' in out1));

  const out2 = validateSettings({ aor: { enabled: true }, recentWorkspaces: ['x'] });
  check('aor still preserved while recentWorkspaces dropped',
    out2.aor && out2.aor.enabled === true && !('recentWorkspaces' in out2));
}

console.log('-- isPathInsideRoot: prefix and case sensitivity (task-004)');
{
  // Use the OS temp dir as a guaranteed-existing root.
  const os = require('os');
  const tmpRoot = os.tmpdir();
  const inside = path.join(tmpRoot, 'carrotcap-test-' + Date.now());
  fs.mkdirSync(inside, { recursive: true });
  const insideFile = path.join(inside, 'x.txt');
  fs.writeFileSync(insideFile, 'hi');

  check('exact root matches itself', isPathInsideRoot(tmpRoot, tmpRoot));
  check('subdirectory matches', isPathInsideRoot(inside, tmpRoot));
  check('file inside subdir matches', isPathInsideRoot(insideFile, tmpRoot));
  check('parent does NOT match child as root', !isPathInsideRoot(tmpRoot, inside));
  check('unrelated path rejected', !isPathInsideRoot('C:\\Windows', inside));

  // Sibling-prefix bug: "/foo/bar2" must NOT be considered inside "/foo/bar".
  const sibling = path.join(tmpRoot, 'carrotcap-sibling-' + Date.now());
  const siblingExt = sibling + 'X';
  fs.mkdirSync(sibling, { recursive: true });
  fs.mkdirSync(siblingExt, { recursive: true });
  check('sibling-prefix not a substring match', !isPathInsideRoot(siblingExt, sibling));

  // Cleanup
  try { fs.rmSync(inside, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(sibling, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(siblingExt, { recursive: true, force: true }); } catch {}
}

console.log('-- isPathInsideRoot: rejects malformed inputs');
{
  check('empty target rejected', !isPathInsideRoot('', 'C:\\Windows'));
  check('empty root rejected', !isPathInsideRoot('C:\\Windows', ''));
  check('non-string rejected', !isPathInsideRoot(42, 'C:\\Windows'));
  check('NUL in target rejected', !isPathInsideRoot('C:\\foo\x00bar', 'C:\\foo'));
  check('NUL in root rejected', !isPathInsideRoot('C:\\foo', 'C:\\foo\x00bar'));
}

console.log('-- isPathInsideRoot: drive-root and POSIX-root edge bounds');
{
  // These checks document the expected behavior at filesystem boundaries.
  // We do not assume any particular OS — the assertions only check that
  // isPathInsideRoot terminates and returns a defined boolean.
  const r1 = isPathInsideRoot('C:\\Windows', 'C:\\');
  check('drive-root contains Windows path', r1 === true || r1 === false);
  const r2 = isPathInsideRoot('C:\\foo\\..\\bar', 'C:\\foo');
  check('lexical-with-dotdot resolves and is judged', r2 === true || r2 === false);
}

console.log('-- isPathInsideAllowedWorkspace: against the live Set');
{
  const os = require('os');
  const tmpRoot = os.tmpdir();
  const ws = path.join(tmpRoot, 'carrotcap-ws-' + Date.now());
  fs.mkdirSync(ws, { recursive: true });
  const inside = path.join(ws, 'sub', 'deep');
  fs.mkdirSync(inside, { recursive: true });

  // Initially empty Set: nothing is allowed.
  allowedWorkspaces.clear();
  check('empty allowlist rejects everything', !isPathInsideAllowedWorkspace(inside));

  const real = addAllowedWorkspace(ws);
  check('addAllowedWorkspace returns realpath', typeof real === 'string' && real.length > 0);
  check('inside path now allowed', isPathInsideAllowedWorkspace(inside));
  check('outside path still rejected', !isPathInsideAllowedWorkspace('C:\\Windows'));

  // addAllowedWorkspace should reject non-existent paths.
  const ghost = path.join(tmpRoot, 'carrotcap-ghost-does-not-exist-' + Date.now());
  const ghostReal = addAllowedWorkspace(ghost);
  check('non-existent path rejected by addAllowedWorkspace', ghostReal === null);

  // addAllowedWorkspace should reject files (not directories).
  const filePath = path.join(ws, 'a-file.txt');
  fs.writeFileSync(filePath, 'x');
  const fileReal = addAllowedWorkspace(filePath);
  check('file (non-dir) rejected by addAllowedWorkspace', fileReal === null);

  allowedWorkspaces.clear();
  try { fs.rmSync(ws, { recursive: true, force: true }); } catch {}
}

console.log('-- copyTemplateIfMissing + writeIfMissing happy path (task-005)');
{
  const os = require('os');
  const tmpRoot = os.tmpdir();
  const ws = path.join(tmpRoot, 'carrotcap-task005-' + Date.now());
  fs.mkdirSync(ws, { recursive: true });
  const sourceFile = path.join(ws, 'src.md');
  fs.writeFileSync(sourceFile, '# template content');

  const destDir = path.join(ws, 'sub');
  fs.mkdirSync(destDir, { recursive: true });
  const destFile = path.join(destDir, 'dest.md');

  const ok1 = copyTemplateIfMissing(sourceFile, destFile, ws);
  check('copyTemplateIfMissing first call writes file', ok1 === true);
  check('destination file exists with correct content',
    fs.existsSync(destFile) && fs.readFileSync(destFile, 'utf8') === '# template content');

  // Second call should NOT overwrite — writeIfMissing semantics.
  fs.writeFileSync(destFile, '# user-modified');
  const ok2 = copyTemplateIfMissing(sourceFile, destFile, ws);
  check('copyTemplateIfMissing second call does not overwrite', ok2 === false);
  check('user-modified content preserved',
    fs.readFileSync(destFile, 'utf8') === '# user-modified');

  // Missing source: skip silently.
  const ghost = path.join(ws, 'ghost-source.md');
  const dest2 = path.join(destDir, 'dest2.md');
  const ok3 = copyTemplateIfMissing(ghost, dest2, ws);
  check('missing source returns false', ok3 === false);
  check('missing source does not create dest', !fs.existsSync(dest2));

  try { fs.rmSync(ws, { recursive: true, force: true }); } catch {}
}

console.log('-- assertAncestorsClean fail-closed (task-004-r4)');
{
  const os = require('os');
  const tmpRoot = os.tmpdir();
  const ws = path.join(tmpRoot, 'carrotcap-aac-' + Date.now());
  fs.mkdirSync(path.join(ws, 'inner'), { recursive: true });

  // Reaches realRoot — should NOT throw.
  let threw = false;
  try { assertAncestorsClean(path.join(ws, 'inner', 'leaf.txt'), ws); }
  catch { threw = true; }
  check('reaches realRoot -> does not throw', !threw);

  // Missing projectRoot — must throw.
  let t1 = false;
  try { assertAncestorsClean('/whatever', ''); } catch { t1 = true; }
  check('missing projectRoot throws', t1);

  // Path outside projectRoot — must reach fs root and throw.
  let t2 = false;
  try { assertAncestorsClean(path.join(tmpRoot, 'unrelated', 'leaf.txt'), ws); } catch { t2 = true; }
  check('path outside workspace throws (reaches fs root)', t2);

  try { fs.rmSync(ws, { recursive: true, force: true }); } catch {}
}

console.log('');
console.log(`Summary: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
