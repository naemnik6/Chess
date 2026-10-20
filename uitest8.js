/* Тесты версионирования, обновлений и десктоп-раскладки (исправление критического бага упаковки) */
const fs = require('fs');
const path = require('path');
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); }
catch (e) { ({ JSDOM, VirtualConsole } = require('/tmp/node_modules/jsdom')); }
const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (fail++, console.log('  FAIL ' + m)); };

function boot(withBridge) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc,
    beforeParse(win) {
      if (withBridge) {
        win.Chesster = {
          appVersion: '2.0', platform: 'electron',
          openExternal: () => Promise.resolve(true),
          saveFile: () => Promise.resolve({ saved: true, path: '/x' }),
          pickEngine: () => Promise.resolve({ canceled: true }),
          spawnEngine: () => Promise.resolve({ ok: true, pid: 1 }),
          engineWrite: () => { }, engineKill: () => { },
          onEngineLine: () => { }, onEngineExit: () => { }, onEngineError: () => { },
          onMenu: () => { }, setTitle: () => { }, setBadge: () => Promise.resolve(true),
          appReady: () => Promise.resolve(true)
        };
      }
      win.URL.createObjectURL = () => 'blob:x';
      win.URL.revokeObjectURL = () => { };
      win.HTMLAnchorElement.prototype.click = function () { };
    }
  });
  return { dom, win: dom.window, doc: dom.window.document, errors };
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('\n— Маркировка версии —');
  const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
  const V = ver.version;
  ok(/^\d+\.\d+(\.\d+)?$/.test(V), 'version.json — единый источник версии: ' + V);
  ok(new RegExp("var APP_VERSION = ['\"]" + V.replace('.', '\\.') + "['\"]").test(html), 'версия прошита в собранный index.html');
  ok(/var BUILD_STAMP = ['"]\d{4}-\d{2}-\d{2}['"]/.test(html), 'дата сборки прошита: ' + (html.match(/var BUILD_STAMP = ['"]([^'"]+)['"]/) || [])[1]);

  const b = boot(false);
  await wait(220);
  const A = b.win.ChessApp, S = b.win.Store;
  const v = A.version();
  ok(v.app === V, 'ChessApp.version() отдаёт ' + V + ': ' + JSON.stringify(v));
  A.openSettings('about');
  const vline = (b.doc.getElementById('versionLine').textContent || '').replace(/\s+/g, ' ');
  ok(new RegExp('Версия приложения: ' + V.replace('.', '\\.')).test(vline), 'версия показана в настройках, категория «О программе»: ' + vline.slice(0, 60));
  ok(/режим: браузер/.test(vline), 'рядом показан режим запуска');
  ok(/Обновления:/.test(vline), 'рядом объяснено, как приходят обновления');
  const foot = (b.doc.getElementById('footVersion').textContent || '').replace(/\s+/g, ' ');
  ok(new RegExp('Шахматы ' + V.replace('.', '\\.')).test(foot), 'версия продублирована внизу страницы: ' + foot.slice(0, 50));
  ok(b.doc.getElementById('versionLine').closest('#setWin') !== null, 'строка версии живёт в окне настроек');
  const helpTxt = (b.doc.querySelector('#helpRules').textContent || '').replace(/\s+/g, ' ');
  ok(new RegExp('Шахматы ' + V.replace('.', '\\.')).test(helpTxt), 'версия есть и в справке (настройки → «Справка»)');
  ok(b.doc.getElementById('btnHelp') === null, 'отдельной кнопки «?» нет — вся справка в окне настроек');
  A.closeSettings();
  ok(!b.doc.body.classList.contains('desktop'), 'в браузере нет класса desktop');
  A.openPanel('game');
  ok(A.panelOpen() === true, 'в браузере меню открылось только по действию пользователя');
  A.closePanel();
  ok(b.errors.length === 0, 'ошибок консоли в браузере нет');

  console.log('\n— Десктоп: раскладка и автооткрытие меню —');
  const d = boot(true);
  await wait(220);
  const DA = d.win.ChessApp;
  ok(d.doc.body.classList.contains('desktop'), 'в обёртке выставляется класс desktop');
  ok(DA.panelOpen() === true, 'на компьютере меню открыто сразу (окно большое, панель не мешает)');
  ok(d.win.ChessApp.G.tab === 'moves', 'открыта сохранённая вкладка: ' + DA.G.tab);
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  ok(/body\.desktop \.panel\{width:min\(520px,100vw\)/.test(css), 'панель на компьютере шире (520 px)');
  ok(/body\.desktop \.toolbar button\{width:44px/.test(css), 'кнопки-иконки на компьютере крупнее');
  ok(/body\.desktop \.moves-status \.big\{font-size:2[0-9]px/.test(css), 'строка статуса во вкладке на компьютере крупнее');
  ok(/body\.desktop\{font-size:15px;overflow:hidden\}/.test(css), 'на компьютере отключена страничная прокрутка');
  ok(/body\.desktop footer\.foot\{display:none\}/.test(css), 'футер браузера в приложении не мешает');
  ok(css.indexOf('--dw') < 0 && /\.panel\{position:absolute/.test(css),
    'панель на компьютере — оверлей: открытие меню не сдвигает и не опускает доску');
  DA.openSettings('view');
  const chk = d.doc.getElementById('chkPanelAuto');
  ok(chk && chk.checked === true, 'галочка «открывать меню при запуске» включена по умолчанию');
  chk.checked = false; chk.dispatchEvent(new d.win.Event('change', { bubbles: true }));
  ok(d.win.Store.settings().panelAutoOpen === false, 'отключение автооткрытия сохраняется в настройках');
  chk.checked = true; chk.dispatchEvent(new d.win.Event('change', { bubbles: true }));
  ok(d.win.Store.settings().panelAutoOpen === true, 'включение обратно тоже сохраняется');
  ok(d.errors.length === 0, 'ошибок консоли в обёртке нет');

  console.log('\n— Критический баг упаковки: поиск index.html —');
  const main = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8');
  ok(/process\.resourcesPath && path\.join\(process\.resourcesPath, 'app', 'index\.html'\)/.test(main),
    'упакованный путь resources/app/index.html проверяется первым');
  ok(/path\.join\(__dirname, '\.\.', 'index\.html'\)/.test(main), 'путь разработки desktop/../index.html сохранён');
  ok(/path\.join\(exeDir, 'index\.html'\)/.test(main), 'portable-сценарий: index.html рядом с exe');
  ok(/findIndexPath\(\)/.test(main) && /fs\.existsSync\(c\)/.test(main), 'пути перебираются до первого существующего файла');
  ok(/indexFile\.missing/.test(main) && /showErrorBox/.test(main), 'при отсутствии файла — понятное окно с перечнем путей, а не пустой фон');
  ok(/did-fail-load/.test(main), 'ошибка загрузки страницы тоже диагностируется');
  ok(!/win\.loadFile\(path\.join\(__dirname, '\.\.', 'index\.html'\)\)/.test(main), 'старого сломанного вызова loadFile больше нет');
  ok(/win\.maximize\(\)/.test(main), 'приложение стартует развёрнутым на весь экран');
  ok(/width: Math\.max\(1280/.test(main) && /minWidth: 900/.test(main), 'минимальный размер окна поднят (не «малое окно»)');

  console.log('\n— Резолвер index.html: имитация трёх раскладок —');
  const os = require('os');
  const mk = base => { fs.mkdirSync(base, { recursive: true }); return base; };
  const findSrc = (main.match(/function findIndexPath\(\) \{[\s\S]*?\n\}/) || [])[0];
  ok(!!findSrc, 'функция findIndexPath извлечена из main.js для проверки');
  const makeFinder = (dirName, resourcesPath, exePath) => {
    const fakeApp = { getPath: () => exePath, getAppPath: () => dirName };
    const factory = new Function('fs', 'path', 'app', '__dirname',
      findSrc + '; return findIndexPath;');
    return factory(fs, path, fakeApp, dirName);
  };
  // 1) упаковка: код в app.asar, веб-часть в resources/app
  const pkgDir = mk(path.join(os.tmpdir(), 'chesstest-pkg'));
  mk(path.join(pkgDir, 'resources', 'app'));
  fs.writeFileSync(path.join(pkgDir, 'resources', 'app', 'index.html'), '<!doctype html>');
  let found = makeFinder(path.join(pkgDir, 'resources', 'app.asar'), path.join(pkgDir, 'resources'), path.join(pkgDir, 'Chess.exe'))();
  ok(typeof found === 'string' && found === path.join(pkgDir, 'resources', 'app', 'index.html'),
    'упаковка: найден resources/app/index.html (раньше здесь открывалась пустая страница)');
  // 2) разработка: desktop/main.js рядом с ../index.html
  const devDir = mk(path.join(os.tmpdir(), 'chesstest-dev'));
  mk(path.join(devDir, 'desktop'));
  fs.writeFileSync(path.join(devDir, 'index.html'), '<!doctype html>');
  found = makeFinder(path.join(devDir, 'desktop'), undefined, path.join(devDir, 'desktop', 'electron'))();
  ok(found === path.join(devDir, 'index.html'), 'разработка: найден ../index.html');
  // 3) portable: index.html положен рядом с exe
  const porDir = mk(path.join(os.tmpdir(), 'chesstest-portable'));
  fs.writeFileSync(path.join(porDir, 'index.html'), '<!doctype html>');
  found = makeFinder(path.join(porDir, 'old', 'app.asar'), path.join(porDir, 'no-such'), path.join(porDir, 'Chess.exe'))();
  ok(found === path.join(porDir, 'index.html'), 'portable: найден index.html рядом с exe');
  // 4) ничего нет — честная диагностика вместо тёмного окна
  const emptyDir = mk(path.join(os.tmpdir(), 'chesstest-empty'));
  found = makeFinder(path.join(emptyDir, 'x.asar'), path.join(emptyDir, 'r'), path.join(emptyDir, 'Chess.exe'))();
  ok(found && found.missing && found.missing.length >= 6, 'при отсутствии файла возвращается список проверенных путей для диалога');

  console.log('\n— Обновления —');
  ok(/async function runUpdateCheck\(/.test(main) && /electron-updater/.test(main),
    'в обёртке есть проверка обновлений через electron-updater (runUpdateCheck)');
  ok(/id="btnCheckUpdates"/.test(html) && /app:checkUpdates/.test(main), 'проверка обновлений доступна из окна настроек и через IPC обёртки');
  ok(/quitAndInstall/.test(main), 'скачанное обновление ставится перезапуском');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8'));
  const V3 = V.split('.').length === 2 ? V + '.0' : V;   /* version.json «2.3» ↔ установщик «2.3.0» */
  ok(pkg.version === V3, 'версия обёртки синхронизирована: ' + pkg.version + ' = ' + V3);
  ok((pkg.dependencies || {})['electron-updater'] !== undefined && !(pkg.devDependencies || {})['electron-updater'],
    'electron-updater в dependencies (production) — иначе он не попадает в сборку');
  ok(pkg.build.publish && pkg.build.publish.provider === 'github', 'заготовка источника обновлений (github) в конфиге сборки');
  ok(pkg.build.extraResources.some(r => String(r.from).indexOf('version.json') >= 0), 'version.json упаковывается в ресурсы');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  ok(new RegExp("const VERSION = 'chesster-" + V.replace('.', '\\.') + "-\\d{4}-\\d{2}-\\d{2}'").test(sw),
    'кэш сервис-воркера помечен версией: ' + (sw.match(/chesster-[\d.-]+/) || [])[0]);
  ok(/skipWaiting|updatefound/.test(html), 'PWA сообщит о новой версии при обновлении кэша');
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  ok(man.start_url === './index.html', 'PWA стартует с index.html');

  console.log('\n— Регресс: игра после всех изменений работает —');
  const t = id => (b.doc.getElementById(id).textContent || '').replace(/\s+/g, ' ').trim();
  const tap = n => b.doc.querySelector('.sq[data-sq="' + b.win.Chess.sqFromName(n) + '"]')
    .dispatchEvent(new b.win.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
  tap('e2'); tap('e4'); tap('e7'); tap('e5');
  ok(A.G.sans.join(' ') === 'e4 e5', 'ходы делаются: ' + A.G.sans.join(' '));
  ok(t('statusBig') === 'Ход белых', 'статус живой: ' + t('statusBig'));
  ok(b.doc.querySelectorAll('.sq.check').length === 0, 'подсветки не залипли');

  console.log(`\nИТОГ: ${pass} пройдено, ${fail} провалено`);
  process.exit(fail ? 1 : 0);
})();
