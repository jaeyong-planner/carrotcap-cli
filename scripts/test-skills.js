// Unit tests for main-skills.js pure parts (task-023). Usage: node scripts/test-skills.js
'use strict';
const sk = require('../main-skills.js');

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else      { console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`); fail++; }
}

console.log('-- catalog');
check('ids are unique and plain', new Set(sk.SKILL_CATALOG.map((s) => s.id)).size === sk.SKILL_CATALOG.length && sk.SKILL_CATALOG.every((s) => /^[a-z0-9-]+$/.test(s.id)));
check('every entry says who made it, where it comes from and what it does', sk.SKILL_CATALOG.every((s) => s.maker && s.source && s.desc && s.rule));
check('non-Anthropic makers are flagged third-party', sk.SKILL_CATALOG.filter((s) => !/^Anthropic$/.test(s.maker)).every((s) => s.thirdParty === true));
check('presets only use catalog ids', Object.values(sk.PRESETS).every((p) => p.ids.every((id) => sk.SKILL_CATALOG.some((s) => s.id === id))));
check('the web preset has the Anthropic dev set', ['code-review', 'feature-dev', 'security-guidance', 'frontend-design'].every((id) => sk.PRESETS.web.ids.includes(id)));
check('presets never pick third-party plugins (need a deliberate tick + consent)', Object.values(sk.PRESETS).every((p) => p.ids.every((id) => !sk.SKILL_CATALOG.find((s) => s.id === id).thirdParty)));
check('marketplace fallback is project-scoped', JSON.stringify(sk.marketplaceAddArgs()) === JSON.stringify(['plugin', 'marketplace', 'add', 'anthropics/claude-plugins-official', '--scope', 'project']));

console.log('-- ids from the renderer');
check('unknown / non-string / duplicate ids dropped, catalog order', JSON.stringify(sk.sanitizeSkillIds(['code-review', 'evil; rm -rf', 7, 'superpowers', 'code-review', '__proto__'])) === JSON.stringify(['superpowers', 'code-review']));
check('not an array → none', sk.sanitizeSkillIds('superpowers').length === 0 && sk.sanitizeSkillIds(null).length === 0);
check('install argv is fixed tokens + the id', JSON.stringify(sk.installArgs('code-review')) === JSON.stringify(['plugin', 'install', 'code-review@claude-plugins-official', '--scope', 'project']));

console.log('-- CLAUDE.md block');
const block = sk.buildSkillsBlock(['code-review', 'superpowers', 'bogus']);
check('block is marked and lists the installed plugins', block.startsWith(sk.SKILLS_BLOCK_START) && block.trimEnd().endsWith(sk.SKILLS_BLOCK_END) && /superpowers, code-review/.test(block));
check('one rule per installed plugin, none for others', /\/code-review/.test(block) && /systematic-debugging/.test(block) && !/frontend-design/.test(block) && !/bogus/.test(block));
const user = '# My project\n\nOwn rules here.\n';
const once = sk.mergeSkillsBlock(user, block);
check('added after the user text, which stays', once.startsWith('# My project\n\nOwn rules here.\n\n') && once.includes(sk.SKILLS_BLOCK_START));
const again = sk.mergeSkillsBlock(once + '\n## later section\n', sk.buildSkillsBlock(['feature-dev']));
check('re-run replaces the block (no duplicate), keeps text around it', again.split(sk.SKILLS_BLOCK_START).length === 2 && /feature-dev/.test(again) && !/\/code-review/.test(again) && again.includes('Own rules here.') && again.includes('## later section'));
check('empty/new CLAUDE.md gets just the block', sk.mergeSkillsBlock('', block) === block && sk.mergeSkillsBlock(undefined, block) === block);
const crlf = sk.mergeSkillsBlock(once.replace(/\n/g, '\r\n'), block);
check('CRLF file: block replaced once', crlf.split(sk.SKILLS_BLOCK_START).length === 2);
check('CRLF file stays CRLF everywhere (no bare LF)', !/(^|[^\r])\n/.test(crlf) && !/(^|[^\r])\n/.test(sk.mergeSkillsBlock('# A\r\nB\r\n', block)));
check('LF file stays LF', !/\r/.test(sk.mergeSkillsBlock('# A\nB\n', block)));

console.log('-- what a plugin contains (local marketplace copy)');
{
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-mk-'));
  const md = path.join(cfg, 'plugins', 'marketplaces', 'claude-plugins-official');
  const mk = (rel, text) => { fs.mkdirSync(path.dirname(path.join(md, rel)), { recursive: true }); fs.writeFileSync(path.join(md, rel), text); };
  mk('.claude-plugin/marketplace.json', JSON.stringify({ name: 'claude-plugins-official', plugins: [
    { name: 'code-review', source: './plugins/code-review' },
    { name: 'security-guidance', source: './plugins/security-guidance' },
    { name: 'playwright', source: './external_plugins/playwright' },
    { name: 'superpowers', source: { source: 'url', url: 'https://github.com/obra/superpowers.git', sha: '896224c4b1879920ab573417e68fd51d2ccc9072' } },
  ] }));
  mk('plugins/code-review/.claude-plugin/plugin.json', '{"name":"code-review","version":"1.2.0"}');
  mk('plugins/code-review/commands/code-review.md', '# cmd');
  mk('plugins/code-review/skills/review/SKILL.md', '# skill');
  mk('plugins/security-guidance/.claude-plugin/plugin.json', '{"name":"security-guidance"}');
  mk('plugins/security-guidance/hooks/hooks.json', JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'bash run.sh' }] }], PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'python3 check.py' }] }] } }));
  mk('external_plugins/playwright/.mcp.json', JSON.stringify({ playwright: { command: 'npx', args: ['@playwright/mcp@latest'] } }));
  const cr = sk.inspectPlugin('code-review', cfg);
  check('counts skills and commands, reads the version', cr.version === '1.2.0' && cr.components.includes('스킬 1') && cr.components.includes('명령 1'), JSON.stringify(cr));
  const sg = sk.inspectPlugin('security-guidance', cfg);
  check('lists every hook with the command it runs', sg.hooks.length === 2 && sg.hooks.some((h) => h.event === 'PostToolUse' && h.command === 'python3 check.py'), JSON.stringify(sg.hooks));
  const pw = sk.inspectPlugin('playwright', cfg);
  check('shows the MCP server command', pw.mcp.length === 1 && pw.mcp[0].command === 'npx @playwright/mcp@latest');
  const sp = sk.inspectPlugin('superpowers', cfg);
  check('remote plugin: repository and pinned commit', /obra\/superpowers/.test(sp.remote) && sp.pinned === '896224c4b1879920ab573417e68fd51d2ccc9072');
  check('no local copy → says so instead of guessing', sk.inspectPlugin('code-review', path.join(cfg, 'nope')).available === false);
  fs.rmSync(cfg, { recursive: true, force: true });
}

(async () => {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  console.log('-- remote plugin: pinned commit read from GitHub before consent (review r2)');
  const sha = '896224c4b1879920ab573417e68fd51d2ccc9072';
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-rm-'));
  const md = path.join(cfg, 'plugins', 'marketplaces', 'claude-plugins-official', '.claude-plugin');
  fs.mkdirSync(md, { recursive: true });
  fs.writeFileSync(path.join(md, 'marketplace.json'), JSON.stringify({ name: 'claude-plugins-official', plugins: [
    { name: 'superpowers', source: { source: 'url', url: 'https://github.com/obra/superpowers.git', sha } },
    { name: 'playwright', source: { source: 'url', url: 'https://example.com/x.git', sha } },
  ] }));
  const files = {
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'superpowers', version: '5.0.0' }),
    'hooks/hooks.json': JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'bash ${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh' }] }] } }),
  };
  const seen = [];
  const fakeFetch = async (url) => {
    seen.push(url);
    if (url.startsWith('https://api.github.com/')) return JSON.stringify({ truncated: false, tree: [
      { type: 'blob', path: '.claude-plugin/plugin.json' }, { type: 'blob', path: 'hooks/hooks.json' }, { type: 'blob', path: 'hooks/session-start.sh' },
      { type: 'blob', path: 'skills/brainstorming/SKILL.md' }, { type: 'blob', path: 'skills/tdd/SKILL.md' }, { type: 'blob', path: 'commands/plan.md' },
      { type: 'blob', path: 'agents/reviewer.md' }, { type: 'blob', path: 'lib/helper.js' }, { type: 'tree', path: 'skills' },
    ] });
    const p = url.split(`/${sha}/`)[1];
    if (files[p]) return files[p];
    throw new Error('HTTP 404');
  };
  const r = await sk.inspectRemotePlugin('superpowers', { configDir: cfg, fetch: fakeFetch });
  check('reads the tree at the pinned commit only', seen[0] === `https://api.github.com/repos/obra/superpowers/git/trees/${sha}?recursive=1` && seen.slice(1).every((u) => u.includes(`/obra/superpowers/${sha}/`)), JSON.stringify(seen));
  check('counts skills, commands, agents and scripts', ['스킬 2', '명령 1', '에이전트 1', '실행 파일·스크립트 2개'].every((c) => r.components.includes(c)), JSON.stringify(r.components));
  check('lists the hook commands it runs', r.hooks.length === 1 && /session-start\.sh/.test(r.hooks[0].command) && r.components.includes('훅 1개 (명령 실행)'));
  check('marks the result as inspected with version and commit', r.inspected === true && r.pinned === sha && r.version === '5.0.0');
  let threw = '';
  try { await sk.inspectRemotePlugin('playwright', { configDir: cfg, fetch: fakeFetch }); } catch (e) { threw = e.message; }
  check('a non-GitHub source cannot be inspected (so it cannot be consented to)', /확인할 수 없습니다/.test(threw), threw);
  threw = '';
  try { await sk.inspectRemotePlugin('superpowers', { configDir: cfg, fetch: async () => JSON.stringify({ truncated: true, tree: [] }) }); } catch (e) { threw = e.message; }
  check('a truncated listing is refused', /너무 커서/.test(threw), threw);
  check('local copy flags remote plugins as needing the check', sk.inspectPlugin('superpowers', cfg).needsRemoteCheck === true);
  fs.rmSync(cfg, { recursive: true, force: true });

  if (process.platform === 'win32') {
    console.log('-- timeout kills the whole process tree (review r1/r2)');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-to-'));
    const marker = path.join(d, 'still-running.txt');
    const slow = path.join(d, 'slow claude.cmd');
    // the marker is written by a grandchild, like the real claude running under cmd.exe:
    // killing only the shell would leave it running
    fs.writeFileSync(slow, `@echo off\r\npowershell -NoProfile -Command "Start-Sleep -Seconds 4; Set-Content -LiteralPath '${marker}' late"\r\n`);
    const run = sk.makeRunner({ taskkillPath: () => path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), timeoutMs: 1200 });
    const t0 = Date.now();
    const res = await run(slow, ['plugin', 'install', 'x'], d);
    check('times out and reports it', res.timedOut === true && res.code === -1 && /시간 초과/.test(res.out) && Date.now() - t0 < 5000, JSON.stringify(res));
    await new Promise((ok) => setTimeout(ok, 6500));
    check('the child (not just cmd.exe) was stopped — its later step never ran', !fs.existsSync(marker));
    fs.rmSync(d, { recursive: true, force: true });
  }

  console.log('');
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
