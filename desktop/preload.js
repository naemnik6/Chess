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

  /* архив партий файлом на устройстве (десктоп) */
  archiveRead: () => ipcRenderer.sendSync('store:readArchive'),
  archiveWrite: (text) => ipcRenderer.sendSync('store:writeArchive', text),
  archivePath: () => ipcRenderer.sendSync('store:archivePath'),

  /* меню приложения и обновления */
  onMenu: (name, cb) => ipcRenderer.on('menu:' + name, () => cb()),
  /* проверка возвращает объект результата: { ok, reason, message, error?, diag, releasesUrl } —
     интерфейс показывает конкретную ошибку, а не «не настроено» */
  checkUpdates: () => ipcRenderer.invoke('app:checkUpdates'),
  updateInfo: () => ipcRenderer.invoke('app:updateInfo'),
  /* события обёртки (checking-for-update, update-available, update-not-available,
     download-progress, update-downloaded, error, …) — страница пишет их в консоль DevTools */
  onUpdaterEvent: (cb) => {
    ipcRenderer.on('updater:event', (_e, payload) => cb(payload));
  },

  /* жизненный цикл */
  appReady: () => Promise.resolve(true),
  /* кнопка «Выход» в окне настроек: закрываем приложение целиком
     (главный процесс гасит процесс движка и завершает Electron) */
  quitApp: () => ipcRenderer.invoke('app:quit'),
  onQuitRequested: (cb) => ipcRenderer.on('app:quit-requested', () => cb())
});
