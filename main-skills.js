// CARROTCAP CLI — project skills setup (task-023), main-process side.
// Installs a chosen set of Claude Code plugins for ONE project (scope "project") from the
// official Anthropic marketplace, records what was set up in <project>/.carrotcap/skills.json
// and adds usage rules to the project's CLAUDE.md so the agent applies them.
//
// Nothing is installed without the user choosing it in the app: the renderer shows the
// catalog — maker, source, pinned version/commit and what each plugin contains (skills,
// commands, agents, hooks and the commands they run, MCP servers) read from the local
// marketplace copy — and sends the ids the user ticked. Only catalog ids are accepted; the
// commands are built from constants, never from renderer text.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

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
// Presets pick Anthropic plugins only; third-party ones (superpowers, playwright) must be
// ticked by hand and confirmed after reading what they contain (review task-023 r1).
const PRESETS = {
  web: { label: '웹 개발', ids: ['code-review', 'feature-dev', 'security-guidance', 'frontend-design'] },
  backend: { label: '백엔드·API', ids: ['code-review', 'feature-dev', 'security-guidance', 'pr-review-toolkit'] },
  docs: { label: '문서·기획', ids: ['claude-md-management', 'skill-creator'] },
};

// Only catalog ids, each once, in catalog order.
function sanitizeSkillIds(ids) {
  const want = new Set(Array.isArray(ids) ? ids.filter((i) => typeof i === 'string' && SKILL_IDS.has(i)) : []);
  return SKILL_CATALOG.map((s) => s.id).filter((id) => want.has(id));
}

// The CLAUDE.md block for the installed ids (LF; mergeSkillsBlock adapts line endings).
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

// Insert or replace the block, leaving the rest of CLAUDE.md untouched and keeping the
// file's line endings (review r1).
function mergeSkillsBlock(current, rawBlock) {
  const text = typeof current === 'string' ? current : '';
  const crlf = /\r\n/.test(text);
  const eol = crlf ? '\r\n' : '\n';
  const block = crlf ? rawBlock.replace(/\r?\n/g, '\r\n') : rawBlock;
  const i = text.indexOf(SKILLS_BLOCK_START);
  const j = text.indexOf(SKILLS_BLOCK_END);
  if (i >= 0 && j > i) {
    let after = j + SKILLS_BLOCK_END.length;
    if (text[after] === '\r') after++;
    if (text[after] === '\n') after++;
    return text.slice(0, i) + block + text.slice(after);
  }
  return (text ? text.replace(/\s*$/, eol + eol) : '') + block;
}

// argv for one `claude plugin ...` call — constants and catalog ids only.
function installArgs(id) { return ['plugin', 'install', `${id}@${MARKETPLACE}`, '--scope', 'project']; }
function marketplaceAddArgs() { return ['plugin', 'marketplace', 'add', MARKETPLACE_SOURCE, '--scope', 'project']; }

// ---- what a plugin contains, from the local marketplace copy (review r1) ----
function claudeConfigDir(env = process.env) {
  return (env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR.trim()) || path.join(os.homedir(), '.claude');
}
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function countFiles(dir, re) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => re.test(d.name)).length; } catch { return 0; }
}
function gitHead(dir) {
  try {
    const head = fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8').trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head;
    const ref = /^ref: (.+)$/.exec(head);
    if (!ref) return null;
    const loose = path.join(dir, '.git', ...ref[1].split('/'));
    if (fs.existsSync(loose)) return fs.readFileSync(loose, 'utf8').trim();
    const packed = fs.readFileSync(path.join(dir, '.git', 'packed-refs'), 'utf8');
    const m = packed.split('\n').find((l) => l.endsWith(' ' + ref[1]));
    return m ? m.split(' ')[0] : null;
  } catch { return null; }
}
const short = (s, n = 140) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
// { version, pinned, remote, components: [..], hooks: [{event, command}], mcp: [{name, command}] }
function inspectPlugin(id, configDir = claudeConfigDir()) {
  const mdir = path.join(configDir, 'plugins', 'marketplaces', MARKETPLACE);
  const market = readJson(path.join(mdir, '.claude-plugin', 'marketplace.json'));
  const entry = market && Array.isArray(market.plugins) ? market.plugins.find((p) => p && p.name === id) : null;
  if (!entry) return { available: false, note: '로컬 마켓플레이스 정보 없음 — 설치 때 받아 옵니다' };
  const out = { available: true, components: [], hooks: [], mcp: [] };
  if (entry.source && typeof entry.source === 'object') {
    out.remote = entry.source.url || entry.source.repo || '';
    out.pinned = entry.source.sha || entry.source.ref || null;
    out.note = out.pinned ? '외부 저장소의 고정된 커밋을 설치 — 구성은 설치 전에 저장소에서 확인' : '외부 저장소 — 구성은 설치 전에 저장소에서 확인';
    return out;
  }
  if (typeof entry.source !== 'string' || !/^\.\//.test(entry.source)) return out;
  const pdir = path.join(mdir, ...entry.source.slice(2).split('/'));
  const manifest = readJson(path.join(pdir, '.claude-plugin', 'plugin.json')) || {};
  out.version = manifest.version || entry.version || null;
  out.pinned = gitHead(mdir); // marketplace commit the files come from
  let skills = 0;
  try {
    for (const d of fs.readdirSync(path.join(pdir, 'skills'), { withFileTypes: true })) {
      if (d.isDirectory() && fs.existsSync(path.join(pdir, 'skills', d.name, 'SKILL.md'))) skills++;
    }
  } catch { /* none */ }
  const commands = countFiles(path.join(pdir, 'commands'), /\.md$/i);
  const agents = countFiles(path.join(pdir, 'agents'), /\.md$/i);
  const hooksCfg = readJson(path.join(pdir, 'hooks', 'hooks.json'));
  if (hooksCfg && hooksCfg.hooks && typeof hooksCfg.hooks === 'object') {
    for (const [event, groups] of Object.entries(hooksCfg.hooks)) {
      for (const g of Array.isArray(groups) ? groups : []) {
        for (const h of (g && Array.isArray(g.hooks)) ? g.hooks : []) {
          if (h && typeof h.command === 'string') out.hooks.push({ event, command: short(h.command) });
        }
      }
    }
  }
  const mcpCfg = readJson(path.join(pdir, '.mcp.json'));
  const servers = mcpCfg && (mcpCfg.mcpServers || mcpCfg);
  if (servers && typeof servers === 'object') {
    for (const [name, v] of Object.entries(servers)) {
      if (v && typeof v === 'object' && typeof v.command === 'string') {
        out.mcp.push({ name, command: short([v.command, ...(Array.isArray(v.args) ? v.args : [])].join(' ')) });
      }
    }
  }
  if (skills) out.components.push(`스킬 ${skills}`);
  if (commands) out.components.push(`명령 ${commands}`);
  if (agents) out.components.push(`에이전트 ${agents}`);
  if (out.hooks.length) out.components.push(`훅 ${out.hooks.length}개 (명령 실행)`);
  if (out.mcp.length) out.components.push(`MCP 서버 ${out.mcp.length}개 (프로그램 실행)`);
  return out;
}

function setupSkills(deps) {
  const {
    handle, getWindow, loadSettings, resolveAllowedDir, safeRealpath, isPathInsideRoot,
    assertAncestorsClean, safeMkdir, isAllowedCliCommand, findCommand, taskkillPath,
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
  // Write <root>/<rel> only if it stays a plain, singly linked file inside the project.
  function writeInside(root, rel, text) {
    const file = path.join(root, rel);
    if (fs.existsSync(file)) {
      const lst = fs.lstatSync(file);
      if (lst.isSymbolicLink() || !lst.isFile()) throw new Error(`${rel} is not a plain file`);
      if (lst.nlink > 1) throw new Error(`${rel} is hard-linked elsewhere`);
    }
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
  function killTree(child) {
    // On Windows a .cmd runs under cmd.exe: kill the whole tree so the real claude stops too.
    if (process.platform === 'win32' && child.pid) {
      execFile(taskkillPath(), ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      try { child.kill('SIGKILL'); } catch { /* gone */ }
    }
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
      // resolve only on close, so a timed-out install is really gone before the next one
      const t = setTimeout(() => { add('\n(시간 초과)'); killTree(child); }, INSTALL_TIMEOUT_MS);
      child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: String(e.message) }); });
      child.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
    });
  }

  handle('skills:catalog', () => {
    const configDir = claudeConfigDir();
    return {
      marketplace: MARKETPLACE,
      catalog: SKILL_CATALOG.map(({ id, maker, thirdParty, source, desc }) => ({
        id, maker, thirdParty: !!thirdParty, source, desc, inspect: inspectPlugin(id, configDir),
      })),
      presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { label: v.label, ids: v.ids.slice() }])),
    };
  });
  handle('skills:status', (_e, projectRoot) => {
    const root = resolveAllowedDir(projectRoot);
    return root ? readState(root) : null;
  });
  // The user chose "don't ask again" for this project.
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
    // third-party entries need the explicit confirmation the window asks for
    const third = ids.filter((id) => SKILL_CATALOG.find((s) => s.id === id).thirdParty);
    if (third.length && p.confirmThirdParty !== true) return { ok: false, error: `외부 제작 항목(${third.join(', ')})은 출처·동작 확인에 동의해야 설치됩니다` };
    if (running) return { ok: false, error: '이미 설치 중입니다' };
    const exe = claudeCommand();
    if (!exe) return { ok: false, error: 'claude CLI를 찾을 수 없습니다 (settings.json의 cli.claude 확인)' };
    running = true;
    try {
      // The official marketplace is built in; add it (project scope) only if this machine does not know it.
      const list = await run(exe, ['plugin', 'marketplace', 'list'], root);
      if (!new RegExp(`\\b${MARKETPLACE}\\b`).test(list.out)) {
        send({ id: '(marketplace)', status: 'running' });
        const m = await run(exe, marketplaceAddArgs(), root);
        send({ id: '(marketplace)', status: m.code === 0 ? 'ok' : 'fail', out: m.out.slice(-400) });
        if (m.code !== 0) return { ok: false, error: '공식 마켓플레이스를 추가하지 못했습니다', results: [] };
      }
      const results = [];
      for (const id of ids) {
        send({ id, status: 'running' });
        const r = await run(exe, installArgs(id), root);
        const ok = r.code === 0 || /already installed/i.test(r.out); // already installed counts
        results.push({ id, ok, out: r.out.slice(-400) });
        send({ id, status: ok ? 'ok' : 'fail', out: r.out.slice(-400) });
      }
      const prev = readState(root) || {};
      const all = sanitizeSkillIds([...(Array.isArray(prev.installed) ? prev.installed : []), ...results.filter((r) => r.ok).map((r) => r.id)]);
      // Rules first; if they cannot be written, remember it so START offers the setup again.
      let rulesError = null;
      if (all.length) {
        try {
          let current = '';
          try { current = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'); } catch { /* new file */ }
          writeInside(root, 'CLAUDE.md', mergeSkillsBlock(current, buildSkillsBlock(all)));
        } catch (e) { rulesError = e.message; }
      }
      writeState(root, { installed: all, marketplace: MARKETPLACE, at: new Date().toISOString(), ...(rulesError ? { rulesPending: true } : {}) });
      if (rulesError) return { ok: false, results, installed: all, error: `설치는 했지만 CLAUDE.md에 규칙을 쓰지 못했습니다 (${rulesError})` };
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
  sanitizeSkillIds, buildSkillsBlock, mergeSkillsBlock, installArgs, marketplaceAddArgs, inspectPlugin,
};
