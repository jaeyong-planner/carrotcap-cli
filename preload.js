// preload — 렌더러에 안전한 IPC API만 노출.
const { contextBridge, ipcRenderer, clipboard } = require('electron');

const api = {
  // 설정
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (next) => ipcRenderer.invoke('settings:set', next),

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
  ptyAvailable: () => ipcRenderer.invoke('app:pty-available'),

  // 클립보드 — Ctrl+Shift+C / Ctrl+Shift+V 단축키용
  clipboardRead: () => {
    try { return clipboard.readText(); } catch { return ''; }
  },
  clipboardWrite: (text) => {
    try { clipboard.writeText(String(text || '')); return true; } catch { return false; }
  }
};

contextBridge.exposeInMainWorld('carrotcap', api);
