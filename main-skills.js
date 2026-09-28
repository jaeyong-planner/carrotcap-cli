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
  // task-025: a separate marketplace (typesafe-ai/skills); the plugin is the marketplace root ("./")
  { id: 'typesafe', label: 'typesafe (Jev)', marketplace: 'typesafe-ai', marketplaceSource: 'typesafe-ai/skills',
    maker: 'TypeSafe AI (외부 제작 · 별도 마켓)', thirdParty: true, source: 'https://github.com/typesafe-ai/skills',
    desc: 'Jev 판단 모델 — 분류·필터·순위·검증을 확률로 받는 설계·코드 가이드 (/typesafe:typesafe-ai, 호출에는 TYPESAFE_API_KEY 필요)',
    rule: '분류·필터·순위·검증처럼 뜻을 읽는 좁은 판단은 Jev(/typesafe:typesafe-ai, node scripts/system-one.js — CLM 우선, Jev 대체)로 먼저 받고, 계산·권한·실행은 코드에 둔다. 확률이 애매한 판단은 사람 확인으로 넘긴다.' },
];
const SKILL_IDS = new Set(SKILL_CATALOG.map((s) => s.id));
// Which marketplace a catalog id comes from (default: the official one).
const catalogEntry = (id) => SKILL_CATALOG.find((s) => s.id === id) || null;
const marketOf = (id) => (catalogEntry(id) || {}).marketplace || MARKETPLACE;
const marketSourceOf = (mkt) => (mkt === MARKETPLACE ? MARKETPLACE_SOURCE : (SKILL_CATALOG.find((s) => s.marketplace === mkt) || {}).marketplaceSource || null);
const pluginKey = (id) => `${id}@${marketOf(id)}`;
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
    `설치된 Claude Code 플러그인 (프로젝트 범위): ${list.map(pluginKey).join(', ') || '없음'}`,
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
function installArgs(id) { return ['plugin', 'install', pluginKey(id), '--scope', 'project']; }
function uninstallArgs(id) { return ['plugin', 'uninstall', pluginKey(id), '--scope', 'project']; }
function marketplaceAddArgs(mkt = MARKETPLACE) {
  const src = marketSourceOf(mkt);
  if (!src) throw new Error(`unknown marketplace ${mkt}`);
  return ['plugin', 'marketplace', 'add', src, '--scope', 'project'];
}

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
        if (h && typeof h.command === 'string') out.push({ event, command: short(h.command), full: h.command });
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
      const full = typeof v.command === 'string' ? [v.command, ...(Array.isArray(v.args) ? v.args : [])].join(' ') : `원격 ${v.url}`;
      out.push({ name, command: short(full), full });
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
function marketDir(mkt, configDir) { return path.join(configDir, 'plugins', 'marketplaces', mkt); }
function marketReady(mkt, configDir = claudeConfigDir()) { return fs.existsSync(path.join(marketDir(mkt, configDir), '.claude-plugin', 'marketplace.json')); }
function marketEntry(id, configDir) {
  const mdir = marketDir(marketOf(id), configDir);
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
  // only "./<folder>" inside the marketplace copy can be read here (review r7)
  const unsupported = { available: false, note: '지원하지 않는 출처 형식 — 내용을 확인할 수 없습니다' };
  // "./" = the plugin is the marketplace folder itself (typesafe-ai, task-025)
  const atRoot = entry.source === './';
  if (typeof entry.source !== 'string' || (!atRoot && !/^\.\/[A-Za-z0-9_.\-/]+$/.test(entry.source)) || entry.source.split('/').includes('..')) return unsupported;
  const pdir = atRoot ? mdir : path.join(mdir, ...entry.source.slice(2).split('/'));
  try {
    const realM = fs.realpathSync.native(mdir);
    const relP = path.relative(realM, fs.realpathSync.native(pdir));
    if ((!relP && !atRoot) || relP.startsWith('..') || path.isAbsolute(relP)) return unsupported;
    if (atRoot && fs.lstatSync(mdir).isSymbolicLink()) return unsupported;
  } catch { return unsupported; }
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
  try {
    const files = walkFiles(pdir);
    let total = 0;
    const entries = scanTargets(files).map((p) => {
      const text = fs.readFileSync(path.join(pdir, ...p.split('/')), 'utf8');
      total += Buffer.byteLength(text, 'utf8');
      if (total > MAX_SCAN_BYTES) throw new Error('확인할 내용이 너무 큽니다');
      return { path: p, text };
    });
    finishContent(out, files, entries);
    out.scripts = files.filter((p) => SCRIPT_RE.test(p)).length;
    // what was shown, for the check after install (review r6); media by raw bytes
    out.digest = {
      files: Object.fromEntries(entries.map((e) => [e.path, textHash(e.text)])),
      media: Object.fromEntries(files.filter((p) => MEDIA_RE.test(p)).map((p) => [p, bytesHash(fs.readFileSync(path.join(pdir, ...p.split('/'))))])),
    };
  } catch (e) {
    return { available: false, note: `내용을 확인할 수 없습니다 — ${e.message}` };
  }
  return summarize(out, {
    skills,
    commands: countFiles(path.join(pdir, 'commands'), /\.md$/i),
    agents: countFiles(path.join(pdir, 'agents'), /\.md$/i),
    scripts: out.scripts,
  });
}

// ---- remote plugins: read the pinned commit from GitHub before consent (review r2) ----
const GITHUB_REPO_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;
const SCRIPT_RE = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|ps1|psm1|cmd|bat|rb|pl|php|lua)$/i;
function fetchText(url, { timeoutMs = 15000, maxBytes = 4 * 1024 * 1024, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//.test(url)) return reject(new Error('not a GitHub URL'));
    const req = require('https').get(url, { headers: { 'User-Agent': 'carrotcap-cli', Accept: 'application/vnd.github+json' }, timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let size = 0;
      const chunks = [];
      res.on('data', (c) => { size += c.length; if (size > maxBytes) { req.destroy(new Error('too large')); return; } chunks.push(c); });
      res.on('end', () => resolve(raw ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
// ---- content scan: what the skill texts and scripts actually do (review r3) ----
// Every SKILL.md / command / agent prompt and every script is read and checked for the
// risks the user asked about. Files that cannot be read (binaries, too many, fetch errors)
// make the plugin uninspectable, so it cannot be consented to.
const BINARY_RE = /\.(exe|dll|so|dylib|node|bin|com|msi|scr|jar|wasm)$/i;
// images/fonts/media are the only files not read: nothing in a plugin can run them
const MEDIA_RE = /\.(png|jpe?g|gif|webp|ico|bmp|woff2?|ttf|otf|eot|pdf|mp3|mp4|wav|ogg|webm|mov)$/i;
const LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepare', 'preprepare', 'postprepare', 'prepublish', 'prepack', 'postpack'];
const MAX_SCAN_FILES = 600;
const MAX_SCAN_BYTES = 8 * 1024 * 1024;
const MAX_FINDINGS = 300;
const HOOK_BODY_CHARS = 6000;
const RISKS = [
  { cat: 'network', label: '네트워크', any: /\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|ncat|nc\s+-|scp|ssh\s)\b|\bfetch\(|XMLHttpRequest|require\(\s*['"](node:)?(https?|net|dgram|tls)['"]\s*\)|from\s+['"](node:)?(https?|net)['"]|\brequests\.(get|post|put)|urllib|http\.client|\bsocket\./i, script: /https?:\/\//i },
  { cat: 'delete', label: '파일 삭제', any: /\brm\s+-[a-z]*[rf]|\brmdir\b|\bRemove-Item\b|\brd\s+\/s|\bdel\s+(\/[a-z]\s+)*|\bunlink(Sync)?\(|\bfs\.(rm|rmdir)(Sync)?\(|\brmtree\b|\bos\.remove|\bgit\s+clean\b|\bgit\s+reset\s+--hard/i },
  { cat: 'secrets', label: '환경변수·자격증명', any: /process\.env|\$env:|\bos\.environ|\bgetenv\b|%[A-Z_]*(KEY|TOKEN|SECRET)%|~\/\.(ssh|aws|npmrc|netrc|config\/gh)|\.git-credentials|\bcredentials?\b|\bkeychain\b/i, cs: /\b[A-Z0-9_]*(API_KEY|TOKEN|SECRET|PASSWORD)\b/ },
  { cat: 'exec', label: '셸·프로그램 실행', any: /child_process|\bexec(Sync|File)?\(|\bspawn(Sync)?\(|\bsubprocess\b|\bos\.system\b|\beval\s*[( ]|\bStart-Process\b|\bInvoke-Expression\b|\biex\b|\b(bash|sh|zsh)\s+-c\b|\bpowershell(\.exe)?\s+-|\bcmd(\.exe)?\s+\/c\b|\bnpx\s|\bpip\s+install\b|\bnpm\s+(i|install)\b/i },
];
function scanTexts(entries) {
  // a NUL byte means a binary we cannot show: refuse
  const bin = entries.find((e) => e.text.includes('\u0000'));
  if (bin) throw new Error(`본문을 확인할 수 없는 바이너리 파일이 있습니다: ${bin.path}`);
  const counts = Object.fromEntries(RISKS.map((r) => [r.cat, 0]));
  const findings = [];
  let bytes = 0;
  for (const { path: p, text } of entries) {
    bytes += Buffer.byteLength(text, 'utf8');
    // anything that may run: script extensions, no extension, or a shebang line
    const isScript = SCRIPT_RE.test(p) || !/\.[^./]+$/.test(p) || text.startsWith('#!');
    if (/(^|\/)package\.json$/.test(p)) {
      let pkg = null;
      try { pkg = JSON.parse(text); } catch { /* still scanned as text below */ }
      const scripts = pkg && pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
      for (const k of LIFECYCLE) {
        if (typeof scripts[k] !== 'string') continue;
        counts.exec++;
        findings.push({ cat: 'exec', label: '설치 때 자동 실행', file: p, line: 0, text: short(`scripts.${k}: ${scripts[k]}`, 160) });
      }
    }
    const lines = text.split(/\r?\n/);
    for (let n = 0; n < lines.length; n++) {
      const line = lines[n];
      for (const r of RISKS) {
        if (!(r.any.test(line) || (r.cs && r.cs.test(line)) || (isScript && r.script && r.script.test(line)))) continue;
        counts[r.cat]++;
        if (findings.length < MAX_FINDINGS) findings.push({ cat: r.cat, label: r.label, file: p, line: n + 1, text: short(line.trim(), 160) });
      }
    }
  }
  return { files: entries.length, bytes, counts, findings, truncated: findings.length >= MAX_FINDINGS };
}
// plugin files a hook / MCP command runs: ${CLAUDE_PLUGIN_ROOT}/<path> (also bare relative paths)
function referencedFiles(commands, files) {
  const out = new Set();
  const missing = new Set();
  for (const c of commands) {
    const re = /\$\{?CLAUDE_PLUGIN_ROOT\}?[\\/]([^\s"'`;|&]+)/g;
    let m;
    while ((m = re.exec(c))) {
      const p = m[1].replace(/\\/g, '/').replace(/^\.\//, '');
      if (files.includes(p)) out.add(p); else missing.add(p);
    }
    for (const tok of c.split(/[\s"'`]+/)) {
      const p = tok.replace(/^\.\//, '');
      if (p && !p.includes('CLAUDE_PLUGIN_ROOT') && files.includes(p)) out.add(p);
    }
  }
  return { used: [...out], missing: [...missing] };
}
function scanTargets(files) {
  const bin = files.filter((p) => BINARY_RE.test(p));
  if (bin.length) throw new Error(`본문을 확인할 수 없는 바이너리 실행 파일이 있습니다: ${bin.slice(0, 3).join(', ')}`);
  const targets = files.filter((p) => !MEDIA_RE.test(p));
  if (targets.length > MAX_SCAN_FILES) throw new Error(`확인할 파일이 너무 많습니다 (${targets.length}개)`);
  return targets;
}
// hook/MCP commands → the bodies they run, plus the scan over every prompt and script
function finishContent(out, files, entries) {
  const byPath = new Map(entries.map((e) => [e.path, e.text]));
  const cmds = [...out.hooks.map((h) => h.full || h.command), ...out.mcp.map((m) => m.full || m.command)];
  const ref = referencedFiles(cmds, files);
  if (ref.missing.length) throw new Error(`훅이 실행하는 파일을 찾을 수 없습니다: ${ref.missing.slice(0, 3).join(', ')}`);
  out.runFiles = ref.used.map((p) => {
    const body = byPath.get(p);
    if (typeof body !== 'string') throw new Error(`훅이 실행하는 파일을 읽지 못했습니다: ${p}`);
    return { path: p, body: body.length > HOOK_BODY_CHARS ? body.slice(0, HOOK_BODY_CHARS) + '\n…(생략)' : body };
  });
  out.security = scanTexts(entries);
  out.security.skipped = files.filter((p) => MEDIA_RE.test(p)).length;
  // code fetched at run time (npx/uvx/docker ...) is not in the plugin: say so plainly
  out.external = cmds.filter((c) => /^\s*(npx|uvx|pipx|bunx|pnpm\s+dlx|yarn\s+dlx|docker|podman)\b/i.test(c) || /^원격 /.test(c)).map((c) => short(c));
  for (const h of out.hooks) delete h.full;
  for (const m of out.mcp) delete m.full;
  return out;
}
async function mapLimit(items, limit, fn) {
  const res = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; res[k] = await fn(items[k]); }
  }));
  return res;
}
function walkFiles(root, max = 5000) {
  const out = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    let ents;
    try { ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const d of ents) {
      if (d.name === '.git') continue;
      const p = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) stack.push(p);
      else if (d.isFile()) out.push(p);
      else if (d.isSymbolicLink()) throw new Error(`링크 파일이 있어 내용을 확인할 수 없습니다: ${p}`);
      if (out.length > max) throw new Error('파일이 너무 많아 확인할 수 없습니다');
    }
  }
  return out;
}

// line endings may be converted on checkout; everything else must be identical
function textHash(text) {
  return require('crypto').createHash('sha256').update(String(text).replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}
function bytesHash(buf) { return require('crypto').createHash('sha256').update(buf).digest('hex'); }
// After `claude plugin install`: the copy Claude recorded for this project must be the commit
// that was inspected, with exactly the files that were shown (review r5).
function verifyInstalledCopy(id, root, { sha, digest }, { configDir = claudeConfigDir(), realpath = (p) => fs.realpathSync.native(p) } = {}) {
  const rec = readJson(path.join(configDir, 'plugins', 'installed_plugins.json'));
  const list = rec && rec.plugins && Array.isArray(rec.plugins[pluginKey(id)]) ? rec.plugins[pluginKey(id)] : [];
  const same = (a, b) => { try { return realpath(a).toLowerCase() === realpath(b).toLowerCase(); } catch { return false; } };
  const e = list.find((x) => x && x.scope === 'project' && typeof x.projectPath === 'string' && same(x.projectPath, root));
  if (!e) return '설치 기록을 찾을 수 없습니다';
  // local marketplace copies may have no commit to compare; their files are compared below
  if (sha && e.gitCommitSha !== sha) return `설치된 커밋(${String(e.gitCommitSha || '없음').slice(0, 7)})이 확인한 커밋(${sha.slice(0, 7)})과 다릅니다`;
  const cache = path.join(configDir, 'plugins', 'cache');
  let dir;
  try { dir = realpath(e.installPath); } catch { return '설치된 파일을 찾을 수 없습니다'; }
  const rel = path.relative(realpath(cache), dir);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return '설치 위치가 플러그인 캐시 밖입니다';
  let files;
  try { files = walkFiles(dir); } catch (err) { return err.message; }
  const shown = new Set([...Object.keys(digest.files), ...Object.keys(digest.media)]);
  // Claude's own bookkeeping in the cache folder (.in_use/<pid> markers) is not plugin content
  const extra = files.filter((p) => !shown.has(p) && !/^\.in_use\/\d+$/.test(p) && p !== '.orphaned_at');
  if (extra.length) return `확인하지 않은 파일이 설치됐습니다: ${extra.slice(0, 3).join(', ')}`;
  for (const [p, h] of Object.entries(digest.files)) {
    let text;
    try { text = fs.readFileSync(path.join(dir, ...p.split('/')), 'utf8'); } catch { return `확인한 파일이 설치되지 않았습니다: ${p}`; }
    if (textHash(text) !== h) return `설치된 ${p}의 내용이 확인한 것과 다릅니다`;
  }
  for (const [p, h] of Object.entries(digest.media)) {
    let buf;
    try { buf = fs.readFileSync(path.join(dir, ...p.split('/'))); } catch { return `확인한 파일이 설치되지 않았습니다: ${p}`; }
    if (bytesHash(buf) !== h) return `설치된 ${p}의 내용이 확인한 것과 다릅니다`;
  }
  return null;
}
// what a file was when it was read: a later write must find it unchanged (review r7)
const stampOf = (st) => ({ ino: st.ino, dev: st.dev, size: st.size, mtimeMs: st.mtimeMs });
const sameStamp = (a, b) => (a === null ? b === null : !!b && a.ino === b.ino && a.dev === b.dev && a.size === b.size && a.mtimeMs === b.mtimeMs);
const sameFile = (a, b) => !!a && !!b && a.ino === b.ino && a.dev === b.dev;
// Write <root>/<rel> without ever following a link out of the project (review r5/r6).
// An EMPTY temp file is created exclusively (random name) and opened; the text is written
// through that handle only after the created file is known to be inside the project, so a
// folder swapped for a link at any moment never receives the text (at most an empty temp
// that is removed at once). The temp is then renamed over the target: a rename replaces a
// link instead of writing through it, and after a folder swap the temp name is not found
// there, so the rename fails. Nothing is ever written back on failure.
// expect: undefined = no check; null = the target must still not exist; a stamp = it must be unchanged
function writeInsideProject(root, rel, text, { safeRealpath, isPathInsideRoot, assertAncestorsClean, beforeCreate, beforeRename, expect }) {
  const file = path.join(root, rel);
  const dir = path.dirname(file);
  if (fs.existsSync(file)) {
    const lst = fs.lstatSync(file);
    if (lst.isSymbolicLink() || !lst.isFile()) throw new Error(`${rel} is not a plain file`);
    if (lst.nlink > 1) throw new Error(`${rel} is hard-linked elsewhere`);
  }
  assertAncestorsClean(file, root);
  const realDir = safeRealpath(dir);
  if (!realDir || !isPathInsideRoot(realDir, root)) throw new Error(`${rel} escaped the project`);
  if (beforeCreate) beforeCreate(); // tests: swap things in the race window
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${require('crypto').randomBytes(8).toString('hex')}.tmp`);
  let fd = fs.openSync(tmp, 'wx');
  let done = false;
  try {
    const realTmp = safeRealpath(tmp);
    let atPath = null;
    try { atPath = realTmp ? fs.lstatSync(realTmp) : null; } catch { /* gone */ }
    if (!realTmp || !isPathInsideRoot(realTmp, root) || !sameFile(atPath, fs.fstatSync(fd))) throw new Error(`${rel} escaped the project`);
    fs.writeFileSync(fd, text, 'utf8');
    fs.closeSync(fd);
    fd = null;
    if (beforeRename) beforeRename();
    if (expect !== undefined) {
      let cur = null;
      try { cur = stampOf(fs.lstatSync(file)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (!sameStamp(expect, cur)) throw new Error(`${rel} was changed meanwhile — not overwritten`);
    }
    fs.renameSync(tmp, file);
    done = true;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* closed */ } }
    if (!done) { try { fs.rmSync(tmp, { force: true }); } catch { /* the temp name exists only where we made it */ } }
  }
}
// Read <root>/<rel> only if what was opened is the plain, singly linked file inside the
// project that was checked (review r6): a link swapped in before the open, or the path
// changed while open, is refused instead of merging someone else's file into ours.
function readInsideProject(root, rel, { safeRealpath, isPathInsideRoot, assertAncestorsClean, afterOpen, withStamp }) {
  const file = path.join(root, rel);
  let before;
  try { before = fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return withStamp ? { text: null, stamp: null } : null; throw e; }
  if (before.isSymbolicLink() || !before.isFile()) throw new Error(`${rel} is not a plain file`);
  if (before.nlink > 1) throw new Error(`${rel} is hard-linked elsewhere`);
  assertAncestorsClean(file, root);
  const fd = fs.openSync(file, 'r');
  try {
    if (afterOpen) afterOpen();
    const opened = fs.fstatSync(fd);
    const real = safeRealpath(file);
    let now = null;
    try { now = fs.lstatSync(file); } catch { /* gone */ }
    if (!sameFile(before, opened) || !sameFile(now, opened) || opened.nlink > 1 || !real || !isPathInsideRoot(real, root)) {
      throw new Error(`${rel} changed while reading`);
    }
    const text = fs.readFileSync(fd, 'utf8');
    return withStamp ? { text, stamp: stampOf(fs.fstatSync(fd)) } : text;
  } finally {
    fs.closeSync(fd);
  }
}

// task-028: which scope a catalog plugin is installed in, read from Claude's own record:
// 'user' (every project), or 'project'/'local' when it belongs to this project. null = not installed.
function installedScope(id, root, { configDir = claudeConfigDir(), realpath = (p) => fs.realpathSync.native(p) } = {}) {
  const rec = readJson(path.join(configDir, 'plugins', 'installed_plugins.json'));
  const key = pluginKey(id);
  const list = rec && rec.plugins && Array.isArray(rec.plugins[key]) ? rec.plugins[key] : [];
  const same = (a, b) => { try { return realpath(a).toLowerCase() === realpath(b).toLowerCase(); } catch { return false; } };
  const hit = list.find((x) => x && (x.scope === 'user'
    || ((x.scope === 'project' || x.scope === 'local') && root && typeof x.projectPath === 'string' && same(x.projectPath, root))));
  return hit ? hit.scope : null;
}
// task-025: typesafe@typesafe-ai installed for the user, or for this project (scope project/local).
function jevInstalled(root, opts = {}) { return installedScope('typesafe', root, opts); }
// `claude plugin marketplace list` names each marketplace on its own line ("  ❯ name" / "  name")
function listsMarketplace(out, mkt) {
  return String(out).split(/\r?\n/).some((l) => l.replace(/^[\s>❯•*-]+/, '').split(/\s+/)[0] === mkt);
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
  // a link or submodule is restored as something else than the text we would show (review r5)
  const odd = tree.tree.find((t) => t && (t.mode === '120000' || t.type === 'commit'));
  if (odd) throw new Error(`링크·서브모듈이 있어 내용을 확인할 수 없습니다: ${odd.path}`);
  const files = tree.tree.filter((t) => t && t.type === 'blob' && typeof t.path === 'string').map((t) => t.path);
  const rawText = (p) => fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${p.split('/').map(encodeURIComponent).join('/')}`);
  const raw = async (p) => JSON.parse(await rawText(p));
  const rawBytes = async (p) => {
    const v = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${p.split('/').map(encodeURIComponent).join('/')}`, { raw: true });
    return Buffer.isBuffer(v) ? v : Buffer.from(String(v), 'utf8');
  };
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
  const targets = scanTargets(files);
  let total = 0;
  const entries = await mapLimit(targets, 6, async (p) => {
    let text;
    try { text = await rawText(p); } catch (e) { throw new Error(`${p}을(를) 읽지 못했습니다 (${e.message}) — 확인 전에는 설치할 수 없습니다`); }
    total += Buffer.byteLength(text, 'utf8');
    if (total > MAX_SCAN_BYTES) throw new Error('확인할 내용이 너무 큽니다');
    return { path: p, text };
  });
  finishContent(out, files, entries);
  // what was shown, so the installed copy can be compared with it afterwards (review r5/r6)
  const media = await mapLimit(files.filter((p) => MEDIA_RE.test(p)), 6, async (p) => {
    let b;
    try { b = await rawBytes(p); } catch (e) { throw new Error(`${p}을(를) 읽지 못했습니다 (${e.message}) — 확인 전에는 설치할 수 없습니다`); }
    total += b.length;
    if (total > MAX_SCAN_BYTES) throw new Error('확인할 내용이 너무 큽니다');
    return [p, bytesHash(b)];
  });
  out.digest = { files: Object.fromEntries(entries.map((e) => [e.path, textHash(e.text)])), media: Object.fromEntries(media) };
  return summarize(out, {
    skills: files.filter((p) => /^skills\/[^/]+\/SKILL\.md$/.test(p)).length,
    commands: files.filter((p) => /^commands\/[^/]+\.md$/.test(p)).length,
    agents: files.filter((p) => /^agents\/[^/]+\.md$/.test(p)).length,
    scripts: files.filter((p) => SCRIPT_RE.test(p)).length,
  });
}

// Runs one `claude plugin ...` call; resolves only after the process (tree) is gone.
function makeRunner({ taskkillPath, timeoutMs = INSTALL_TIMEOUT_MS } = {}) {
  // Resolves once the whole tree is gone (review r7): taskkill /T on Windows (a .cmd runs under
  // cmd.exe), the process group on POSIX (the child leads its own group).
  function killTree(child) {
    return new Promise((done) => {
      if (process.platform === 'win32' && child.pid && taskkillPath) {
        execFile(taskkillPath(), ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => done());
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
        done();
      }
    });
  }
  return function run(exe, args, cwd) {
    return new Promise((resolve) => {
      // .cmd/.bat need a shell on Windows; every argument is a fixed token (no quoting needed)
      const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe);
      const detached = process.platform !== 'win32'; // own process group, so the group can be killed
      const child = viaShell
        ? spawn(`"${exe}" ${args.join(' ')}`, { cwd, shell: true, windowsHide: true })
        : spawn(exe, args, { cwd, windowsHide: true, detached });
      let out = '';
      let timedOut = false;
      let killing = null;
      const add = (d) => { out = (out + d).slice(-4000); };
      child.stdout.on('data', add);
      child.stderr.on('data', add);
      const t = setTimeout(() => { timedOut = true; add('\n(시간 초과)'); killing = killTree(child); }, timeoutMs);
      // the next install may start only after the timed-out tree is really gone
      const finish = (r) => { clearTimeout(t); (killing || Promise.resolve()).then(() => resolve(r)); };
      child.on('error', (e) => finish({ code: -1, out: String(e.message), timedOut }));
      child.on('close', (code) => finish({ code: timedOut ? -1 : code, out, timedOut }));
    });
  };
}

function setupSkills(deps) {
  const {
    handle, getWindow, loadSettings, resolveAllowedDir, safeRealpath, isPathInsideRoot,
    assertAncestorsClean, safeMkdir, isAllowedCliCommand, findCommand, taskkillPath,
    installTimeoutMs = INSTALL_TIMEOUT_MS, fetchRemote = fetchText,
    hasTypesafeKey = () => !!(process.env.TYPESAFE_API_KEY || '').trim(), // task-025
    refreshPath = async () => {}, // task-027: re-read the registered PATH before looking up claude
    confirmThirdParty, // async ({ title, detail }) => boolean — a native dialog in main (review r8)
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
  function thirdPartySummary(ids) {
    const lines = [];
    for (const id of ids) {
      const s = SKILL_CATALOG.find((x) => x.id === id);
      const seen = remoteInspected.get(id);
      const i = seen ? seen.shown : inspectPlugin(id);
      lines.push(`■ ${id} — ${s.maker}`, `  출처: ${s.source}${i.pinned ? ` @ ${String(i.pinned).slice(0, 7)}` : ''}`);
      if (Array.isArray(i.components) && i.components.length) lines.push(`  구성: ${i.components.join(' · ')}`);
      for (const h of (i.hooks || []).slice(0, 5)) lines.push(`  훅 ${h.event}: ${h.command}`);
      for (const m of (i.mcp || []).slice(0, 5)) lines.push(`  MCP ${m.name}: ${m.command}`);
      const c = i.security && i.security.counts;
      if (c) lines.push(`  보안 점검: 네트워크 ${c.network} · 파일 삭제 ${c.delete} · 환경변수·자격증명 ${c.secrets} · 셸·프로그램 실행 ${c.exec}`);
      for (const e of i.external || []) lines.push(`  ⚠ 실행할 때 외부 패키지를 받아 실행: ${e}`);
    }
    return { title: `외부 제작 플러그인 ${ids.length}개를 이 프로젝트에 설치할까요?`, detail: lines.join('\n') };
  }
  // no window shown (direct call): compare with the local copy as it is now, if there is one
  const localDigest = (id) => { const i = inspectPlugin(id); return i.digest && !i.needsRemoteCheck ? { sha: null, digest: i.digest } : null; };
  const writeInside = (root, rel, text, expect) => writeInsideProject(root, rel, text, { safeRealpath, isPathInsideRoot, assertAncestorsClean, expect });
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
  const localShown = new Map(); // id → digest of the local marketplace copy shown in the window

  handle('skills:catalog', () => {
    const configDir = claudeConfigDir();
    return {
      marketplace: MARKETPLACE,
      catalog: SKILL_CATALOG.map(({ id, label, maker, thirdParty, source, desc }) => {
        const { digest, ...inspect } = inspectPlugin(id, configDir);
        // what the window shows for a local plugin, kept for the check after install (review r6)
        if (digest) localShown.set(id, { sha: null, digest }); else localShown.delete(id);
        const mkt = marketOf(id);
        // only an entry from its own marketplace needs "마켓 추가"; the official one is added by
        // the install itself when missing (task-023), so it always counts as ready here (task-026 fix)
        const ready = mkt === MARKETPLACE ? true : marketReady(mkt, configDir);
        return { id, label: label || id, maker, thirdParty: !!thirdParty, source, desc, inspect, marketplace: mkt, marketReady: ready };
      }),
      presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { label: v.label, ids: v.ids.slice() }])),
    };
  });
  handle('skills:inspect-remote', async (_e, id) => {
    const s = SKILL_CATALOG.find((x) => x.id === id);
    if (!s) return { ok: false, error: '알 수 없는 스킬' };
    try {
      const r = await inspectRemotePlugin(id, { fetch: fetchRemote });
      remoteInspected.set(id, { sha: r.pinned, digest: r.digest, shown: r });
      const { digest, ...shown } = r; // hashes stay in main
      return { ok: true, inspect: shown };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  // task-025: a catalog entry from a marketplace this machine does not have yet. Adding a
  // marketplace only clones its listing (nothing is installed or run); the window then shows
  // the local copy so the user can inspect it before installing.
  handle('skills:add-marketplace', async (_e, payload) => {
    const p = (payload && typeof payload === 'object') ? payload : {};
    const root = resolveAllowedDir(p.projectRoot);
    if (!root) return { ok: false, error: '프로젝트 폴더를 먼저 선택하세요' };
    const s = typeof p.id === 'string' ? catalogEntry(p.id) : null;
    if (!s || !s.marketplace) return { ok: false, error: '별도 마켓이 필요한 항목이 아닙니다' };
    if (marketReady(s.marketplace)) return { ok: true, already: true };
    await refreshPath(); // before the check: check → running = true stays one synchronous step
    if (running) return { ok: false, error: '이미 설치 중입니다' };
    const exe = claudeCommand();
    if (!exe) return { ok: false, error: 'claude CLI를 찾을 수 없습니다 (settings.json의 cli.claude 확인)' };
    running = true;
    try {
      const m = await run(exe, marketplaceAddArgs(s.marketplace), root);
      const last = m.out.split('\n').filter(Boolean).slice(-1)[0] || '';
      if (m.code !== 0) return { ok: false, error: `마켓플레이스 ${s.marketplace}를 추가하지 못했습니다 — ${last}` };
      if (!marketReady(s.marketplace)) return { ok: false, error: '마켓을 추가했지만 목록 파일을 찾을 수 없습니다' };
      return { ok: true };
    } finally {
      running = false;
    }
  });
  // task-025: can Jev (typesafe plugin) be used here, and is the API key set? (never the key itself)
  handle('skills:jev-status', (_e, projectRoot) => {
    const root = projectRoot ? resolveAllowedDir(projectRoot) : null;
    return { installed: jevInstalled(root), apiKey: hasTypesafeKey() === true };
  });
  handle('skills:status', (_e, projectRoot) => {
    const root = resolveAllowedDir(projectRoot);
    if (!root) return null;
    const st = readState(root);
    // task-028: this app only records its own installs, so a plugin added at user scope (or by the
    // claude CLI) looked uninstalled. Report those separately; `installed` keeps its old meaning
    // so the "first run" prompt (needsSetup) is unchanged.
    const also = SKILL_CATALOG.filter((s) => installedScope(s.id, root)).map((s) => s.id);
    return { ...(st || {}), installedElsewhere: also };
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
      return i.needsRemoteCheck && (remoteInspected.get(id) || {}).sha !== i.pinned;
    });
    if (unchecked.length) return { ok: false, error: `${unchecked.join(', ')}: 내용을 확인할 수 없거나 아직 확인하지 않았습니다 ("구성 불러오기")` };
    await refreshPath(); // before the check: check → running = true stays one synchronous step
    if (running) return { ok: false, error: '이미 설치 중입니다' };
    const exe = claudeCommand();
    if (!exe) return { ok: false, error: 'claude CLI를 찾을 수 없습니다 (settings.json의 cli.claude 확인)' };
    running = true;
    try {
      // Third-party: the renderer's tick is not trusted on its own — main asks the user itself
      // with a native dialog listing what will be installed and what it runs (review r8).
      if (third.length) {
        if (typeof confirmThirdParty !== 'function') return { ok: false, error: '외부 제작 항목을 확인할 창을 열 수 없습니다' };
        const approved = await confirmThirdParty(thirdPartySummary(third));
        if (approved !== true) return { ok: false, error: '외부 제작 항목 설치를 취소했습니다', cancelled: true };
      }
      // Each marketplace the picks come from is added (project scope) only if this machine does not know it.
      const list = await run(exe, ['plugin', 'marketplace', 'list'], root);
      for (const mkt of [...new Set(ids.map(marketOf))]) {
        if (listsMarketplace(list.out, mkt)) continue;
        const tag = mkt === MARKETPLACE ? '(marketplace)' : `(marketplace ${mkt})`;
        send({ id: tag, status: 'running' });
        const m = await run(exe, marketplaceAddArgs(mkt), root);
        send({ id: tag, status: m.code === 0 ? 'ok' : 'fail', out: m.out.slice(-400) });
        if (m.code !== 0) return { ok: false, error: mkt === MARKETPLACE ? '공식 마켓플레이스를 추가하지 못했습니다' : `마켓플레이스 ${mkt}를 추가하지 못했습니다`, results: [] };
      }
      const results = [];
      for (const id of ids) {
        send({ id, status: 'running' });
        const r = await run(exe, installArgs(id), root);
        let ok = r.code === 0 || /already installed/i.test(r.out); // already installed counts
        let out = r.out.slice(-400);
        // a remote plugin must have installed exactly what the user inspected; otherwise it is removed again
        const seen = remoteInspected.get(id) || localShown.get(id) || localDigest(id);
        if (ok && seen) {
          const bad = verifyInstalledCopy(id, root, seen);
          if (bad) {
            const u = await run(exe, uninstallArgs(id), root);
            ok = false;
            out = `${bad} — ${u.code === 0 ? '설치를 되돌렸습니다' : '되돌리지 못했습니다, 직접 제거하세요: claude plugin uninstall ' + pluginKey(id) + ' --scope project'}`;
          }
        }
        results.push({ id, ok, out });
        send({ id, status: ok ? 'ok' : 'fail', out });
      }
      const prev = readState(root) || {};
      const all = sanitizeSkillIds([...(Array.isArray(prev.installed) ? prev.installed : []), ...results.filter((r) => r.ok).map((r) => r.id)]);
      // Rules first; if they cannot be written, remember it so START offers the setup again.
      let rulesError = null;
      if (all.length) {
        try {
          const cur = readInsideProject(root, 'CLAUDE.md', { safeRealpath, isPathInsideRoot, assertAncestorsClean, withStamp: true });
          // written only if CLAUDE.md is still what was read (an edit meanwhile is not overwritten)
          writeInside(root, 'CLAUDE.md', mergeSkillsBlock(cur.text || '', buildSkillsBlock(all)), cur.stamp);
        } catch (e) { rulesError = e.message; }
      }
      writeState(root, { installed: all, marketplace: MARKETPLACE, plugins: all.map(pluginKey), at: new Date().toISOString(), ...(rulesError ? { rulesPending: true } : {}) });
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
  setupSkills, SKILL_CATALOG, PRESETS, MARKETPLACE, marketOf, pluginKey, jevInstalled, installedScope, listsMarketplace, SKILLS_BLOCK_START, SKILLS_BLOCK_END,
  sanitizeSkillIds, buildSkillsBlock, mergeSkillsBlock, installArgs, marketplaceAddArgs, inspectPlugin,
  inspectRemotePlugin, makeRunner, parseHooks, parseMcp, scanTexts, textHash, verifyInstalledCopy, writeInsideProject, readInsideProject, uninstallArgs, bytesHash,
};
