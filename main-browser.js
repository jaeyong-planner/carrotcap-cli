// CARROTCAP CLI — browser mode (task-015), main-process side.
// A BrowserView in the middle of the window shows the app being built. The user can
// pin annotations on elements and the view collects console errors; both are turned
// into a text context (+ a screenshot with the pins) that the renderer prepends to the
// chat message it sends to the agent terminal.
//
// Isolation: separate in-memory session, sandbox, no preload, http(s) only, all
// permission requests and downloads denied. Page scripts never reach the app's IPC.

const { BrowserView, session: electronSession } = require('electron');
const path = require('path');
const fs = require('fs');

const PARTITION        = 'cc-browser';        // no "persist:" → nothing kept after quit
const ISOLATED_WORLD   = 999;                 // annotation overlay lives here, not in the page world
const MAX_ERRORS       = 100;
const MAX_ERRORS_SENT  = 8;
const MAX_ERROR_LEN    = 600;
const MAX_URL_LEN      = 2048;
const SHOT_KEEP        = 20;
const SHOT_MAX_AGE_MS  = 3 * 24 * 60 * 60 * 1000;
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 3 };
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// "localhost:3000" → "http://localhost:3000/"; only http(s) is accepted.
function normalizeUrl(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s || s.length > MAX_URL_LEN || /[\x00-\x1F]/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = (/^(localhost|127\.|\[::1\])/i.test(s) ? 'http://' : 'https://') + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : null;
}

// Page-controlled strings end up pasted into an agent terminal. Make them one line of
// printable text: no C0/DEL/C1 controls (ESC could end a bracketed paste), no line breaks.
function cleanText(s, max) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u001F\u007F-\u009F\u{2028}\u{2029}]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

function clampRect(r) {
  const n = (v, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0);
  if (!r || typeof r !== 'object') return { x: 0, y: 0, width: 0, height: 0 };
  return { x: n(r.x, 20000), y: n(r.y, 20000), width: n(r.width, 20000), height: n(r.height, 20000) };
}

// Annotation overlay, run in an isolated world. Resolves with the picked element's
// description, or null when cancelled (Esc / __ccPickCancel()).
const PICK_SCRIPT = `(() => new Promise((resolve) => {
  if (window.__ccPickCancel) window.__ccPickCancel();
  const Z = 2147483647;
  let pins = document.getElementById('__cc_pins');
  if (!pins) {
    pins = document.createElement('div');
    pins.id = '__cc_pins';
    pins.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:' + Z;
    document.documentElement.appendChild(pins);
  }
  const glass = document.createElement('div');
  glass.style.cssText = 'position:fixed;inset:0;cursor:crosshair;z-index:' + Z + ';background:transparent';
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;display:none;pointer-events:none;border:2px solid #ff8c42;background:rgba(255,140,66,.12);z-index:' + Z;
  document.documentElement.appendChild(glass);
  document.documentElement.appendChild(box);
  const under = (x, y) => { glass.style.pointerEvents = 'none'; const el = document.elementFromPoint(x, y); glass.style.pointerEvents = 'auto'; return el; };
  const cssPath = (el) => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && parts.length < 5 && e !== document.documentElement; e = e.parentElement) {
      if (e.id) { parts.unshift('#' + CSS.escape(e.id)); break; }
      let p = e.tagName.toLowerCase();
      const cls = [...e.classList].filter((c) => !/^\\d/.test(c)).slice(0, 2);
      if (cls.length) p += '.' + cls.map((c) => CSS.escape(c)).join('.');
      const sib = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e.tagName) : [];
      if (sib.length > 1) p += ':nth-of-type(' + (sib.indexOf(e) + 1) + ')';
      parts.unshift(p);
    }
    return parts.join(' > ');
  };
  const done = (value) => {
    glass.remove(); box.remove();
    window.removeEventListener('keydown', onKey, true);
    window.__ccPickCancel = null;
    resolve(value);
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } };
  glass.addEventListener('mousemove', (e) => {
    const el = under(e.clientX, e.clientY);
    if (!el) return;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  });
  glass.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const el = under(e.clientX, e.clientY);
    if (!el) return done(null);
    const r = el.getBoundingClientRect();
    const n = pins.querySelectorAll('[data-cc-pin]').length + 1;
    const pin = document.createElement('div');
    pin.setAttribute('data-cc-pin', String(n));
    pin.textContent = String(n);
    pin.style.cssText = 'position:absolute;left:' + (r.left + scrollX - 10) + 'px;top:' + (r.top + scrollY - 10) + 'px;width:20px;height:20px;border-radius:10px;background:#ff8c42;color:#15151a;font:bold 12px/20px sans-serif;text-align:center;box-shadow:0 0 0 2px #fff';
    const outline = document.createElement('div');
    outline.style.cssText = 'position:absolute;left:' + (r.left + scrollX) + 'px;top:' + (r.top + scrollY) + 'px;width:' + r.width + 'px;height:' + r.height + 'px;border:2px dashed #ff8c42';
    pins.appendChild(outline); pins.appendChild(pin);
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('alt') || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
    done({ n, selector: cssPath(el), tag: el.tagName.toLowerCase(), text,
      rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
      viewport: { width: innerWidth, height: innerHeight } });
  });
  window.addEventListener('keydown', onKey, true);
  window.__ccPickCancel = () => done(null);
}))()`;

const CANCEL_SCRIPT = `(() => { if (window.__ccPickCancel) window.__ccPickCancel(); return true; })()`;
const CLEAR_SCRIPT  = `(() => { if (window.__ccPickCancel) window.__ccPickCancel(); const p = document.getElementById('__cc_pins'); if (p) p.remove(); return true; })()`;

function sanitizePick(v) {
  if (!v || typeof v !== 'object') return null;
  const str = (s, n) => (typeof s === 'string' ? cleanText(s, n) : '');
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : 0);
  const r = v.rect || {};
  const vp = v.viewport || {};
  return {
    n: Math.max(1, Math.min(99, num(v.n))),
    selector: str(v.selector, 300),
    tag: str(v.tag, 20),
    text: str(v.text, 120),
    rect: { x: num(r.x), y: num(r.y), width: num(r.width), height: num(r.height) },
    viewport: { width: num(vp.width), height: num(vp.height) }
  };
}

const withTimeout = (p, ms, what) => {
  let timer;
  return Promise.race([
    p,
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${what} timed out`)), ms); })
  ]).finally(() => clearTimeout(timer));
};

function setupBrowser({ handle, getWindow, resolveAllowedDir, safeMkdir, writeIfMissing, userDataRoot }) {
  let sessionReady = false;
  let view = null;
  let device = 'desktop';
  let errors = [];          // { at, level, message, source, line }
  let reportedUpTo = 0;     // errors[] index already attached to a chat message
  let debuggerAttached = false;

  const send = (channel, payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };
  const pushState = () => {
    if (!view) return send('browser:state', { open: false });
    const wc = view.webContents;
    send('browser:state', {
      open: true,
      url: cleanText(wc.getURL(), MAX_URL_LEN),
      title: cleanText(wc.getTitle(), 200),
      loading: wc.isLoading(),
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward(),
      device,
      errorCount: errors.length,
      newErrors: errors.length - reportedUpTo
    });
  };
  const addError = (level, message, source, line) => {
    errors.push({
      at: new Date().toISOString(),
      level,
      message: cleanText(message, MAX_ERROR_LEN),
      source: cleanText(source, 300),
      line: Number.isInteger(line) ? line : 0
    });
    if (errors.length > MAX_ERRORS) {
      const drop = errors.length - MAX_ERRORS;
      errors = errors.slice(drop);
      reportedUpTo = Math.max(0, reportedUpTo - drop);
    }
    pushState();
  };

  function ensureView() {
    if (view) return view;
    const ses = electronSession.fromPartition(PARTITION);
    // The partition session outlives views: register its handlers once (review task-015).
    if (!sessionReady) {
      sessionReady = true;
      ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
      ses.setPermissionCheckHandler(() => false);
      ses.on('will-download', (e) => e.preventDefault());
      // Never touch local files, whatever the page or a redirect asks for.
      ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: /^file:/i.test(d.url) }));
      // Failed requests (404 script, 500 API, DNS...) never reach console-message — record
      // them from the network layer. One listener per event per session; this session is ours.
      ses.webRequest.onCompleted((d) => {
        if (d.statusCode >= 400) addError('network', `${d.statusCode} ${d.method} ${d.url}`, d.resourceType || '', 0);
      });
      ses.webRequest.onErrorOccurred((d) => {
        if (d.error !== 'net::ERR_ABORTED' && d.error !== 'net::ERR_BLOCKED_BY_CLIENT') {
          addError('network', `${d.error} ${d.method} ${d.url}`, d.resourceType || '', 0);
        }
      });
    }
    view = new BrowserView({
      webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false }
    });
    view.setBackgroundColor('#ffffff');
    const wc = view.webContents;
    // Stay on http(s); popups open in the same view.
    wc.setWindowOpenHandler(({ url }) => {
      const u = normalizeUrl(url);
      if (u) wc.loadURL(u).catch(() => {});
      return { action: 'deny' };
    });
    // http(s) only — for links, server redirects (30x to file: etc.) and, as a last line,
    // anything that still lands on another scheme.
    wc.on('will-navigate', (e, url) => { if (!normalizeUrl(url)) e.preventDefault(); });
    wc.on('will-redirect', (e, url) => { if (!normalizeUrl(url)) e.preventDefault(); });
    wc.on('did-navigate', (_e, url) => {
      if (!normalizeUrl(url) && url !== 'about:blank') wc.loadURL('about:blank').catch(() => {});
    });
    wc.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 3) addError('error', message, sourceId, line);
    });
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (code !== -3) addError('load', `${isMainFrame ? '페이지' : '리소스'} 로드 실패 ${code} ${desc}`, url, 0); // -3 = aborted
    });
    wc.on('render-process-gone', (_e, details) => addError('crash', `렌더러 종료: ${details && details.reason}`, wc.getURL(), 0));
    for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) {
      wc.on(ev, pushState);
    }
    const win = getWindow();
    if (win) win.addBrowserView(view);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    return view;
  }

  async function applyDevice(mode) {
    device = mode === 'mobile' ? 'mobile' : 'desktop';
    if (!view) return;
    const wc = view.webContents;
    // PC is the default — no debugger needed until the user switches to mobile once.
    if (device === 'desktop' && !debuggerAttached) { pushState(); return; }
    try {
      if (!debuggerAttached) { wc.debugger.attach('1.3'); debuggerAttached = true; }
      const cmd = (method, params) => withTimeout(wc.debugger.sendCommand(method, params), 3000, method);
      if (device === 'mobile') {
        await cmd('Emulation.setDeviceMetricsOverride', { width: MOBILE.width, height: MOBILE.height, deviceScaleFactor: MOBILE.deviceScaleFactor, mobile: true });
        await cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        await cmd('Emulation.setUserAgentOverride', { userAgent: MOBILE_UA });
      } else {
        await cmd('Emulation.clearDeviceMetricsOverride');
        await cmd('Emulation.setTouchEmulationEnabled', { enabled: false });
        await cmd('Emulation.setUserAgentOverride', { userAgent: wc.session.getUserAgent() });
      }
    } catch (e) {
      console.warn('[carrotcap] browser device emulation failed:', e.message);
    }
    pushState();
  }

  function destroyView() {
    if (!view) return;
    const win = getWindow();
    try { if (win && !win.isDestroyed()) win.removeBrowserView(view); } catch { /* window closing */ }
    if (debuggerAttached) { try { view.webContents.debugger.detach(); } catch { /* already detached */ } }
    try { view.webContents.close(); } catch { /* already gone */ }
    view = null;
    debuggerAttached = false;
    errors = [];
    reportedUpTo = 0;
    pushState();
  }

  // Screenshots: <project>/.carrotcap/browser (self-ignoring), newest 20, max 3 days.
  // Inside a project the folder goes through the same guards as AIOps setup: every
  // ancestor must be a real directory (no symlink/junction) and the result must stay
  // inside the picked workspace — so writing and pruning can never leave it (review C2).
  function shotDir(projectRoot) {
    const real = resolveAllowedDir(projectRoot);
    if (!real) {
      const dir = path.join(userDataRoot, 'browser-shots');
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
    const dir = path.join(real, '.carrotcap', 'browser');
    safeMkdir(dir, real); // throws on symlinked ancestors / escape
    writeIfMissing(path.join(real, '.carrotcap', '.gitignore'), '*\n', real);
    return dir;
  }
  function pruneShots(dir) {
    let files;
    try {
      const lst = fs.lstatSync(dir);
      if (lst.isSymbolicLink() || !lst.isDirectory()) return;
      // withFileTypes: isFile() is false for symlinks, so only real files are removed
      files = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && /^shot-[0-9TZ-]+\.png$/.test(d.name));
    } catch { return; }
    const now = Date.now();
    const withTime = files.map((d) => {
      const p = path.join(dir, d.name);
      let t = 0;
      try { t = fs.statSync(p).mtimeMs; } catch { /* vanished */ }
      return { p, t };
    }).sort((a, b) => b.t - a.t);
    withTime.forEach((f, i) => {
      if (i >= SHOT_KEEP || now - f.t > SHOT_MAX_AGE_MS) { try { fs.rmSync(f.p, { force: true }); } catch { /* next time */ } }
    });
  }

  handle('browser:open', async (_e, url) => {
    const u = normalizeUrl(url);
    if (!u) return { ok: false, error: 'http:// 또는 https:// 주소만 열 수 있습니다.' };
    const v = ensureView();
    // Navigate first: CDP emulation commands on a view that never loaded can stall.
    v.webContents.loadURL(u).catch(() => { /* did-fail-load records it */ });
    await withTimeout(new Promise((r) => v.webContents.once('did-stop-loading', r)), 15000, 'page load').catch(() => {});
    if (device === 'mobile') {
      await applyDevice('mobile');
      v.webContents.reload(); // re-layout with the mobile viewport/UA from the first request
    }
    pushState();
    return { ok: true, url: v.webContents.getURL() };
  });
  handle('browser:close', () => { destroyView(); return true; });
  handle('browser:bounds', (_e, rect) => {
    if (view) view.setBounds(clampRect(rect));
    return true;
  });
  handle('browser:nav', (_e, action) => {
    if (!view) return false;
    const wc = view.webContents;
    if (action === 'back' && wc.canGoBack()) wc.goBack();
    else if (action === 'forward' && wc.canGoForward()) wc.goForward();
    else if (action === 'reload') wc.reload();
    else return false;
    return true;
  });
  handle('browser:device', async (_e, mode) => {
    await applyDevice(mode);
    return device;
  });
  handle('browser:pick', async () => {
    if (!view) return null;
    try {
      const v = await view.webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code: PICK_SCRIPT }], true);
      return sanitizePick(v);
    } catch { return null; }
  });
  handle('browser:pick-cancel', async () => {
    if (!view) return false;
    try { await view.webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code: CANCEL_SCRIPT }]); } catch { /* page gone */ }
    return true;
  });
  handle('browser:clear-pins', async () => {
    if (!view) return false;
    try { await view.webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code: CLEAR_SCRIPT }]); } catch { /* page gone */ }
    return true;
  });
  handle('browser:errors', () => errors.slice(-MAX_ERRORS));
  // Everything the agent needs for one chat message. Nothing is consumed here: the
  // renderer calls browser:commit only after the text really reached the terminal.
  handle('browser:context', async (_e, payload) => {
    if (!view) return null;
    const p = (payload && typeof payload === 'object') ? payload : {};
    const wc = view.webContents;
    const out = { url: cleanText(wc.getURL(), MAX_URL_LEN), title: cleanText(wc.getTitle(), 200), device };
    if (p.screenshot) {
      try {
        const img = await wc.capturePage();
        const dir = shotDir(p.projectRoot);
        const file = path.join(dir, `shot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
        fs.writeFileSync(file, img.toPNG());
        pruneShots(dir);
        out.screenshot = file;
      } catch (e) {
        console.warn('[carrotcap] browser screenshot failed:', e.message);
      }
    }
    if (p.includeErrors) {
      out.errors = errors.slice(reportedUpTo).slice(-MAX_ERRORS_SENT);
      out.errorsSkipped = Math.max(0, errors.length - reportedUpTo - out.errors.length);
    }
    out.errorMark = errors.length; // pass back to browser:commit
    return out;
  });
  handle('browser:commit', (_e, mark) => {
    if (Number.isInteger(mark) && mark > reportedUpTo && mark <= errors.length) {
      reportedUpTo = mark;
      pushState();
    }
    return true;
  });

  return { destroyView };
}

module.exports = { setupBrowser, normalizeUrl, sanitizePick, clampRect, cleanText };
