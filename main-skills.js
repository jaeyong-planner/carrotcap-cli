// CARROTCAP CLI — project skills setup (task-023), main-process side.
// Installs a chosen set of Claude Code plugins for ONE project (scope "project") from the
// official Anthropic marketplace, records what was set up in <project>/.carrotcap/skills.json
// and adds usage rules to the project's CLAUDE.md so the agent applies them.
//
// Nothing is installed without the user choosing it in the app: the renderer shows the
// catalog (maker, source, what it does) and sends the ids the user ticked. Only catalog ids
// are accepted; the commands are built from constants, never from renderer text.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MARKETPLACE = 'claude-plugins-official';               // built into Claude Code
const MARKETPLACE_SOURCE = 'anthropics/claude-plugins-official';
const INSTALL_TIMEOUT_MS = 180000;
const SKILLS_BLOCK_START = '<!-- CARROTCAP:SKILLS:START -->';
const SKILLS_BLOCK_END = '<!-- CARROTCAP:SKILLS:END -->';

// `rule`: the line written to CLAUDE.md when the plugin is installed.
const SKILL_CATALOG = [
  { id: 'superpowers', maker: 'obra (외부 제작 · 공식 마켓 등록)', thirdParty: true, source: 'https://github.com/obra/superpowers',
    desc: '요구사항 구체화 → 작업 분해 → TDD → 체계적 디버깅 → 리뷰 흐름',
    rule: '새 기능·큰 변경은 superpowers 스킬 순서(brainstorming → writing-plans → test-driven-development)로 진행하고, 버그는 systematic-debugging으로 원인부터 찾는다.' },
  { id: 'code-review', maker: 'Anthropic', source: 'claude-plugins-official/plugins/code-review',
    desc: '커밋·PR 전 버그·보안·중복·테스트 점검 (여러 리뷰 에이전트)',
    rule: '커밋·PR 전에 /code-review로 점검하고 Critical/Major는 고친 뒤 올린다.' },
  { id: 'feature-dev', maker: 'Anthropic', source: 'claude-plugins-official/plugins/feature-dev',
    desc: '탐색 → 설계 → 구현 → 검토의 기능 개발 워크플로우',
    rule: '기능 단위 작업은 /feature-dev 워크플로우(코드 탐색 → 설계 → 구현 → 검토)를 따른다.' },
  { id: 'security-guidance', maker: 'Anthropic', source: 'claude-plugins-official/plugins/security-guidance',
    desc: '코드 편집 시 위험 패턴 경고 (훅)',
    rule: 'security-guidance 경고가 나오면 무시하지 말고 반영하거나 이유를 남긴다.' },
  { id: 'commit-commands', maker: 'Anthropic', source: 'claude-plugins-official/plugins/commit-commands',
    desc: '커밋·푸시·PR 명령 (/commit 등)',
    rule: '커밋은 /commit으로 만들고 메시지는 변경 이유 중심으로 쓴다.' },
  { id: 'frontend-design', maker: 'Anthropic', source: 'claude-plugins-official/plugins/frontend-design',
    desc: 'React·Next.js·Vue 화면·대시보드·반응형 UI 설계',
    rule: 'UI 작업은 frontend-design 스킬 기준(디자인 토큰·접근성·반응형)으로 만든다.' },
  { id: 'pr-review-toolkit', maker: 'Anthropic', source: 'claude-plugins-official/plugins/pr-review-toolkit',
    desc: 'PR 단위 리뷰 (주석·테스트·에러 처리·타입)',
    rule: 'PR 단위 변경은 pr-review-toolkit 에이전트로 테스트·에러 처리까지 확인한다.' },
  { id: 'playwright', maker: 'Microsoft (MCP 서버)', thirdParty: true, source: 'claude-plugins-official/external_plugins/playwright',
    desc: '브라우저 자동화·E2E 테스트 (실행 시 npx로 받아 옴)',
    rule: '화면 동작은 playwright MCP로 E2E 확인 후 완료라고 보고한다.' },
  { id: 'claude-md-management', maker: 'Anthropic', source: 'claude-plugins-official/plugins/claude-md-management',
    desc: 'CLAUDE.md 품질 점검·학습 내용 반영',
    rule: '작업에서 얻은 규칙·교훈은 claude-md-management로 CLAUDE.md에 반영한다.' },
  { id: 'skill-creator', maker: 'Anthropic', source: 'claude-plugins-official/plugins/skill-creator',
    desc: '반복 작업을 새 스킬로 만들고 개선',
    rule: '세 번 이상 반복되는 절차는 skill-creator로 프로젝트 스킬로 만든다.' },
];
const SKILL_IDS = new Set(SKILL_CATALOG.map((s) => s.id));
const PRESETS = {
  web: { label: '웹 개발', ids: ['superpowers', 'code-review', 'feature-dev', 'security-guidance', 'frontend-design', 'playwright'] },
  backend: { label: '백엔드·API', ids: ['superpowers', 'code-review', 'feature-dev', 'security-guidance', 'pr-review-toolkit'] },
  docs: { label: '문서·기획', ids: ['superpowers', 'claude-md-management', 'skill-creator'] },
};

// Only catalog ids, each once, in catalog order.
function sanitizeSkillIds(ids) {
  const want = new Set(Array.isArray(ids) ? ids.filter((i) => typeof i === 'string' && SKILL_IDS.has(i)) : []);
  return SKILL_CATALOG.map((s) => s.id).filter((id) => want.has(id));
}

// The CLAUDE.md block for the installed ids.
function buildSkillsBlock(ids) {
  const list = sanitizeSkillIds(ids);
  const lines = [
    SKILLS_BLOCK_START,
    '## 스킬 사용 규칙 (CARROTCAP이 설정 — 이 블록은 SKILLS 버튼으로 다시 만들어짐)',
    '',
    `설치된 Claude Code 플러그인 (프로젝트 범위, ${MARKETPLACE}): ${list.join(', ') || '없음'}`,
    '',
    ...SKILL_CATALOG.filter((s) => list.includes(s.id)).map((s) => `- ${s.rule}`),
    SKILLS_BLOCK_END,
  ];
  return lines.join('\n') + '\n';
}

// Insert or replace the block, leaving the rest of CLAUDE.md untouched.
function mergeSkillsBlock(current, block) {
  const text = typeof current === 'string' ? current : '';
  const i = text.indexOf(SKILLS_BLOCK_START);
  const j = text.indexOf(SKILLS_BLOCK_END);
  if (i >= 0 && j > i) {
    let after = j + SKILLS_BLOCK_END.length;
    if (text[after] === '\r') after++;
    if (text[after] === '\n') after++;
    return text.slice(0, i) + block + text.slice(after);
  }
  return (text ? text.replace(/\s*$/, '\n\n') : '') + block;
}

// argv for one `claude plugin ...` call — constants and catalog ids only.
function installArgs(id) { return ['plugin', 'install', `${id}@${MARKETPLACE}`, '--scope', 'project']; }

function setupSkills(deps) {
  const {
    handle, getWindow, loadSettings, resolveAllowedDir, safeRealpath, isPathInsideRoot,
    assertAncestorsClean, safeMkdir, isAllowedCliCommand, findCommand,
  } = deps;
  let running = false;

  const send = (payload) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send('skills:progress', payload);
  };
  const statePath = (root) => path.join(root, '.carrotcap', 'skills.json');
  function readState(root) {
    try {
      const p = statePath(root);
      if (!fs.lstatSync(p).isFile()) return null;
      const v = JSON.parse(fs.readFileSync(p, 'utf8'));
      return v && typeof v === 'object' ? v : null;
    } catch { return null; }
  }
  // Write <root>/<rel> only if it stays a plain file inside the project.
  function writeInside(root, rel, text) {
    const file = path.join(root, rel);
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error(`${rel} is a link`);
    assertAncestorsClean(file, root);
    fs.writeFileSync(file, text, 'utf8');
    const real = safeRealpath(file);
    if (!real || !isPathInsideRoot(real, root)) throw new Error(`${rel} escaped the project`);
  }
  function writeState(root, state) {
    safeMkdir(path.join(root, '.carrotcap'), root);
    writeInside(root, path.join('.carrotcap', 'skills.json'), JSON.stringify(state, null, 2));
  }
  function claudeCommand() {
    const s = loadSettings() || {};
    const cmd = s.cli && s.cli.claude && typeof s.cli.claude.command === 'string' ? s.cli.claude.command : 'claude';
    if (!isAllowedCliCommand(cmd)) return null;
    return path.isAbsolute(cmd) ? cmd : findCommand(cmd);
  }
  function run(exe, args, cwd) {
    return new Promise((resolve) => {
      // .cmd/.bat need a shell on Windows; every argument is a fixed token (no quoting needed)
      const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe);
      const child = viaShell
        ? spawn(`"${exe}" ${args.join(' ')}`, { cwd, shell: true, windowsHide: true })
        : spawn(exe, args, { cwd, windowsHide: true });
      let out = '';
      const add = (d) => { out = (out + d).slice(-4000); };
      child.stdout.on('data', add);
      child.stderr.on('data', add);
      const t = setTimeout(() => { try { child.kill(); } catch { /* gone */ } add('\n(시간 초과)'); }, INSTALL_TIMEOUT_MS);
      child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: String(e.message) }); });
      child.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
    });
  }

  handle('skills:catalog', () => ({
    marketplace: MARKETPLACE,
    catalog: SKILL_CATALOG.map(({ id, maker, thirdParty, source, desc }) => ({ id, maker, thirdParty: !!thirdParty, source, desc })),
    presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { label: v.label, ids: v.ids.slice() }])),
  }));
  handle('skills:status', (_e, projectRoot) => {
    const root = resolveAllowedDir(projectRoot);
    return root ? readState(root) : null;
  });
  // The user chose "not now / don't ask again" for this project.
  handle('skills:skip', (_e, projectRoot) => {
    const root = resolveAllowedDir(projectRoot);
    if (!root) return false;
    try { writeState(root, { ...(readState(root) || {}), skipped: true, at: new Date().toISOString() }); return true; }
    catch (e) { console.warn('[carrotcap] skills skip failed:', e.message); return false; }
  });
  handle('skills:install', async (_e, payload) => {
    const p = (payload && typeof payload === 'object') ? payload : {};
    const root = resolveAllowedDir(p.projectRoot);
    if (!root) return { ok: false, error: '프로젝트 폴더를 먼저 선택하세요' };
    const ids = sanitizeSkillIds(p.ids);
    if (!ids.length) return { ok: false, error: '설치할 스킬을 고르세요' };
    if (running) return { ok: false, error: '이미 설치 중입니다' };
    const exe = claudeCommand();
    if (!exe) return { ok: false, error: 'claude CLI를 찾을 수 없습니다 (settings.json의 cli.claude 확인)' };
    running = true;
    try {
      // The official marketplace is built in; add it only if this machine does not know it.
      const list = await run(exe, ['plugin', 'marketplace', 'list'], root);
      if (!new RegExp(`\\b${MARKETPLACE}\\b`).test(list.out)) {
        send({ id: '(marketplace)', status: 'running' });
        const m = await run(exe, ['plugin', 'marketplace', 'add', MARKETPLACE_SOURCE], root);
        send({ id: '(marketplace)', status: m.code === 0 ? 'ok' : 'fail', out: m.out.slice(-400) });
        if (m.code !== 0) return { ok: false, error: '공식 마켓플레이스를 추가하지 못했습니다', results: [] };
      }
      const results = [];
      for (const id of ids) {
        send({ id, status: 'running' });
        const r = await run(exe, installArgs(id), root);
        // already installed counts as success
        const ok = r.code === 0 || /already installed/i.test(r.out);
        results.push({ id, ok, out: r.out.slice(-400) });
        send({ id, status: ok ? 'ok' : 'fail', out: r.out.slice(-400) });
      }
      const installed = results.filter((r) => r.ok).map((r) => r.id);
      const prev = readState(root) || {};
      const all = sanitizeSkillIds([...(Array.isArray(prev.installed) ? prev.installed : []), ...installed]);
      writeState(root, { installed: all, marketplace: MARKETPLACE, at: new Date().toISOString() });
      if (all.length) {
        let current = '';
        const claudeMd = path.join(root, 'CLAUDE.md');
        try { current = fs.readFileSync(claudeMd, 'utf8'); } catch { /* new file */ }
        writeInside(root, 'CLAUDE.md', mergeSkillsBlock(current, buildSkillsBlock(all)));
      }
      return { ok: results.every((r) => r.ok), results, installed: all };
    } catch (e) {
      console.warn('[carrotcap] skills install failed:', e.message);
      return { ok: false, error: e.message };
    } finally {
      running = false;
    }
  });
}

module.exports = {
  setupSkills, SKILL_CATALOG, PRESETS, MARKETPLACE, SKILLS_BLOCK_START, SKILLS_BLOCK_END,
  sanitizeSkillIds, buildSkillsBlock, mergeSkillsBlock, installArgs,
};
