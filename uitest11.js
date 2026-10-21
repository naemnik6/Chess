/* Тесты версии 2.3.1/2.4: автообновление (логирование, автопроверка, конкретные
   ошибки без простыни заголовков, ручное скачивание), «О программе» в десктопе,
   стирание стрелок коротким левым кликом по пустой клетке, конфигурация релиза. */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); }
catch (e) { ({ JSDOM, VirtualConsole } = require('/tmp/node_modules/jsdom')); }
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const V = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).version;   /* напр. 2.4 */
const PV = V.split('.').length === 2 ? V + '.0' : V;                                      /* установщик: 2.4.0 */

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (fail++, console.log('  FAIL ' + m)); };

function boot(opts) {
  opts = opts || {};
  const errors = [];
  const logs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  vc.on('error', (...a) => errors.push(a.join(' ')));
  vc.on('log', (...a) => logs.push(a.join(' ')));
  const calls = { writes: [], external: [], opened: [], fullscreen: [] };
  let fileStore = opts.seedFile || null;
  let updaterCb = null;
  let updateResult = opts.updateResult || Promise.resolve(true);
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc,
    beforeParse(win) {
      win.URL.createObjectURL = () => 'blob:x';
      win.URL.revokeObjectURL = () => { };
      win.HTMLAnchorElement.prototype.click = function () { };
      win.open = function (url) { calls.opened.push(url); return null; };
      win.Element.prototype.getBoundingClientRect = function () {
        return this.id === 'board'
          ? { left: 0, top: 0, right: 800, bottom: 800, width: 800, height: 800, x: 0, y: 0 }
          : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
      };
      if (opts.desktop) {
        win.Chesster = {
          appVersion: PV, platform: 'electron',
          openExternal: (url) => { calls.external.push(url); return Promise.resolve(true); },
          saveFile: () => Promise.resolve({ saved: true, path: '/x' }),
          pickEngine: () => Promise.resolve({ canceled: true }),
          spawnEngine: () => Promise.resolve({ ok: true, pid: 1 }),
          engineWrite: () => { }, engineKill: () => { },
          onEngineLine: () => { }, onEngineExit: () => { }, onEngineError: () => { },
          onMenu: () => { }, setTitle: () => { }, setBadge: () => Promise.resolve(true),
          appReady: () => Promise.resolve(true),
          setFullscreen: on => calls.fullscreen.push(!!on),
          isFullscreen: () => Promise.resolve(false),
          checkUpdates: () => Promise.resolve(updateResult),
          setUpdateResult: (r) => { updateResult = r; },
          updateInfo: () => Promise.resolve({ version: PV, state: 'idle' }),
          onUpdaterEvent: (cb) => { updaterCb = cb; },
          archiveRead: () => fileStore,
          archiveWrite: t => { calls.writes.push(t); fileStore = t; return true; },
          archivePath: () => 'C:\\Users\\tester\\AppData\\Roaming\\Chess\\archive.json'
        };
      }
    }
  });
  return {
    dom, win: dom.window, doc: dom.window.document, errors, logs, calls,
    file: () => fileStore,
    fireUpdaterEvent: (ev) => updaterCb && updaterCb(ev),
    setUpdaterCb: cb => { updaterCb = cb; }
  };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const RELEASES = 'https://github.com/naemnik6/Chess/releases/latest';

(async () => {
  /* ================= 1. БРАУЗЕР: «О программе», журнал, стрелки ================= */
  const b = boot({});
  await wait(250);
  const B = b.win, BA = B.ChessApp, BC = B.Chess, bdoc = b.doc;
  const bpev = (t, tg, x, y, btn) => tg.dispatchEvent(new B.MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: btn }));
  const bsq = n => bdoc.querySelector('.sq[data-sq="' + BC.sqFromName(n) + '"]');
  const btap = n => bpev('pointerdown', bsq(n), 0, 0, 0);

  console.log('\n— 2.4: «О программе» и журнал (браузер, окно настроек) —');
  BA.openSettings('about');
  await wait(30);
  let modal = null;
  ok(BA.settingsOpen(), 'категория «О программе» открывается в браузере');
  ok(!!bdoc.getElementById('btnManualUpdate'), 'в «О программе» есть кнопка «Скачать обновление вручную»');
  ok(new RegExp('Версия приложения: ' + V.replace('.', '\\.')).test((bdoc.getElementById('versionLine').textContent || '')),
    'версия ' + V + ' показана в «О программе»');
  bdoc.getElementById('btnManualUpdate').dispatchEvent(new B.MouseEvent('click', { bubbles: true }));
  await wait(30);
  ok(b.calls.opened.includes(RELEASES), 'кнопка открывает страницу релизов GitHub: ' + b.calls.opened.join(','));
  BA.closeSettings();
  ok(!BA.settingsOpen(), 'настройки закрылись');

  BA.openSettings('help');
  await wait(30);
  ok(BA.CHANGELOG.some(r => r[0] === '2.3.1'), 'в журнале есть запись версии 2.3.1');
  ok(BA.CHANGELOG.some(r => r[0] === V), 'в журнале есть запись текущей версии ' + V);
  const planRow = BA.CHANGELOG.find(r => r[0] === 'план');
  ok(planRow && !/автообновления через GitHub Actions/i.test(planRow[1]), 'из «плана» убран пункт про автообновления (реализовано)');
  ok(/окно настроек/i.test((BA.CHANGELOG.find(r => r[0] === '2.4') || ['',''])[1]), 'запись 2.4 описывает окно настроек');
  BA.closeSettings();

  console.log('\n— 2.3.1/2.4: короткий левый клик стирает стрелки (браузер) —');
  bpev('pointerdown', bsq('e2'), 450, 650, 2); bpev('pointermove', B, 450, 550, 2); bpev('pointerup', B, 450, 450, 2);
  ok(BA.G.marks.length === 1, 'стрелка e2→e4 нарисована');
  bpev('pointerdown', bsq('e5'), 450, 450, 0); bpev('pointerup', B, 450, 450, 0);
  ok(BA.G.marks.length === 0, 'короткий левый клик по ПУСТОЙ клетке стирает все пометки');
  ok(bdoc.querySelector('#arrowLayer').innerHTML === '', 'слой стрелок пуст после стирания');

  bpev('pointerdown', bsq('d2'), 350, 650, 2); bpev('pointermove', B, 350, 550, 2); bpev('pointerup', B, 350, 450, 2);
  bpev('pointerdown', bsq('d7'), 350, 150, 2); bpev('pointerup', B, 350, 150, 2);
  ok(BA.G.marks.length === 2, 'две пометки нарисованы');
  bpev('pointerdown', bsq('h8'), 750, 50, 0); bpev('pointerup', B, 750, 50, 0);
  ok(BA.G.marks.length === 0, 'короткий левый клик по занятой чужой клетке тоже стирает всё');

  /* ход стирает пометки (регресс 2.3) */
  bpev('pointerdown', bsq('e2'), 450, 650, 2); bpev('pointermove', B, 450, 550, 2); bpev('pointerup', B, 450, 450, 2);
  btap('e2'); btap('e4');
  await wait(30);
  ok(BA.G.marks.length === 0 && BA.G.moves.length === 1, 'сделанный ход стирает пометки');

  /* короткий левый клик в просмотре истории стирает пометки и не падает */
  bdoc.dispatchEvent(new B.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  await wait(20);
  ok(!BA.canPlay(), 'просмотр истории: ходы заблокированы');
  bpev('pointerdown', bsq('e2'), 450, 650, 2); bpev('pointermove', B, 450, 550, 2); bpev('pointerup', B, 450, 450, 2);
  ok(BA.G.marks.length === 1, 'в просмотре истории стрелку нарисовали');
  bpev('pointerdown', bsq('a1'), 50, 750, 0); bpev('pointerup', B, 50, 750, 0);
  ok(BA.G.marks.length === 0, 'короткий левый клик в просмотре истории стирает пометки');
  bdoc.dispatchEvent(new B.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await wait(20);

  console.log('\n— 2.4: проверка обновлений в браузере —');
  BA.openSettings('about');
  bdoc.getElementById('btnCheckUpdates').dispatchEvent(new B.MouseEvent('click', { bubbles: true }));
  await wait(30);
  modal = bdoc.querySelector('.modal');
  ok(modal && modal.querySelector('h2').textContent === 'Обновления', 'браузер: модалка «Обновления»');
  ok(modal && !!modal.querySelector('[data-a=manual]'), 'браузер: есть кнопка ручного скачивания');
  modal.querySelector('[data-a=close]').dispatchEvent(new B.MouseEvent('click', { bubbles: true }));
  ok(b.errors.length === 0, 'браузер: без ошибок — ' + b.errors.join(' | '));

  /* ================= 2. ДЕСКТОП: ошибки, диагностика, события ================= */
  console.log('\n— 2.4: автообновление (десктоп) —');
  const d = boot({
    desktop: true,
    updateResult: {
      ok: false, reason: 'no-config',
      message: 'Не найден файл C:\\Program Files\\Шахматы\\resources\\app-update.yml — сборка не содержит источника обновлений.',
      diag: {
        packaged: true, version: '2.3.1', updaterLoaded: true, updaterLoadError: null,
        appUpdateYmlPath: 'C:\\res\\app-update.yml', appUpdateYmlExists: false, lastError: null
      },
      releasesUrl: RELEASES
    }
  });
  await wait(250);
  const D = d.win, DA = D.ChessApp, ddoc = d.doc;

  /* «О программе» в десктопе (безлимитный архив: pct = null — раньше падало) */
  DA.openSettings('about');
  await wait(30);
  const aboutTxt = (ddoc.getElementById('aboutInfo').textContent || '') + ' ' + (ddoc.getElementById('versionLine').textContent || '');
  ok(/без ограничений/.test(aboutTxt), 'десктоп: строка архива «без ограничений» (регресс quotaInfo.pct = null)');
  ok(aboutTxt.indexOf(V) >= 0, 'десктоп: версия ' + V + ' в «О программе»');
  ok(/обёртка/.test(aboutTxt), 'десктоп: показана версия обёртки');
  await wait(10);

  /* конкретная ошибка вместо «не настроено» + кнопка ручного скачивания */
  ddoc.getElementById('btnCheckUpdates').dispatchEvent(new D.MouseEvent('click', { bubbles: true }));
  await wait(60);
  modal = ddoc.querySelector('.modal');
  ok(modal && /не удалось/i.test(modal.querySelector('h2').textContent), 'десктоп: заголовок «Проверить обновления не удалось»');
  ok(modal && /app-update\.yml/.test(modal.textContent), 'десктоп: показана КОНКРЕТНАЯ ошибка (app-update.yml), а не «не настроено»');
  ok(modal && /Диагностика/.test(modal.textContent) && /НЕТ/.test(modal.textContent), 'десктоп: блок диагностики с признаком отсутствия app-update.yml');
  ok(modal && !!modal.querySelector('[data-a=manual]'), 'десктоп: кнопка «Скачать обновление вручную» в ошибке');
  modal.querySelector('[data-a=manual]').dispatchEvent(new D.MouseEvent('click', { bubbles: true }));
  await wait(30);
  ok(d.calls.external.includes(RELEASES), 'десктоп: кнопка открыла ' + RELEASES + ' через openExternal');

  /* 2.4: ошибка 404 с дампом заголовков — короткое сообщение + «Технические подробности» */
  d.win.Chesster.setUpdateResult({
    ok: false, reason: 'error',
    message: 'Проверка обновлений не удалась: 404 "method: GET url: https://github.com/naemnik6/Chess/releases.atom\n\nPlease double check that your authentication token is correct.\n\nHeaders: {"set-cookie":["_gh_sess=SECRET; path=/; secure","logged_in=no"]}"',
    error: 'HttpError: 404\n  at ...',
    diag: { packaged: true, updaterLoaded: true, appUpdateYmlExists: true },
    releasesUrl: RELEASES
  });
  ddoc.getElementById('btnCheckUpdates').dispatchEvent(new D.MouseEvent('click', { bubbles: true }));
  await wait(60);
  modal = ddoc.querySelector('.modal');
  const msgP = modal ? (modal.querySelector('p').textContent || '') : '';
  ok(modal && /releases\.atom/.test(msgP), '404: в сообщении видна суть — адрес фида релизов');
  ok(modal && !/Headers:/.test(msgP) && !/set-cookie/.test(msgP), '404: простыни HTTP-заголовков и кук в основном тексте нет');
  ok(modal && !!modal.querySelector('details.upd-tech'), '404: полный текст спрятан в «Технические подробности»');
  ok(modal && /set-cookie/.test(modal.querySelector('details.upd-tech').textContent), '404: подробности сохраняют исходный дамп для диагностики');
  modal.querySelector('[data-a=close]').dispatchEvent(new D.MouseEvent('click', { bubbles: true }));
  await wait(20);

  /* успешный результат: последняя версия — тост, без модалки */
  d.win.Chesster.setUpdateResult({ ok: true, reason: 'up-to-date', message: 'У вас последняя версия (' + PV + ').' });
  ddoc.getElementById('btnCheckUpdates').dispatchEvent(new D.MouseEvent('click', { bubbles: true }));
  await wait(60);
  DA.closeSettings();
  ok(!ddoc.querySelector('.modal'), 'десктоп: при последней версии — только тост, окна нет');
  ok(/ОБНОВЛЕНИЙ НЕТ/.test(ddoc.querySelector('#toastWrap').textContent) &&
    /последняя версия/.test(ddoc.querySelector('#toastWrap').textContent), 'десктоп: тост «Обновлений нет» с текстом результата');

  /* события обёртки: лог в DevTools + тосты */
  d.fireUpdaterEvent({ stage: 'checking-for-update', details: 'текущая версия 2.3.1', state: 'checking' });
  await wait(10);
  ok(d.logs.some(l => /\[updater\] checking-for-update/.test(l)), 'десктоп: событие checking-for-update пишется в консоль страницы (DevTools)');
  d.fireUpdaterEvent({ stage: 'update-downloaded', details: 'версия 2.4.0 скачана', state: 'downloaded' });
  await wait(10);
  ok(/ОБНОВЛЕНИЕ ГОТОВО/.test(ddoc.querySelector('#toastWrap').textContent), 'десктоп: тост «ОБНОВЛЕНИЕ ГОТОВО» на update-downloaded');
  ok(d.logs.some(l => /\[updater\] update-downloaded/.test(l)), 'десктоп: update-downloaded в логе');
  d.fireUpdaterEvent({ stage: 'error', details: 'net::ERR_INTERNET_DISCONNECTED', state: 'error' });
  await wait(10);
  ok(/ОБНОВЛЕНИЕ — ОШИБКА/.test(ddoc.querySelector('#toastWrap').textContent), 'десктоп: тост об ошибке обновления');
  ok(d.errors.length === 0, 'десктоп: без ошибок — ' + d.errors.join(' | '));

  /* ================= 3. СТАТИКА: конфигурация релиза ================= */
  console.log('\n— 2.4: конфигурация автообновления и релиза —');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8'));
  ok(pkg.dependencies && /electron-updater/.test(JSON.stringify(pkg.dependencies)),
    'package.json: electron-updater в dependencies (иначе не попадёт в сборку — корень бага «не настроено»)');
  ok(!pkg.devDependencies || !pkg.devDependencies['electron-updater'], 'package.json: в devDependencies electron-updater больше нет');
  ok(pkg.version === PV, 'package.json: версия ' + PV);
  ok(pkg.build.publish && pkg.build.publish.provider === 'github' &&
    pkg.build.publish.owner === 'naemnik6' && pkg.build.publish.repo === 'Chess',
    'package.json: build.publish → github naemnik6/Chess (из него electron-builder генерирует app-update.yml)');

  const main = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8');
  ok(/updater\.on\('checking-for-update'/.test(main) && /updater\.on\('update-available'/.test(main) &&
    /updater\.on\('update-not-available'/.test(main) && /updater\.on\('update-downloaded'/.test(main) &&
    /updater\.on\('error'/.test(main), 'main.js: логируются все пять событий autoUpdater');
  ok(/webContents\.send\('updater:event'/.test(main), 'main.js: события дублируются в страницу (видно в DevTools)');
  ok(/runUpdateCheck\('startup'\)/.test(main) && /whenReady/.test(main), 'main.js: автопроверка обновлений при запуске');
  ok(/RELEASES_URL = 'https:\/\/github\.com\/naemnik6\/Chess\/releases\/latest'/.test(main), 'main.js: ссылка ручного скачивания в диалогах');
  ok(/app-update\.yml/.test(main), 'main.js: диагностика app-update.yml');
  ok(/Скачать обновление вручную/.test(main), 'main.js: кнопка ручного скачивания в нативных диалогах');
  ok(!/не настроено в этой сборке/i.test(main), 'main.js: сообщения «не настроено» больше нет');

  const preload = fs.readFileSync(path.join(ROOT, 'desktop', 'preload.js'), 'utf8');
  ok(/onUpdaterEvent/.test(preload) && /updater:event/.test(preload), 'preload.js: мост onUpdaterEvent');
  ok(/app:checkUpdates/.test(preload) && /app:updateInfo/.test(preload), 'preload.js: checkUpdates + updateInfo');

  const bat = fs.readFileSync(path.join(ROOT, 'push-release.bat'), 'utf8');
  ok(bat.indexOf('git tag v' + PV) >= 0 && bat.indexOf('git push origin v' + PV) >= 0, 'push-release.bat: тег v' + PV);
  ok(/git commit -m "Release /.test(bat), 'push-release.bat: сообщение коммита на английском (Release …)');
  ok(!/[^\x09\x0a\x0d\x20-\x7e]/.test(bat), 'push-release.bat: только ASCII — cmd.exe не исказит текст при пуше в GitHub');
  const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
  ok(ver.version === V, 'version.json: ' + V);
  ok(html.indexOf("var APP_VERSION = '" + V + "'") >= 0 &&
    fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').indexOf('chesster-' + V) >= 0,
    'index.html и sw.js собраны с версией ' + V);

  console.log('\n============================');
  console.log(V + ': пройдено ' + pass + ', провалено ' + fail);
  process.exit(fail ? 1 : 0);
})();
