// Unit tests for AOR/carrotcap/compress-hook.js (task-017) — no Claude, no Electron, no
// engine binary (a fake engine stands in; the real one is exercised by test:aor).
// Usage: node scripts/test-compress-hook.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const hook = require('../AOR/carrotcap/compress-hook.js');

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else      { console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail++; }
}

const big = Array.from({ length: 300 }, (_, i) => `  PASS  case ${i} works as expected with some padding text`).join('\n') +
  '\n  FAIL  case 301 :: expected 2, got 3\nSummary: 300 passed, 1 failed\n';
const input = (command, response = {}, extra = {}) => ({
  hook_event_name: 'PostToolUse', tool_name: 'Bash', cwd: process.cwd(),
  tool_input: { command, description: 'd' },
  tool_response: { stdout: big, stderr: '', interrupted: false, isImage: false, noOutputExpected: false, ...response },
  ...extra,
});

// Fake engine: a placeholder file (it only has to exist) + a runner that answers like
// aor-engine-win.exe and records what it was given.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hook-'));
const fakeEngine = path.join(tmpDir, 'engine.exe');
fs.writeFileSync(fakeEngine, '');
const engineCalls = [];
const ENGINE_REPLY = [
  '[Layer 1] Summary', 'command: npm test', 'headline: Summary: 300 passed, 1 failed', '',
  '[Layer 3] Evidence', String.raw`raw: C:\x\raw\2026-09-26T00-00-00-000Z-abcdef.log`, '',
].join('\n');
const fakeRun = (bin, args) => {
  const file = args[args.indexOf('--input') + 1];
  engineCalls.push({ bin, args, file, input: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null });
  return { status: 0, stdout: ENGINE_REPLY };
};
const fake = { engine: fakeEngine, run: fakeRun };

console.log('-- which commands are summarized');
for (const c of ['npm test', 'npm run build', 'npm run test:unit', 'pnpm install', 'npx tsc --noEmit', 'pytest -q',
  'python -m pytest tests', 'cargo test', 'go test ./...', 'dotnet build', 'cd app && npm test', 'cd "my app" && npm ci',
  'npm test 2>&1', 'vitest run']) {
  check(`noisy: ${c}`, hook.isNoisyCommand(c));
}
for (const c of ['npm run dev', 'npm start', 'git diff', 'cat package.json', 'npm test | tail -20', 'npm test > out.txt',
  'npm test; rm -rf x', 'echo $(npm test)', 'vitest', 'ls', '', 'npm test\nrm x', 'x'.repeat(3000)]) {
  check(`left alone: ${JSON.stringify(c.slice(0, 30))}`, !hook.isNoisyCommand(c));
}

console.log('-- decide()');
const out = hook.decide(input('npm test'), {}, fake);
const res = out && out.hookSpecificOutput && out.hookSpecificOutput.updatedToolOutput;
check('large successful output is replaced', !!res && out.hookSpecificOutput.hookEventName === 'PostToolUse');
check('replacement keeps the Bash result shape', !!res && ['stdout', 'stderr', 'interrupted', 'isImage', 'noOutputExpected'].every((k) => k in res));
check('replacement is much smaller', !!res && res.stdout.length < big.length / 5, res && `${res.stdout.length} vs ${big.length}`);
check('engine summary present', !!res && res.stdout.includes('[Layer 1]'));
check('engine got the whole output and the command label', engineCalls.length === 1 && engineCalls[0].input === big && engineCalls[0].args.includes('npm test'));
check("engine's input file removed afterwards", engineCalls.length === 1 && !fs.existsSync(engineCalls[0].file));
check('failure line kept verbatim', !!res && res.stdout.includes('FAIL  case 301 :: expected 2, got 3'));
check('raw log path given', !!res && /raw: .+\.log/.test(res.stdout));
check('small output untouched', hook.decide(input('npm test', { stdout: 'ok\n' }), {}, fake) === null);
check('non-noisy command untouched', hook.decide(input('git log'), {}, fake) === null);
check('background run untouched', hook.decide({ ...input('npm test'), tool_input: { command: 'npm test', run_in_background: true } }, {}, fake) === null);
check('interrupted run untouched', hook.decide(input('npm test', { interrupted: true }), {}, fake) === null);
check('other tools untouched', hook.decide({ ...input('npm test'), tool_name: 'Read' }, {}, fake) === null);
check('PostToolUseFailure untouched', hook.decide({ ...input('npm test'), hook_event_name: 'PostToolUseFailure' }, {}, fake) === null);
check('CARROTCAP_AOR_COMPRESS=0 turns it off', hook.decide(input('npm test'), { CARROTCAP_AOR_COMPRESS: '0' }, fake) === null);
check('missing engine → untouched (fail-open)', hook.decide(input('npm test'), {}, { engine: path.join(tmpDir, 'no-such-engine.exe'), run: fakeRun }) === null);
check('engine error → untouched', hook.decide(input('npm test'), {}, { engine: fakeEngine, run: () => ({ status: 1, stdout: '' }) }) === null);
check('odd engine output → untouched', hook.decide(input('npm test'), {}, { engine: fakeEngine, run: () => ({ status: 0, stdout: 'hello' }) }) === null);
check('engine throws → untouched', hook.decide(input('npm test'), {}, { engine: fakeEngine, run: () => { throw new Error('x'); } }) === null);
const leftovers = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(`carrotcap-aor-${process.pid}-`));
check('no temp input files left behind', leftovers.length === 0, leftovers.join(','));

console.log('-- as a process (stdin → stdout)');
const script = path.join(__dirname, '..', 'AOR', 'carrotcap', 'compress-hook.js');
const r1 = spawnSync(process.execPath, [script], { input: JSON.stringify(input('npm test')), encoding: 'utf8', env: { ...process.env, CARROTCAP_AOR_COMPRESS: '0' } });
check('switched off → exit 0, no output', r1.status === 0 && r1.stdout === '');
const r2 = spawnSync(process.execPath, [script], { input: 'not json', encoding: 'utf8' });
check('garbage stdin → exit 0, no output', r2.status === 0 && r2.stdout === '');
const r3 = spawnSync(process.execPath, [script], { input: JSON.stringify(input('git status')), encoding: 'utf8' });
check('non-noisy → exit 0, no output', r3.status === 0 && r3.stdout === '');

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('');
console.log(`Summary: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
