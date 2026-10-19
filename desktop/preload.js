/* =========================================================================
   preload.js — мост между страницей и Electron.
   contextIsolation: true, nodeIntegration: false — страница видит только
   этот узкий набор функций под именем window.Chesster и не имеет доступа
   ни к node, ни к ipc напрямую.
   ========================================================================= */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('Chesster', {
  appVersion: (() => { try { return ipcRenderer.sendSync('app:version'); } catch (e) { return null; } })(),
  platform: 'electron',

  /* внешние ссылки и файлы */
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  saveFile: (payload) => ipcRenderer.invoke('dialog:saveFile', payload),

  /* окно */
  setTitle: (text) => ipcRenderer.send('win:setTitle', text),
  setBadge: (badge) => ipcRenderer.send('win:setBadge', badge),
  setFullscreen: (on) => ipcRenderer.send('win:setFullscreen', { on: !!on }),
  isFullscreen: () => ipcRenderer.invoke('win:isFullscreen'),

  /* внешний UCI-движок отдельным процессом (путь Rodent IV в десктопе) */
  pickEngine: () => ipcRenderer.invoke('engine:pick'),
  spawnEngine: (exePath) => ipcRenderer.invoke('engine:spawn', exePath),
  engineWrite: (line) => ipcRenderer.send('engine:write', line),
  engineKill: () => ipcRenderer.send('engine:kill'),
  onEngineLine: (cb) => {
    ipcRenderer.on('engine:line', (_e, line) => cb(line));
  },
  onEngineExit: (cb) => {
    ipcRenderer.on('engine:exit', (_e, code) => cb(code));
  },
  onEngineError: (cb) => {
    ipcRenderer.on('engine:error', (_e, msg) => cb(msg));
  },

  /* меню приложения и обновления */
  onMenu: (name, cb) => ipcRenderer.on('menu:' + name, () => cb()),
  checkUpdates: () => ipcRenderer.invoke('app:checkUpdates'),

  /* жизненный цикл */
  appReady: () => Promise.resolve(true),
  onQuitRequested: (cb) => ipcRenderer.on('app:quit-requested', () => cb())
});
