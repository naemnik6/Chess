/* Смоук-тест логики автообновлений desktop/main.js без настоящего Electron.
   Модули 'electron' и 'electron-updater' подменяются моками через Module._load,
   затем main.js исполняется как есть и проверяются сценарии:
     • последняя версия / найдено обновление / ошибка сети — результат с конкретным
       сообщением и диагностика (а не «не настроено»);
     • события autoUpdater уходят в страницу каналом 'updater:event' (видны в DevTools);
     • фоновая ошибка — нативный диалог с текстом ошибки и кнопкой ручного скачивания;
     • нет app-update.yml — причина 'no-config' с пояснением про build.publish;
     • dev-режим (не упаковано) — проверка пропускается;
     • автопроверка при запуске (через 4 с после ready).
   Запуск: node desktop/smoketest.js */
const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (fail++, console.log('  FAIL ' + m)); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const RELEASES = 'https://github.com/naemnik6/Chess/releases/latest';

/* ---------- мок electron ---------- */
const state = { external: [], dialogs: [], sent: [], handles: {}, on: {}, packaged: true, dialogResponse: 1, loads: [] };
class WebContents {
  send(ch, payload) { state.sent.push({ ch, payload }); }
  on() { } setWindowOpenHandler() { }
}
class BrowserWindow {
  constructor() { this.webContents = new WebContents(); }
  once(ev, cb) { if (ev === 'ready-to-show') setImmediate(cb); }
  on() { } show() { } maximize() { } close() { }
  setFullScreen() { } isFullScreen() { return false; }
  setTitle() { } setOverlayIcon() { } isDestroyed() { return false; }
  loadFile(p) { state.loads.push(p); }
  static getAllWindows() { return []; }
}
const electronMock = {
  app: {
    name: 'Chess',
    get isPackaged() { return state.packaged; },
    whenReady: () => Promise.resolve(),
    on: (ev, cb) => { state.on[ev] = cb; },
    setAppUserModelId: () => { },
    getPath: (p) => p === 'exe' ? path.join(tmpRoot, 'Chess.exe') : path.join(tmpRoot, 'userdata'),
    getAppPath: () => path.join(tmpRoot, 'appdir'),
    quit: () => { }
  },
  BrowserWindow,
  Menu: { setApplicationMenu: () => { }, buildFromTemplate: () => ({}) },
  dialog: {
    showMessageBox: (win, opts) => { state.dialogs.push(opts); return Promise.resolve({ response: state.dialogResponse }); },
    showErrorBox: (t, m) => state.dialogs.push({ title: t, message: m }),
    showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
    showSaveDialog: () => Promise.resolve({ canceled: true })
  },
  shell: { openExternal: (u) => { state.external.push(u); return Promise.resolve(); } },
  ipcMain: {
    handle: (ch, fn) => { state.handles[ch] = fn; },
    on: (ch, fn) => { state.on['ipc:' + ch] = fn; }
  },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) }
};

/* ---------- мок electron-updater ---------- */
const EventEmitter = require('events');
const autoUpdater = new EventEmitter();
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.mode = 'not-available';
autoUpdater.checkForUpdates = async function () {
  setImmediate(() => {
    autoUpdater.emit('checking-for-update');
    setImmediate(() => {
      if (autoUpdater.mode === 'not-available') autoUpdater.emit('update-not-available', { version: '2.3.1' });
      else if (autoUpdater.mode === 'available') autoUpdater.emit('update-available', { version: '2.4.0', releaseDate: '2026-10-20' });
      else if (autoUpdater.mode === 'error') autoUpdater.emit('error', new Error('net::ERR_NAME_NOT_RESOLVED'));
    });
  });
  return { updateInfo: { version: '2.3.1' } };
};
autoUpdater.quitAndInstall = function () { autoUpdater.emit('__quit'); };
const updaterMock = { autoUpdater };

/* ---------- песочница: resources с app-update.yml и заглушка index.html ---------- */
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chesster-smoke-'));
process.resourcesPath = path.join(tmpRoot, 'res');
fs.mkdirSync(path.join(process.resourcesPath, 'app'), { recursive: true });
fs.writeFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'provider: github\nowner: naemnik6\nrepo: Chess\n');
fs.writeFileSync(path.join(process.resourcesPath, 'app', 'index.html'), '<!-- заглушка для резолвера -->');

/* ---------- подмена модулей и запуск main.js ---------- */
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return electronMock;
  if (request === 'electron-updater') return updaterMock;
  return origLoad.apply(this, arguments);
};
require(path.join(__dirname, 'main.js'));

(async () => {
  await wait(150);   // окно «создано»
  const checkUpdates = state.handles['app:checkUpdates'];
  const updateInfo = state.handles['app:updateInfo'];
  ok(typeof checkUpdates === 'function', 'IPC app:checkUpdates зарегистрирован');
  ok(typeof updateInfo === 'function', 'IPC app:updateInfo зарегистрирован');

  console.log('\n— Последняя версия —');
  state.sent.length = 0;
  autoUpdater.mode = 'not-available';
  let r = await checkUpdates();
  ok(r.ok === true && r.reason === 'up-to-date', 'up-to-date: ' + r.message);
  let stages = state.sent.filter(e => e.ch === 'updater:event').map(e => e.payload.stage);
  ok(stages.includes('checking-for-update'), 'checking-for-update отправлен в страницу (DevTools): ' + stages.join(', '));
  ok(stages.includes('update-not-available'), 'update-not-available отправлен в страницу');
  ok(r.diag && r.diag.appUpdateYmlExists === true, 'диагностика видит app-update.yml');
  ok(r.releasesUrl === RELEASES, 'в результате есть ссылка релизов');

  console.log('\n— Найдено обновление —');
  state.dialogs.length = 0; state.sent.length = 0;
  autoUpdater.mode = 'available';
  r = await checkUpdates();
  ok(r.ok === true && r.reason === 'available' && /2\.4\.0/.test(r.message), 'available: ' + r.message);
  ok(state.dialogs.length === 0, 'при проверке из UI нативный диалог не дублирует интерфейс');
  ok(state.sent.some(e => e.payload.stage === 'update-available'), 'update-available ушёл в страницу');

  console.log('\n— Сетевая ошибка из UI —');
  state.dialogs.length = 0; state.sent.length = 0;
  autoUpdater.mode = 'error';
  r = await checkUpdates();
  ok(r.ok === false && r.reason === 'error', 'error: причина');
  ok(/ERR_NAME_NOT_RESOLVED/.test(r.message), 'error: конкретный текст ошибки: ' + r.message);
  ok(/ERR_NAME_NOT_RESOLVED/.test(r.diag.lastError), 'error: диагностика хранит последнюю ошибку');
  ok(state.dialogs.length === 0, 'error из UI: нативный диалог подавлен (ошибку покажет интерфейс)');

  console.log('\n— Фоновая ошибка: диалог с ручным скачиванием —');
  state.dialogs.length = 0; state.external.length = 0; state.dialogResponse = 0;
  const realNow = Date.now; Date.now = () => realNow() + 40000;   // «прошло» окно подавления UI-проверки
  autoUpdater.emit('error', new Error('background failure'));
  await wait(30);
  Date.now = realNow;
  ok(state.dialogs.length === 1 && /background failure/.test(state.dialogs[0].detail || ''), 'нативный диалог с текстом ошибки');
  ok(state.dialogs[0] && state.dialogs[0].buttons.includes('Скачать обновление вручную'), 'в диалоге кнопка ручного скачивания');
  ok(state.external.includes(RELEASES), 'клик открыл страницу релизов в системном браузере');
  state.dialogResponse = 1;

  console.log('\n— Нет app-update.yml —');
  const yml = path.join(process.resourcesPath, 'app-update.yml');
  fs.renameSync(yml, yml + '.bak');
  r = await checkUpdates();
  ok(r.ok === false && r.reason === 'no-config', 'no-config: причина');
  ok(/app-update\.yml/.test(r.message) && /build\.publish/.test(r.message), 'no-config: сообщение объясняет про app-update.yml и build.publish');
  ok(r.diag.appUpdateYmlExists === false, 'диагностика: appUpdateYmlExists=false');
  fs.renameSync(yml + '.bak', yml);

  console.log('\n— Dev-режим (не упаковано) —');
  state.packaged = false;
  r = await checkUpdates();
  ok(r.ok === false && r.reason === 'dev' && /dev-режим/.test(r.message), 'dev: проверка пропускается с понятным сообщением');
  state.packaged = true;

  console.log('\n— app:updateInfo —');
  const info = await updateInfo();
  ok(info.version && info.state && info.releasesUrl && info.diag, 'updateInfo отдаёт версию, состояние и диагностику');

  console.log('\n— Автопроверка при запуске (через 4 с после ready) —');
  state.sent.length = 0;
  autoUpdater.mode = 'not-available';
  await wait(4300);
  stages = state.sent.filter(e => e.ch === 'updater:event').map(e => e.payload.stage);
  ok(stages.includes('check-requested') && stages.includes('checking-for-update'),
    'при запуске выполнена фоновая проверка: ' + stages.join(', '));

  console.log('\n============================');
  console.log('smoketest main.js: пройдено ' + pass + ', провалено ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SMOKETEST HARNESS ERROR', e); process.exit(2); });
