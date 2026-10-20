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
const FALLBACK_VERSION = '2.3.1';
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

/* ---------- обновления (electron-updater + GitHub Releases) ----------
   Источник обновлений: репозиторий GitHub naemnik6/Chess — артефакты релиза
   (exe-установщик + latest.yml) публикует GitHub Actions.
   Чтобы автообновление работало, нужны три условия:
     • приложение упаковано (app.isPackaged) — при запуске из исходников
       electron-updater пропускает проверку (dev-режим);
     • electron-updater лежит в "dependencies" desktop/package.json
       (НЕ в devDependencies — иначе он не попадает в пакет, и require
       падает: именно так раньше появлялось «не настроено»);
     • в resources есть app-update.yml — его генерирует electron-builder
       из блока build.publish при сборке установщика.
   Диагностика: каждый этап пишется console.log (видно при запуске из
   терминала) И дублируется в страницу каналом 'updater:event' — видно
   в DevTools (Ctrl+Shift+I) на вкладке Console. */
const RELEASES_URL = 'https://github.com/naemnik6/Chess/releases/latest';

let updater = null;               // autoUpdater из electron-updater
let updaterLoadError = null;      // почему require('electron-updater') не удался
let updaterState = 'idle';        // idle | checking | available | not-available | downloading | downloaded | error
let updaterLastError = null;      // последняя ошибка (для диагностики)
let uiCheckUntil = 0;             // до этого момента события «молчат» в диалогах: результат покажет UI

function updaterLog(stage, details) {
  console.log('[updater] ' + stage + (details ? ' — ' + details : ''));
  try {
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater:event', {
        stage: stage,
        details: details == null ? null : String(details),
        state: updaterState,
        appVersion: APP_VERSION,
        lastError: updaterLastError ? String(updaterLastError.message || updaterLastError) : null,
        releasesUrl: RELEASES_URL,
        ts: Date.now()
      });
    }
  } catch (e) { /* окно ещё не создано или уже закрыто — остаётся консоль */ }
}

/* Диагностика одним объектом: что именно не так (упаковка, updater, app-update.yml) */
function updaterDiagnostics() {
  const yml = process.resourcesPath ? path.join(process.resourcesPath, 'app-update.yml') : null;
  let ymlText = null;
  try { if (yml && fs.existsSync(yml)) ymlText = fs.readFileSync(yml, 'utf8').slice(0, 600); } catch (e) { }
  return {
    packaged: !!app.isPackaged,
    version: APP_VERSION,
    resourcesPath: process.resourcesPath || null,
    appUpdateYmlPath: yml,
    appUpdateYmlExists: !!(yml && fs.existsSync(yml)),
    appUpdateYml: ymlText,
    updaterLoaded: !!updater,
    updaterLoadError: updaterLoadError ? String(updaterLoadError.message || updaterLoadError) : null,
    state: updaterState,
    lastError: updaterLastError ? String(updaterLastError.message || updaterLastError) : null,
    releasesUrl: RELEASES_URL
  };
}

function loadUpdater() {
  if (updater || updaterLoadError) return updater;
  try {
    updater = require('electron-updater').autoUpdater;
  } catch (e) {
    updater = null;
    updaterLoadError = e;
    updaterLog('load-failed', 'require("electron-updater") упал: ' + (e && e.message || e) +
      '. Проверьте, что electron-updater указан в "dependencies" (не devDependencies) desktop/package.json.');
    return null;
  }
  updater.autoDownload = true;          // найденную версию качаем сразу, в фоне
  updater.autoInstallOnAppQuit = true;  // при выходе — установить
  updater.logger = {                    // подробный внутренний лог electron-updater — в наш лог
    info: (m) => updaterLog('log-info', typeof m === 'string' ? m : JSON.stringify(m)),
    warn: (m) => updaterLog('log-warn', typeof m === 'string' ? m : JSON.stringify(m)),
    error: (m) => updaterLog('log-error', typeof m === 'string' ? m : JSON.stringify(m)),
    debug: (m) => updaterLog('log-debug', typeof m === 'string' ? m : JSON.stringify(m))
  };

  /* Все события autoUpdater логируются; нативные диалоги показываем только
     когда проверка запущена НЕ из интерфейса (иначе интерфейс сам выведет
     конкретную ошибку — без дубля окон). */
  const uiQuiet = () => Date.now() < uiCheckUntil;

  updater.on('checking-for-update', () => {
    updaterState = 'checking';
    updaterLog('checking-for-update', 'текущая версия ' + APP_VERSION + ', источник: GitHub naemnik6/Chess');
  });
  updater.on('update-available', (info) => {
    updaterState = 'available';
    updaterLog('update-available', 'версия ' + (info && info.version) + (info && info.releaseDate ? ' от ' + info.releaseDate : ''));
    if (uiQuiet()) return;
    dialog.showMessageBox(win, {
      type: 'info', title: 'Обновление',
      message: 'Доступна новая версия: ' + (info && info.version),
      detail: 'Текущая версия: ' + APP_VERSION + '.\nЗагрузка уже идёт в фоне — по окончании предложим перезапустить приложение.',
      buttons: ['Скачать обновление вручную', 'Хорошо']
    }).then(({ response }) => { if (response === 0) shell.openExternal(RELEASES_URL); });
  });
  updater.on('update-not-available', (info) => {
    updaterState = 'not-available';
    updaterLog('update-not-available', 'установлена последняя версия (' + ((info && info.version) || APP_VERSION) + ')');
  });
  updater.on('download-progress', (p) => {
    updaterState = 'downloading';
    updaterLog('download-progress',
      (p && p.percent != null ? p.percent.toFixed(1) : '0') + '% · ' +
      (p && p.transferred != null ? (p.transferred / 1048576).toFixed(1) : '0') + ' МБ из ' +
      (p && p.total ? (p.total / 1048576).toFixed(1) : '?') + ' МБ');
  });
  updater.on('update-downloaded', (info) => {
    updaterState = 'downloaded';
    updaterLog('update-downloaded', 'версия ' + (info && info.version) + ' скачана и готова к установке');
    dialog.showMessageBox(win, {
      type: 'question', title: 'Обновление готово',
      message: 'Новая версия ' + ((info && info.version) || '') + ' скачана. Перезапустить и установить сейчас?',
      detail: 'Данные (архив партий, профили, настройки) сохраняются.',
      buttons: ['Перезапустить и установить', 'Позже']
    }).then(({ response }) => { if (response === 0) updater.quitAndInstall(); });
  });
  updater.on('error', (err) => {
    updaterState = 'error';
    updaterLastError = err;
    updaterLog('error', (err && err.message || String(err)) + (err && err.stack ? '\n' + err.stack : ''));
    if (uiQuiet()) return;   // ошибку во всей конкретике покажет интерфейс
    dialog.showMessageBox(win, {
      type: 'warning', title: 'Обновление',
      message: 'Не удалось проверить обновления',
      detail: 'Ошибка: ' + (err && err.message || String(err)) + '\n\n' +
        'Возможные причины: нет сети, GitHub недоступен, либо в сборке нет\n' +
        'resources/app-update.yml (его генерирует electron-builder из блока\n' +
        'build.publish при сборке установщика). Свежий установщик можно\n' +
        'скачать вручную со страницы релизов.',
      buttons: ['Скачать обновление вручную', 'Закрыть']
    }).then(({ response }) => { if (response === 0) shell.openExternal(RELEASES_URL); });
  });

  updaterLog('loaded', 'electron-updater подключён');
  return updater;
}

/* Ждём однозначного исхода проверки: available / not-available / downloaded / error / таймаут */
function waitForUpdateOutcome(timeoutMs) {
  return new Promise((resolve) => {
    if (!updater) { resolve({ ok: false, reason: 'no-updater', message: 'electron-updater не подключён' }); return; }
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      updater.removeListener('update-available', onAvail);
      updater.removeListener('update-not-available', onNot);
      updater.removeListener('update-downloaded', onDown);
      updater.removeListener('error', onErr);
      resolve(r);
    };
    const onAvail = (info) => finish({
      ok: true, reason: 'available',
      message: 'Доступна новая версия: ' + ((info && info.version) || '?') +
        '. Загрузка идёт в фоне — по окончании приложение предложит перезапуск.',
      version: info && info.version
    });
    const onNot = (info) => finish({
      ok: true, reason: 'up-to-date',
      message: 'У вас последняя версия (' + (((info && info.version) || APP_VERSION)) + ').',
      version: (info && info.version) || APP_VERSION
    });
    const onDown = (info) => finish({
      ok: true, reason: 'downloaded',
      message: 'Версия ' + ((info && info.version) || '?') + ' уже скачана и будет установлена при перезапуске приложения.',
      version: info && info.version
    });
    const onErr = (err) => finish({
      ok: false, reason: 'error',
      message: 'Проверка обновлений не удалась: ' + (err && err.message || String(err)),
      error: String((err && err.stack) || err)
    });
    updater.on('update-available', onAvail);
    updater.on('update-not-available', onNot);
    updater.on('update-downloaded', onDown);
    updater.on('error', onErr);
    setTimeout(() => finish({
      ok: false, reason: 'timeout',
      message: 'Проверка обновлений не завершилась за ' + Math.round(timeoutMs / 1000) +
        ' с. Проверьте подключение к сети или скачайте обновление вручную.',
      error: 'timeout after ' + timeoutMs + ' ms'
    }), timeoutMs);
  });
}

/* Полный цикл проверки: диагностика → запуск → ожидание исхода.
   source: 'startup' (автоматически при запуске) или 'ui' (кнопка в интерфейсе).
   Возвращает объект результата — интерфейс показывает КОНКРЕТНУЮ ошибку
   (из лога), а не абстрактное «не настроено». */
async function runUpdateCheck(source) {
  updaterLog('check-requested', 'источник: ' + source + ', упаковано: ' + !!app.isPackaged + ', версия: ' + APP_VERSION);
  const fail = (reason, message) => ({
    ok: false, reason: reason, message: message,
    diag: updaterDiagnostics(), releasesUrl: RELEASES_URL
  });

  if (!app.isPackaged) {
    const message = 'Проверка обновлений доступна только в установленной версии приложения: ' +
      'сейчас запущен dev-режим из исходников, electron-updater пропускает проверку для упакованных сборок. ' +
      'Соберите установщик командой npm run dist:win в папке desktop.';
    updaterLog('check-skipped', message);
    return fail('dev', message);
  }
  const up = loadUpdater();
  if (!up) {
    return fail('no-updater', 'electron-updater не загрузился: ' +
      (updaterLoadError && updaterLoadError.message || 'неизвестная ошибка') +
      '. Убедитесь, что он указан в "dependencies" desktop/package.json и попал в сборку.');
  }
  const diag = updaterDiagnostics();
  if (!diag.appUpdateYmlExists) {
    const message = 'Не найден файл ' + (diag.appUpdateYmlPath || 'resources/app-update.yml') +
      ' — сборка не содержит источника обновлений. app-update.yml генерирует electron-builder из блока ' +
      'build.publish (desktop/package.json) при сборке установщика. Пересоберите установщик ' +
      '(npm run dist:win) или скачайте обновление вручную со страницы релизов.';
    updaterLog('check-skipped', message);
    return fail('no-config', message);
  }
  try {
    uiCheckUntil = source === 'ui' ? Date.now() + 35000 : 0;
    const outcome = waitForUpdateOutcome(30000);
    await up.checkForUpdates();
    const result = await outcome;
    result.diag = updaterDiagnostics();
    result.releasesUrl = RELEASES_URL;
    updaterLog('check-result', result.reason + ' — ' + result.message);
    return result;
  } catch (e) {
    updaterState = 'error';
    updaterLastError = e;
    updaterLog('check-exception', (e && e.message || String(e)) + (e && e.stack ? '\n' + e.stack : ''));
    return fail('error', 'Проверка обновлений не удалась: ' + (e && e.message || String(e)));
  }
}

/* Кнопка в интерфейсе: возвращаем странице конкретный результат/ошибку и диагностику */
ipcMain.handle('app:checkUpdates', async () => await runUpdateCheck('ui'));
ipcMain.handle('app:updateInfo', () => ({
  version: APP_VERSION, state: updaterState,
  releasesUrl: RELEASES_URL, diag: updaterDiagnostics()
}));

/* ---------- запуск ---------- */
app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('org.chesster.app');
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

  /* Автопроверка обновлений при КАЖДОМ запуске — аналог
     autoUpdater.checkForUpdatesAndNotify(): проверка идёт в фоне, все события
     логируются (консоль + DevTools), найденная версия скачивается сама,
     а по готовности появляется диалог «Перезапустить и установить».
     В dev-режиме (запуск из исходников) пропускаем: electron-updater
     всё равно не проверяет обновления непакованного приложения. */
  if (app.isPackaged) {
    loadUpdater();
    setTimeout(() => {
      runUpdateCheck('startup').catch((e) => updaterLog('startup-check-failed', (e && e.message) || String(e)));
    }, 4000);   // небольшая задержка — не тормозим старт окна
  } else {
    updaterLog('startup-skip', 'dev-режим: автопроверка обновлений не выполняется (приложение не упаковано)');
  }
});
app.on('window-all-closed', () => {
  if (engineChild) { try { engineChild.kill(); } catch (e) { } }
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => { if (engineChild) { try { engineChild.kill(); } catch (e) { } } });

module.exports = { APP_VERSION };
