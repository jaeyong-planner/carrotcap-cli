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
    pickToken: 0
  };

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
    const res = await api.browserOpen(urlInput.value);
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
      if (token !== st.pickToken) return;     // 페이지 이동 등으로 새 루프가 시작됨
      if (!pick) { stopAnnotating(); return; } // Esc / 취소
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
    errCount.textContent = String(s.errorCount || 0);
    errCount.classList.toggle('has', st.newErrors > 0);
    if (!consoleEl.classList.contains('hidden')) renderConsole();
    // 다른 페이지로 이동하면 핀(페이지 DOM)이 사라진다 → 목록도 비우고, 주석 중이면 새 페이지에 다시 건다
    if (prevUrl && st.url && prevUrl.split('#')[0] !== st.url.split('#')[0]) {
      st.pins = [];
      renderPins();
      if (st.annotating && !s.loading) annotateLoop();
    }
  });

  // ---- 채팅 연동: 입력창 전송 직전에 호출 ----
  function fmtRect(r) { return `x=${r.x}, y=${r.y}, ${r.width}×${r.height}`; }
  async function decorate(text, projectRoot) {
    if (!st.active || !st.open) return text;
    const wantErrors = includeErrors.checked && st.newErrors > 0;
    if (!st.pins.length && !wantErrors) return text;
    const ctx = await api.browserContext({ projectRoot, screenshot: st.pins.length > 0, includeErrors: wantErrors });
    if (!ctx) return text;
    const lines = ['[브라우저 컨텍스트 — CARROTCAP]'];
    lines.push(`URL: ${ctx.url}${ctx.title ? ` (${ctx.title})` : ''}`);
    lines.push(`보기: ${ctx.device === 'mobile' ? '모바일 390×844 (터치·모바일 UA)' : 'PC'}`);
    if (ctx.screenshot) lines.push(`화면 캡처(주석 번호 표시): ${ctx.screenshot}`);
    if (st.pins.length) {
      lines.push('주석:');
      for (const p of st.pins) {
        lines.push(`  ${p.n}) <${p.tag}> ${p.selector}${p.text ? ` — "${p.text}"` : ''} @ ${fmtRect(p.rect)} (뷰포트 ${p.viewport.width}×${p.viewport.height})`);
      }
    }
    if (ctx.errors && ctx.errors.length) {
      lines.push(`콘솔 에러 (이전 전송 이후 ${ctx.errors.length + (ctx.errorsSkipped || 0)}건${ctx.errorsSkipped ? `, 최근 ${ctx.errors.length}건만` : ''}):`);
      for (const e of ctx.errors) lines.push(`  - [${e.level}] ${e.message}${e.source ? ` (${e.source}${e.line ? ':' + e.line : ''})` : ''}`);
    }
    lines.push('[요청]');
    lines.push(text || '(주석 위치의 문제를 확인해줘)');
    // 보낸 주석은 소비된다 — 다음 질문은 새 주석으로
    st.pickToken++;
    st.pins = [];
    api.browserClearPins().then(() => { if (st.annotating) annotateLoop(); });
    renderPins();
    return lines.join('\n');
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
