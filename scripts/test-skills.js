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

console.log('');
console.log(`Summary: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
