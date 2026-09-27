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
  const thirdEl = $('#skills-third');
  const thirdOk = $('#skills-third-ok');
  const thirdText = $('#skills-third-text');
  thirdOk.addEventListener('change', () => renderThirdParty());

  let catalog = null;
  let current = null; // { root, resolve, busy }
  const remoteDone = new Map(); // id → inspection of the pinned commit (this session)

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
      body.append(head, desc, src, inspectView(s, remoteDone.get(s.id) || s.inspect || {}));
      row.append(cb, body);
      listEl.appendChild(row);
      cb.addEventListener('change', renderThirdParty);
    }
    renderThirdParty();
  }
  // What the plugin contains and runs — local marketplace copy, or for a remote plugin the
  // pinned commit fetched from GitHub on request (review r1/r2).
  function inspectView(s, i) {
    const box = document.createElement('div');
    box.className = 'skill-inspect';
    if (i.needsRemoteCheck && !i.inspected) {
      const line = document.createElement('div');
      line.textContent = `구성: 외부 저장소 ${String(i.remote || '').replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')}${i.pinned ? ` @ ${i.pinned.slice(0, 7)} (고정 커밋)` : ''} — 설치 전에 내용을 확인해야 합니다`;
      const btn = document.createElement('button');
      btn.className = 'btn-ghost skill-inspect-btn';
      btn.textContent = '구성 불러오기 (GitHub)';
      btn.onclick = async (e) => {
        e.preventDefault();
        btn.disabled = true;
        btn.textContent = '불러오는 중…';
        let r;
        try { r = await api.skillsInspectRemote(s.id); } catch (err) { r = { ok: false, error: err && err.message }; }
        if (r && r.ok) {
          remoteDone.set(s.id, r.inspect);
          box.replaceWith(inspectView(s, r.inspect));
          renderThirdParty();
        } else {
          btn.disabled = false;
          btn.textContent = '다시 시도';
          line.textContent = `구성을 불러오지 못했습니다 — ${(r && r.error) || '알 수 없는 오류'} (확인 전에는 설치할 수 없습니다)`;
        }
      };
      box.append(line, btn);
      return box;
    }
    const line = document.createElement('div');
    const bits = [];
    if (i.remote) bits.push(`외부 저장소 ${i.remote.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')}${i.pinned ? ` @ ${i.pinned.slice(0, 7)} (고정 커밋)` : ''}`);
    if (Array.isArray(i.components) && i.components.length) bits.push(i.components.join(' · '));
    if (i.version) bits.push(`v${i.version}`);
    if (!i.remote && i.pinned) bits.push(`마켓 커밋 ${i.pinned.slice(0, 7)}`);
    if (i.note) bits.push(i.note);
    line.textContent = bits.length ? `구성: ${bits.join(' · ')}` : '구성: 스킬·명령만 (실행되는 프로그램 없음)';
    box.appendChild(line);
    const runs = [...(i.hooks || []).map((h) => `훅 ${h.event}: ${h.command}`), ...(i.mcp || []).map((m) => `MCP ${m.name}: ${m.command}`)];
    if (runs.length) {
      const det = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = `실행하는 명령 ${runs.length}개 보기`;
      det.appendChild(sum);
      for (const r of runs) {
        const d = document.createElement('div');
        d.className = 'skill-run';
        d.textContent = r;
        det.appendChild(d);
      }
      box.appendChild(det);
    }
    // what the skill texts and scripts actually do (review r3)
    const sec = i.security;
    if (sec && sec.counts) {
      const names = { network: '네트워크', delete: '파일 삭제', secrets: '환경변수·자격증명', exec: '셸·프로그램 실행' };
      const secLine = document.createElement('div');
      secLine.className = 'skill-sec';
      secLine.textContent = `보안 점검 (본문 ${sec.files}개 확인): ` + Object.keys(names).map((k) => `${names[k]} ${sec.counts[k] || 0}`).join(' · ');
      box.appendChild(secLine);
      if (sec.findings && sec.findings.length) {
        const det = document.createElement('details');
        const sum = document.createElement('summary');
        sum.textContent = `점검에 걸린 줄 ${sec.findings.length}${sec.truncated ? '+' : ''}개 보기`;
        det.appendChild(sum);
        for (const f of sec.findings) {
          const d = document.createElement('div');
          d.className = 'skill-run';
          d.textContent = `[${f.label}] ${f.file}:${f.line} — ${f.text}`;
          det.appendChild(d);
        }
        box.appendChild(det);
      }
    }
    for (const f of i.runFiles || []) {
      const det = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = `훅이 실행하는 파일 ${f.path} 본문 보기`;
      const pre = document.createElement('pre');
      pre.className = 'skill-body';
      pre.textContent = f.body;
      det.append(sum, pre);
      box.appendChild(det);
    }
    for (const c of i.external || []) {
      const d = document.createElement('div');
      d.className = 'skill-ext';
      d.textContent = `⚠ 실행할 때 외부 패키지를 받아 실행합니다 (본문은 이 창에서 확인 불가): ${c}`;
      box.appendChild(d);
    }
    return box;
  }
  // Third-party picks need an explicit "I checked the source and what it runs".
  function thirdPartyPicked() {
    return catalog.catalog.filter((s) => s.thirdParty && checked().includes(s.id)).map((s) => s.id);
  }
  function renderThirdParty() {
    const picked = thirdPartyPicked();
    // remote plugins picked but not inspected yet: consent is not possible
    const unchecked = picked.filter((id) => {
      const s = catalog.catalog.find((x) => x.id === id);
      if (!s || !s.inspect || !s.inspect.available) return true; // cannot be verified → not installable
      return s.inspect.needsRemoteCheck && !remoteDone.has(id);
    });
    thirdEl.hidden = picked.length === 0;
    if (unchecked.length) {
      thirdOk.checked = false;
      thirdOk.disabled = true;
      thirdText.textContent = `${unchecked.join(', ')}: 내용을 확인해야 설치할 수 있습니다 ("구성 불러오기" — 마켓 정보가 없으면 설치 불가)`;
    } else {
      thirdOk.disabled = !!(current && current.busy);
      thirdText.textContent = picked.length ? `외부 제작 항목 ${picked.join(', ')}의 출처, 실행하는 명령, 보안 점검 결과를 확인했고 설치에 동의합니다` : '';
    }
    if (!picked.length) thirdOk.checked = false;
    installBtn.disabled = (current && current.busy) || (picked.length > 0 && !thirdOk.checked);
  }
  function renderPresets() {
    presetsEl.textContent = '';
    for (const [key, p] of Object.entries(catalog.presets)) {
      const b = document.createElement('button');
      b.className = 'btn-ghost';
      b.textContent = p.label;
      b.onclick = () => {
        listEl.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = p.ids.includes(c.value); });
        renderThirdParty();
      };
      presetsEl.appendChild(b);
    }
  }
  function setBusy(busy) {
    if (current) current.busy = busy;
    for (const b of [skipBtn, neverBtn, closeBtn]) b.disabled = busy;
    listEl.querySelectorAll('input').forEach((c) => { c.disabled = busy; });
    renderThirdParty();
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
    try { r = await api.skillsInstall(current.root, ids, thirdPartyPicked().length > 0 && thirdOk.checked); } catch (e) { r = { ok: false, error: e && e.message }; }
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
    if (st && st.rulesPending) return true; // installed, but the CLAUDE.md rules are missing
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
