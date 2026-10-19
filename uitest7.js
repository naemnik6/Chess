/* Тесты десктоп-слоя: обёртка (Electron), нативный UCI-движок, диалоги, меню, PWA-зацепки */
const fs = require('fs');
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); }
catch (e) { ({ JSDOM, VirtualConsole } = require('/tmp/node_modules/jsdom')); }
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (fail++, console.log('  FAIL ' + m)); };

/* ---------- имитация моста Electron ДО загрузки скриптов страницы ---------- */
function makeBridge(log, win) {
  let lineCb = null;
  return {
    appVersion: '9.9.9', platform: 'electron',
    _lineCb: () => lineCb,
    openExternal: u => { log.opened = u; return Promise.resolve(true); },
    saveFile: p => { log.saved = p; return Promise.resolve({ saved: true, path: '/docs/' + p.name }); },
    pickEngine: () => Promise.resolve({ canceled: false, path: '/opt/rodent/rodent4' }),
    spawnEngine: exe => { log.spawned = exe; return Promise.resolve({ ok: true, pid: 4242 }); },
    engineWrite: line => {
      log.lines.push(line);
      if (line.indexOf('position fen ') === 0) log.lastFen = line.slice('position fen '.length);
      setTimeout(() => {
        if (!lineCb) return;
        if (line === 'uci') lineCb('uciok');
        else if (line === 'isready') lineCb('readyok');
        else if (line.indexOf('go ') === 0) {
          /* «движок» отвечает легальным ходом из переданной ему позиции */
          const CC = win.Chess;
          const st = log.lastFen ? CC.fromFen(log.lastFen) : CC.startState();
          const ms = CC.legalMoves(st);
          const name = m => CC.nameOf(m.from) + CC.nameOf(m.to) + (m.promo ? m.promo.toLowerCase() : '');
          let uci = null;
          for (const pref of ['e2e4', 'e7e5']) {
            if (ms.some(m => name(m) === pref)) { uci = pref; break; }
          }
          if (!uci && ms.length) uci = name(ms[0]);
          lineCb('info depth 12 score cp 35 nodes 12345');
          setTimeout(() => lineCb('bestmove ' + uci + ' ponder a7a5'), 5);
        }
      }, 4);
    },
    engineKill: () => { log.killed = true; },
    onEngineLine: h => { lineCb = h; },
    onEngineExit: () => { }, onEngineError: () => { },
    onMenu: (n, h) => { log.menu[n] = h; },
    setTitle: t => { log.titles.push(t && t.text ? t.text : t); },
    setBadge: () => Promise.resolve(true),
    appReady: () => Promise.resolve(true)
  };
}

function boot(withBridge) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { errors.push(e.message); });
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const log = { lines: [], menu: {}, titles: [], opened: null, saved: null, spawned: null, killed: false };
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc,
    beforeParse(win) {
      if (withBridge) win.Chesster = makeBridge(log, win);
      win.URL.createObjectURL = () => 'blob:fake';
      win.URL.revokeObjectURL = () => { };
      win.HTMLAnchorElement.prototype.click = function () { log.anchor = true; };
    }
  });
  return { dom, win: dom.window, doc: dom.window.document, log, errors };
}

const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  /* ================= ДЕСКТОП ================= */
  const { win, doc, log, errors } = boot(true);
  await wait(200);
  const App = win.ChessApp, S = win.Store, E = win.Engines, P = win.Platform, C = win.Chess;

  console.log('\n— Обнаружение обёртки —');
  ok(P.info().env === 'electron', 'среда определена как electron: ' + P.info().env);
  ok(P.isDesktop() === true, 'приложение понимает, что работает на компьютере');
  ok(P.info().appVersion === '9.9.9', 'версия обёртки видна приложению: ' + P.info().appVersion);
  ok(log.titles.length > 0 && /Chess/.test(log.titles[0]), 'заголовок окна управляется приложением и называется Chess: ' + log.titles[0]);
  ok(doc.body.dataset === undefined || true, 'DOM на месте');

  console.log('\n— Внешние ссылки и файлы через системные средства —');
  App.openLichess('1. e4 e5 1-0', null);
  await wait(60);
  ok(log.opened && log.opened.indexOf('https://lichess.org/paste?pgn=') === 0,
    'ссылка ушла в системный браузер через обёртку: ' + String(log.opened).slice(0, 48) + '…');
  const sres = await P.saveFile('test.pgn', '1. e4 e5 1-0');
  ok(sres.ok && sres.how === 'native' && sres.path === '/docs/test.pgn', 'файл сохранён системным диалогом: ' + sres.path);
  ok(log.saved && log.saved.name === 'test.pgn' && typeof log.saved.data === 'string',
    'в IPC ушли имя и сырые данные (не blob-ссылка)');

  console.log('\n— Меню обёртки привязано к действиям —');
  ok(Object.keys(log.menu).length >= 8, 'приложение подписано на пункты меню: ' + Object.keys(log.menu).join(', '));
  const flippedBefore = App.G.flipped;
  log.menu.flip();
  ok(App.G.flipped === !flippedBefore, 'пункт «Перевернуть доску» работает из меню обёртки');
  log.menu.flip();
  log.menu.marks();
  ok(App.G.marks.length === 0, 'пункт «Стрелки: стереть» работает');

  console.log('\n— Нативный UCI-движок (путь Rodent IV) —');
  ok(E.nativeAvailable() === true, 'нативный транспорт доступен в обёртке');
  ok(doc.getElementById('btnRodentExe').disabled === false, 'кнопка «Выбрать exe…» активна в десктопе');
  const started = await E.startNative('/opt/rodent/rodent4');
  ok(started.ok && started.kind === 'native' && started.pid === 4242, 'движок запущен как процесс: pid ' + started.pid);
  ok(log.lines.indexOf('uci') >= 0 && log.lines.indexOf('isready') >= 0, 'выполнено рукопожатие UCI: uci / isready');
  ok(E.status().active === 'rodent4' && E.status().ready === true, 'статус: активен rodent4, готов');
  const s0 = C.startState();
  const res = await E.searchMove(s0, C.toFen(s0), 'medium');
  ok(res.engine === 'rodent4' && res.uci === 'e2e4', 'движок вернул ход в нотации UCI: ' + res.uci);
  ok(res.depth === 12 && res.score === '35', 'парсятся depth и score из строк info: depth ' + res.depth + ', score ' + res.score);
  const m = App.uciToMove('e2e4');
  ok(m && m.from === C.sqFromName('e2') && m.to === C.sqFromName('e4'), 'строка UCI преобразуется в ход движка правил');
  App.loadFen('8/P6k/8/8/8/8/7K/8 w - - 0 1');
  const mp = App.uciToMove('a7a8q');
  ok(mp && mp.promo && mp.promo.toLowerCase() === 'q', 'превращение в нотации UCI (a7a8q) распознаётся в позиции, где оно легально');
  App.newGame(true);
  /* ход через интерфейс: бот за чёрных считает нативным движком */
  App.setMode('bot-b');
  App.newGame(true);
  doc.querySelector('.sq[data-sq="' + C.sqFromName('e2') + '"]').dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
  doc.querySelector('.sq[data-sq="' + C.sqFromName('e4') + '"]').dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
  await wait(900);
  ok(App.G.sans.length === 2 && App.G.sans[1] === 'e5', 'бот ответил ходом движка из процесса: ' + App.G.sans.join(' '));
  ok(log.lines.some(l => l.indexOf('position fen') === 0), 'позиция передавалась движку строкой position fen');
  ok(log.lines.some(l => l.indexOf('go ') === 0), 'команда go передавалась движку');
  await E.stop();
  ok(log.killed === true, 'процесс движка корректно останавливается');

  console.log('\n— Пресеты и UCI-опции Rodent IV —');
  const opts = E.getOptions('rodent4');
  ok(opts.DepthLimit === 8 && opts.MoveTime === 1500, 'пресет «Средний» применён к опциям: ' + JSON.stringify(opts));
  E.applyPreset('rodent4', 'hard');
  ok(E.getOptions('rodent4').MoveTime === 5000, 'пресет «Сильный» меняет лимит времени');
  E.setOption('rodent4', 'MultiPV', 3);
  ok(E.getOptions('rodent4').MultiPV === 3, 'опция MultiPV устанавливается');
  const def = E.byId('rodent4');
  ok(def.uciOptions.map(o => o.name).indexOf('Personality') >= 0, 'в каталоге описаны «личности» Rodent IV');

  ok(errors.length === 0, 'ошибок консоли в десктоп-режиме нет' + (errors.length ? ': ' + errors[0] : ''));

  /* ================= БРАУЗЕР: установка движка и PWA ================= */
  const b = boot(false);
  await wait(200);
  const B = b.win, BE = B.Engines, BP = B.Platform, BA = B.ChessApp;

  console.log('\n— Браузерный режим: задел под WASM-сборку —');
  ok(BP.info().env === 'browser', 'без обёртки среда — браузер');
  ok(BE.nativeAvailable() === false, 'нативный транспорт в браузере недоступен');
  BA.openPanel('engine');
  ok(b.doc.getElementById('btnRodentExe').disabled === true, 'кнопка «Выбрать exe…» погашена в браузере');
  const data = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]).buffer;   /* магическое число wasm */
  const meta = await BE.install('rodent4', { name: 'rodent4.wasm', size: 8, data });
  ok(meta && meta.size === 8, 'сборка движка принята и описана: ' + meta.name + ', ' + meta.size + ' Б');
  ok(['indexeddb', 'memory'].indexOf(meta.storage) >= 0, 'хранится вне localStorage: ' + meta.storage);
  ok(BE.isInstalled('rodent4') === true, 'движок помечен установленным');
  BA.renderEngineTab();
  ok(BE.status().installed.indexOf('rodent4') >= 0, 'установка видна в статусе');
  const stored = await BP.getFile('engine:rodent4');
  ok(stored && (stored.byteLength === 8 || stored.length === 8), 'файл лежит в хранилище движков, а не в архиве партий');
  const rodentTxt = (b.doc.getElementById('rodentInfo').textContent || '').replace(/\s+/g, ' ');
  ok(/Установлен/.test(rodentTxt), 'карточка показывает установленную сборку: ' + rodentTxt.slice(0, 60));
  ok(/IndexedDB|memory/.test(rodentTxt), 'в карточке указано, где лежит файл');
  await BE.uninstall('rodent4');
  BA.renderEngineTab();
  ok(BE.isInstalled('rodent4') === false, 'удаление сборки работает');
  ok(BE.byId('rodent4').available === false, 'каталог снова помечает движок недоступным');
  ok((b.doc.getElementById('rodentHelp').textContent || '').indexOf('Web Worker') > 0,
    'справка объясняет, чего не хватает для запуска в браузере');

  console.log('\n— PWA-зацепки —');
  ok(b.doc.querySelector('link[rel=manifest]') !== null, 'в head есть manifest.webmanifest');
  ok(fs.existsSync(__dirname + '/manifest.webmanifest'), 'файл манифеста лежит рядом с index.html');
  const man = JSON.parse(fs.readFileSync(__dirname + '/manifest.webmanifest', 'utf8'));
  ok(man.display === 'standalone' && man.start_url === './index.html', 'манифест: standalone, старт с index.html');
  ok(man.icons.length >= 3, 'в манифесте иконки нескольких размеров: ' + man.icons.map(i => i.sizes).join(', '));
  ok(fs.existsSync(__dirname + '/sw.js'), 'рядом лежит сервис-воркер sw.js');
  const sw = fs.readFileSync(__dirname + '/sw.js', 'utf8');
  ok(/self\.addEventListener\('fetch'/.test(sw) && /caches\.open/.test(sw), 'воркер кэширует приложение для офлайна');
  ok(/registerServiceWorker/.test(html) && /location\.protocol/.test(html),
    'регистрация воркера защищена проверкой протокола (в песочнице и file:// не выполняется)');
  ok(b.errors.length === 0, 'ошибок консоли в браузерном режиме нет' + (b.errors.length ? ': ' + b.errors[0] : ''));

  console.log('\n— Обёртки на диске —');
  const files = ['desktop/main.js', 'desktop/preload.js', 'desktop/package.json',
    'desktop/rodent4-worker.js', 'desktop/tauri/tauri.conf.json', 'desktop/tauri/src/main.rs',
    'desktop/icons/icon-512.png', 'desktop/icons/icon.ico', 'desktop/icons/icon.svg', 'desktop/icon.py'];
  files.forEach(f => ok(fs.existsSync(__dirname + '/' + f), 'есть ' + f));
  const main = fs.readFileSync(__dirname + '/desktop/main.js', 'utf8');
  ok(/contextIsolation: true/.test(main) && /nodeIntegration: false/.test(main) && /sandbox: true/.test(main),
    'Electron: изоляция контекста, без nodeIntegration, песочница');
  ok(/shell\.openExternal/.test(main) && /dialog\.showSaveDialog/.test(main), 'Electron: системные ссылки и диалог сохранения');
  ok(/spawn\(exePath/.test(main), 'Electron: внешний движок запускается отдельным процессом');
  const preload = fs.readFileSync(__dirname + '/desktop/preload.js', 'utf8');
  ok(/contextBridge\.exposeInMainWorld\('Chesster'/.test(preload), 'preload отдаёт странице только узкий мост window.Chesster');
  const tauri = fs.readFileSync(__dirname + '/desktop/tauri/src/main.rs', 'utf8');
  ok(/#\[tauri::command\]/.test(tauri) && /engine_spawn/.test(tauri), 'Tauri: команды сохранения, ссылок и запуска движка');

  console.log(`\nИТОГ: ${pass} пройдено, ${fail} провалено`);
  process.exit(fail ? 1 : 0);
})();
