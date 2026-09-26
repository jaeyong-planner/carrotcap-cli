// Unit tests for AOR/carrotcap/compress-hook.js (task-017) — no Claude, no Electron.
// The real engine is used when present (it is in the dev tree); a fake runner covers
// the failure paths. Usage: node scripts/test-compress-hook.js
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
const out = hook.decide(input('npm test'), {});
const res = out && out.hookSpecificOutput && out.hookSpecificOutput.updatedToolOutput;
check('large successful output is replaced', !!res && out.hookSpecificOutput.hookEventName === 'PostToolUse');
check('replacement keeps the Bash result shape', !!res && ['stdout', 'stderr', 'interrupted', 'isImage', 'noOutputExpected'].every((k) => k in res));
check('replacement is much smaller', !!res && res.stdout.length < big.length / 5, res && `${res.stdout.length} vs ${big.length}`);
check('engine summary present', !!res && res.stdout.includes('[Layer 1]'));
check('failure line kept verbatim', !!res && res.stdout.includes('FAIL  case 301 :: expected 2, got 3'));
check('raw log path given', !!res && /raw: .+\.log/.test(res.stdout));
check('small output untouched', hook.decide(input('npm test', { stdout: 'ok\n' }), {}) === null);
check('non-noisy command untouched', hook.decide(input('git log'), {}) === null);
check('background run untouched', hook.decide({ ...input('npm test'), tool_input: { command: 'npm test', run_in_background: true } }, {}) === null);
check('interrupted run untouched', hook.decide(input('npm test', { interrupted: true }), {}) === null);
check('other tools untouched', hook.decide({ ...input('npm test'), tool_name: 'Read' }, {}) === null);
check('PostToolUseFailure untouched', hook.decide({ ...input('npm test'), hook_event_name: 'PostToolUseFailure' }, {}) === null);
check('CARROTCAP_AOR_COMPRESS=0 turns it off', hook.decide(input('npm test'), { CARROTCAP_AOR_COMPRESS: '0' }) === null);
check('missing engine → untouched (fail-open)', hook.decide(input('npm test'), {}, { engine: path.join(os.tmpdir(), 'no-such-engine.exe') }) === null);
check('engine error → untouched', hook.decide(input('npm test'), {}, { run: () => ({ status: 1, stdout: '' }) }) === null);
check('odd engine output → untouched', hook.decide(input('npm test'), {}, { run: () => ({ status: 0, stdout: 'hello' }) }) === null);
check('engine throws → untouched', hook.decide(input('npm test'), {}, { run: () => { throw new Error('x'); } }) === null);
const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(`carrotcap-aor-${process.pid}-`)).length;
check('temp input file removed', before === 0);

console.log('-- as a process (stdin → stdout)');
const script = path.join(__dirname, '..', 'AOR', 'carrotcap', 'compress-hook.js');
const r1 = spawnSync(process.execPath, [script], { input: JSON.stringify(input('npm test')), encoding: 'utf8', env: { ...process.env, CARROTCAP_AOR_COMPRESS: '' } });
check('prints JSON for a noisy run', r1.status === 0 && JSON.parse(r1.stdout).hookSpecificOutput.updatedToolOutput.stdout.includes('[Layer 1]'));
const r2 = spawnSync(process.execPath, [script], { input: 'not json', encoding: 'utf8' });
check('garbage stdin → exit 0, no output', r2.status === 0 && r2.stdout === '');
const r3 = spawnSync(process.execPath, [script], { input: JSON.stringify(input('git status')), encoding: 'utf8' });
check('non-noisy → exit 0, no output', r3.status === 0 && r3.stdout === '');

console.log('');
console.log(`Summary: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
