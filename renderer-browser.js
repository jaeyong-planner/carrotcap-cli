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
  const errorsToChat = $('#br-errors-to-chat');
  const composerInput = $('#composer-input');
  const attachEl = $('#composer-attach');
  const modal = $('#modal');
  const MAX_PINS = 20; // main-browser.js MAX_PINS와 같게 유지

  const st = {
    active: false,     // browser mode on (layout)
    open: false,       // a page is loaded in the view
    device: 'desktop',
    url: '',
    pins: [],          // [{ n, selector, tag, text, rect, viewport }]
    full: false,       // 주석 상한에 닿음
    newErrors: 0,
    attach: null,      // 입력창에 첨부한 콘솔 에러 { gen, mark, lines, total, skipped }
    attaching: false,
    sending: false,    // 입력창 전송 중 — 첨부 새로고침을 막는다 (review r5)
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
      dropAttachment('브라우저를 닫아 콘솔 에러 첨부를 뺐습니다');
      renderErrorsButton();
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
    renderErrorsButton();
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
    if (st.pins.length < MAX_PINS) st.full = false; // 보내거나 지워서 자리가 나면 안내를 거둔다
    for (const p of st.pins) {
      const el = document.createElement('span');
      el.className = 'br-pin';
      el.textContent = `${p.n} ${p.tag}${p.text ? ` "${p.text}"` : ''}`;
      el.title = p.selector;
      pinsEl.appendChild(el);
    }
    if (st.full && st.pins.length) {
      const hint = document.createElement('span');
      hint.className = 'muted small';
      hint.textContent = `주석은 한 번에 ${MAX_PINS}개까지 — 먼저 보내거나 지워 주세요`;
      pinsEl.appendChild(hint);
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
      if (st.pins.length >= MAX_PINS) { st.full = true; stopAnnotating(); return; }
      const pick = await api.browserPick();
      if (token !== st.pickToken) return;     // 페이지 이동·지우기 등으로 새 루프가 시작됨
      // 끝난 이유를 구분한다 (review r2 M4): 사용자가 Esc를 누른 경우에만 주석 모드를 끈다.
      if (!pick || pick.cancelled === 'esc') { stopAnnotating(); return; }
      if (pick.cancelled === 'full') { st.full = true; stopAnnotating(); return; } // main이 센 상한 (review r11)
      if (pick.cancelled === 'cancel') return; // 앱이 취소함 (끄기/지우기가 이미 처리)
      if (pick.cancelled === 'gone') {         // 페이지가 바뀌는 중 — 잠시 뒤 새 페이지에 다시 건다
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      if (st.pins.length >= MAX_PINS) { st.full = true; stopAnnotating(); return; }
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
    if (s && !s.open) dropAttachment(); // the view is gone: its errors go with it
    if (!s || !s.open) return;
    st.url = s.url || '';
    if (document.activeElement !== urlInput && s.url) urlInput.value = s.url;
    $('#br-back').disabled = !s.canGoBack;
    $('#br-forward').disabled = !s.canGoForward;
    st.newErrors = s.newErrors || 0;
    errCount.textContent = String(s.errorCount || 0);
    errCount.classList.toggle('has', st.newErrors > 0);
    renderErrorsButton();
    if (!consoleEl.classList.contains('hidden')) renderConsole();
    // 새 문서(이동·같은 URL 새로고침·뒤로가기)면 핀(페이지 DOM)이 사라진다. URL이 아니라 main의
    // 문서 세대로 판단한다 (review r4). 이전 pick 결과는 토큰으로 무시하고, 로드가 끝나면
    // 주석 오버레이를 새 문서에 다시 건다.
    if (Number.isInteger(s.pageGen) && s.pageGen !== st.pageGen) {
      const firstState = st.pageGen === -1;
      st.pageGen = s.pageGen;
      if (!firstState || st.pins.length) {
        st.pickToken++;
        st.pins = [];
        st.navPending = true;
        renderPins();
      }
      // 첨부한 콘솔 에러는 그 문서의 것 — 새 문서면 뗀다 (task-019)
      if (st.attach && st.attach.gen !== st.pageGen) dropAttachment('페이지가 바뀌어 콘솔 에러 첨부를 뺐습니다');
    }
    if (st.navPending && !s.loading) {
      st.navPending = false;
      if (st.annotating) annotateLoop();
    }
  });

  // ---- 채팅 연동: 입력창 전송 직전에 호출 ----
  function fmtRect(r) { return `x=${r.x}, y=${r.y}, ${r.width}×${r.height}`; }
  // 콘솔 에러 첨부 (task-019, review r1-r3): 버튼을 누르면 새 콘솔 에러를 입력창에 "첨부"한다 —
  // 읽기 전용 칩(개수·미리보기·✕)으로 보이고, 페이지가 만든 문자열은 편집 가능한 입력 내용·기록·
  // 클립보드에 들어가지 않는다. 보낼 때 주석과 같은 보호 경로(에이전트 페인 전용, guarded paste)로만
  // 붙는다. 첨부는 그 문서의 것 — 페이지가 바뀌거나 브라우저를 닫으면 떨어진다.
  const MAX_PREVIEW = 3;
  function isAgentTarget(target) {
    return !!(target && AGENT_CLIS.has(target.cli) && target.bracketedPaste);
  }
  function notify(text) {
    window.dispatchEvent(new CustomEvent('carrotcap:notice', { detail: String(text) }));
  }
  function dropAttachment(reason) {
    if (!st.attach) return;
    st.attach = null;
    renderAttach();
    renderErrorsButton();
    if (reason) notify(reason);
  }
  function renderAttach() {
    if (!attachEl) return;
    attachEl.textContent = '';
    attachEl.hidden = !st.attach;
    if (!st.attach) return;
    const head = document.createElement('div');
    head.className = 'composer-attach-head';
    const title = document.createElement('span');
    title.textContent = `⚠ 콘솔 에러 ${st.attach.total}건 첨부${st.attach.skipped ? ` (최근 ${st.attach.lines.length}건)` : ''}`;
    const remove = document.createElement('button');
    remove.id = 'composer-attach-remove';
    remove.className = 'icon-btn';
    remove.title = '첨부 빼기';
    remove.setAttribute('aria-label', '콘솔 에러 첨부 빼기');
    remove.textContent = '✕';
    remove.onclick = () => dropAttachment();
    head.append(title, remove);
    attachEl.appendChild(head);
    for (const l of st.attach.lines.slice(0, MAX_PREVIEW)) {
      const row = document.createElement('div');
      row.className = 'composer-attach-line';
      row.textContent = l; // textContent only — page text never becomes markup
      attachEl.appendChild(row);
    }
    if (st.attach.lines.length > MAX_PREVIEW) {
      const more = document.createElement('div');
      more.className = 'composer-attach-line muted';
      more.textContent = `… 외 ${st.attach.lines.length - MAX_PREVIEW}건`;
      attachEl.appendChild(more);
    }
  }

  // 입력창 전송 직전: 붙일 컨텍스트를 만든다. 아무것도 소비하지 않고,
  // 터미널에 실제로 보낸 뒤 commit()을 불러야 주석·에러가 "보냄"이 된다.
  //   반환: { text, commit } | { blocked: '이유' }
  async function decorate(text, projectRoot, target) {
    const plain = { text, commit: () => {} };
    const attach = st.attach;
    if (!st.active || !st.open) return plain; // 닫을 때 첨부도 떨어진다 (setActive)
    if (!st.pins.length && !attach) return plain;
    // 여러 줄 컨텍스트는 에이전트 CLI(bracketed paste를 켜는 대화형 앱)에만 보낸다.
    // 일반 PowerShell에 붙이면 페이지가 만든 문자열이 명령으로 실행될 수 있다 (review C3).
    if (!isAgentTarget(target)) {
      return { blocked: '브라우저 주석·콘솔 에러는 CLAUDE/CODEX 버튼으로 실행한 에이전트 페인에만 보낼 수 있습니다' };
    }
    if (attach && attach.gen !== st.pageGen) {
      dropAttachment();
      return { blocked: '페이지가 바뀌어 콘솔 에러 첨부를 뺐습니다 — 새 페이지에서 다시 첨부하세요' };
    }
    const ctx = await api.browserContext({ projectRoot, screenshot: st.pins.length > 0, includeErrors: false, gen: st.pageGen });
    if (!ctx) return attach ? { blocked: '브라우저 컨텍스트를 만들지 못했습니다 — 다시 시도하세요' } : plain;
    if (ctx.stale) {
      // 준비하는 사이 페이지가 바뀌었다 — 옛 페이지의 주석·에러를 새 페이지 설명으로 보내지 않는다
      st.pins = [];
      renderPins();
      dropAttachment();
      return { blocked: '페이지가 바뀌었습니다 — 새 페이지에서 주석·콘솔 에러를 다시 넣어 주세요' };
    }
    const pins = st.pins.slice(0, MAX_PINS);
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
    if (attach) {
      lines.push(`콘솔 에러 (이전 전송 이후 ${attach.total}건${attach.skipped ? `, 최근 ${attach.lines.length}건만` : ''}):`);
      for (const l of attach.lines) lines.push(`  - ${l}`);
    }
    lines.push('[요청]');
    // 모든 컨텍스트 줄은 "# "로 시작한다 — 만에 하나 셸이 받더라도 PowerShell·bash 모두 줄 주석이라
    // 실행되지 않는다 (줄바꿈은 이미 제거되어 주석을 벗어날 수 없음). 에이전트에게는 그냥 읽히는 텍스트.
    const ask = text || (pins.length ? '(주석 위치의 문제를 확인해줘)' : '(콘솔 에러를 확인해줘)');
    const block = lines.map((l) => `# ${l}`).join('\n') + '\n' + ask;
    const commit = () => {
      // 첨부한 시점까지의 에러만 "보냄" — 그 뒤에 난 에러는 계속 새 에러로 남는다.
      if (attach) {
        api.browserCommit(attach.mark);
        // Any attachment still shown is either this one or one made during the send — the
        // latter may repeat what was just delivered, so it goes too (review r5).
        if (st.attach) {
          const other = st.attach !== attach;
          st.attach = null;
          renderAttach();
          if (other) notify('보내는 동안 바뀐 콘솔 에러 첨부를 뺐습니다 — 필요하면 다시 첨부하세요');
        }
      }
      // 이번에 보낸 핀만 지운다 — 전송을 준비하는 사이 새로 찍은 핀은 목록·페이지 모두 남는다 (review r2).
      const sent = pins.map((p) => p.n);
      st.pins = st.pins.filter((p) => !sent.includes(p.n));
      api.browserClearPins(sent, ctx.gen);
      renderPins();
      renderErrorsButton();
    };
    // valid(): checked right before delivery — if the user removed or refreshed the attachment
    // while this send was being prepared, nothing is sent (review r4).
    const valid = () => !attach || st.attach === attach;
    return { text: block, commit, context: true, token: ctx.token, valid };
  }

  // ---- 콘솔 에러 → 입력창 첨부 (task-019) ----
  function renderErrorsButton() {
    if (!errorsToChat) return;
    const n = st.newErrors;
    errorsToChat.disabled = st.attaching || st.sending || !st.open || n === 0;
    errorsToChat.textContent = n === 0 ? '새 콘솔 에러 없음'
      : st.attach ? `⚠ 새 콘솔 에러 ${n}건 → 첨부 새로고침` : `⚠ 새 콘솔 에러 ${n}건 → 채팅에 첨부`;
  }
  async function attachErrors() {
    if (st.attaching || st.sending || !st.open) return;
    st.attaching = true; // 빠른 두 번 클릭도 한 번만
    renderErrorsButton();
    try {
      const gen = st.pageGen;
      const openToken = st.openToken;
      // noToken: this lookup is never pasted — it must not replace the one-time ticket of a
      // send in flight (review r4).
      const ctx = await api.browserContext({ screenshot: false, includeErrors: true, noToken: true, gen });
      // The browser may have closed/reopened or the page changed while we waited (review r4).
      if (!st.active || !st.open || openToken !== st.openToken || gen !== st.pageGen) return;
      // A send started meanwhile: it goes with the attachment it prepared — replacing it now
      // would cancel that send. The refresh is simply dropped (review r6).
      if (st.sending) return;
      if (!ctx || ctx.stale || !Array.isArray(ctx.errors) || !ctx.errors.length) return;
      const lines = ctx.errors.map((e) => `[${oneLine(e.level, 10)}] ${oneLine(e.message)}${e.source ? ` (${oneLine(e.source, 300)}${e.line ? ':' + e.line : ''})` : ''}`);
      st.attach = { gen: ctx.gen, mark: ctx.errorMark, lines, total: lines.length + (ctx.errorsSkipped || 0), skipped: ctx.errorsSkipped || 0 };
      renderAttach();
      if (composerInput) composerInput.focus();
    } finally {
      st.attaching = false;
      renderErrorsButton();
    }
  }

  // ---- 이벤트 ----
  window.addEventListener('carrotcap:sending', (e) => { st.sending = !!e.detail; renderErrorsButton(); });
  function bind() {
    if (errorsToChat) {
      errorsToChat.onclick = () => {
        attachErrors().catch(() => { renderErrorsButton(); notify('콘솔 에러 첨부를 만들지 못했습니다 — 다시 시도하세요'); });
      };
    }
    renderErrorsButton();
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

  window.CarrotcapBrowser = { decorate, isActive: () => st.active && st.open, hasAttachment: () => !!st.attach };
})();
