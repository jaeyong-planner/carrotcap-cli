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
    folder: { rootPath: '', tree: null }
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

  // ---------- 부트 ----------
  async function boot() {
    state.settings = await api.getSettings();

    // 초기 폴더: settings.defaultProjectPath
    if (state.settings && state.settings.defaultProjectPath) {
      await loadFolder(state.settings.defaultProjectPath);
    }

    // 첫 탭 + 첫 페인
    createTab();

    // 글로벌 이벤트
    bindGlobalEvents();
  }

  // ---------- 탭 ----------
  function createTab() {
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
    spawnIntoPane(root, { mode: 'plain', cwd: state.folder.rootPath || undefined });
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
    // 모든 페인 정리
    walkPanes(state.panes.get(tab.rootPaneId), (p) => {
      if (p.type === 'leaf' && p.ptyId) api.killPty(p.ptyId);
      if (p.type === 'leaf' && p.term) p.term.dispose();
      state.panes.delete(p.id);
    });
    tab.pageEl.remove();
    state.tabs.splice(idx, 1);
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
    if (pane && pane.term) setTimeout(() => pane.term.focus(), 10);
  }

  // 활성 leaf를 dir 방향으로 분할
  function splitActive(direction) {
    const leaf = state.panes.get(state.activePaneId);
    if (!leaf || leaf.type !== 'leaf') return;
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
    spawnIntoPane(fresh, { mode: 'plain', cwd: state.folder.rootPath || undefined });

    activatePane(fresh.id);
    setTimeout(() => fitAllIn(rootOfTab(state.activeTabId)), 50);
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
    // xterm.js 5.x: windowsPty (object). windowsMode is deprecated and silently ignored.
    const winPty = (navigator.userAgent.includes('Windows'))
      ? { backend: 'conpty', buildNumber: 19045 }
      : undefined;
    const term = new Terminal({
      fontFamily: (state.settings && state.settings.ui && state.settings.ui.fontFamily) || 'Cascadia Code, Consolas, monospace',
      fontSize: (state.settings && state.settings.ui && state.settings.ui.fontSize) || 14,
      cursorBlink: true,
      convertEol: false,
      windowsPty: winPty,
      theme: { background: '#0a0a0d', foreground: '#e8e8ee', cursor: '#ff8c42' }
    });

    // Let xterm.js handle Backspace/Delete with its defaults:
    //   Backspace -> 0x7f (DEL)  ← PSReadLine maps this to BackwardDeleteChar (one char back).
    //   Delete    -> ESC [ 3 ~   ← standard sequence, accepted by PowerShell/bash.
    // We intentionally do NOT remap Backspace to 0x08; that triggers PSReadLine's
    // BackwardKillLine in some configurations and wipes the entire line.
    term.attachCustomKeyEventHandler((ev) => {
      // Only swallow Ctrl+Shift+C/V at the window-level handler. Everything else passes through.
      if (ev.type === 'keydown' && ev.ctrlKey && ev.shiftKey &&
          (ev.key.toLowerCase() === 'c' || ev.key.toLowerCase() === 'v')) {
        return false;
      }
      return true;
    });
    const fit = FitAddon ? new FitAddon() : null;
    if (fit) term.loadAddon(fit);
    if (WebLinks) term.loadAddon(new WebLinks());
    term.open(leaf.hostEl);
    if (fit) { try { fit.fit(); } catch {} }

    leaf.term = term;
    leaf.fit = fit;

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
      }
      // 폴백 상태(PTY 미가용)에서만 시각적 경고를 띄운다. 정상 PTY 상태에선 추가 라벨 없음.
      const existing = leaf.headEl.querySelector('.shell-tag');
      if (existing) existing.remove();
      if (result.ptyMode === 'pipe-fallback' && result.shell) {
        const tag = document.createElement('span');
        tag.className = 'shell-tag';
        tag.style.cssText = 'margin-left:8px;color:#f0c060;font-size:10px;opacity:0.9;';
        tag.textContent = '(no-PTY)';
        tag.title = 'node-pty unavailable. Run scripts\\fix-pty.ps1 to enable PTY.';
        leaf.headEl.querySelector('.kind').after(tag);
      }
    }

    // Send xterm key bytes verbatim. PSReadLine + node-pty handle DEL (0x7f) and CSI 3~ correctly.
    term.onData((data) => api.writePty(leaf.ptyId, data));
    term.onResize(({ cols, rows }) => api.resizePty(leaf.ptyId, cols, rows));

    setTimeout(() => { try { term.focus(); } catch {} }, 50);
  }

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
        return;
      }
    }
  });

  // ---------- 폴더/검색 ----------
  async function pickFolder() {
    if (!api || typeof api.pickFolder !== 'function') {
      console.error('[carrotcap] api.pickFolder is not available. preload bridge missing?');
      return;
    }
    try {
      const p = await api.pickFolder();
      if (p) await loadFolder(p);
    } catch (err) {
      console.error('[carrotcap] pickFolder failed:', err && (err.stack || err.message || err));
    }
  }
  async function loadFolder(rootPath) {
    state.folder.rootPath = rootPath;
    folderPathEl.textContent = rootPath;
    const tree = await api.getFolderTree(rootPath);
    state.folder.tree = tree;
    renderTree();
    if (state.settings) {
      state.settings.defaultProjectPath = rootPath;
      api.setSettings(state.settings);
    }
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
  function runCli(key) {
    const leaf = state.panes.get(state.activePaneId);
    if (!leaf || leaf.type !== 'leaf' || !leaf.ptyId) {
      console.warn('[carrotcap] No active pane or ptyId for CLI:', key);
      return;
    }
    const cli = state.settings && state.settings.cli && state.settings.cli[key];
    if (!cli) {
      console.warn('[carrotcap] CLI config not found:', key);
      return;
    }
    const cmd = [cli.command, ...(cli.args || [])].join(' ');
    api.writePty(leaf.ptyId, cmd + '\r');
    if (leaf.term) leaf.term.focus();
  }

  // ---------- 글로벌 이벤트 ----------
  function bindGlobalEvents() {
    newTabBtn.onclick = () => createTab();
    $('#pick-folder').onclick = pickFolder;
    $('#close-pane').onclick = () => closePane(state.activePaneId);

    document.querySelectorAll('.btn-split').forEach(b => {
      b.onclick = () => splitActive(b.dataset.dir);
    });
    document.querySelectorAll('.btn-cli').forEach(b => {
      b.onclick = () => runCli(b.dataset.cli);
    });

    sidebarSearch.addEventListener('input', () => {
      renderTree(sidebarSearch.value);
    });

    // 단축키
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 't') { e.preventDefault(); createTab(); }
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'w') { e.preventDefault(); closePane(state.activePaneId); }
      if (e.ctrlKey && e.shiftKey) {
        // Ctrl+Shift+C — 활성 페인 xterm의 선택 텍스트 복사
        if (e.key.toLowerCase() === 'c') {
          const leaf = state.panes.get(state.activePaneId);
          if (leaf && leaf.term) {
            const sel = leaf.term.getSelection();
            if (sel && sel.length > 0) {
              api.clipboardWrite(sel);
              e.preventDefault();
              return;
            }
          }
        }
        // Ctrl+Shift+V — paste clipboard text into PTY
        if (e.key.toLowerCase() === 'v') {
          const leaf = state.panes.get(state.activePaneId);
          if (leaf && leaf.ptyId) {
            const txt = api.clipboardRead();
            if (txt) {
              // Normalize CRLF to LF so PowerShell receives one line at a time.
              api.writePty(leaf.ptyId, String(txt).replace(/\r\n/g, '\n'));
              if (leaf.term) { try { leaf.term.focus(); } catch (err) {} }
            }
            e.preventDefault();
            return;
          }
        }
        if (e.key === 'ArrowRight') { e.preventDefault(); splitActive('right'); }
        if (e.key === 'ArrowLeft')  { e.preventDefault(); splitActive('left'); }
        if (e.key === 'ArrowUp')    { e.preventDefault(); splitActive('up'); }
        if (e.key === 'ArrowDown')  { e.preventDefault(); splitActive('down'); }
      }
    });

    window.addEventListener('resize', () => {
      const root = rootOfTab(state.activeTabId);
      if (root) fitAllIn(root);
    });
  }

  // ---------- util ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

