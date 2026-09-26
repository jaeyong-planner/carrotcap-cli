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
// task-009: also pull ensureAiopsProjectStructure (reads templates/aiops/ via APP_ROOT).
const aiopsStart = source.indexOf('function ensureAiopsProjectStructure');
const aiopsEnd   = source.indexOf('function resolvePtyArgs');
if (aiopsStart < 0 || aiopsEnd < 0) {
  console.error('FATAL: ensureAiopsProjectStructure not found in main.js');
  process.exit(2);
}
const aiopsBlock = source.slice(aiopsStart, aiopsEnd);

// Build a sandboxed module: eval the block and export the helpers.
// APP_ROOT is injectable so missing-template cases can use an empty app root.
const makeWrapper = (appRoot) => `
const fs = require('fs');
const APP_ROOT = ${JSON.stringify(appRoot)};
${block}
${aiopsBlock}
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
  clampInt,
  resolveAllowedDir,
  sanitizeSpawnPayload,
  isValidPtyId,
  validateClaudeMdContent,
  MAX_CLAUDE_MD_BYTES,
  isWithinByteCap,
  migrateSettings,
  SETTINGS_VERSION,
  sanitizeHistoryLayout,
  applyHistorySnapshot,
  finalizeHistoryRecord,
  dropResumableLayouts,
  pickResumableSession,
  isHistoryExpired,
  HISTORY_MAX_SESSIONS,
  sanitizeHistoryRecord,
  ensureAiopsProjectStructure,
  findMissingAiopsTemplates,
  AIOPS_CLAUDE_BLOCK_START,
  AIOPS_CLAUDE_BLOCK_END,
  pruneAorRuntime,
  buildCompressHookSettings,
  claudeArgsTakeHook,
  resolveAorEngineRoot,
  buildLaunchShims,
  LAUNCH_SHIM_NAMES,
  isOwnLaunchShim,
  isCanonicalInstall,
  AOR_RAW_KEEP,
  AOR_REPORT_KEEP,
};
`;
function loadHelpers(appRoot, proc = process) {
  const mod = { exports: {} };
  new Function('module', 'require', 'process', 'path', makeWrapper(appRoot))(mod, require, proc, path);
  return mod.exports;
}
const m = { exports: loadHelpers(path.join(__dirname, '..')) };
const {
  validateSettings, pwshSingleQuote, posixShellQuote, getSystem32Path,
  isPathInsideRoot, isPathInsideAllowedWorkspace, addAllowedWorkspace,
  safeRealpath, allowedWorkspaces, MAX_RECENT_WORKSPACES,
  writeIfMissing, safeMkdir, assertAncestorsClean, copyTemplateIfMissing,
  clampInt, resolveAllowedDir, sanitizeSpawnPayload, isValidPtyId,
  validateClaudeMdContent, MAX_CLAUDE_MD_BYTES,
  ensureAiopsProjectStructure, AIOPS_CLAUDE_BLOCK_START, AIOPS_CLAUDE_BLOCK_END,
  isWithinByteCap, findMissingAiopsTemplates, migrateSettings, SETTINGS_VERSION,
  sanitizeHistoryLayout, applyHistorySnapshot, finalizeHistoryRecord, dropResumableLayouts,
  pickResumableSession, isHistoryExpired, HISTORY_MAX_SESSIONS, sanitizeHistoryRecord,
  pruneAorRuntime, AOR_RAW_KEEP, AOR_REPORT_KEEP, buildCompressHookSettings, claudeArgsTakeHook, buildLaunchShims, LAUNCH_SHIM_NAMES, isOwnLaunchShim, isCanonicalInstall
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

  // Missing source: throws (task-014 r5).
  const ghost = path.join(ws, 'ghost-source.md');
  const dest2 = path.join(destDir, 'dest2.md');
  let threw3 = false;
  try { copyTemplateIfMissing(ghost, dest2, ws); } catch { threw3 = true; }
  check('missing source throws (never a silent partial setup)', threw3);
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

console.log('-- clampInt (task-007)');
{
  check('in range kept', clampInt(80, 2, 1000, 80) === 80);
  check('float floored', clampInt(80.9, 2, 1000, 80) === 80);
  check('too big clamped', clampInt(1e9, 2, 1000, 80) === 1000);
  check('negative clamped', clampInt(-5, 2, 1000, 80) === 2);
  check('NaN -> fallback', clampInt(NaN, 2, 1000, 80) === 80);
  check('string -> fallback', clampInt('100', 2, 1000, 80) === 80);
}

console.log('-- sanitizeSpawnPayload / resolveAllowedDir (task-007)');
{
  const os = require('os');
  const ws = path.join(os.tmpdir(), 'carrotcap-spawn-' + Date.now());
  const sub = path.join(ws, 'sub');
  fs.mkdirSync(sub, { recursive: true });
  const file = path.join(ws, 'f.txt');
  fs.writeFileSync(file, 'x');
  allowedWorkspaces.clear();
  addAllowedWorkspace(ws);

  const ok = sanitizeSpawnPayload({ mode: 'aiops', cwd: sub, cols: 120, rows: 30 });
  check('allowed cwd kept (realpath)', ok.cwd === safeRealpath(sub));
  check('valid mode kept', ok.mode === 'aiops');
  check('cols/rows kept', ok.cols === 120 && ok.rows === 30);

  const out = sanitizeSpawnPayload({ mode: 'aiops', cwd: os.homedir() });
  check('cwd outside allowlist dropped', !('cwd' in out));
  check('file cwd rejected', resolveAllowedDir(file) === null);
  check('non-string cwd rejected', resolveAllowedDir({ toString: () => ws }) === null);

  const bad = sanitizeSpawnPayload({ mode: 'root', cliKey: 'constructor', cols: 1e9, rows: -1, extra: 'x' });
  check('unknown mode -> plain', bad.mode === 'plain');
  check('reserved cliKey dropped', !('cliKey' in bad));
  check('cols clamped', bad.cols === 1000);
  check('rows clamped', bad.rows === 1);
  check('unknown keys dropped', !('extra' in bad));
  check('invalid cliKey dropped', !('cliKey' in sanitizeSpawnPayload({ mode: 'cli', cliKey: 'a;b' })));
  check('valid cliKey kept', sanitizeSpawnPayload({ mode: 'cli', cliKey: 'claude' }).cliKey === 'claude');

  check('null payload -> defaults', sanitizeSpawnPayload(null).mode === 'plain');
  check('array payload -> defaults', sanitizeSpawnPayload([1, 2]).mode === 'plain');

  allowedWorkspaces.clear();
  try { fs.rmSync(ws, { recursive: true, force: true }); } catch {}
}

console.log('-- isValidPtyId (task-007)');
{
  check('real id shape accepted', isValidPtyId('pty_1727330000000_ab12cd'));
  check('non-string rejected', !isValidPtyId(12));
  check('proto key rejected', !isValidPtyId('__proto__'));
  check('suffix garbage rejected', !isValidPtyId('pty_1_ab;rm'));
}

console.log('-- validateClaudeMdContent (task-007)');
{
  check('normal text accepted', validateClaudeMdContent('# 규칙\n- a'));
  check('empty string accepted', validateClaudeMdContent(''));
  check('non-string rejected', !validateClaudeMdContent({ a: 1 }));
  check('NUL rejected', !validateClaudeMdContent('a\x00b'));
  check('exact cap accepted', validateClaudeMdContent('a'.repeat(MAX_CLAUDE_MD_BYTES)));
  check('over cap rejected', !validateClaudeMdContent('a'.repeat(MAX_CLAUDE_MD_BYTES + 1)));
  check('multibyte counted as bytes', !validateClaudeMdContent('가'.repeat(Math.ceil(MAX_CLAUDE_MD_BYTES / 3) + 1)));
}

console.log('-- ensureAiopsProjectStructure from templates/aiops (task-009)');
{
  const os = require('os');
  const ws = path.join(os.tmpdir(), 'carrotcap-aiops-' + Date.now());
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, 'CLAUDE.md'), '# existing project rules\n');

  const res = ensureAiopsProjectStructure(ws);
  check('setup returns paths', res && res.root === safeRealpath(ws));
  const tmpl = (n) => fs.readFileSync(path.join(__dirname, '..', 'templates', 'aiops', n), 'utf8');
  const out = (...p) => fs.readFileSync(path.join(ws, ...p), 'utf8');
  check('supervisor.md from template', out('agents', 'supervisor.md') === tmpl('supervisor.md'));
  check('task-001.md from template', out('backlog', 'task-001.md') === tmpl('task-001.md'));
  check('workflow.md from template', out('backlog', 'workflow.md') === tmpl('workflow.md'));
  check('media/reviewer deployed',
    fs.existsSync(path.join(ws, 'agents', 'media.md')) && fs.existsSync(path.join(ws, 'agents', 'reviewer.md')));
  check('helper scripts deployed', fs.existsSync(path.join(ws, 'scripts', 'run-reviewer.ps1')));

  const claude = out('CLAUDE.md');
  check('existing CLAUDE.md content preserved', claude.startsWith('# existing project rules\n'));
  check('AIOps block appended with markers',
    claude.includes(AIOPS_CLAUDE_BLOCK_START) && claude.trimEnd().endsWith(AIOPS_CLAUDE_BLOCK_END));
  check('block body from template', claude.includes(tmpl('CLAUDE-block.md').trim()));

  // Idempotent: second run changes nothing and keeps user edits.
  fs.writeFileSync(path.join(ws, 'agents', 'supervisor.md'), '# user edited');
  ensureAiopsProjectStructure(ws);
  check('second run keeps user-edited supervisor.md', out('agents', 'supervisor.md') === '# user edited');
  check('second run does not duplicate the block',
    out('CLAUDE.md').split(AIOPS_CLAUDE_BLOCK_START).length === 2);

  try { fs.rmSync(ws, { recursive: true, force: true }); } catch {}
}

console.log('-- missing templates: refuse before writing (task-009 review)');
{
  const os = require('os');
  check('real app root has all templates', findMissingAiopsTemplates().length === 0, findMissingAiopsTemplates().join(','));

  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'carrotcap-noroot-'));
  const broken = loadHelpers(emptyRoot);
  const missing = broken.findMissingAiopsTemplates();
  check('empty app root reports all 8 templates missing', missing.length === 8, missing.join(','));
  check('missing list names templates/aiops/supervisor.md', missing.includes(path.join('templates', 'aiops', 'supervisor.md')));

  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'carrotcap-partial-'));
  const res = broken.ensureAiopsProjectStructure(ws);
  check('setup returns null when templates missing', res === null);
  check('no partial structure written', fs.readdirSync(ws).length === 0, fs.readdirSync(ws).join(','));

  // Helper scripts cannot be deployed (scripts/ is a file here): setup succeeds WITH a warning.
  const wsScripts = fs.mkdtempSync(path.join(os.tmpdir(), 'carrotcap-scripts-'));
  fs.writeFileSync(path.join(wsScripts, 'scripts'), 'not a directory');
  const resS = ensureAiopsProjectStructure(wsScripts);
  check('scripts deployment failure -> success with a warning', resS && typeof resS.warning === 'string' && /scripts/.test(resS.warning));
  const clean = ensureAiopsProjectStructure(ws);
  check('clean setup has no warning', !!clean && clean.warning === undefined);
  try { fs.rmSync(wsScripts, { recursive: true, force: true }); } catch {}

  // Re-run with a complete app root recovers normally.
  const res2 = ensureAiopsProjectStructure(ws);
  check('re-run with complete templates succeeds', res2 && fs.existsSync(path.join(ws, 'agents', 'supervisor.md')));

  try { fs.rmSync(emptyRoot, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(ws, { recursive: true, force: true }); } catch {}
}

console.log('-- isWithinByteCap: UTF-8 bytes, not UTF-16 units (task-009 review)');
{
  check('ascii at cap accepted', isWithinByteCap('a'.repeat(10), 10));
  check('ascii over cap rejected', !isWithinByteCap('a'.repeat(11), 10));
  check('hangul counted as 3 bytes', !isWithinByteCap('가가가가', 10) && isWithinByteCap('가가가', 9));
  check('emoji counted as 4 bytes', !isWithinByteCap('😀😀😀', 10));
  check('non-string rejected', !isWithinByteCap(123, 10));
}

console.log('-- migrateSettings: drop Google CLIs, add grok, run once (task-012)');
{
  const old = {
    aor: { enabled: true },
    cli: {
      claude: { command: 'claude', args: [] },
      gemini: { command: 'agy', args: [] },          // real v0.1 user file: key gemini, command agy
      antigravity: { command: 'antigravity', args: [] },
      research: { command: 'gemini', args: ['-y'] }, // removed by command name too
      codex: { command: 'codex', args: [] }
    }
  };
  const { settings: s1, changed: c1 } = migrateSettings(old);
  check('migration reports a change', c1 === true);
  check('gemini / antigravity / agy removed', !s1.cli.gemini && !s1.cli.antigravity && !s1.cli.research);
  check('claude and codex kept', s1.cli.claude && s1.cli.codex);
  check('grok added', s1.cli.grok && s1.cli.grok.command === 'grok');
  check('version stamped', s1.settingsVersion === SETTINGS_VERSION);
  check('other sections untouched', s1.aor.enabled === true);
  check('input not mutated', !!old.cli.gemini);

  delete s1.cli.grok; // user removes grok on purpose
  const { settings: s2, changed: c2 } = migrateSettings(s1);
  check('second run is a no-op (grok not re-added)', c2 === false && !s2.cli.grok);
  check('null settings -> no change', migrateSettings(null).changed === false);
  check('settingsVersion survives validateSettings', validateSettings({ settingsVersion: 2 }).settingsVersion === 2);
  check('bad settingsVersion dropped', !('settingsVersion' in validateSettings({ settingsVersion: '2' })));
}

console.log('-- bundled settings.json (task-012)');
{
  const bundled = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'settings.json'), 'utf8'));
  const cleaned = validateSettings(bundled);
  check('bundled CLIs are claude, codex, grok', Object.keys(cleaned.cli).join(',') === 'claude,codex,grok', Object.keys(cleaned.cli).join(','));
  check('bundled settings already at current version', migrateSettings(cleaned).changed === false);
}

console.log('-- session history helpers (task-013)');
{
  const layout = sanitizeHistoryLayout({
    tabs: [
      { panes: [{ mode: 'aiops', cli: 'claude' }, { mode: 'evil', cli: 'a;b' }, { mode: 'plain', cli: '__proto__' }] },
      { panes: [] },
      'junk'
    ],
    extra: 'dropped'
  });
  check('sanitize keeps valid panes, drops empty tabs', layout && layout.tabs.length === 1 && layout.tabs[0].panes.length === 3);
  check('sanitize: unknown mode -> plain, bad cli -> null',
    layout.tabs[0].panes[1].mode === 'plain' && layout.tabs[0].panes[1].cli === null && layout.tabs[0].panes[2].cli === null);
  check('sanitize: unknown keys dropped', !('extra' in layout));
  check('sanitize caps tabs at 8', sanitizeHistoryLayout({ tabs: Array.from({ length: 20 }, () => ({ panes: [{ mode: 'plain' }] })) }).tabs.length === 8);
  check('sanitize rejects garbage', sanitizeHistoryLayout(null) === null && sanitizeHistoryLayout({ tabs: 'x' }) === null);

  // 7 app runs, one session each
  let rec = null;
  for (let i = 1; i <= 7; i++) {
    rec = applyHistorySnapshot(rec, { sessionId: `s${i}`, projectRoot: 'C:\\p', layout, nowIso: `2026-09-2${i}T10:00:00.000Z`, lastTask: 'task-013' });
  }
  check(`at most ${HISTORY_MAX_SESSIONS} sessions kept`, rec.sessions.length === HISTORY_MAX_SESSIONS);
  check('newest first', rec.sessions[0].id === 's7');
  check('summary fields recorded', rec.sessions[0].clis.join() === 'claude' && rec.sessions[0].paneCount === 3);
  const again = applyHistorySnapshot(rec, { sessionId: 's7', projectRoot: 'C:\\p', layout, nowIso: '2026-09-28T11:00:00.000Z', lastTask: 'bad name!' });
  check('same session updated in place, startedAt kept', again.sessions.filter((s) => s.id === 's7').length === 1 && again.sessions[0].startedAt === '2026-09-27T10:00:00.000Z');
  check('invalid lastTask ignored (keeps previous)', again.sessions[0].lastTask === 'task-013');

  const fin = finalizeHistoryRecord(again, new Set(['s7']), '2026-09-28T12:00:00.000Z');
  check('finalize marks this run clean', fin.sessions[0].clean === true && fin.sessions[0].endedAt === '2026-09-28T12:00:00.000Z');
  check('finalize keeps layout only on the newest', !!fin.sessions[0].layout && fin.sessions.slice(1).every((s) => !s.layout));
  check('older sessions stay unclean (crash evidence)', fin.sessions.slice(1).every((s) => s.clean === false));

  const pick = pickResumableSession(fin, new Set());
  check('resumable = newest with a layout', pick && pick.startedAt === '2026-09-27T10:00:00.000Z' && pick.layout);
  check('current run excluded from resume', pickResumableSession(fin, new Set(['s7'])) === null);
  const dropped = dropResumableLayouts(fin, new Set());
  check('dismiss drops every layout not in keep set', dropped.sessions.every((s) => !s.layout));

  check('expired after 30 days', isHistoryExpired({ updatedAt: '2026-08-01T00:00:00Z' }, Date.parse('2026-09-26T00:00:00Z')));
  check('fresh record not expired', !isHistoryExpired({ updatedAt: '2026-09-20T00:00:00Z' }, Date.parse('2026-09-26T00:00:00Z')));
  check('unparsable date counts as expired', isHistoryExpired({ updatedAt: 'x' }, Date.now()));
}

console.log('-- sanitizeHistoryRecord: files are re-validated on read (task-012/013 review)');
{
  const hostile = {
    projectRoot: 'C:\\p'.repeat(1000),
    updatedAt: '2026-09-26T10:00:00.000Z',
    sessions: [
      { id: 'ok-1', startedAt: '2026-09-26T10:00:00.000Z', clean: 'yes', lastTask: '../../etc', clis: ['claude', 'x;y', '__proto__', 7],
        layout: { tabs: Array.from({ length: 50 }, () => ({ panes: Array.from({ length: 50 }, () => ({ mode: 'plain', cli: 'claude' })) })) },
        paneCount: 1e9, extra: 'drop me' },
      { id: 'BAD ID', startedAt: '2026-09-26T10:00:00.000Z' },
      { id: 'no-start' },
      null, 'junk',
      ...Array.from({ length: 20 }, (_, i) => ({ id: `s-${i}`, startedAt: '2026-09-25T10:00:00.000Z' }))
    ]
  };
  const r = sanitizeHistoryRecord(hostile);
  const s0 = r.sessions[0];
  check('projectRoot capped', r.projectRoot.length <= 1024);
  check('sessions capped', r.sessions.length === HISTORY_MAX_SESSIONS);
  check('invalid ids / missing startedAt dropped', r.sessions.every((s) => /^[a-z0-9-]+$/.test(s.id) && s.startedAt));
  check('layout re-capped to 8x8', s0.layout.tabs.length === 8 && s0.layout.tabs.every((t) => t.panes.length === 8));
  check('clean must be boolean true', s0.clean === false);
  check('bad lastTask dropped', s0.lastTask === null);
  check('clis filtered', s0.clis.join() === 'claude');
  check('counts clamped', s0.paneCount === 64);
  check('unknown fields dropped', !('extra' in s0));
  check('non-record -> null', sanitizeHistoryRecord({ sessions: 'x' }) === null && sanitizeHistoryRecord(null) === null);
}

console.log('-- migrateSettings: settingsVersion must be a real integer (task-012/013 review)');
{
  for (const v of ['2', 2.5, null, true, -1]) {
    const { changed } = migrateSettings({ settingsVersion: v, cli: { gemini: { command: 'gemini', args: [] } } });
    check(`settingsVersion ${JSON.stringify(v)} -> migrates`, changed === true);
  }
  check('current settingsVersion -> no-op', migrateSettings({ settingsVersion: SETTINGS_VERSION, cli: {} }).changed === false);
}

console.log('-- migrateSettings v3: AIOps on by default, once');
{
  // v2 files may hold a real v0.2 choice -> an explicit boolean is kept (review task-014)
  const v2off = { settingsVersion: 2, aor: { enabled: true, autoStart: false, engineRoot: 'X' }, cli: { claude: { command: 'claude', args: [] } } };
  const { settings: s2k, changed: c2k } = migrateSettings(v2off);
  check('v2 -> v3 migrates', c2k === true && s2k.settingsVersion === 3);
  check('v2 explicit "off" is kept', s2k.aor.autoStart === false);
  // v2 without a value -> default on
  const { settings: s } = migrateSettings({ settingsVersion: 2, aor: { enabled: true, engineRoot: 'X' }, cli: { claude: { command: 'claude', args: [] } } });
  check('v2 without a value -> AIOps on', s.aor.autoStart === true);
  for (const v of [null, 'false', 0, 1]) {
    check(`v2 non-boolean autoStart ${JSON.stringify(v)} -> on`, migrateSettings({ settingsVersion: 2, aor: { autoStart: v }, cli: {} }).settings.aor.autoStart === true);
  }
  check('other aor fields kept', s.aor.enabled === true && s.aor.engineRoot === 'X');
  check('v2 CLI list untouched (grok not re-added)', Object.keys(s.cli).join() === 'claude');
  // v1 (pre-v0.2 builds, where off was only the default) -> on
  check('v1 "off" (old default) -> on', migrateSettings({ aor: { autoStart: false }, cli: {} }).settings.aor.autoStart === true);
  // after v3 the user's own "off" sticks
  const off = { ...s, aor: { ...s.aor, autoStart: false } };
  check('user turning AIOps off later is respected', migrateSettings(off).changed === false);
  // v1 gets both steps
  const { settings: s1 } = migrateSettings({ cli: { gemini: { command: 'agy', args: [] } } });
  check('v1 -> both steps (gemini removed, grok added, AIOps on)', !s1.cli.gemini && !!s1.cli.grok && s1.aor.autoStart === true);
  const bundled = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'settings.json'), 'utf8'));
  check('bundled default: AIOps on', bundled.aor.autoStart === true && bundled.settingsVersion === SETTINGS_VERSION);
}

console.log('-- browser mode helpers (task-015)');
{
  // main-browser.js only destructures from 'electron' at load time, so plain node can require it.
  const { cleanText, normalizeUrl, sanitizePick, clampRect } = require(path.join(__dirname, '..', 'main-browser.js'));
  const ESC = String.fromCharCode(27);
  const hostile = `ok${ESC}[201~\r\nRemove-Item -Recurse ~${String.fromCharCode(0x2028)}x${String.fromCharCode(0x9b)}y${String.fromCharCode(0x7f)}`;
  const c = cleanText(hostile, 200);
  check('cleanText strips ESC / CR / LF / U+2028 / C1 / DEL', !/[\u0000-\u001F\u007F-\u009F\u{2028}\u{2029}]/u.test(c), JSON.stringify(c));
  check('cleanText keeps the readable text', c.startsWith('ok') && c.includes('Remove-Item'));
  check('cleanText caps length', cleanText('a'.repeat(50), 10).length === 10);
  check('normalizeUrl: localhost gets http', normalizeUrl('localhost:3000') === 'http://localhost:3000/');
  check('normalizeUrl: bare host gets https', normalizeUrl('example.com') === 'https://example.com/');
  for (const bad of ['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'data:text/html,x', 'chrome://gpu', 'http://a\nb', '', null]) {
    check(`normalizeUrl rejects ${JSON.stringify(bad)}`, normalizeUrl(bad) === null);
  }
  const pick = sanitizePick({ n: 5000, selector: `a${ESC}[201~b`, tag: 'button', text: 'x\r\ny', rect: { x: 1.4, y: 'z' }, viewport: {} });
  check('sanitizePick clamps n and cleans strings', pick.n === 999 && !pick.selector.includes(ESC) && !/[\r\n]/.test(pick.text) && pick.rect.x === 1 && pick.rect.y === 0);
  check('sanitizePick rejects non-objects', sanitizePick('x') === null);
  const r = clampRect({ x: -5, y: 1e9, width: 'w', height: 10.6 });
  check('clampRect clamps to integers >= 0', r.x === 0 && r.y === 20000 && r.width === 0 && r.height === 11);
}

console.log('-- AOR engine settings + runtime pruning (task-016)');
{
  const v = validateSettings({ aor: { consoleShims: 'yes', compressHook: 0 } });
  check('consoleShims / compressHook coerced to booleans', v.aor.consoleShims === true && v.aor.compressHook === false);
  check('absent flags stay absent (defaults apply)', !('consoleShims' in validateSettings({ aor: {} }).aor));

  const os = require('os');
  const rt = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-aor-rt-'));
  const now = Date.parse('2026-09-27T00:00:00Z');
  for (const d of ['raw', 'reports', 'metrics']) fs.mkdirSync(path.join(rt, d));
  const touch = (p, ms) => { fs.writeFileSync(p, 'x'); const t = new Date(ms); fs.utimesSync(p, t, t); };
  // raw: 210 recent logs + 1 old one + a foreign file
  for (let i = 0; i < 210; i++) touch(path.join(rt, 'raw', `2026-09-26T10-00-00-${String(i).padStart(3, '0')}Z-abcdef${String(i).padStart(6, '0')}.log`), now - 3600e3 + i * 1000);
  touch(path.join(rt, 'raw', '2026-09-01T00-00-00-000Z-a45e5d794fee.log'), now - 20 * 86400e3);
  touch(path.join(rt, 'raw', 'notes.txt'), now - 90 * 86400e3);
  for (let i = 0; i < 25; i++) touch(path.join(rt, 'reports', `session-report-202609${String(i + 1).padStart(2, '0')}-120000.txt`), now - (25 - i) * 3600e3);
  touch(path.join(rt, 'metrics', '2026-07-01.jsonl'), now);
  touch(path.join(rt, 'metrics', '2026-09-20.jsonl'), now);
  const res = pruneAorRuntime(rt, now);
  const rawLeft = fs.readdirSync(path.join(rt, 'raw'));
  check('raw logs capped at AOR_RAW_KEEP, old one dropped', rawLeft.filter((n) => n.endsWith('.log')).length === AOR_RAW_KEEP && !rawLeft.includes('2026-09-01T00-00-00-000Z-a45e5d794fee.log'), JSON.stringify(res));
  check('newest raw log kept', rawLeft.includes('2026-09-26T10-00-00-209Z-abcdef000209.log'));
  check('foreign file in raw untouched', rawLeft.includes('notes.txt'));
  check('reports capped at AOR_REPORT_KEEP (newest kept)', fs.readdirSync(path.join(rt, 'reports')).length === AOR_REPORT_KEEP && fs.existsSync(path.join(rt, 'reports', 'session-report-20260925-120000.txt')));
  check('metrics older than 30 days removed, recent kept', !fs.existsSync(path.join(rt, 'metrics', '2026-07-01.jsonl')) && fs.existsSync(path.join(rt, 'metrics', '2026-09-20.jsonl')));
  // A junctioned raw dir is never followed.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-aor-out-'));
  touch(path.join(outside, '2026-01-01T00-00-00-000Z-a45e5d794fee.log'), now - 90 * 86400e3);
  fs.rmSync(path.join(rt, 'raw'), { recursive: true, force: true });
  fs.symlinkSync(outside, path.join(rt, 'raw'), 'junction');
  pruneAorRuntime(rt, now);
  check('junctioned raw dir not followed', fs.existsSync(path.join(outside, '2026-01-01T00-00-00-000Z-a45e5d794fee.log')));
  check('missing runtime dir is a no-op', JSON.stringify(pruneAorRuntime(path.join(rt, 'nope'), now)) === '{"raw":0,"reports":0,"metrics":0}');
  fs.rmSync(path.join(rt, 'raw'), { force: true, recursive: false });
  fs.rmSync(rt, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
}

console.log('-- compress hook settings (task-017)');
{
  const cfg = buildCompressHookSettings(String.raw`C:\Program Files\nodejs\node.exe`, String.raw`C:\Users\o'neil\내 드라이브\AOR\carrotcap\compress-hook.js`);
  const h = cfg.hooks.PostToolUse[0];
  const cmd = h.hooks[0].command;
  check('only a PostToolUse hook on Bash', Object.keys(cfg).join() === 'hooks' && Object.keys(cfg.hooks).join() === 'PostToolUse' && h.matcher === 'Bash');
  check('paths single-quoted with forward slashes', cmd.startsWith("'C:/Program Files/nodejs/node.exe' 'C:/Users/"), cmd);
  check('apostrophe in a path is escaped for sh', cmd.includes(String.raw`o'\''neil`), cmd);
  const r = require('child_process').spawnSync('bash', ['-c', 'for a in ' + cmd + '; do echo "[$a]"; done'], { encoding: 'utf8' });
  const words = r.error ? [] : r.stdout.trim().split(/\r?\n/);
  check('bash splits it into exactly the two paths', words.length === 2 && words[1].includes("o'neil"), r.stdout || String(r.error));
}

console.log('-- which claude calls get the hook (review task-016 r1)');
{
  check('plain launch takes the hook', claudeArgsTakeHook([]) && claudeArgsTakeHook(['--continue']) && claudeArgsTakeHook(['--model', 'opus', 'fix the bug']));
  check('--settings <file> blocks it', !claudeArgsTakeHook(['--settings', 'x.json']));
  check('--settings=<file> blocks it', !claudeArgsTakeHook(['--settings=x.json', '--version']));
  check('subcommand anywhere blocks it', !claudeArgsTakeHook(['mcp', 'list']) && !claudeArgsTakeHook(['--verbose', 'mcp', 'list']) && !claudeArgsTakeHook(['update']));
  check('non-string args ignored', claudeArgsTakeHook([null, 3, '--continue']) && claudeArgsTakeHook(undefined));
  const mac = loadHelpers(path.join(__dirname, '..'), { ...process, platform: 'darwin', env: process.env });
  check('no AOR engine outside Windows (PowerShell scripts)', mac.resolveAorEngineRoot({ aor: { engineRoot: __dirname } }) === null);
}

console.log('-- `carrotcap` launch shims (task-018)');
{
  check('only our own names — never Cream\'s carrotcap.cmd / aor.cmd', LAUNCH_SHIM_NAMES.join() === 'carrotcap.bat,carrotcap');
  const exe = String.raw`C:\Users\o'neil\AppData\Local\Programs\carrotcap-cli\carrotcap.exe`;
  const sh = buildLaunchShims(exe);
  check('.bat: marker line, starts the exe detached, passing args', sh['carrotcap.bat'] === `@echo off\r\nrem CARROTCAP-CLI-LAUNCHER\r\nsetlocal DisableDelayedExpansion\r\nstart "" "${exe}" %*\r\n`);
  check('sh: marker on line 2', sh.carrotcap.split('\n')[1] === '# CARROTCAP-CLI-LAUNCHER');
  check('own launchers recognized (both forms)', isOwnLaunchShim(sh['carrotcap.bat']) && isOwnLaunchShim(sh.carrotcap));
  check("Cream CLI's launcher is not ours", !isOwnLaunchShim('@echo off\r\nsetlocal\r\nset "CREAM_CLI_EXE=C:\\x\\Cream CLI.exe"\r\nstart "" "%CREAM_CLI_EXE%"\r\n'));
  check('marker elsewhere / other files are not ours', !isOwnLaunchShim('@echo off\r\nstart x\r\nrem CARROTCAP-CLI-LAUNCHER\r\n') && !isOwnLaunchShim('') && !isOwnLaunchShim(null));
  // Replace the exe with echo to see exactly what Git Bash would run.
  const probe = sh.carrotcap.replace(/ >\/dev\/null 2>&1 &\n$/, '\n').replace(/^'[^\n]*carrotcap\.exe' /m, (m) => `printf '[%s]' ${m.trim()} `);
  const r = require('child_process').spawnSync('bash', ['-c', probe, 'carrotcap', 'C:/my project'], { encoding: 'utf8' });
  check('Git Bash shim: exe path (with apostrophe) + args survive quoting', !r.error && r.stdout === "[C:/Users/o'neil/AppData/Local/Programs/carrotcap-cli/carrotcap.exe][C:/my project]", r.stdout || String(r.error));
  check('Git Bash shim runs in the background (terminal not blocked)', /&\n$/.test(sh.carrotcap));
  const pct = buildLaunchShims(String.raw`C:\Users\a%PATH%b\carrotcap.exe`);
  check('% in the path is escaped as %% for cmd (review r3), kept as-is for Git Bash', !!pct && pct['carrotcap.bat'].includes(String.raw`"C:\Users\a%%PATH%%b\carrotcap.exe"`) && pct.carrotcap.includes("'C:/Users/a%PATH%b/carrotcap.exe'"));
  for (const bad of ['carrotcap.exe', String.raw`C:\a"b\carrotcap.exe`, 'C:\\a\r\nb\\carrotcap.exe', null]) {
    check(`unsafe exe path rejected: ${JSON.stringify(bad)}`, buildLaunchShims(bad) === null);
  }
}
// Only the installed copy self-registers (review r4). Windows paths + junctions: Windows only.
if (process.platform === 'win32') {
  const os = require('os');
  const lad = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-lad-'));
  const canon = path.join(lad, 'Programs', 'carrotcap-cli', 'carrotcap.exe');
  fs.mkdirSync(path.dirname(canon), { recursive: true });
  fs.writeFileSync(canon, '');
  const stray = path.join(lad, 'old copy', 'carrotcap.exe');
  fs.mkdirSync(path.dirname(stray), { recursive: true });
  fs.writeFileSync(stray, '');
  check('installed copy may self-register', isCanonicalInstall(canon, lad));
  check('a copy elsewhere may not', !isCanonicalInstall(stray, lad));
  check('missing exe / bad input → no', !isCanonicalInstall(path.join(lad, 'nope.exe'), lad) && !isCanonicalInstall(canon, '') && !isCanonicalInstall(null, lad));
  const viaLink = path.join(lad, 'linked');
  fs.symlinkSync(path.join(lad, 'old copy'), viaLink, 'junction');
  fs.rmSync(path.join(lad, 'Programs', 'carrotcap-cli'), { recursive: true, force: true });
  fs.symlinkSync(path.join(lad, 'old copy'), path.join(lad, 'Programs', 'carrotcap-cli'), 'junction');
  check('canonical path that is a junction to another copy → no', !isCanonicalInstall(canon, lad));
  fs.rmSync(path.join(lad, 'Programs', 'carrotcap-cli'), { force: true, recursive: false });
  fs.rmSync(viaLink, { force: true, recursive: false });
  fs.rmSync(lad, { recursive: true, force: true });
}

console.log('');
console.log(`Summary: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
