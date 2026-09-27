/* CARROTCAP CLI — 프로젝트 스킬 세팅 창 (task-023)
 * 카탈로그(만든 곳·출처·용도)를 보여 주고, 사용자가 고른 것만 main에 설치를 요청한다.
 * renderer.js는 window.CarrotcapSkills.needsSetup(root) / open(root, { reason })만 쓴다.
 */
(() => {
  const api = window.carrotcap;
  const $ = (s) => document.querySelector(s);
  const modal = $('#skills-modal');
  const listEl = $('#skills-list');
  const presetsEl = $('#skills-presets');
  const progressEl = $('#skills-progress');
  const installBtn = $('#skills-install');
  const skipBtn = $('#skills-skip');
  const neverBtn = $('#skills-never');
  const closeBtn = $('#skills-close');
  const titleNote = $('#skills-reason');

  let catalog = null;
  let current = null; // { root, resolve, busy }

  async function loadCatalog() {
    if (!catalog) catalog = await api.skillsCatalog();
    return catalog;
  }
  function checked() {
    return [...listEl.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
  }
  function renderList(selected, installed) {
    listEl.textContent = '';
    for (const s of catalog.catalog) {
      const row = document.createElement('label');
      row.className = 'skill-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = s.id;
      cb.checked = selected.includes(s.id);
      const body = document.createElement('div');
      const head = document.createElement('div');
      head.className = 'skill-head';
      const name = document.createElement('strong');
      name.textContent = s.id;
      const maker = document.createElement('span');
      maker.className = 'skill-maker' + (s.thirdParty ? ' third' : '');
      maker.textContent = s.maker;
      head.append(name, maker);
      if (installed.includes(s.id)) {
        const done = document.createElement('span');
        done.className = 'skill-done';
        done.textContent = '설치됨';
        head.appendChild(done);
      }
      const desc = document.createElement('div');
      desc.className = 'skill-desc';
      desc.textContent = s.desc;
      const src = document.createElement('div');
      src.className = 'skill-src';
      src.textContent = s.source;
      body.append(head, desc, src);
      row.append(cb, body);
      listEl.appendChild(row);
    }
  }
  function renderPresets() {
    presetsEl.textContent = '';
    for (const [key, p] of Object.entries(catalog.presets)) {
      const b = document.createElement('button');
      b.className = 'btn-ghost';
      b.textContent = p.label;
      b.onclick = () => listEl.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = p.ids.includes(c.value); });
      presetsEl.appendChild(b);
    }
  }
  function setBusy(busy) {
    if (current) current.busy = busy;
    for (const b of [installBtn, skipBtn, neverBtn, closeBtn]) b.disabled = busy;
    listEl.querySelectorAll('input').forEach((c) => { c.disabled = busy; });
  }
  function finish(result) {
    const c = current;
    current = null;
    modal.classList.add('hidden');
    if (c) c.resolve(result);
  }

  api.onSkillsProgress((p) => {
    if (!current || !p) return;
    let row = progressEl.querySelector(`[data-id="${CSS.escape(String(p.id))}"]`);
    if (!row) {
      row = document.createElement('div');
      row.dataset.id = String(p.id);
      progressEl.appendChild(row);
    }
    const mark = p.status === 'ok' ? '✓' : p.status === 'fail' ? '✗' : '…';
    row.className = 'skill-progress ' + (p.status || '');
    row.textContent = `${mark} ${p.id}${p.status === 'fail' && p.out ? ` — ${String(p.out).split('\n').filter(Boolean).slice(-1)[0] || ''}` : ''}`;
  });

  installBtn.onclick = async () => {
    if (!current || current.busy) return;
    const ids = checked();
    if (!ids.length) { progressEl.textContent = '설치할 스킬을 고르세요'; return; }
    progressEl.textContent = '';
    setBusy(true);
    let r;
    try { r = await api.skillsInstall(current.root, ids); } catch (e) { r = { ok: false, error: e && e.message }; }
    setBusy(false);
    if (r && r.ok) { finish({ action: 'installed', installed: r.installed || ids }); return; }
    const line = document.createElement('div');
    line.className = 'skill-progress fail';
    line.textContent = r && r.error ? r.error : '일부 스킬을 설치하지 못했습니다 — 위 항목을 확인하세요';
    progressEl.appendChild(line);
    if (r && Array.isArray(r.installed) && r.installed.length) {
      skipBtn.textContent = current && current.reason === 'start' ? '설치된 것으로 시작' : '닫기';
    }
  };
  skipBtn.onclick = () => { if (!current || current.busy) return; finish({ action: 'skipped' }); };
  neverBtn.onclick = async () => {
    if (!current || current.busy) return;
    await api.skillsSkip(current.root);
    finish({ action: 'never' });
  };
  closeBtn.onclick = () => { if (!current || current.busy) return; finish({ action: 'closed' }); };
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current && !current.busy) finish({ action: 'closed' }); });

  // true when START should offer the setup: nothing set up yet and not declined for good
  async function needsSetup(root) {
    if (!root) return false;
    const st = await api.skillsStatus(root);
    return !st || (!st.skipped && !(Array.isArray(st.installed) && st.installed.length));
  }
  async function open(root, opts = {}) {
    if (!root) return { action: 'closed' };
    if (current) return { action: 'busy' };
    await loadCatalog();
    const st = (await api.skillsStatus(root)) || {};
    const installed = Array.isArray(st.installed) ? st.installed : [];
    renderPresets();
    renderList(installed.length ? installed : catalog.presets.web.ids, installed);
    progressEl.textContent = '';
    const reason = opts.reason || 'manual';
    titleNote.textContent = reason === 'start'
      ? '처음 시작하는 프로젝트입니다 — 개발에 쓸 스킬을 먼저 세팅할까요?'
      : '이 프로젝트에서 Claude가 쓸 스킬을 고르세요.';
    installBtn.textContent = reason === 'start' ? '설치하고 시작' : '설치';
    skipBtn.textContent = reason === 'start' ? '건너뛰고 시작' : '취소';
    neverBtn.hidden = reason !== 'start';
    closeBtn.hidden = reason === 'start';
    return new Promise((resolve) => {
      current = { root, resolve, busy: false, reason };
      setBusy(false);
      modal.classList.remove('hidden');
      installBtn.focus();
    });
  }

  window.CarrotcapSkills = { open, needsSetup };
})();
