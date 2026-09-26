/* CARROTCAP CLI — renderer (vanilla JS, contextIsolation 적용) */
/* 전제: window.carrotcap (preload) + window.Terminal (xterm) + window.FitAddon + window.WebLinksAddon */

(() => {
  const api = window.carrotcap;
  const Terminal = window.Terminal;
  const FitAddon = window.FitAddon ? window.FitAddon.FitAddon : null;
  const WebLinks = window.WebLinksAddon ? window.WebLinksAddon.WebLinksAddon : null;

  // ---------- 상태 ----------
  const state = {
    settings: null,
    tabs: [],          // [{id, title, rootPaneId, pageEl}]
    panes: new Map(),  // id -> { id, type:'leaf'|'split', dir, children:[], parent, ptyId, term, fit, kind, paneEl, hostEl }
    activeTabId: null,
    activePaneId: null,
    folder: { rootPath: '', tree: null },
    aiopsMode: false,
    aorMode: true,
    // task-005: cache of workspace rootPaths that already had aiops:setup run
    // in this session, so AIOps panes after the first don't re-run the IPC.
    aiopsAutoSetupDone: new Set()
  };

  let nextId = 1;
  const newId = (p) => `${p}_${nextId++}`;

  // ---------- DOM refs ----------
  const $ = (sel) => document.querySelector(sel);
  const tabsEl = $('#tabs');
  const newTabBtn = $('#new-tab');
  const paneArea = $('#pane-area');
  const sidebarSearch = $('#search');
  const treeEl = $('#tree');
  const folderPathEl = $('#folder-path');
  const aorToggle = $('#aor-toggle');
  const aorModeToggle = $('#aor-mode-toggle');
  const aorStatus = $('#aor-status');
  const flowStatus = $('#flow-status');
  const modal = $('#modal');
  const modalText = $('#modal-text');

  // ---------- 부트 ----------
  async function boot() {
    try { state.platform = await api.platform(); } catch { state.platform = 'win32'; }
    state.settings = await api.getSettings();
    try { state.aorEngineFound = !!(await api.aorStatus()).engineFound; } catch { state.aorEngineFound = false; }
    // AIOps는 기본 ON — 사용자가 끈 경우(autoStart: false)만 끈다.
    state.aiopsMode = !(state.settings && state.settings.aor && state.settings.aor.autoStart === false);
    // task-005: AOR mode is the underlying routed-shell mode. AIOps implies AOR.
    // Default to true (matches settings defaults `aor.enabled: true`).
    state.aorMode = state.aiopsMode || (state.settings && state.settings.aor && state.settings.aor.enabled !== false);
    aorToggle.checked = state.aiopsMode;
    aorModeToggle.checked = state.aorMode;
    refreshAorBadge();

    // 초기 폴더: settings.defaultProjectPath
    if (state.settings && state.settings.defaultProjectPath) {
      await loadFolder(state.settings.defaultProjectPath);
    }

    // 첫 탭 + 첫 페인
    createTab();

    // 글로벌 이벤트
    bindGlobalEvents();
    refreshCliStatus();
  }

  function refreshAorBadge() {
    // AOR 엔진이 없으면 배지 자체를 숨긴다 — "AOR ON"이 켜져 있어도 실제로는 라우팅(토큰 절감)이 없다.
    aorStatus.hidden = !state.aorEngineFound;
    const label = state.aiopsMode ? 'AIOps ON' : (state.aorMode ? 'AOR ON' : 'PLAIN');
    aorStatus.textContent = label;
    aorStatus.classList.toggle('on', state.aiopsMode || state.aorMode);
  }

  // task-005: single source of truth for the spawn mode. AIOps implies AOR.
  function resolveSpawnMode() {
    if (state.aiopsMode) return 'aiops';
    if (state.aorMode)   return 'aor';
    return 'plain';
  }

  async function persistModeSettings() {
    if (!state.settings) return false;
    state.settings.aor = state.settings.aor || {};
    state.settings.aor.autoStart = state.aiopsMode;
    state.settings.aor.enabled   = state.aorMode;
    try {
      await api.setSettings(state.settings);
      return true;
    } catch (err) {
      setFlowStatus('모드 설정 저장 실패: ' + (err && err.message ? err.message : 'unknown'), 'warn');
      return false;
    }
  }

  function setFlowStatus(text, tone = '') {
    if (!flowStatus) return;
    flowStatus.textContent = text;
    flowStatus.classList.toggle('ok', tone === 'ok');
    flowStatus.classList.toggle('warn', tone === 'warn');
  }

  // ---------- 탭 ----------
  function createTab(opts = {}) {
    const tabId = newId('tab');
    const pageEl = document.createElement('div');
    pageEl.className = 'tab-page';
    pageEl.dataset.tabId = tabId;
    paneArea.appendChild(pageEl);

    // 첫 leaf
    const root = createLeafPane();
    pageEl.appendChild(root.paneEl);
    root.parent = { kind: 'tab', tabId };
    const tab = { id: tabId, title: `Terminal ${state.tabs.length + 1}`, rootPaneId: root.id, pageEl };
    state.tabs.push(tab);

    renderTabs();
    activateTab(tabId);
    activatePane(root.id);
    spawnIntoPane(root, { mode: opts.mode || resolveSpawnMode(), cwd: state.folder.rootPath || undefined });
    scheduleHistorySave();
    return root;
  }

  function activateTab(tabId) {
    state.activeTabId = tabId;
    for (const t of state.tabs) {
      t.pageEl.classList.toggle('active', t.id === tabId);
    }
    renderTabs();
    // 활성 탭 안에서 한 leaf를 활성으로
    const tab = state.tabs.find(t => t.id === tabId);
    if (tab) {
      const leaf = firstLeafIn(state.panes.get(tab.rootPaneId));
      if (leaf) activatePane(leaf.id);
    }
    // 사이즈 재조정
    setTimeout(() => fitAllIn(state.panes.get(state.tabs.find(t => t.id === tabId).rootPaneId)), 30);
  }

  function closeTab(tabId) {
    const idx = state.tabs.findIndex(t => t.id === tabId);
    if (idx < 0) return;
    const tab = state.tabs[idx];
    const closedRoots = rootsUnder(state.panes.get(tab.rootPaneId));
    // 모든 페인 정리
    walkPanes(state.panes.get(tab.rootPaneId), (p) => {
      if (p.type === 'leaf' && p.ptyId) api.killPty(p.ptyId);
      if (p.type === 'leaf' && p.term) p.term.dispose();
      state.panes.delete(p.id);
    });
    tab.pageEl.remove();
    state.tabs.splice(idx, 1);
    saveHistoryForRoots(closedRoots);
    scheduleHistorySave();
    if (state.tabs.length === 0) {
      createTab();
    } else {
      activateTab(state.tabs[Math.max(0, idx - 1)].id);
    }
    renderTabs();
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    for (const t of state.tabs) {
      const el = document.createElement('div');
      el.className = 'tab' + (t.id === state.activeTabId ? ' active' : '');
      el.innerHTML = `<span>${escapeHtml(t.title)}</span><span class="x" title="닫기">×</span>`;
      el.onclick = (e) => {
        if (e.target.classList.contains('x')) { e.stopPropagation(); closeTab(t.id); return; }
        activateTab(t.id);
      };
      tabsEl.appendChild(el);
    }
  }

  // ---------- 페인 / 분할 트리 ----------
  function createLeafPane() {
    const id = newId('pane');
    const paneEl = document.createElement('div');
    paneEl.className = 'pane';
    paneEl.dataset.paneId = id;

    const head = document.createElement('div');
    head.className = 'head';
    head.innerHTML = `<span class="kind">PLAIN</span><span class="x" title="페인 닫기">×</span>`;
    paneEl.appendChild(head);

    const hostEl = document.createElement('div');
    hostEl.className = 'term-host';
    paneEl.appendChild(hostEl);

    const node = { id, type: 'leaf', paneEl, hostEl, headEl: head, ptyId: null, term: null, fit: null, kind: 'plain', parent: null };
    state.panes.set(id, node);

    // 활성화 클릭
    paneEl.addEventListener('mousedown', () => activatePane(id), true);
    head.querySelector('.x').onclick = (e) => { e.stopPropagation(); closePane(id); };

    // 드래그앤드롭 — 파일 경로를 PTY에 입력
    paneEl.addEventListener('dragover', (e) => { e.preventDefault(); paneEl.classList.add('drop-target'); });
    paneEl.addEventListener('dragleave', () => paneEl.classList.remove('drop-target'));
    paneEl.addEventListener('drop', (e) => {
      e.preventDefault();
      paneEl.classList.remove('drop-target');
      const txt = e.dataTransfer.getData('text/carrotcap-path');
      const filePath = txt || (e.dataTransfer.files && e.dataTransfer.files[0] && e.dataTransfer.files[0].path);
      if (!filePath) return;
      // 경로에 공백/특수문자가 있으면 큰따옴표로 감싼다. 이미 따옴표가 있으면 그대로.
      const needsQuote = /[\s&()<>%!^]/.test(filePath) && !/^".*"$/.test(filePath);
      const quoted = needsQuote ? `"${filePath}"` : filePath;
      const send = (attempt = 0) => {
        if (node.ptyId) {
          api.writePty(node.ptyId, quoted + ' ');
          if (node.term) { try { node.term.focus(); } catch {} }
        } else if (attempt < 10) {
          // PTY 아직 스폰 중일 수 있음 — 잠깐 기다렸다가 재시도.
          setTimeout(() => send(attempt + 1), 100);
        }
      };
      send();
    });

    // term-host 클릭 시에도 명시적으로 포커스 (xterm이 readonly 상태로 빠지는 케이스 방지)
    hostEl.addEventListener('mousedown', () => {
      activatePane(id);
      if (node.term) { try { node.term.focus(); } catch {} }
    });

    return node;
  }

  function activatePane(id) {
    state.activePaneId = id;
    for (const [, p] of state.panes) {
      if (p.type === 'leaf') p.paneEl.classList.toggle('active', p.id === id);
    }
    const pane = state.panes.get(id);
    updateComposerTarget();
    // 입력창에 쓰는 중이면 포커스를 빼앗지 않는다.
    if (pane && pane.term && document.activeElement !== composerInput) setTimeout(() => pane.term.focus(), 10);
  }

  // 활성 leaf를 dir 방향으로 분할
  function splitActive(direction, opts = {}) {
    const leaf = state.panes.get(state.activePaneId);
    if (!leaf || leaf.type !== 'leaf') return null;
    const horizontal = direction === 'left' || direction === 'right';
    const orientation = horizontal ? 'h' : 'v';

    // 새 leaf (DOM은 먼저 만들고 PTY 스폰은 DOM 부착 후)
    const fresh = createLeafPane();

    // split 컨테이너
    const splitNode = { id: newId('split'), type: 'split', dir: orientation, children: [], parent: leaf.parent, splitEl: null };
    const splitEl = document.createElement('div');
    splitEl.className = `split ${orientation}`;
    splitNode.splitEl = splitEl;
    state.panes.set(splitNode.id, splitNode);

    // 부모에서 leaf의 위치를 split으로 교체
    replaceInParent(leaf, splitNode);
    leaf.parent = splitNode;
    fresh.parent = splitNode;

    // 자식 순서: left/up은 새 페인이 앞, right/down은 뒤
    const newFirst = (direction === 'left' || direction === 'up');
    const ordered = newFirst ? [fresh, leaf] : [leaf, fresh];
    splitNode.children = ordered;

    splitEl.appendChild(ordered[0].paneEl);
    const resizer = document.createElement('div');
    resizer.className = 'resizer';
    splitEl.appendChild(resizer);
    splitEl.appendChild(ordered[1].paneEl);
    enableResize(resizer, splitEl, ordered[0].paneEl, ordered[1].paneEl, orientation);

    // 이제 DOM에 부착됐으니 PTY 스폰 (xterm 사이즈 계산 정확)
    spawnIntoPane(fresh, { mode: opts.mode || resolveSpawnMode(), cwd: state.folder.rootPath || undefined });

    activatePane(fresh.id);
    setTimeout(() => fitAllIn(rootOfTab(state.activeTabId)), 50);
    scheduleHistorySave();
    return fresh;
  }

  // leaf를 부모의 자리에 splitNode를 끼워넣음
  function replaceInParent(leaf, replacementNode) {
    const parent = leaf.parent;
    if (!parent) return;
    if (parent.kind === 'tab') {
      const tab = state.tabs.find(t => t.id === parent.tabId);
      if (!tab) return;
      tab.pageEl.replaceChild(replacementNode.splitEl || replacementNode.paneEl, leaf.paneEl);
      tab.rootPaneId = replacementNode.id;
    } else if (parent.type === 'split') {
      const idx = parent.children.indexOf(leaf);
      if (idx >= 0) {
        parent.children[idx] = replacementNode;
        parent.splitEl.replaceChild(replacementNode.splitEl || replacementNode.paneEl, leaf.paneEl);
      }
    }
  }

  function closePane(id) {
    const pane = state.panes.get(id);
    if (!pane || pane.type !== 'leaf') return;
    if (pane.ptyId) api.killPty(pane.ptyId);
    if (pane.term) pane.term.dispose();

    const parent = pane.parent;
    state.panes.delete(id);
    // 부모 split에서 떼어낸 뒤 저장해야 닫은 페인이 기록에 남지 않는다 → 아래 정리 후 저장.
    const closedRoot = pane.projectRoot;
    setTimeout(() => { saveHistoryForRoots([closedRoot]); scheduleHistorySave(); }, 0);

    if (!parent || parent.kind === 'tab') {
      // 마지막 페인 → 탭을 닫음. 우선 parent.tabId로 찾고, 없으면 rootPaneId로 보강 탐색.
      const tab = (parent && parent.tabId)
        ? state.tabs.find(t => t.id === parent.tabId)
        : state.tabs.find(t => t.rootPaneId === id);
      if (tab) closeTab(tab.id);
      return;
    }
    // split의 한 자식이 사라지면, 형제 노드가 split의 위치로 승격
    if (parent.type === 'split') {
      const sibling = parent.children.find(c => c.id !== id);
      if (!sibling) return;
      const grand = parent.parent;
      if (grand && grand.kind === 'tab') {
        const tab = state.tabs.find(t => t.id === grand.tabId);
        if (tab) {
          tab.pageEl.replaceChild(sibling.splitEl || sibling.paneEl, parent.splitEl);
          tab.rootPaneId = sibling.id;
        }
        sibling.parent = grand;
      } else if (grand && grand.type === 'split') {
        const idx = grand.children.indexOf(parent);
        if (idx >= 0) {
          grand.children[idx] = sibling;
          grand.splitEl.replaceChild(sibling.splitEl || sibling.paneEl, parent.splitEl);
        }
        sibling.parent = grand;
      }
      state.panes.delete(parent.id);
      const remainingLeaf = firstLeafIn(sibling);
      if (remainingLeaf) activatePane(remainingLeaf.id);
      setTimeout(() => fitAllIn(rootOfTab(state.activeTabId)), 30);
    }
  }

  function rootOfTab(tabId) {
    const t = state.tabs.find(x => x.id === tabId);
    return t ? state.panes.get(t.rootPaneId) : null;
  }

  function firstLeafIn(node) {
    if (!node) return null;
    if (node.type === 'leaf') return node;
    for (const c of node.children) {
      const l = firstLeafIn(c); if (l) return l;
    }
    return null;
  }

  function walkPanes(node, fn) {
    if (!node) return;
    if (node.type === 'leaf') { fn(node); return; }
    for (const c of node.children) walkPanes(c, fn);
    fn(node);
  }

  function fitAllIn(node) {
    if (!node) return;
    if (node.type === 'leaf') {
      if (node.fit) {
        try { node.fit.fit(); } catch {}
        if (node.term && node.ptyId) api.resizePty(node.ptyId, node.term.cols, node.term.rows);
      }
      return;
    }
    for (const c of node.children) fitAllIn(c);
  }

  // 리사이저: split 비율 조절
  function enableResize(resizer, container, leftEl, rightEl, orientation) {
    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const isH = orientation === 'h';
      const startPos = isH ? e.clientX : e.clientY;
      const rect = container.getBoundingClientRect();
      const total = isH ? rect.width : rect.height;
      const startLeft = isH ? leftEl.getBoundingClientRect().width : leftEl.getBoundingClientRect().height;
      const onMove = (ev) => {
        const cur = isH ? ev.clientX : ev.clientY;
        const delta = cur - startPos;
        const newLeft = Math.max(80, Math.min(total - 80, startLeft + delta));
        const pct = (newLeft / total) * 100;
        if (isH) {
          leftEl.style.flex = `0 0 ${pct}%`;
          rightEl.style.flex = `1`;
        } else {
          leftEl.style.flex = `0 0 ${pct}%`;
          rightEl.style.flex = `1`;
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        setTimeout(() => fitAllIn(rootOfTab(state.activeTabId)), 30);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ---------- 터미널(xterm) ----------
  async function spawnIntoPane(leaf, payload) {
    // task-005: when entering AIOps mode in a workspace, auto-run setup once
    // per (rootPath, session) so the user doesn't need to click SETUP first.
    // Skips silently if no folder selected — pane spawns without project state.
    if (payload && payload.mode === 'aiops' && state.folder.rootPath
        && !state.aiopsAutoSetupDone.has(state.folder.rootPath)) {
      const ok = await setupAiopsWorkflow();
      if (ok) state.aiopsAutoSetupDone.add(state.folder.rootPath);
    }
    const term = new Terminal({
      fontFamily: (state.settings && state.settings.ui && state.settings.ui.fontFamily) || 'Cascadia Code, Consolas, monospace',
      fontSize: (state.settings && state.settings.ui && state.settings.ui.fontSize) || 14,
      cursorBlink: true,
      theme: { background: '#0a0a0d', foreground: '#e8e8ee', cursor: '#ff8c42' }
    });
    const fit = FitAddon ? new FitAddon() : null;
    if (fit) term.loadAddon(fit);
    if (WebLinks) term.loadAddon(new WebLinks());
    term.open(leaf.hostEl);
    if (fit) { try { fit.fit(); } catch {} }

    leaf.term = term;
    leaf.fit = fit;
    leaf.spawnMode = (payload && payload.mode) || 'plain';
    leaf.projectRoot = (payload && payload.cwd) || null;
    attachClipboard(leaf);

    const cols = term.cols, rows = term.rows;
    const result = await api.spawnPty({ ...payload, cols, rows });
    if (result && result.error) {
      term.write(`\r\n\x1b[31m[carrotcap] ${result.error}\x1b[0m\r\n`);
      return;
    }
    leaf.ptyId = result.id;
    leaf.kind = result.kind || (payload.mode || 'plain');
    if (leaf.headEl) {
      const k = leaf.headEl.querySelector('.kind');
      if (k) {
        // 'aor-fallback(plain)' 같은 라벨도 그대로 보이도록 그대로 출력하되 영문 대문자로
        k.textContent = String(leaf.kind || 'plain').toUpperCase();
        // 폴백 케이스는 색상 강조
        if (/fallback/i.test(leaf.kind)) k.style.color = '#f0c060';
        if (result.warning) {
          k.title = result.warning;
          k.textContent += ' ⚠';
        } else if (result.note) {
          k.title = result.note; // 정보성 안내는 툴팁으로만 (경고 표시 없음)
        }
      }
    }
    if (result.warning) setFlowStatus(result.warning, 'warn');
    if (leaf.id === state.activePaneId) updateComposerTarget();

    term.onData((data) => api.writePty(leaf.ptyId, data));
    term.onResize(({ cols, rows }) => api.resizePty(leaf.ptyId, cols, rows));

    setTimeout(() => { try { term.focus(); } catch {} }, 50);
  }

  // ---------- 세션 이어하기 (task-013) ----------
  // 저장: 탭/페인 배치 + 페인별 실행 CLI (터미널 출력·키 입력은 저장하지 않음).
  // 복원: 같은 배치를 다시 만들고 각 CLI를 자기 "이어하기" 옵션으로 실행 → 대화 내용은 CLI가 복원.
  const RESUME_ARGS = { claude: ['--continue'], codex: ['resume', '--last'], grok: ['--continue'] };
  const resumeBox = $('#resume-box');
  const resumeText = $('#resume-text');
  let historyTimer = null;
  let restoring = false;

  // 페인은 만들어질 때의 프로젝트에 속한다 — 다른 프로젝트로 바꿔도 이전 프로젝트의 페인이
  // 새 프로젝트 기록에 섞이지 않는다 (task-012/013 review r4).
  function buildLayout(root) {
    const tabs = [];
    for (const t of state.tabs) {
      const panes = [];
      walkPanes(state.panes.get(t.rootPaneId), (p) => {
        if (p.type === 'leaf' && p.projectRoot === root) panes.push({ mode: p.spawnMode || 'plain', cli: p.cli || null });
      });
      if (panes.length) tabs.push({ panes });
    }
    return { tabs };
  }
  // 예약된 저장은 예약한 순간의 프로젝트에 묶는다 — 그 사이 다른 폴더를 열어도 섞이지 않게.
  let historyPendingRoot = null;
  function flushHistorySave() {
    if (!historyPendingRoot) return;
    clearTimeout(historyTimer);
    const root = historyPendingRoot;
    historyPendingRoot = null;
    // 페인이 하나도 없으면 빈 배치를 보낸다 → main이 이번 세션의 "이어하기" 배치를 지운다.
    api.saveHistory(root, buildLayout(root)).catch(() => {});
  }
  // 첫 변경은 즉시 저장(곧바로 앱을 닫아도 세션이 남게), 이어지는 변경은 800ms로 묶는다.
  let historyLastSaveAt = 0;
  function scheduleHistorySave() {
    if (restoring || !state.folder.rootPath) return;
    if (historyPendingRoot && historyPendingRoot !== state.folder.rootPath) flushHistorySave();
    clearTimeout(historyTimer);
    historyPendingRoot = state.folder.rootPath;
    if (Date.now() - historyLastSaveAt > 800) {
      historyLastSaveAt = Date.now();
      flushHistorySave();
      return;
    }
    historyTimer = setTimeout(() => { historyLastSaveAt = Date.now(); flushHistorySave(); }, 800);
  }
  // 현재 폴더가 아닌 프로젝트의 페인을 닫았을 때: 그 프로젝트 기록도 즉시 갱신 (review r5).
  function saveHistoryForRoots(roots) {
    for (const root of roots) {
      if (!root || root === state.folder.rootPath) continue; // 현재 프로젝트는 scheduleHistorySave가 처리
      api.saveHistory(root, buildLayout(root)).catch(() => {});
    }
  }
  function rootsUnder(node) {
    const roots = new Set();
    walkPanes(node, (p) => { if (p.type === 'leaf' && p.projectRoot) roots.add(p.projectRoot); });
    return roots;
  }
  // 창을 닫을 때 남은 예약분을 바로 보낸다.
  window.addEventListener('beforeunload', () => flushHistorySave());
  function formatWhen(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  async function checkResume() {
    resumeBox.classList.add('hidden');
    const root = state.folder.rootPath;
    if (!root) return;
    let prev = null;
    try { prev = await api.getHistory(root); } catch { prev = null; }
    // 응답이 오는 사이 다른 프로젝트를 열었으면 버린다.
    if (root !== state.folder.rootPath) return;
    if (!prev || !prev.layout || !Array.isArray(prev.layout.tabs)) return;
    const paneCount = prev.layout.tabs.reduce((n, t) => n + t.panes.length, 0);
    const parts = [
      `${formatWhen(prev.startedAt)} 세션`,
      prev.clean ? '정상 종료' : '비정상 종료',
      `탭 ${prev.layout.tabs.length} · 페인 ${paneCount}`
    ];
    if (prev.clis && prev.clis.length) parts.push(prev.clis.join(', '));
    if (prev.lastTask) parts.push(`마지막 ${prev.lastTask}`);
    resumeText.textContent = parts.join(' · ');
    resumeBox.dataset.layout = JSON.stringify(prev.layout);
    resumeBox.dataset.root = root;
    resumeBox.classList.remove('hidden');
  }
  function whenPtyReady(leaf, timeoutMs = 8000) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (leaf.ptyId) return resolve(true);
        if (Date.now() - started > timeoutMs || leaf.exited) return resolve(false);
        setTimeout(tick, 100);
      };
      tick();
    });
  }
  let resumeInProgress = false;
  async function resumeSession() {
    if (resumeInProgress) return; // 두 번 눌러도 한 번만 복원
    let layout;
    try { layout = JSON.parse(resumeBox.dataset.layout || 'null'); } catch { layout = null; }
    const root = resumeBox.dataset.root;
    resumeBox.classList.add('hidden');
    // 제안이 뜬 뒤 다른 프로젝트로 바꿨다면 복원하지 않는다.
    if (!layout || !Array.isArray(layout.tabs) || root !== state.folder.rootPath) return;
    resumeInProgress = true;
    $('#resume-go').disabled = true;
    try {
      await restoreLayout(root, layout);
    } finally {
      resumeInProgress = false;
      $('#resume-go').disabled = false;
    }
  }
  async function restoreLayout(root, layout) {
    // 기존 탭은 절대 닫지 않는다 — 사용자가 이미 쓰고 있는 셸(편집기 등)을 죽일 수 있다.
    restoring = true;
    const launches = [];
    try {
      for (const t of layout.tabs) {
        let leaf = createTab({ mode: t.panes[0].mode });
        launches.push([leaf, t.panes[0].cli]);
        for (const p of t.panes.slice(1)) {
          leaf = splitActive('right', { mode: p.mode });
          if (leaf) launches.push([leaf, p.cli]);
        }
      }
    } finally {
      restoring = false;
    }
    for (const [leaf, cli] of launches) {
      // 복원 도중 다른 프로젝트를 열었으면 여기서 멈춘다 — 원래 프로젝트의 기록은 지우지 않고
      // 성공 메시지도 띄우지 않는다 (다음에 다시 이어할 수 있게).
      if (root !== state.folder.rootPath) return;
      if (!cli || state.cliStatus[cli] === false) continue;
      if (!(await whenPtyReady(leaf))) continue;
      const cmd = cliCommandLine(cli, null, RESUME_ARGS[cli] || []);
      if (!cmd) continue;
      api.writePty(leaf.ptyId, cmd + '\r');
      leaf.cli = cli;
    }
    if (root !== state.folder.rootPath) return;
    // 복원했으니 이전 세션의 배치 정보는 더 필요 없다 — 지금 세션이 새로 기록된다.
    api.dismissHistory(root).catch(() => {});
    scheduleHistorySave();
    setFlowStatus('이전 세션을 복원했습니다 — 각 CLI가 마지막 대화를 이어갑니다', 'ok');
  }
  function bindResume() {
    $('#resume-go').onclick = () => resumeSession();
    $('#resume-dismiss').onclick = () => {
      resumeBox.classList.add('hidden');
      if (resumeBox.dataset.root) api.dismissHistory(resumeBox.dataset.root).catch(() => {});
    };
  }

  // ---------- 입력창 (task-010) ----------
  // 터미널 줄 편집은 프로그램마다 규칙이 달라 전체 선택/삭제가 안 되는 경우가 많다.
  // 입력창은 일반 textarea라 Ctrl+A·Delete·한글 조합이 항상 같은 방식으로 동작하고,
  // Enter를 누르면 활성 페인에 붙여넣기(term.paste: bracketed paste 지원) 후 Enter를 보낸다.
  const composer = $('#composer');
  const composerInput = $('#composer-input');
  const composerTarget = $('#composer-target');
  const COMPOSER_HISTORY_MAX = 50;
  const composerHistory = [];
  let composerHistoryIdx = -1;
  const COMPOSER_HIDDEN_KEY = 'carrotcap.composerHidden';

  function readComposerHidden() {
    try { return localStorage.getItem(COMPOSER_HIDDEN_KEY) === '1'; } catch { return false; }
  }
  function setComposerHidden(hidden) {
    composer.classList.toggle('hidden', hidden);
    try { localStorage.setItem(COMPOSER_HIDDEN_KEY, hidden ? '1' : '0'); } catch { /* per-viewer convenience only */ }
    setTimeout(() => fitAllIn(rootOfTab(state.activeTabId)), 30);
  }
  function autoGrowComposer() {
    composerInput.style.height = 'auto';
    composerInput.style.height = Math.min(composerInput.scrollHeight + 2, 160) + 'px';
  }
  function updateComposerTarget() {
    const leaf = state.panes.get(state.activePaneId);
    const label = leaf && leaf.type === 'leaf'
      ? String(leaf.kind || 'plain').toUpperCase() + (leaf.exited ? ' · 종료됨' : '')
      : '-';
    composerTarget.textContent = `→ ${label}`;
  }
  function focusComposer() {
    if (composer.classList.contains('hidden')) {
      const leaf = state.panes.get(state.activePaneId);
      if (leaf && leaf.term) leaf.term.focus();
      return;
    }
    composerInput.focus();
  }
  function sendComposer() {
    const leaf = state.panes.get(state.activePaneId);
    if (!leaf || leaf.type !== 'leaf' || !leaf.ptyId || !leaf.term) {
      // 보낼 곳이 없으면 입력 내용은 지우지 않는다.
      composerTarget.textContent = leaf && leaf.exited ? '→ 세션 종료됨 — 새 탭/페인에서 보내세요' : '→ 활성 터미널 없음';
      return;
    }
    const text = composerInput.value;
    if (text) {
      leaf.term.paste(text);
      if (composerHistory[composerHistory.length - 1] !== text) composerHistory.push(text);
      if (composerHistory.length > COMPOSER_HISTORY_MAX) composerHistory.shift();
    }
    // Enter는 붙여넣기와 분리해 보낸다 — 붙여넣기 안의 개행으로 취급되어 제출이 안 되는 CLI가 있다.
    // 그 사이 세션이 끝났으면 보내지 않는다.
    const ptyId = leaf.ptyId;
    setTimeout(() => { if (leaf.ptyId === ptyId) api.writePty(ptyId, '\r'); }, text ? 60 : 0);
    composerInput.value = '';
    composerHistoryIdx = -1;
    autoGrowComposer();
  }
  function bindComposer() {
    setComposerHidden(readComposerHidden());
    $('#toggle-composer').onclick = () => {
      setComposerHidden(!composer.classList.contains('hidden'));
      if (!composer.classList.contains('hidden')) composerInput.focus();
    };
    $('#composer-send').onclick = () => { sendComposer(); composerInput.focus(); };
    $('#composer-clear').onclick = () => { composerInput.value = ''; autoGrowComposer(); composerInput.focus(); };
    composerInput.addEventListener('input', autoGrowComposer);
    composerInput.addEventListener('keydown', (e) => {
      if (e.isComposing) return; // 한글 조합 중 Enter는 조합 확정용
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComposer(); return; }
      if (e.key === 'Escape') {
        e.preventDefault();
        const leaf = state.panes.get(state.activePaneId);
        if (leaf && leaf.term) leaf.term.focus();
        return;
      }
      // 입력창이 비었거나 기록을 탐색 중일 때만 ↑/↓로 이전 입력 불러오기
      const browsing = composerHistoryIdx !== -1 || composerInput.value === '';
      if (browsing && composerHistory.length && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        if (e.key === 'ArrowUp') {
          composerHistoryIdx = composerHistoryIdx === -1 ? composerHistory.length - 1 : Math.max(0, composerHistoryIdx - 1);
        } else if (composerHistoryIdx !== -1) {
          composerHistoryIdx = composerHistoryIdx + 1 >= composerHistory.length ? -1 : composerHistoryIdx + 1;
        }
        composerInput.value = composerHistoryIdx === -1 ? '' : composerHistory[composerHistoryIdx];
        autoGrowComposer();
      }
    });
  }

  // ---------- 클립보드 (task-009) ----------
  // Ctrl+C: 선택 영역이 있으면 복사, 없으면 그대로 SIGINT. Ctrl+Shift+C: 복사.
  // Ctrl+Shift+V / Shift+Insert: 붙여넣기. Ctrl+V는 셸/CLI(이미지 붙여넣기 등) 동작을 위해 건드리지 않는다.
  async function copyTermSelection(term) {
    const text = term.getSelection();
    if (!text) return false;
    const r = await api.writeClipboard(text);
    return !!(r && r.ok);
  }
  async function pasteIntoTerm(term) {
    const r = await api.readClipboard();
    if (r && r.ok && r.text) term.paste(r.text);
  }
  function attachClipboard(leaf) {
    const term = leaf.term;
    // 선택은 사용자가 다시 타이핑하기 전까지만 "살아 있다" — 오래된 선택 때문에
    // 중단용 Ctrl+C가 복사로 먹히지 않게 한다 (task-010/011 review).
    term.onData(() => { if (term.hasSelection()) term.clearSelection(); });
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || e.altKey || e.metaKey) return true;
      const key = String(e.key || '').toLowerCase();
      if (e.ctrlKey && key === 'c' && (e.shiftKey || term.hasSelection())) {
        e.preventDefault();
        copyTermSelection(term).then((ok) => { if (ok && !e.shiftKey) term.clearSelection(); });
        return false;
      }
      if ((e.ctrlKey && e.shiftKey && key === 'v') || (!e.ctrlKey && e.shiftKey && key === 'insert')) {
        e.preventDefault();
        pasteIntoTerm(term);
        return false;
      }
      return true;
    });
    leaf.hostEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (leaf.ptyId) api.showTermMenu(leaf.ptyId, term.hasSelection());
    });

    // task-011: copy-on-select. Claude/Codex/Grok TUI는 화면을 계속 다시 그려서 선택이
    // Ctrl+C를 누르기 전에 풀릴 수 있다 — 드래그를 마치는 순간 클립보드에 넣어 둔다.
    // 새로 만든 선택만 복사한다 — 클릭만 하고 선택이 그대로면 클립보드를 덮어쓰지 않는다.
    let mouseDown = false;
    let changedDuringDrag = false;
    leaf.hostEl.addEventListener('mousedown', () => { mouseDown = true; changedDuringDrag = false; });
    leaf.hostEl.addEventListener('mouseup', () => {
      mouseDown = false;
      if (!changedDuringDrag) return;
      setTimeout(() => { if (term.hasSelection()) copyTermSelection(term); }, 0);
    });
    term.onSelectionChange(() => {
      if (mouseDown) { changedDuringDrag = true; return; }
      // 더블클릭(단어)·선택 API처럼 드래그 없이 끝나는 선택
      if (term.hasSelection()) copyTermSelection(term);
    });

    // task-011: 마우스 모드를 켠 TUI에서는 일반 드래그가 앱으로 전달되어 선택이 안 된다.
    // xterm은 Shift+드래그로 강제 선택할 수 있으므로 그때만 헤더에 안내를 띄운다.
    const hint = document.createElement('span');
    hint.className = 'select-hint';
    hint.textContent = 'Shift+드래그로 선택';
    hint.hidden = true;
    if (leaf.headEl) leaf.headEl.insertBefore(hint, leaf.headEl.querySelector('.x'));
    const refreshHint = () => { hint.hidden = !term.modes || term.modes.mouseTrackingMode === 'none'; };
    term.onWriteParsed(refreshHint);
  }

  const MAX_COPY_BYTES = 1024 * 1024;
  function bufferText(term, visibleOnly) {
    const buf = term.buffer.active;
    const start = visibleOnly ? buf.viewportY : 0;
    const end = visibleOnly ? buf.viewportY + term.rows : buf.length;
    const lines = [];
    for (let y = start; y < end; y++) {
      const line = buf.getLine(y);
      if (!line) continue;
      // 줄바꿈으로 이어진(wrapped) 줄은 앞 줄에 붙인다
      if (line.isWrapped && lines.length) lines[lines.length - 1] += line.translateToString(true);
      else lines.push(line.translateToString(true));
    }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    // 1MB(UTF-8) 상한: 최신 줄부터 거꾸로 담고, 넘치면 오래된 줄을 통째로 버린다 (문자 중간 절단 없음).
    const enc = new TextEncoder();
    const kept = [];
    let bytes = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      const size = enc.encode(lines[i]).length + 1;
      if (bytes + size > MAX_COPY_BYTES) break;
      bytes += size;
      kept.push(lines[i]);
    }
    return kept.reverse().join('\n');
  }
  async function copyBuffer(term, visibleOnly) {
    const text = bufferText(term, visibleOnly);
    if (text) await api.writeClipboard(text);
  }
  api.onTermMenuCommand(({ id, command }) => {
    for (const [, p] of state.panes) {
      if (p.type !== 'leaf' || p.ptyId !== id || !p.term) continue;
      if (command === 'copy') copyTermSelection(p.term);
      else if (command === 'copyScreen') copyBuffer(p.term, true);
      else if (command === 'copyAll') copyBuffer(p.term, false);
      else if (command === 'paste') pasteIntoTerm(p.term);
      else if (command === 'selectAll') p.term.selectAll();
      else if (command === 'clear') p.term.clear();
      p.term.focus();
      return;
    }
  });

  // PTY → term 데이터 라우팅
  api.onPtyData(({ id, data }) => {
    for (const [, p] of state.panes) {
      if (p.type === 'leaf' && p.ptyId === id && p.term) {
        p.term.write(data);
        return;
      }
    }
  });
  api.onPtyExit(({ id }) => {
    for (const [, p] of state.panes) {
      if (p.type === 'leaf' && p.ptyId === id && p.term) {
        p.term.write('\r\n\x1b[33m[carrotcap] session ended\x1b[0m\r\n');
        // 끝난 세션으로는 더 이상 보내지 않는다 (입력창이 내용을 지우고 조용히 버리던 문제).
        p.ptyId = null;
        p.exited = true;
        const k = p.headEl && p.headEl.querySelector('.kind');
        if (k) k.textContent = `${String(p.kind || 'plain').toUpperCase()} · 종료됨`;
        if (p.id === state.activePaneId) updateComposerTarget();
        return;
      }
    }
  });

  // ---------- 폴더/검색 ----------
  async function pickFolder() {
    const p = await api.pickFolder();
    if (p) await loadFolder(p);
  }
  async function loadFolder(rootPath) {
    // task-005: changing the workspace invalidates the auto-setup cache so the
    // next AIOps pane in the new workspace re-runs setup if needed.
    const changed = state.folder.rootPath !== rootPath;
    if (changed) {
      state.aiopsAutoSetupDone.clear();
      flushHistorySave(); // 이전 프로젝트 몫의 예약 저장은 이전 프로젝트에 기록
    }
    state.folder.rootPath = rootPath;
    // task-013: 새 프로젝트를 열면 이 프로젝트의 이전 세션을 이어할지 묻는다.
    if (changed) {
      checkResume();
      scheduleHistorySave();
    }
    folderPathEl.textContent = rootPath;
    const tree = await api.getFolderTree(rootPath);
    state.folder.tree = tree;
    renderTree();
    if (state.settings) {
      state.settings.defaultProjectPath = rootPath;
      api.setSettings(state.settings);
    }
    setFlowStatus(state.aiopsMode
      ? 'AIOps 모드 ON: 새 페인이 열리면 워크플로우가 자동 셋업됩니다.'
      : 'SETUP을 누르면 이 폴더에 AI 개발 워크플로우를 만듭니다.');
  }
  function renderTree(filter = '') {
    treeEl.innerHTML = '';
    if (!state.folder.tree) return;
    if (filter && filter.trim()) {
      // 검색 모드 — 평면 결과
      api.searchFiles(state.folder.rootPath, filter.trim()).then((results) => {
        treeEl.innerHTML = '';
        for (const r of results) {
          const n = document.createElement('div');
          n.className = `node ${r.type}`;
          n.textContent = (r.type === 'dir' ? '📁 ' : '📄 ') + r.name;
          n.title = r.path;
          n.draggable = true;
          n.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/carrotcap-path', r.path);
            e.dataTransfer.effectAllowed = 'copy';
          });
          n.addEventListener('dblclick', () => api.showInOS(r.path));
          treeEl.appendChild(n);
        }
      });
      return;
    }
    // 트리 모드
    const renderNode = (node, depth) => {
      const div = document.createElement('div');
      div.className = `node ${node.type}`;
      div.title = node.path;
      div.style.paddingLeft = (depth * 12) + 'px';
      div.textContent = (node.type === 'dir' ? '📁 ' : '📄 ') + node.name;
      div.draggable = true;
      div.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/carrotcap-path', node.path);
        e.dataTransfer.effectAllowed = 'copy';
      });
      div.addEventListener('dblclick', () => api.showInOS(node.path));
      treeEl.appendChild(div);
      if (node.type === 'dir') {
        for (const c of node.children) renderNode(c, depth + 1);
      }
    };
    renderNode(state.folder.tree, 0);
  }

  // ---------- CLI 버튼: 활성 페인에 명령 입력 ----------
  // task-012: 역할 — claude=코딩, codex=코드 리뷰, grok=이미지·영상
  const CLI_ROLES = { claude: '코딩', codex: '코드 리뷰', grok: '이미지·영상' };
  state.cliStatus = {};

  // 셸 문법은 플랫폼마다 다르다: Windows는 PowerShell, macOS/Linux는 POSIX 셸(bash/zsh).
  const isWin = () => state.platform === 'win32';
  function cliCommandLine(key, prompt, extraArgs = []) {
    const cli = state.settings && state.settings.cli && state.settings.cli[key];
    if (!cli) return null;
    const parts = [cli.command, ...(cli.args || []), ...extraArgs];
    if (prompt) parts.push(prompt);
    // PowerShell: & '<cmd>' '<arg>' ... / POSIX: '<cmd>' '<arg>' ... — 공백·따옴표가 든 인자도 안전
    return isWin() ? '& ' + parts.map(psQuote).join(' ') : parts.map(posixQuote).join(' ');
  }
  function inProjectDir(dir, command) {
    return isWin()
      ? `Set-Location -LiteralPath ${psQuote(dir)}; ${command}`
      : `cd -- ${posixQuote(dir)} && ${command}`;
  }

  function activeLeafOrWarn() {
    const leaf = state.panes.get(state.activePaneId);
    if (!leaf || leaf.type !== 'leaf' || !leaf.ptyId) {
      setFlowStatus('활성 터미널 페인이 없습니다', 'warn');
      return null;
    }
    return leaf;
  }

  function cliMissing(key) {
    if (state.cliStatus[key] === false) {
      const cmd = state.settings && state.settings.cli && state.settings.cli[key] ? state.settings.cli[key].command : key;
      setFlowStatus(`'${cmd}' 명령을 찾을 수 없습니다. 설치 후 PATH를 확인하세요.`, 'warn');
      return true;
    }
    return false;
  }

  function runCli(key) {
    const leaf = activeLeafOrWarn();
    if (!leaf || cliMissing(key)) return;
    const cmd = cliCommandLine(key);
    if (!cmd) {
      setFlowStatus(`settings.json에 '${key}' CLI 설정이 없습니다`, 'warn');
      return;
    }
    api.writePty(leaf.ptyId, cmd + '\r');
    leaf.cli = key;
    if (leaf.term) leaf.term.focus();
    scheduleHistorySave();
  }

  async function refreshCliStatus() {
    try { state.cliStatus = (await api.cliStatus()) || {}; } catch { state.cliStatus = {}; }
    document.querySelectorAll('.btn-cli[data-cli], .btn-flow[data-flow]').forEach((b) => {
      const key = b.dataset.cli || (FLOW_STEPS[b.dataset.flow] && FLOW_STEPS[b.dataset.flow].cli);
      if (!key) return;
      const missing = state.cliStatus[key] === false;
      b.classList.toggle('missing', missing);
      if (!b.dataset.baseTitle) b.dataset.baseTitle = b.title || '';
      b.title = missing ? `${b.dataset.baseTitle} — 설치되지 않음 (PATH 확인)` : b.dataset.baseTitle;
    });
  }

  async function setupAiopsWorkflow() {
    if (!state.folder.rootPath) {
      setFlowStatus('프로젝트 폴더를 먼저 선택하세요', 'warn');
      return null;
    }
    const result = await api.setupAiops(state.folder.rootPath);
    if (!result || !result.ok) {
      setFlowStatus((result && result.error) || '워크플로우 세팅 실패', 'warn');
      return null;
    }
    await loadFolder(state.folder.rootPath);
    setFlowStatus('agents/logs/backlog 워크플로우 준비 완료', 'ok');
    return result;
  }

  async function runAiopsFlow(step) {
    const setup = await setupAiopsWorkflow();
    if (!setup) return;

    const flow = FLOW_STEPS[step];
    if (!flow) return;
    const leaf = activeLeafOrWarn();
    if (!leaf || cliMissing(flow.cli)) return;
    // task-012: PowerShell은 `<` 입력 리디렉션을 지원하지 않아 예전 `claude < agents\x.md`는
    // 실행 자체가 실패했다. 규약 파일을 읽으라는 첫 프롬프트로 대화형 CLI를 시작한다.
    const launch = cliCommandLine(flow.cli, flow.prompt);
    if (!launch) {
      setFlowStatus(`settings.json에 '${flow.cli}' CLI 설정이 없습니다`, 'warn');
      return;
    }
    api.writePty(leaf.ptyId, inProjectDir(state.folder.rootPath, launch) + '\r');
    leaf.cli = flow.cli;
    if (leaf.term) leaf.term.focus();
    scheduleHistorySave();
    setFlowStatus(`${step.toUpperCase()}: ${flow.cli} (${CLI_ROLES[flow.cli]}) 을 활성 페인에서 시작했습니다`, 'ok');
  }

  const FLOW_STEPS = {
    start: {
      cli: 'claude',
      prompt: 'agents/supervisor.md 를 읽고 그 절차대로 backlog/ 의 작업을 진행해줘. 너는 코딩 담당이다.'
    },
    review: {
      cli: 'codex',
      prompt: 'agents/reviewer.md 규약에 따라 최근 변경(git diff, 없으면 최근 수정 파일)을 리뷰하고 결과를 logs/review/ 에 저장해줘. 코드는 수정하지 마.'
    },
    media: {
      cli: 'grok',
      prompt: 'agents/media.md 규약을 읽고 대기해줘. 내가 이미지나 영상을 요청하면 그때 만들어 assets/generated/ 에 저장하고 logs/media/ 에 기록해줘.'
    }
  };

  // ---------- 글로벌 이벤트 ----------
  function bindGlobalEvents() {
    bindComposer();
    bindResume();
    newTabBtn.onclick = () => createTab();
    $('#pick-folder').onclick = pickFolder;
    $('#close-pane').onclick = () => closePane(state.activePaneId);

    document.querySelectorAll('.btn-split').forEach(b => {
      b.onclick = () => splitActive(b.dataset.dir);
    });
    document.querySelectorAll('.btn-cli').forEach(b => {
      b.onclick = () => runCli(b.dataset.cli);
    });
    $('#aiops-setup').onclick = () => setupAiopsWorkflow();
    document.querySelectorAll('.btn-flow[data-flow]').forEach(b => {
      b.onclick = () => runAiopsFlow(b.dataset.flow);
    });

    aorToggle.onchange = async (e) => {
      const prevAiops = state.aiopsMode;
      const prevAor   = state.aorMode;
      state.aiopsMode = e.target.checked;
      // AIOps implies AOR — if user turns AIOps on, AOR follows.
      if (state.aiopsMode && !state.aorMode) {
        state.aorMode = true;
        aorModeToggle.checked = true;
      }
      refreshAorBadge();
      const ok = await persistModeSettings();
      if (!ok) {
        // Rollback to keep UI in sync with what is actually persisted.
        state.aiopsMode = prevAiops;
        state.aorMode   = prevAor;
        aorToggle.checked = prevAiops;
        aorModeToggle.checked = prevAor;
        refreshAorBadge();
      }
    };

    aorModeToggle.onchange = async (e) => {
      const prevAiops = state.aiopsMode;
      const prevAor   = state.aorMode;
      state.aorMode = e.target.checked;
      // Turning AOR off forces AIOps off (AIOps cannot run without AOR).
      if (!state.aorMode && state.aiopsMode) {
        state.aiopsMode = false;
        aorToggle.checked = false;
      }
      refreshAorBadge();
      const ok = await persistModeSettings();
      if (!ok) {
        state.aiopsMode = prevAiops;
        state.aorMode   = prevAor;
        aorToggle.checked = prevAiops;
        aorModeToggle.checked = prevAor;
        refreshAorBadge();
      }
    };

    sidebarSearch.addEventListener('input', () => {
      renderTree(sidebarSearch.value);
    });

    // 모달
    $('#open-aor-editor').onclick = async () => {
      modalText.value = await api.getClaudeMd();
      modal.classList.remove('hidden');
    };
    $('#modal-close').onclick = () => modal.classList.add('hidden');
    $('#modal-save').onclick = async () => {
      const saved = await api.setClaudeMd(modalText.value);
      if (!saved || !saved.ok) {
        alert(`CLAUDE.md 저장 실패: ${(saved && saved.error) || '알 수 없는 오류'}`);
        return;
      }
      modal.classList.add('hidden');
    };

    // 단축키 (task-010): 터미널 편집 키(Ctrl+W 단어 삭제, Ctrl+T, Ctrl+Shift+화살표 단어 선택)를
    // 가로채지 않도록 앱 단축키는 Ctrl+Shift / Alt+Shift 조합만 쓴다. 캡처 단계에서 처리해
    // xterm으로 넘어가기 전에 소비한다.
    const SPLIT_KEYS = { ArrowRight: 'right', ArrowLeft: 'left', ArrowUp: 'up', ArrowDown: 'down' };
    window.addEventListener('keydown', (e) => {
      const key = String(e.key || '').toLowerCase();
      const ctrlShift = e.ctrlKey && e.shiftKey && !e.altKey;
      let action = null;
      if (ctrlShift && key === 't') action = () => createTab();
      else if (ctrlShift && key === 'w') action = () => closePane(state.activePaneId);
      else if (ctrlShift && e.code === 'Space') action = () => focusComposer();
      else if (e.altKey && e.shiftKey && !e.ctrlKey && SPLIT_KEYS[e.key]) action = () => splitActive(SPLIT_KEYS[e.key]);
      if (!action) return;
      // 반복 입력(키를 누르고 있을 때)도 터미널로 새지 않게 소비하되, 동작은 한 번만.
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) action();
    }, true);

    // 포커스 복구 (task-010): 사이드바 버튼/트리를 누른 뒤 포커스가 body·버튼에 남으면 타이핑이
    // 허공으로 사라진다. 그 상태에서 글자를 치면 입력창으로 포커스를 옮겨 글자를 받는다.
    document.addEventListener('keydown', (e) => {
      // 'Process'는 IME(한글 등) 조합이 시작될 때의 keydown — 조합도 입력창에서 시작되게 한다.
      const isTextKey = e.key.length === 1 || e.key === 'Process';
      if (e.ctrlKey || e.altKey || e.metaKey || !isTextKey) return;
      const el = document.activeElement;
      const tag = el ? el.tagName : 'BODY';
      if (tag === 'BUTTON' && e.key === ' ') return; // 스페이스는 버튼 누르기
      if (tag === 'BODY' || tag === 'BUTTON' || (el && el.classList && el.classList.contains('node'))) {
        if (!modal.classList.contains('hidden')) return;
        focusComposer();
      }
    }, true);

    window.addEventListener('resize', () => {
      const root = rootOfTab(state.activeTabId);
      if (root) fitAllIn(root);
    });
  }

  // ---------- util ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function psQuote(s) {
    return `'${String(s).replace(/'/g, "''")}'`;
  }

  function posixQuote(s) {
    return `'${String(s).replace(/'/g, "'\\''")}'`;
  }

  // boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
