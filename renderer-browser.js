/* CARROTCAP CLI — 브라우저 모드 렌더러 (task-015)
 * 가운데 영역에 BrowserView(main-browser.js)를 띄우고, 주석·콘솔 에러를 모아
 * 입력창 전송 시 [브라우저 컨텍스트] 블록으로 에이전트에게 함께 보낸다.
 * renderer.js는 window.CarrotcapBrowser.decorate(text, projectRoot)만 호출한다.
 */
(() => {
  const api = window.carrotcap;
  const $ = (s) => document.querySelector(s);
  const area = $('#browser-area');
  const viewport = $('#browser-viewport');
  const frame = $('#browser-frame');
  const empty = $('#browser-empty');
  const urlInput = $('#br-url');
  const pinsEl = $('#br-pins');
  const errCount = $('#br-err-count');
  const consoleEl = $('#browser-console');
  const annotateBtn = $('#br-annotate');
  const includeErrors = $('#br-include-errors');
  const modal = $('#modal');

  const st = {
    active: false,     // browser mode on (layout)
    open: false,       // a page is loaded in the view
    device: 'desktop',
    url: '',
    pins: [],          // [{ n, selector, tag, text, rect, viewport }]
    newErrors: 0,
    annotating: false,
    pickToken: 0,
    openToken: 0,
    navPending: false,
    pageGen: -1        // main의 문서 세대 — browser:state로 갱신
  };
  // 에이전트 CLI만 브라우저 컨텍스트를 받는다 — 일반 셸에 붙여넣으면 줄마다 명령으로 실행된다.
  const AGENT_CLIS = new Set(['claude', 'codex', 'grok']);
  // 페이지에서 온 문자열은 main에서 한 번 정리되지만, 붙여넣기 직전에 한 번 더 한 줄로 만든다.
  const oneLine = (s, max = 600) => String(s == null ? '' : s)
    .replace(/[\u0000-\u001F\u007F-\u009F\u{2028}\u{2029}]/gu, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);

  // ---- 레이아웃: #browser-frame 위치를 BrowserView bounds로 보낸다 ----
  function sendBounds() {
    if (!st.active || !st.open || !modal.classList.contains('hidden')) {
      api.browserBounds({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    const r = frame.getBoundingClientRect();
    api.browserBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
  }
  new ResizeObserver(sendBounds).observe(frame);
  window.addEventListener('resize', sendBounds);
  // 모달(CLAUDE.md 편집기)은 DOM이라 네이티브 BrowserView 아래에 깔린다 → 열려 있는 동안 숨김
  new MutationObserver(sendBounds).observe(modal, { attributes: true, attributeFilter: ['class'] });

  function setActive(on) {
    st.active = on;
    st.openToken++; // 진행 중인 열기 결과는 무효 (닫은 뒤 늦게 도착한 응답이 상태를 되살리지 않게)
    area.classList.toggle('hidden', !on);
    document.body.classList.toggle('browser-mode', on);
    $('#toggle-browser').classList.toggle('active', on);
    if (!on) {
      stopAnnotating();
      api.browserClose();
      st.open = false;
      st.pins = [];
      renderPins();
    }
    // 오른쪽 터미널 폭이 바뀌었으니 xterm 크기 재계산 (renderer.js의 resize 핸들러)
    setTimeout(() => { window.dispatchEvent(new Event('resize')); sendBounds(); }, 30);
    if (on) setTimeout(() => urlInput.focus(), 50);
  }

  async function openUrl() {
    if (!st.active) return;
    const token = ++st.openToken;
    const res = await api.browserOpen(urlInput.value);
    if (token !== st.openToken || !st.active) {
      if (!st.active) api.browserClose(); // 기다리는 사이 브라우저 모드를 껐다
      return;
    }
    if (!res || !res.ok) {
      empty.textContent = (res && res.error) || '열 수 없는 주소입니다.';
      empty.hidden = false;
      return;
    }
    st.open = true;
    empty.hidden = true;
    sendBounds();
  }

  async function setDevice(mode) {
    st.device = await api.browserDevice(mode);
    viewport.classList.toggle('mobile', st.device === 'mobile');
    $('#br-desktop').classList.toggle('active', st.device !== 'mobile');
    $('#br-mobile').classList.toggle('active', st.device === 'mobile');
    setTimeout(sendBounds, 30);
  }

  // ---- 주석 ----
  function renderPins() {
    pinsEl.innerHTML = '';
    for (const p of st.pins) {
      const el = document.createElement('span');
      el.className = 'br-pin';
      el.textContent = `${p.n} ${p.tag}${p.text ? ` "${p.text}"` : ''}`;
      el.title = p.selector;
      pinsEl.appendChild(el);
    }
    if (!st.pins.length) {
      const hint = document.createElement('span');
      hint.className = 'muted small';
      hint.textContent = st.annotating ? '페이지에서 요소를 클릭하세요 (Esc 끝내기)' : '📍 주석을 켜고 문제 있는 요소를 클릭한 뒤, 오른쪽 입력창에 "1번 버튼이 안 눌려"처럼 적어 보내세요';
      pinsEl.appendChild(hint);
    }
  }
  async function annotateLoop() {
    const token = ++st.pickToken;
    while (st.annotating && token === st.pickToken) {
      const pick = await api.browserPick();
      if (token !== st.pickToken) return;     // 페이지 이동·지우기 등으로 새 루프가 시작됨
      // 끝난 이유를 구분한다 (review r2 M4): 사용자가 Esc를 누른 경우에만 주석 모드를 끈다.
      if (!pick || pick.cancelled === 'esc') { stopAnnotating(); return; }
      if (pick.cancelled === 'cancel') return; // 앱이 취소함 (끄기/지우기가 이미 처리)
      if (pick.cancelled === 'gone') {         // 페이지가 바뀌는 중 — 잠시 뒤 새 페이지에 다시 건다
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      st.pins.push(pick);
      renderPins();
    }
  }
  function startAnnotating() {
    if (!st.open) return;
    st.annotating = true;
    annotateBtn.classList.add('active');
    renderPins();
    annotateLoop();
  }
  function stopAnnotating() {
    if (!st.annotating) return;
    st.annotating = false;
    st.pickToken++;
    annotateBtn.classList.remove('active');
    api.browserPickCancel();
    renderPins();
  }
  async function clearPins() {
    st.pickToken++; // 지우기로 취소된 이전 pick(null)이 주석 모드를 끄지 않게
    st.pins = [];
    await api.browserClearPins();
    renderPins();
    if (st.annotating) annotateLoop(); // 오버레이가 지워졌으니 다시 건다
  }

  // ---- 콘솔 ----
  async function renderConsole() {
    const list = await api.browserErrors();
    consoleEl.innerHTML = '';
    if (!list.length) {
      consoleEl.textContent = '콘솔 에러 없음';
      return;
    }
    for (const e of list.slice().reverse()) {
      const row = document.createElement('div');
      row.className = 'br-err';
      row.textContent = `[${e.level}] ${e.message}`;
      const src = document.createElement('span');
      src.className = 'src';
      src.textContent = e.source ? `  (${e.source}${e.line ? ':' + e.line : ''})` : '';
      row.appendChild(src);
      consoleEl.appendChild(row);
    }
  }

  api.onBrowserState((s) => {
    if (!s || !s.open) return;
    const prevUrl = st.url;
    st.url = s.url || '';
    if (document.activeElement !== urlInput && s.url) urlInput.value = s.url;
    $('#br-back').disabled = !s.canGoBack;
    $('#br-forward').disabled = !s.canGoForward;
    st.newErrors = s.newErrors || 0;
    if (Number.isInteger(s.pageGen)) st.pageGen = s.pageGen;
    errCount.textContent = String(s.errorCount || 0);
    errCount.classList.toggle('has', st.newErrors > 0);
    if (!consoleEl.classList.contains('hidden')) renderConsole();
    // 다른 페이지로 이동하면 핀(페이지 DOM)이 사라진다 → 목록을 비우고, 이전 pick(이동으로 null)은
    // 무시하도록 토큰을 올린 뒤, 로드가 끝나면 주석 오버레이를 새 페이지에 다시 건다.
    if (prevUrl && st.url && prevUrl.split('#')[0] !== st.url.split('#')[0]) {
      st.pickToken++;
      st.pins = [];
      st.navPending = true;
      renderPins();
    }
    if (st.navPending && !s.loading) {
      st.navPending = false;
      if (st.annotating) annotateLoop();
    }
  });

  // ---- 채팅 연동: 입력창 전송 직전에 호출 ----
  function fmtRect(r) { return `x=${r.x}, y=${r.y}, ${r.width}×${r.height}`; }
  // 입력창 전송 직전: 붙일 컨텍스트를 만든다. 아무것도 소비하지 않고,
  // 터미널에 실제로 보낸 뒤 commit()을 불러야 주석·에러가 "보냄"이 된다.
  //   반환: { text, commit } | { blocked: '이유' }
  async function decorate(text, projectRoot, target) {
    const plain = { text, commit: () => {} };
    if (!st.active || !st.open) return plain;
    const wantErrors = includeErrors.checked && st.newErrors > 0;
    if (!st.pins.length && !wantErrors) return plain;
    // 여러 줄 컨텍스트는 에이전트 CLI(bracketed paste를 켜는 대화형 앱)에만 보낸다.
    // 일반 PowerShell에 붙이면 페이지가 만든 문자열이 명령으로 실행될 수 있다 (review C3).
    const isAgent = target && AGENT_CLIS.has(target.cli) && target.bracketedPaste;
    if (!isAgent) {
      return { blocked: '브라우저 주석·콘솔 에러는 CLAUDE/CODEX 버튼으로 실행한 에이전트 페인에만 보낼 수 있습니다' };
    }
    const ctx = await api.browserContext({ projectRoot, screenshot: st.pins.length > 0, includeErrors: wantErrors, gen: st.pageGen });
    if (!ctx) return plain;
    if (ctx.stale) {
      // 준비하는 사이 페이지가 바뀌었다 — 옛 페이지의 주석을 새 페이지 설명으로 보내지 않는다
      st.pins = [];
      renderPins();
      return { blocked: '페이지가 바뀌어 주석이 사라졌습니다 — 새 페이지에서 다시 찍어 주세요' };
    }
    const pins = st.pins.slice();
    const lines = ['[브라우저 컨텍스트 — CARROTCAP]'];
    lines.push(`URL: ${oneLine(ctx.url, 2048)}${ctx.title ? ` (${oneLine(ctx.title, 200)})` : ''}`);
    lines.push(`보기: ${ctx.device === 'mobile' ? '모바일 390×844 (터치·모바일 UA)' : 'PC'}`);
    if (ctx.screenshot) lines.push(`화면 캡처(주석 번호 표시): ${oneLine(ctx.screenshot, 1024)}`);
    if (pins.length) {
      lines.push('주석:');
      for (const p of pins) {
        lines.push(`  ${p.n}) <${oneLine(p.tag, 20)}> ${oneLine(p.selector, 300)}${p.text ? ` — "${oneLine(p.text, 120)}"` : ''} @ ${fmtRect(p.rect)} (뷰포트 ${p.viewport.width}×${p.viewport.height})`);
      }
    }
    if (ctx.errors && ctx.errors.length) {
      lines.push(`콘솔 에러 (이전 전송 이후 ${ctx.errors.length + (ctx.errorsSkipped || 0)}건${ctx.errorsSkipped ? `, 최근 ${ctx.errors.length}건만` : ''}):`);
      for (const e of ctx.errors) {
        lines.push(`  - [${oneLine(e.level, 10)}] ${oneLine(e.message)}${e.source ? ` (${oneLine(e.source, 300)}${e.line ? ':' + e.line : ''})` : ''}`);
      }
    }
    lines.push('[요청]');
    lines.push(text || '(주석 위치의 문제를 확인해줘)');
    const commit = () => {
      if (wantErrors) api.browserCommit(ctx.errorMark);
      // 이번에 보낸 핀만 지운다 — 전송을 준비하는 사이 새로 찍은 핀은 목록·페이지 모두 남는다 (review r2).
      const sent = pins.map((p) => p.n);
      st.pins = st.pins.filter((p) => !sent.includes(p.n));
      api.browserClearPins(sent, ctx.gen);
      renderPins();
    };
    return { text: lines.join('\n'), commit, context: true };
  }

  // ---- 이벤트 ----
  function bind() {
    $('#toggle-browser').onclick = () => setActive(!st.active);
    $('#br-go').onclick = openUrl;
    urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); openUrl(); } });
    $('#br-back').onclick = () => api.browserNav('back');
    $('#br-forward').onclick = () => api.browserNav('forward');
    $('#br-reload').onclick = () => api.browserNav('reload');
    $('#br-desktop').onclick = () => setDevice('desktop');
    $('#br-mobile').onclick = () => setDevice('mobile');
    annotateBtn.onclick = () => (st.annotating ? stopAnnotating() : startAnnotating());
    $('#br-clear').onclick = clearPins;
    $('#br-console').onclick = () => {
      consoleEl.classList.toggle('hidden');
      if (!consoleEl.classList.contains('hidden')) renderConsole();
      setTimeout(sendBounds, 30);
    };
    renderPins();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();

  window.CarrotcapBrowser = { decorate, isActive: () => st.active && st.open };
})();
