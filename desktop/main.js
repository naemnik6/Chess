/* =========================================================================
   Chesster — десктоп-обёртка на Electron.
   Запускает ТОТ ЖЕ index.html, что и браузерная версия, и добавляет:
     • нативное окно с русской меню-строкой, иконкой и заголовком;
     • системный диалог сохранения файлов (PGN-выгрузка архива);
     • открытие внешних ссылок (Lichess) в системном браузере;
     • запуск внешнего UCI-движка (Rodent IV) отдельным процессом —
       в десктопе движок может быть настоящим исполняемым файлом,
       а не только WASM-сборкой;
     • счётчик на иконке и корректное завершение.
   Безопасность: contextIsolation + sandbox, preload отдаёт в страницу
   только узкий набор функций (window.Chesster), nodeIntegration выключен.
   ========================================================================= */
const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let win = null;
let engineChild = null;

/* ---------- версия приложения ----------
   Единый источник — version.json в корне проекта; в упакованном виде он
   приезжает в resources/app/version.json. Если файла нет — запасная константа. */
const FALLBACK_VERSION = '2.0';
function readAppVersion() {
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath, 'app', 'version.json'),
    path.join(__dirname, 'version.json'),
    path.join(__dirname, '..', 'version.json'),
    path.join(app.getPath('exe'), 'version.json')
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (j && j.version) return String(j.version);
      }
    } catch (e) { /* пропускаем */ }
  }
  return FALLBACK_VERSION;
}
const APP_VERSION = readAppVersion();

/* ---------- где лежит index.html ----------
   В разработке: desktop/../index.html.
   В упаковке: electron-builder кладёт веб-часть в resources/app/ (extraResources),
   а код приложения живёт в resources/app.asar — поэтому путь через __dirname..'
   там НЕ работает и окно открывало пустую страницу. Перебираем все варианты,
   включая файл рядом с exe (portable-сценарий). */
function findIndexPath() {
  const exeDir = path.dirname(app.getPath('exe'));
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath, 'app', 'index.html'),
    path.join(__dirname, '..', 'index.html'),
    path.join(__dirname, 'index.html'),
    path.join(app.getAppPath(), 'index.html'),
    path.join(app.getAppPath(), '..', 'index.html'),
    path.join(exeDir, 'index.html'),
    path.join(exeDir, 'resources', 'app', 'index.html'),
    path.join(exeDir, '..', 'index.html')
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; } catch (e) { }
  }
  return { missing: candidates };
}

function createWindow() {
  const { screen } = require('electron');
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.max(1280, Math.min(area.width, 1720)),
    height: Math.max(800, Math.min(area.height, 1020)),
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: '#0b0e1c',
    title: 'Chess',
    icon: path.join(__dirname, 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon-512.png'),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  win.once('ready-to-show', () => {
    win.show();
    win.maximize();          /* десктоп-версия стартует развёрнутой на весь экран */
  });

  const indexFile = findIndexPath();
  if (indexFile.missing) {
    dialog.showErrorBox(
      'Шахматы: не найден index.html',
      'Приложение не смогло найти веб-часть (index.html).\n\nПроверенные пути:\n  ' +
      indexFile.missing.join('\n  ') +
      '\n\nПереустановите приложение или положите index.html рядом с исполняемым файлом.'
    );
    app.quit();
    return;
  }
  console.log('[chesster] версия', APP_VERSION, '| index.html:', indexFile);
  win.loadFile(indexFile);
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    dialog.showErrorBox('Шахматы: страница не загрузилась',
      'Код ' + code + ': ' + desc + '\nURL: ' + url +
      '\n\nПопробуйте перезапустить приложение; если ошибка повторяется — переустановите его.');
  });

  // внешние ссылки — только в системный браузер, никогда внутри окна
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const file = url.startsWith('file://');
    if (!file) { event.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); }
  });

  win.on('closed', () => { win = null; });
}

/* ---------- полноэкранный режим ---------- */
ipcMain.on('win:setFullscreen', (_e, payload) => {
  if (!win) return;
  const on = !!(payload && payload.on);
  win.setFullScreen(on);
});
ipcMain.handle('win:isFullscreen', () => (win ? win.isFullScreen() : false));

/* ---------- меню ----------
   Раньше здесь собиралась нативная панель «Партия/Вид/Инструменты/Справка»,
   которая в полноэкранном режиме оставалась видимой полосой сверху.
   Теперь меню полностью перенесено в интерфейс приложения (кнопка «⋮» в шапке),
   а нативная панель отключена. */
function buildMenu() {
  // Нативная панель меню отключена: в полноэкранном режиме она оставалась
  // видимой полосой сверху. Все действия («Партия», «Вид», «Инструменты»,
  // «Справка») перенесены в интерфейс приложения — кнопка «⋮» в шапке окна.
  if (process.platform === 'darwin') {
    // macOS требует наличие меню приложения для Quit/Hide — оставляем минимум
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: app.name, submenu: [{ role: 'quit' }, { role: 'hide' }, { role: 'minimize' }] }
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }
}

/* ---------- IPC: архив партий файлом на устройстве ----------
   В десктоп-версии архив живёт не в localStorage (там ограничения браузера),
   а обычным файлом archive.json в userData: место практически не ограничено,
   партии хранятся на устройстве пользователя. */
const archiveFile = () => path.join(app.getPath('userData'), 'archive.json');
ipcMain.on('store:readArchive', (e) => {
  try {
    e.returnValue = fs.existsSync(archiveFile()) ? fs.readFileSync(archiveFile(), 'utf8') : null;
  } catch (err) { e.returnValue = null; }
});
ipcMain.on('store:writeArchive', (e, text) => {
  try {
    fs.writeFileSync(archiveFile(), String(text), 'utf8');
    e.returnValue = true;
  } catch (err) { e.returnValue = false; }
});
ipcMain.on('store:archivePath', (e) => { e.returnValue = archiveFile(); });

/* ---------- IPC: версия ---------- */
ipcMain.on('app:version', (event) => { event.returnValue = APP_VERSION; });

/* ---------- IPC: файлы ---------- */
ipcMain.handle('dialog:saveFile', async (_e, payload) => {
  if (!win) return { saved: false };
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Сохранить файл',
    defaultPath: path.join(app.getPath('documents'), payload.name || 'partiya.pgn'),
    filters: [
      { name: 'Шахматные файлы PGN', extensions: ['pgn', 'txt'] },
      { name: 'Все файлы', extensions: ['*'] }
    ]
  });
  if (canceled || !filePath) return { saved: false, canceled: true };
  try {
    const data = typeof payload.data === 'string'
      ? Buffer.from(payload.data, 'utf8')
      : Buffer.from(payload.data);           // Uint8Array / ArrayBuffer из preload
    fs.writeFileSync(filePath, data);
    return { saved: true, path: filePath };
  } catch (err) {
    return { saved: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('shell:openExternal', async (_e, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.on('win:setTitle', (_e, payload) => {
  /* из preload приходит объект { text } — берём строку из него, а не сам объект */
  const t = payload && typeof payload === 'object' ? payload.text : payload;
  if (win && t) win.setTitle(String(t));
});
ipcMain.on('win:setBadge', (_e, payload) => {
  if (!win) return;
  const text = (payload && payload.text) || '';
  try {
    if (process.platform === 'darwin') app.dock.setBadge(text);
    else if (process.platform === 'linux' && win.setOverlayIcon) { /* нет оверлея — пропускаем */ }
    else if (win.setOverlayIcon) win.setOverlayIcon(null, '');
  } catch (e) { /* необязательно */ }
});

/* ---------- IPC: внешний UCI-движок отдельным процессом ----------
   Это путь для настоящего Rodent IV в десктопе: исполняемый файл работает
   нативно, строки UCI ходят через IPC, а страница видит их как обычный
   UCI-поток (window.Chesster.onEngineLine). */
ipcMain.handle('engine:spawn', async (_e, exePath) => {
  if (engineChild) { try { engineChild.kill(); } catch (e) { } engineChild = null; }
  if (typeof exePath !== 'string' || !exePath) return { ok: false, error: 'не указан файл движка' };
  if (!fs.existsSync(exePath)) return { ok: false, error: 'файл не найден: ' + exePath };
  try {
    engineChild = spawn(exePath, [], { cwd: path.dirname(exePath), stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
  engineChild.stdout.setEncoding('utf8');
  let buf = '';
  engineChild.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line && win) win.webContents.send('engine:line', line);
    }
  });
  engineChild.on('exit', (code) => { if (win) win.webContents.send('engine:exit', code); engineChild = null; });
  engineChild.on('error', (err) => { if (win) win.webContents.send('engine:error', String(err.message)); });
  return { ok: true, pid: engineChild.pid };
});
ipcMain.on('engine:write', (_e, line) => {
  if (engineChild && engineChild.stdin.writable) engineChild.stdin.write(line + '\n');
});
ipcMain.on('engine:kill', () => {
  if (engineChild) { try { engineChild.kill(); } catch (e) { } engineChild = null; }
});
ipcMain.handle('engine:pick', async () => {
  if (!win) return { canceled: true };
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Выбрать исполняемый файл движка (Rodent IV)',
    properties: ['openFile'],
    filters: [
      { name: 'Исполняемые файлы', extensions: ['exe', 'bin', ''] },
      { name: 'Все файлы', extensions: ['*'] }
    ]
  });
  return { canceled, path: canceled ? null : filePaths[0] };
});

/* ---------- обновления ----------
   Три канала, по среде:
     • браузер  — обычная перезагрузка страницы;
     • PWA      — сервис-воркер кэширует новую версию по имени кэша (version.json)
                  и сам предложит обновиться при следующем открытии;
     • десктоп  — electron-updater, если он установлен и в build.publish указан
                  источник (GitHub и т.п.). Без настроенного источника показываем
                  текущую версию и подсказку. */
function checkForUpdates() {
  let updater = null;
  try { updater = require('electron-updater').autoUpdater; } catch (e) { updater = null; }
  if (!updater) {
    dialog.showMessageBox(win, {
      type: 'info', title: 'Обновления',
      message: 'Шахматы ' + APP_VERSION,
      detail: 'Автообновление не настроено в этой сборке.\n\n' +
        '• Десктоп: соберите новую версию командой npm run dist:win и установите поверх — ' +
        'данные (архив партий, профили, настройки) хранятся отдельно и сохранятся.\n' +
        '• Веб/PWA: новая версия применяется сервис-воркером автоматически при следующем открытии.\n\n' +
        'Чтобы включить автообновление, добавьте electron-updater и блок build.publish ' +
        '(см. desktop/README.md, раздел «Обновления»).'
    });
    return;
  }
  updater.once('update-available', () => dialog.showMessageBox(win, {
    type: 'info', title: 'Обновление', message: 'Доступна новая версия — скачиваем…'
  }));
  updater.once('update-downloaded', () => {
    dialog.showMessageBox(win, {
      type: 'question', title: 'Обновление готово',
      message: 'Новая версия скачана. Перезапустить сейчас?', buttons: ['Перезапустить', 'Позже']
    }).then(({ response }) => { if (response === 0) updater.quitAndInstall(); });
  });
  updater.once('error', (e) => dialog.showMessageBox(win, {
    type: 'warning', title: 'Обновление', message: 'Не удалось проверить обновления: ' + e.message
  }));
  updater.checkForUpdates().catch(() => { });
}

ipcMain.handle('app:checkUpdates', () => { checkForUpdates(); return true; });

/* ---------- запуск ---------- */
app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('org.chesster.app');
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => {
  if (engineChild) { try { engineChild.kill(); } catch (e) { } }
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => { if (engineChild) { try { engineChild.kill(); } catch (e) { } } });

module.exports = { APP_VERSION };
