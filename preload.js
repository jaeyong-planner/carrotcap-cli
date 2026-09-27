// preload — 렌더러에 안전한 IPC API만 노출.
const { contextBridge, ipcRenderer } = require('electron');

const api = {
  // 설정
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (next) => ipcRenderer.invoke('settings:set', next),

  // AOR / CLAUDE.md
  getClaudeMd: () => ipcRenderer.invoke('aor:get-claude-md'),
  setClaudeMd: (content) => ipcRenderer.invoke('aor:set-claude-md', content),
  setupAiops: (projectRoot) => ipcRenderer.invoke('aiops:setup', projectRoot),

  // 폴더
  pickFolder: () => ipcRenderer.invoke('folder:pick'),
  getFolderTree: (rootPath) => ipcRenderer.invoke('folder:tree', rootPath),
  searchFiles: (rootPath, query) => ipcRenderer.invoke('folder:search', rootPath, query),
  showInOS: (filePath) => ipcRenderer.invoke('folder:open-in-os', filePath),

  // 페인 / PTY
  spawnPty: (payload) => ipcRenderer.invoke('pty:spawn', payload),
  writePty: (id, data) => ipcRenderer.send('pty:write', { id, data }),
  writePtyAck: (id, data) => ipcRenderer.invoke('pty:write-ack', { id, data }),
  pasteGuarded: (id, text, token, submit = false) => ipcRenderer.invoke('pty:paste-guarded', { id, text, token, submit }),
  resizePty: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  killPty: (id) => ipcRenderer.send('pty:kill', { id }),

  onPtyData: (handler) => {
    const wrap = (_e, payload) => handler(payload);
    ipcRenderer.on('pty:data', wrap);
    return () => ipcRenderer.removeListener('pty:data', wrap);
  },
  onPtyExit: (handler) => {
    const wrap = (_e, payload) => handler(payload);
    ipcRenderer.on('pty:exit', wrap);
    return () => ipcRenderer.removeListener('pty:exit', wrap);
  },

  // 클립보드 / 터미널 우클릭 메뉴 (task-009)
  readClipboard: () => ipcRenderer.invoke('clipboard:read-text'),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  showTermMenu: (id, hasSelection) => ipcRenderer.send('term-menu:show', { id, hasSelection: !!hasSelection }),
  onTermMenuCommand: (handler) => {
    const wrap = (_e, payload) => handler(payload);
    ipcRenderer.on('term-menu:command', wrap);
    return () => ipcRenderer.removeListener('term-menu:command', wrap);
  },

  cliStatus: () => ipcRenderer.invoke('cli:status'),

  // 브라우저 모드 (task-015)
  browserOpen: (url) => ipcRenderer.invoke('browser:open', url),
  browserClose: () => ipcRenderer.invoke('browser:close'),
  browserBounds: (rect) => ipcRenderer.invoke('browser:bounds', rect),
  browserNav: (action) => ipcRenderer.invoke('browser:nav', action),
  browserDevice: (mode) => ipcRenderer.invoke('browser:device', mode),
  browserPick: () => ipcRenderer.invoke('browser:pick'),
  browserPickCancel: () => ipcRenderer.invoke('browser:pick-cancel'),
  browserClearPins: (only, gen) => ipcRenderer.invoke('browser:clear-pins', only, gen),
  browserErrors: () => ipcRenderer.invoke('browser:errors'),
  browserContext: (opts) => ipcRenderer.invoke('browser:context', opts),
  browserCommit: (mark) => ipcRenderer.invoke('browser:commit', mark),
  onBrowserState: (handler) => {
    const wrap = (_e, payload) => handler(payload);
    ipcRenderer.on('browser:state', wrap);
    return () => ipcRenderer.removeListener('browser:state', wrap);
  },
  aorStatus: () => ipcRenderer.invoke('aor:status'),

  // 프로젝트 스킬 세팅 (task-023)
  skillsCatalog: () => ipcRenderer.invoke('skills:catalog'),
  skillsStatus: (projectRoot) => ipcRenderer.invoke('skills:status', projectRoot),
  skillsSkip: (projectRoot) => ipcRenderer.invoke('skills:skip', projectRoot),
  skillsInspectRemote: (id) => ipcRenderer.invoke('skills:inspect-remote', id),
  skillsInstall: (projectRoot, ids, confirmThirdParty = false) => ipcRenderer.invoke('skills:install', { projectRoot, ids, confirmThirdParty }),
  onSkillsProgress: (handler) => {
    const wrap = (_e, payload) => handler(payload);
    ipcRenderer.on('skills:progress', wrap);
    return () => ipcRenderer.removeListener('skills:progress', wrap);
  },

  // 세션 이어하기 (task-013)
  saveHistory: (projectRoot, layout) => ipcRenderer.invoke('history:save', { projectRoot, layout }),
  getHistory: (projectRoot) => ipcRenderer.invoke('history:get', projectRoot),
  dismissHistory: (projectRoot) => ipcRenderer.invoke('history:dismiss', projectRoot),
  platform: () => ipcRenderer.invoke('app:platform'),
  ptyAvailable: () => ipcRenderer.invoke('app:pty-available')
};

contextBridge.exposeInMainWorld('carrotcap', api);
