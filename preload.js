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

  platform: () => ipcRenderer.invoke('app:platform'),
  ptyAvailable: () => ipcRenderer.invoke('app:pty-available')
};

contextBridge.exposeInMainWorld('carrotcap', api);
