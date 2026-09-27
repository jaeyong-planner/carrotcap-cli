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
check('the web preset matches the recommended set', ['superpowers', 'code-review', 'feature-dev', 'frontend-design', 'playwright'].every((id) => sk.PRESETS.web.ids.includes(id)));

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

console.log('');
console.log(`Summary: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
