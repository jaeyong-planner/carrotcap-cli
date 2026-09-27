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
// hooks.json-style object → [{ event, command }]
function parseHooks(cfg) {
  const out = [];
  const hooks = cfg && typeof cfg === 'object' ? (cfg.hooks && typeof cfg.hooks === 'object' ? cfg.hooks : cfg) : null;
  if (!hooks || typeof hooks !== 'object') return out;
  for (const [event, groups] of Object.entries(hooks)) {
    for (const g of Array.isArray(groups) ? groups : []) {
      for (const h of (g && Array.isArray(g.hooks)) ? g.hooks : []) {
        if (h && typeof h.command === 'string') out.push({ event, command: short(h.command) });
      }
    }
  }
  return out;
}
// .mcp.json-style object → [{ name, command }]
function parseMcp(cfg) {
  const out = [];
  const servers = cfg && typeof cfg === 'object' ? (cfg.mcpServers && typeof cfg.mcpServers === 'object' ? cfg.mcpServers : cfg) : null;
  if (!servers || typeof servers !== 'object') return out;
  for (const [name, v] of Object.entries(servers)) {
    if (v && typeof v === 'object' && (typeof v.command === 'string' || typeof v.url === 'string')) {
      out.push({ name, command: short(typeof v.command === 'string' ? [v.command, ...(Array.isArray(v.args) ? v.args : [])].join(' ') : `원격 ${v.url}`) });
    }
  }
  return out;
}
function summarize(out, counts) {
  out.components = [];
  if (counts.skills) out.components.push(`스킬 ${counts.skills}`);
  if (counts.commands) out.components.push(`명령 ${counts.commands}`);
  if (counts.agents) out.components.push(`에이전트 ${counts.agents}`);
  if (out.hooks.length) out.components.push(`훅 ${out.hooks.length}개 (명령 실행)`);
  if (out.mcp.length) out.components.push(`MCP 서버 ${out.mcp.length}개 (프로그램 실행)`);
  if (counts.scripts) out.components.push(`실행 파일·스크립트 ${counts.scripts}개`);
  return out;
}
function marketEntry(id, configDir) {
  const mdir = path.join(configDir, 'plugins', 'marketplaces', MARKETPLACE);
  const market = readJson(path.join(mdir, '.claude-plugin', 'marketplace.json'));
  const entry = market && Array.isArray(market.plugins) ? market.plugins.find((p) => p && p.name === id) : null;
  return { mdir, entry };
}
// { available, version, pinned, remote, needsRemoteCheck, components, hooks, mcp }
function inspectPlugin(id, configDir = claudeConfigDir()) {
  const { mdir, entry } = marketEntry(id, configDir);
  if (!entry) return { available: false, note: '로컬 마켓플레이스 정보 없음 — 설치 때 받아 옵니다' };
  const out = { available: true, components: [], hooks: [], mcp: [] };
  if (entry.source && typeof entry.source === 'object') {
    out.remote = entry.source.url || entry.source.repo || '';
    out.pinned = entry.source.sha || entry.source.ref || null;
    out.needsRemoteCheck = true; // contents live in another repository: fetch them before consenting
    out.note = '외부 저장소 — "구성 불러오기"로 고정 커밋의 내용을 확인한 뒤 설치할 수 있습니다';
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
  out.hooks = [...parseHooks(readJson(path.join(pdir, 'hooks', 'hooks.json'))), ...parseHooks(manifest.hooks && typeof manifest.hooks === 'object' ? manifest.hooks : null)];
  out.mcp = [...parseMcp(readJson(path.join(pdir, '.mcp.json'))), ...parseMcp(manifest.mcpServers && typeof manifest.mcpServers === 'object' ? manifest.mcpServers : null)];
  return summarize(out, {
    skills,
    commands: countFiles(path.join(pdir, 'commands'), /\.md$/i),
    agents: countFiles(path.join(pdir, 'agents'), /\.md$/i),
  });
}

// ---- remote plugins: read the pinned commit from GitHub before consent (review r2) ----
const GITHUB_REPO_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;
const SCRIPT_RE = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|ps1|psm1|cmd|bat|exe|rb|pl)$/i;
function fetchText(url, { timeoutMs = 15000, maxBytes = 4 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    if (!/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//.test(url)) return reject(new Error('not a GitHub URL'));
    const req = require('https').get(url, { headers: { 'User-Agent': 'carrotcap-cli', Accept: 'application/vnd.github+json' }, timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let size = 0;
      const chunks = [];
      res.on('data', (c) => { size += c.length; if (size > maxBytes) { req.destroy(new Error('too large')); return; } chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
async function inspectRemotePlugin(id, { configDir = claudeConfigDir(), fetch = fetchText } = {}) {
  const { entry } = marketEntry(id, configDir);
  const src = entry && entry.source && typeof entry.source === 'object' ? entry.source : null;
  const m = src && typeof src.url === 'string' ? GITHUB_REPO_RE.exec(src.url) : null;
  const sha = src && typeof src.sha === 'string' && /^[0-9a-f]{40}$/.test(src.sha) ? src.sha : null;
  if (!m || !sha) throw new Error('고정 커밋이 있는 GitHub 저장소가 아니라 내용을 확인할 수 없습니다');
  const [, owner, repo] = m;
  const tree = JSON.parse(await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`));
  if (!tree || !Array.isArray(tree.tree)) throw new Error('저장소 목록을 읽지 못했습니다');
  if (tree.truncated) throw new Error('저장소가 너무 커서 전체 목록을 확인할 수 없습니다');
  const files = tree.tree.filter((t) => t && t.type === 'blob' && typeof t.path === 'string').map((t) => t.path);
  const raw = async (p) => JSON.parse(await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${p.split('/').map(encodeURIComponent).join('/')}`));
  const manifest = files.includes('.claude-plugin/plugin.json') ? await raw('.claude-plugin/plugin.json') : {};
  const out = { available: true, remote: src.url, pinned: sha, inspected: true, hooks: [], mcp: [], version: manifest.version || null };
  // hooks: hooks/hooks.json, or what plugin.json points to / holds inline
  const hookFiles = new Set(files.filter((p) => /^hooks\/hooks\.json$/.test(p)));
  if (typeof manifest.hooks === 'string') hookFiles.add(manifest.hooks.replace(/^\.\//, ''));
  for (const p of hookFiles) if (files.includes(p)) out.hooks.push(...parseHooks(await raw(p)));
  if (manifest.hooks && typeof manifest.hooks === 'object') out.hooks.push(...parseHooks(manifest.hooks));
  const mcpFiles = new Set(files.filter((p) => p === '.mcp.json'));
  if (typeof manifest.mcpServers === 'string') mcpFiles.add(manifest.mcpServers.replace(/^\.\//, ''));
  for (const p of mcpFiles) if (files.includes(p)) out.mcp.push(...parseMcp(await raw(p)));
  if (manifest.mcpServers && typeof manifest.mcpServers === 'object') out.mcp.push(...parseMcp(manifest.mcpServers));
  return summarize(out, {
    skills: files.filter((p) => /^skills\/[^/]+\/SKILL\.md$/.test(p)).length,
    commands: files.filter((p) => /^commands\/[^/]+\.md$/.test(p)).length,
    agents: files.filter((p) => /^agents\/[^/]+\.md$/.test(p)).length,
    scripts: files.filter((p) => SCRIPT_RE.test(p)).length,
  });
}

// Runs one `claude plugin ...` call; resolves only after the process (tree) is gone.
function makeRunner({ taskkillPath, timeoutMs = INSTALL_TIMEOUT_MS } = {}) {
  function killTree(child) {
    // On Windows a .cmd runs under cmd.exe: kill the whole tree so the real claude stops too.
    if (process.platform === 'win32' && child.pid && taskkillPath) {
      execFile(taskkillPath(), ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      try { child.kill('SIGKILL'); } catch { /* gone */ }
    }
  }
  return function run(exe, args, cwd) {
    return new Promise((resolve) => {
      // .cmd/.bat need a shell on Windows; every argument is a fixed token (no quoting needed)
      const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe);
      const child = viaShell
        ? spawn(`"${exe}" ${args.join(' ')}`, { cwd, shell: true, windowsHide: true })
        : spawn(exe, args, { cwd, windowsHide: true });
      let out = '';
      let timedOut = false;
      const add = (d) => { out = (out + d).slice(-4000); };
      child.stdout.on('data', add);
      child.stderr.on('data', add);
      const t = setTimeout(() => { timedOut = true; add('\n(시간 초과)'); killTree(child); }, timeoutMs);
      child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: String(e.message), timedOut }); });
      child.on('close', (code) => { clearTimeout(t); resolve({ code: timedOut ? -1 : code, out, timedOut }); });
    });
  };
}

function setupSkills(deps) {
  const {
    handle, getWindow, loadSettings, resolveAllowedDir, safeRealpath, isPathInsideRoot,
    assertAncestorsClean, safeMkdir, isAllowedCliCommand, findCommand, taskkillPath,
    installTimeoutMs = INSTALL_TIMEOUT_MS, fetchRemote = fetchText,
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
    let before = null;
    try { before = fs.readFileSync(file, 'utf8'); } catch { /* new file */ }
    fs.writeFileSync(file, text, 'utf8');
    const real = safeRealpath(file);
    if (!real || !isPathInsideRoot(real, root)) {
      // swapped between the check and the write: undo what we just wrote there (review r2)
      try { if (before === null) fs.rmSync(file, { force: true }); else fs.writeFileSync(file, before, 'utf8'); } catch { /* best effort */ }
      throw new Error(`${rel} escaped the project`);
    }
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
  const run = makeRunner({ taskkillPath, timeoutMs: installTimeoutMs });
  // Remote plugins whose pinned commit the user has inspected in this session (review r2).
  const remoteInspected = new Map();

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
  handle('skills:inspect-remote', async (_e, id) => {
    const s = SKILL_CATALOG.find((x) => x.id === id);
    if (!s) return { ok: false, error: '알 수 없는 스킬' };
    try {
      const r = await inspectRemotePlugin(id, { fetch: fetchRemote });
      remoteInspected.set(id, r.pinned);
      return { ok: true, inspect: r };
    } catch (e) {
      return { ok: false, error: e.message };
    }
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
    // a remote plugin only after its pinned commit was actually inspected (and still is the one listed)
    // A third-party plugin whose contents cannot be verified at all is not installable.
    const unchecked = ids.filter((id) => {
      if (!SKILL_CATALOG.find((s) => s.id === id).thirdParty) return false;
      const i = inspectPlugin(id);
      if (!i.available) return true;
      return i.needsRemoteCheck && remoteInspected.get(id) !== i.pinned;
    });
    if (unchecked.length) return { ok: false, error: `${unchecked.join(', ')}: 내용을 확인할 수 없거나 아직 확인하지 않았습니다 ("구성 불러오기")` };
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
  inspectRemotePlugin, makeRunner, parseHooks, parseMcp,
};
