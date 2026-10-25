/* Тесты версии 3.2:
     • HEX-поле пипетки: специальность правила, строка hexrow, живое окно;
     • цвета стрелок и меток в теме (--mark-1…4), SVG меток через var();
     • удержание правой кнопки на одной клетке (~0,5 с) → окно «Цвет стрелок
       и меток»: короткое нажатие и тяга работают как раньше, уход на другую
       клетку отменяет удержание, в режиме дизайнера удержание тоже работает,
       а метки не рисуются;
     • цвета фигур: спрайт с var(--pc-*), наследование заливки от <use>,
       группа «Фигуры» в реестре, дизайнер предлагает цвета фигуры на клетке,
       золотая подсветка обводит фигуры и клетки с метками;
     • Rodent V: разбор ЖИВОГО рукопожатия версии 1.2 (id name/author, 9 опций,
       info/bestmove), имя движка в карточке, ссылки и справка, отказ от
       архивов в браузере, рабочая папка процесса в обеих обёртках;
     • релиз-файлы версии 3.2.
   Запуск: node uitest15.js (нужен jsdom: cd /tmp && npm install jsdom) */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); }
catch (e) { ({ JSDOM, VirtualConsole } = require('/tmp/node_modules/jsdom')); }
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const V = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).version;
const PV = V.split('.').length === 2 ? V + '.0' : V;

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (fail++, console.log('  FAIL ' + m)); };
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------- ЖИВОЕ рукопожатие Rodent V 1.2 ----------
   Строки сняты с настоящего движка (release-1-2, Linux-бинарник) командой uci:
   именно их приложение должно разобрать без потерь. */
const RODENT_V_HELLO = [
  'id name Rodent V 1.2 AVX2',
  'id author Naman Thanki, Pawel Koziol, based on Sungorus by Pablo Vazquez',
  'option name Hash type spin default 16 min 1 max 4096',
  'option name Clear Hash type button',
  'option name UCI_Chess960 type check default false',
  'option name UCI_LimitStrength type check default false',
  'option name UCI_Elo type spin default 3000 min 800 max 3000',
  'option name OwnBook type check default false',
  'option name Threads type spin default 1 min 1 max 256',
  'option name MultiPV type spin default 1 min 1 max 500',
  'option name PersonalityFile type string default personalities/rodent.txt'
];
const RODENT_V_INFO = 'info depth 4 seldepth 7 multipv 1 time 2 nodes 811 nps 405500 hashfull 0 score cp 12 pv e2e3 c7c6 d2d4 d7d5';

function makeBridge(log, win) {
  let lineCb = null;
  return {
    appVersion: '9.9.9', platform: 'electron',
    openExternal: u => { log.opened.push(u); return Promise.resolve(true); },
    saveFile: p => Promise.resolve({ saved: true, path: '/docs/' + p.name }),
    pickEngine: () => Promise.resolve({ canceled: false, path: '/opt/rodent/release-1-2/rodent_v_1.2' }),
    spawnEngine: exe => { log.spawned = exe; return Promise.resolve({ ok: true, pid: 4242 }); },
    engineWrite: line => {
      log.lines.push(line);
      setTimeout(() => {
        if (!lineCb) return;
        if (line === 'uci') { RODENT_V_HELLO.forEach(l => lineCb(l)); lineCb('uciok'); }
        else if (line === 'isready') lineCb('readyok');
        else if (line.indexOf('go ') === 0) {
          lineCb('info string search limited to  1330  nodes');
          lineCb(RODENT_V_INFO);
          setTimeout(() => lineCb('bestmove e2e3 ponder c7c6'), 4);
        }
      }, 4);
    },
    engineKill: () => { log.killed = true; },
    onEngineLine: h => { lineCb = h; },
    onEngineExit: () => { }, onEngineError: () => { },
    onMenu: (n, h) => { log.menu[n] = h; },
    setTitle: () => { }, setBadge: () => Promise.resolve(true),
    quitApp: () => { log.quit = (log.quit || 0) + 1; return Promise.resolve({ ok: true }); },
    appReady: () => Promise.resolve(true)
  };
}

function boot(withBridge) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const log = { lines: [], opened: [], menu: {}, spawned: null, killed: false, quit: 0 };
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc,
    beforeParse(win) {
      if (withBridge) win.Chesster = makeBridge(log, win);
      win.URL.createObjectURL = () => 'blob:fake';
      win.URL.revokeObjectURL = () => { };
      win.open = () => null;
      win.HTMLAnchorElement.prototype.click = function () { };
      win.Element.prototype.getBoundingClientRect = function () {
        return this.id === 'board'
          ? { left: 0, top: 0, right: 800, bottom: 800, width: 800, height: 800, x: 0, y: 0 }
          : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
      };
    }
  });
  return { dom, win: dom.window, doc: dom.window.document, log, errors };
}

(async () => {
  /* ============================ 1. БРАУЗЕР: CSS И ПИПЕТКА ============================ */
  const b = boot(false);
  await wait(300);
  const win = b.win, doc = b.doc;
  const App = win.ChessApp, S = win.Store, T = win.Theme, C = win.Chess;
  const q = s => doc.querySelector(s);
  const qa = s => [...doc.querySelectorAll(s)];
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

  console.log('\n— 3.2: HEX-поле пипетки не вылезает за край окна —');
  ok(/input\.inp\.cp-hex\{width:112px;flex:0 1 112px;min-width:76px\}/.test(css),
    'правило HEX-поля имеет специальность выше базового input.inp{width:100%}');
  ok(!/\.cp-hex\{width:112px;flex:0 0 auto\}/.test(css),
    'старое слабое правило .cp-hex удалено (его перебивало input.inp)');
  ok(/\.cp-row\.hexrow \.cp-target-hint\{[^}]*text-overflow:ellipsis/.test(css),
    'подсказка в строке HEX обрезается многоточием и не выдавливает поле');
  App.openColorPicker({ v: '--light' });
  await wait(30);
  const hexRow = q('#cpHex') && q('#cpHex').closest('.cp-row');
  ok(hexRow && hexRow.classList.contains('hexrow'), 'строка HEX-поля помечена классом hexrow');
  ok(q('#cpHex').classList.contains('inp') && q('#cpHex').classList.contains('cp-hex'),
    'у поля классы inp cp-hex — новое правило применяется к нему');
  ok(q('#cpTarget') && hexRow.contains(q('#cpTarget')), 'подсказка cpTarget живёт в той же строке');
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }));
  await wait(20);

  console.log('\n— 3.2: цвета стрелок и меток в теме —');
  ok(['--mark-1', '--mark-2', '--mark-3', '--mark-4'].every(v => T.BY_VAR[v]),
    'четыре цвета меток зарегистрированы в теме');
  ok(T.DEFAULTS['--mark-1'] === '#3aa0ff' && T.DEFAULTS['--mark-2'] === '#ffb02e' &&
    T.DEFAULTS['--mark-3'] === '#ff5f5f' && T.DEFAULTS['--mark-4'] === '#57d97a',
    'значения по умолчанию равны прежним хардкод-цветам стрелок — вид не изменился');
  ok(/--mark-1:#3aa0ff/.test(css) && /--mark-4:#57d97a/.test(css),
    'переменные меток объявлены в :root');
  ok(T.groupName('--mark-1') === 'Доска и клетки', 'цвета меток — в группе «Доска и клетки»');
  ok(App.MARK_HOLD_MS === 500, 'порог удержания правой кнопки — 500 мс');
  ok(typeof App.openMarksChooser === 'function' && typeof App.markStyle === 'function',
    'приложение отдаёт окно цвета меток и резолвер цвета');
  ok(App.markStyle(0) === 'var(--mark-1,#3aa0ff)' && App.markStyle(5) === 'var(--mark-2,#ffb02e)',
    'markStyle возвращает var() со значением по умолчанию и циклит по модулю 4');

  /* ============================ 2. ПРАВАЯ КНОПКА: КАК РАНЬШЕ ============================ */
  console.log('\n— 3.2: короткий правый клик и тяга работают как раньше —');
  const pev = (t, tg, x, y, btn) => tg.dispatchEvent(new win.MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: btn }));
  const bsq = n => doc.querySelector('.sq[data-sq="' + C.sqFromName(n) + '"]');
  const marks = () => App.G.marks;
  const clearM = () => { marks().length = 0; App.render(); };

  pev('pointerdown', bsq('e2'), 450, 650, 2);
  pev('pointerup', win, 450, 650, 2);
  await wait(30);
  ok(marks().length === 1 && marks()[0].type === 'circle' && marks()[0].from === C.sqFromName('e2'),
    'короткий правый клик (<0,5 с) поставил круг, окно цвета не открылось');
  ok(App.G.modal === null, 'модальное окно не открывалось');
  ok(/<circle[^>]*style="stroke:var\(--mark-1,#3aa0ff\)/.test(q('#arrowLayer').innerHTML),
    'круг нарисован цветом темы var(--mark-1)');
  clearM();

  pev('pointerdown', bsq('e2'), 450, 650, 2);
  pev('pointermove', win, 450, 550, 2);
  pev('pointerup', win, 450, 450, 2);
  await wait(30);
  ok(marks().length === 1 && marks()[0].type === 'arrow' &&
    marks()[0].from === C.sqFromName('e2') && marks()[0].to === C.sqFromName('e4'),
    'быстрая тяга e2→e4 нарисовала стрелку');
  ok(/<polygon[^>]*style="fill:var\(--mark-1,#3aa0ff\)/.test(q('#arrowLayer').innerHTML),
    'наконечник стрелки залит цветом темы');
  clearM();

  /* ============================ 3. УДЕРЖАНИЕ ПРАВОЙ КНОПКИ ============================ */
  console.log('\n— 3.2: удержание правой кнопки на одной клетке —');
  pev('pointerdown', bsq('d4'), 350, 450, 2);
  await wait(60);
  ok(bsq('d4').classList.contains('hold-ring'), 'на клетке появилось золотое кольцо удержания');
  await wait(620);
  ok(App.G.modal !== null && q('.modal h2') && q('.modal h2').textContent.indexOf('Цвет стрелок и меток') >= 0,
    'удержание ~0,5 с открыло окно «Цвет стрелок и меток»: ' + (q('.modal h2') ? q('.modal h2').textContent : '—'));
  const rows = qa('.dpick-row');
  ok(rows.length === 4, 'в окне четыре цвета меток: ' + rows.length);
  ok(rows[0].querySelector('.dpick-n b').textContent.indexOf('Стрелки и метки — цвет 1') >= 0,
    'без меток на клетке первым идёт цвет 1: ' + rows[0].querySelector('.dpick-n b').textContent);
  ok(marks().length === 0, 'удержание не нарисовало круг — меток нет');
  ok(!bsq('d4').classList.contains('hold-ring'), 'кольцо удержания погашено');
  /* отпускание правой кнопки над окном не должно показывать меню браузера */
  const bg = q('.modal-bg');
  const cm = new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  bg.dispatchEvent(cm);
  ok(cm.defaultPrevented, 'contextmenu над окном подавлен (кнопку отпускают уже над ним)');
  rows[1].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(30);
  ok(q('#cpH') !== null && q('.modal h2').textContent.indexOf('Стрелки и метки — цвет 2') >= 0,
    'клик по строке открыл пипетку выбранного цвета: ' + q('.modal h2').textContent);
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }));
  await wait(30);
  ok(App.G.modal === null, 'Esc закрыл пипетку');

  console.log('\n— 3.2: уход на другую клетку отменяет удержание —');
  pev('pointerdown', bsq('e2'), 450, 650, 2);
  pev('pointermove', win, 450, 450, 2);      /* та же тяга, что рисует стрелку */
  await wait(620);
  ok(App.G.modal === null, 'окно цвета НЕ открылось: курсор ушёл на другую клетку');
  pev('pointerup', win, 450, 450, 2);
  await wait(30);
  ok(marks().length === 1 && marks()[0].type === 'arrow', 'вместо окна нарисовалась обычная стрелка');
  clearM();

  console.log('\n— 3.2: цвет метки на клетке предлагается первым —');
  pev('pointerdown', bsq('a1'), 50, 750, 2);
  pev('pointerup', win, 50, 750, 2);
  await wait(20);                            /* метка цвета 1 на a1 */
  pev('pointerdown', bsq('d4'), 350, 450, 2);
  pev('pointerup', win, 350, 450, 2);
  await wait(20);                            /* метка цвета 2 на d4 */
  ok(marks().length === 2 && marks()[1].color === 1, 'две метки с чередующимися цветами');
  pev('pointerdown', bsq('d4'), 350, 450, 2);
  await wait(620);
  const rows2 = qa('.dpick-row');
  ok(rows2.length === 4 && rows2[0].querySelector('.dpick-n b').textContent.indexOf('цвет 2') >= 0,
    'на клетке с меткой первым предложен её цвет: ' + rows2[0].querySelector('.dpick-n b').textContent);
  ok(rows2[0].textContent.indexOf('цвет метки на этой клетке') >= 0, 'строка помечена как «цвет метки на этой клетке»');
  q('.modal [data-a=cancel]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(20);
  ok(App.G.modal === null, '«Отмена» закрывает окно цвета меток');
  clearM();

  console.log('\n— 3.2: перекраска метки применяется мгновенно —');
  pev('pointerdown', bsq('e5'), 450, 350, 2);
  pev('pointerup', win, 450, 350, 2);
  await wait(20);
  S.setSetting('theme', Object.assign({}, S.settings().theme, { '--mark-1': '#00ff00' }));
  App.applyThemeNow();
  ok(doc.getElementById('themeCss').textContent.indexOf('--mark-1:#00ff00') >= 0,
    'переопределение --mark-1 попало в themeCss');
  ok(/style="stroke:var\(--mark-1,#3aa0ff\)/.test(q('#arrowLayer').innerHTML),
    'разметка метки не перерисовывается: var() подхватывает новое значение из CSS');
  S.setSetting('theme', {});
  App.applyThemeNow();
  clearM();

  /* ============================ 4. ЦВЕТА ФИГУР ============================ */
  console.log('\n— 3.2: цвета фигур —');
  ok(T.GROUPS.length === 6 && T.GROUPS.some(g => g.id === 'pieces' && g.items.length === 5),
    'в реестре шесть групп, «Фигуры» — пять элементов');
  ok(['--pc-w-fill', '--pc-w-line', '--pc-b-fill', '--pc-b-line', '--pc-b-hi'].every(v =>
    T.BY_VAR[v] && T.groupName(v) === 'Фигуры'), 'все переменные фигур — в группе «Фигуры»');
  const wK = html.match(/<symbol id="pc-wK"[\s\S]*?<\/symbol>/)[0];
  const bP = html.match(/<symbol id="pc-bP"[\s\S]*?<\/symbol>/)[0];
  ok(wK.indexOf('var(--pc-w-fill,#fff)') >= 0 && wK.indexOf('var(--pc-w-line,#000)') >= 0 &&
    wK.indexOf('fill="#fff"') < 0 && wK.indexOf('stroke="#000"') < 0,
    'белый король: заливка и контур — переменные темы с запасными значениями, хардкод убран');
  ok(bP.indexOf('style="stroke:var(--pc-b-line,#000)"/>') >= 0 && bP.indexOf('fill:') < 0,
    'чёрная пешка: контур — переменная, заливка наследуется от <use>');
  const useW = q('#board .sq[data-sq="4"] use');   /* e1 — белый король */
  ok(useW && /fill:var\(--pc-w-fill,#fff\)/.test(useW.getAttribute('style') || ''),
    'белая фигура: <use style="fill:var(--pc-w-fill,#fff)"> — наследование внутрь спрайта');
  const useB = q('#board .sq[data-sq="60"] use');  /* e8 — чёрный король */
  ok(useB && /fill:var\(--pc-b-fill,#000\)/.test(useB.getAttribute('style') || ''),
    'чёрная фигура: <use style="fill:var(--pc-b-fill,#000)">');
  ok(q('#board .sq[data-sq="4"] svg').classList.contains('pw') &&
    q('#board .sq[data-sq="60"] svg').classList.contains('pb'),
    'у фигур на доске есть классы стороны pw/pb (для золотой подсветки)');
  const capSvg = q('.chip svg, #capBottom svg, #capTop svg');
  ok(capSvg === null || capSvg.querySelector('use[style*="--pc-"]') !== null,
    'взятые фигуры тоже наследуют цвет от <use>');

  console.log('\n— 3.2: дизайнер предлагает цвета фигуры на клетке —');
  const e1 = q('#board .sq[data-sq="4"]');
  const candE1 = App.designerFor(e1).vars.map(v => v.v);
  ok(candE1[0] === '--dark' && candE1.indexOf('--pc-w-fill') >= 0 && candE1.indexOf('--pc-w-line') >= 0,
    'клетка e1 (тёмная) с белым королём предлагает цвет клетки, заливку и контур белых: ' + candE1.join(', '));
  ok(candE1.indexOf('--pc-shadow') >= 0, 'тень фигур в списке осталась');
  ok(candE1.length <= 12, 'список цветов клетки не длиннее 12 пунктов: ' + candE1.length);
  const candD5 = App.designerFor(q('#board .sq[data-sq="35"]')).vars.map(v => v.v);
  ok(candD5.indexOf('--pc-w-fill') < 0 && candD5.indexOf('--pc-b-fill') < 0,
    'у пустой клетки цветов фигур нет');
  const b8q = q('#board .sq[data-sq="59"]');        /* d8 — чёрный ферзь */
  const candD8 = App.designerFor(b8q).vars.map(v => v.v);
  ok(candD8.indexOf('--pc-b-fill') >= 0 && candD8.indexOf('--pc-b-hi') >= 0,
    'клетка с чёрной фигурой предлагает заливку, контур и светлые детали чёрных');

  console.log('\n— 3.2: золотая подсветка фигур и меток —');
  App.flashThemeTargets({ v: '--pc-w-fill' });
  const flashedW = qa('.flash-var');
  ok(flashedW.length > 0 && flashedW.every(el => el.tagName === 'svg' && el.classList.contains('pw')),
    'подсветка --pc-w-fill обводит белые фигуры: ' + flashedW.length);
  pev('pointerdown', bsq('c3'), 250, 550, 2);
  pev('pointerup', win, 250, 550, 2);
  await wait(20);
  App.flashThemeTargets({ v: '--mark-1' });
  const flashedM = qa('.flash-var');
  ok(flashedM.length > 0 && flashedM.every(el => el.classList.contains('sq')),
    'подсветка --mark-1 обводит клетки с метками этого цвета: ' +
    flashedM.map(el => el.dataset.sq).join(','));
  App.flashThemeTargets({ v: '--mark-3' });
  ok(qa('.flash-var').length === 0, 'у цвета без меток подсвечивать нечего — обошлось без ошибок');
  clearM();
  await wait(1700);

  /* ============================ 5. УДЕРЖАНИЕ В РЕЖИМЕ ДИЗАЙНЕРА ============================ */
  console.log('\n— 3.2: удержание правой кнопки в режиме дизайнера —');
  App.startDesigner();
  await wait(30);
  ok(App.designerActive(), 'режим дизайнера включён');
  pev('pointerdown', bsq('e2'), 450, 650, 2);
  pev('pointerup', win, 450, 650, 2);
  await wait(30);
  ok(marks().length === 0, 'короткий правый клик в режиме дизайнера метку не рисует');
  pev('pointerdown', bsq('e2'), 450, 650, 2);
  await wait(620);
  ok(App.G.modal !== null && q('.modal h2').textContent.indexOf('Цвет стрелок и меток') >= 0,
    'удержание в режиме дизайнера открывает то же окно цвета меток');
  ok(marks().length === 0, 'метки по-прежнему не рисуются');
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }));
  await wait(30);
  ok(App.G.modal === null && App.designerActive(), 'Esc закрыл окно, режим дизайнера остался');
  App.stopDesigner();
  await wait(30);
  ok(!App.designerActive(), 'выход из режима дизайнера');
  ok(b.errors.length === 0, 'браузерная сессия без ошибок консоли' + (b.errors.length ? ': ' + b.errors.join(' | ') : ''));
  b.dom.window.close();

  /* ============================ 6. ДЕСКТОП: RODENT V ============================ */
  const d = boot(true);
  await wait(300);
  const dw = d.win, ddoc = d.doc;
  const DA = dw.ChessApp, DE = dw.Engines, DS = dw.Store, dq = s => ddoc.querySelector(s);
  const clickEl = el => el.dispatchEvent(new dw.MouseEvent('click', { bubbles: true }));

  console.log('\n— 3.2: разбор настоящего рукопожатия Rodent V 1.2 —');
  const pElo = DE.parseUciOption('option name UCI_Elo type spin default 3000 min 800 max 3000');
  ok(pElo && pElo.type === 'spin' && pElo.min === 800 && pElo.max === 3000 && pElo['default'] === '3000',
    'UCI_Elo: spin 800…3000, по умолчанию 3000');
  const pPers = DE.parseUciOption('option name PersonalityFile type string default personalities/rodent.txt');
  ok(pPers && pPers.type === 'string' && pPers['default'] === 'personalities/rodent.txt',
    'PersonalityFile: строка с путём «личности» (путь со слэшем не обрезан)');
  const pClear = DE.parseUciOption('option name Clear Hash type button');
  ok(pClear && pClear.name === 'Clear Hash' && pClear.type === 'button',
    '«Clear Hash» — кнопочная опция из двух слов');
  const pMulti = DE.parseUciOption('option name MultiPV type spin default 1 min 1 max 500');
  ok(pMulti && pMulti.max === 500, 'MultiPV до 500 вариантов');

  console.log('\n— 3.2: подключение exe и имя движка —');
  DA.openSettings('engine');
  await wait(60);
  ok(dq('#engineList').textContent.indexOf('Rodent IV / V') >= 0,
    'карточка движка называется «Rodent IV / V»');
  ok(DE.byId('rodent4').name === 'Rodent IV / V', 'в каталоге то же имя');
  ok(DE.byId('rodent4').accepts.every(a => a.ext !== '.zip'), 'каталог больше не обещает поддержку архивов');
  ok(dq('#btnRodentV') !== null, 'кнопка «↗ Rodent V (релизы)» есть в карточке');
  clickEl(dq('#btnRodentV'));
  await wait(30);
  ok(d.log.opened.includes('https://github.com/nescitus/Rodent-V/releases'),
    'кнопка открывает релизы Rodent V: ' + d.log.opened.join(','));
  clickEl(dq('#btnRodentExe'));
  await wait(250);
  ok(d.log.spawned === '/opt/rodent/release-1-2/rodent_v_1.2', 'обёртка получила путь к exe');
  const idn = DE.engineIdentity('rodent4');
  ok(idn && idn.name === 'Rodent V 1.2 AVX2', 'движок представился: ' + (idn ? idn.name : '—'));
  ok(idn && /Naman Thanki/.test(idn.author || ''), 'автор прочитан из id author');
  const det = DE.detectedOptions('rodent4');
  ok(det.length === 9, 'прочитаны все 9 опций Rodent V: ' + det.map(o => o.name).join(', '));
  const elo = det.filter(o => o.name === 'UCI_Elo')[0];
  ok(elo && elo.min === 800 && elo.max === 3000, 'пределы UCI_Elo дошли до интерфейса');
  ok(dq('#rodentInfo').innerHTML.indexOf('Движок представился') >= 0 &&
    dq('#rodentInfo').innerHTML.indexOf('Rodent V 1.2 AVX2') >= 0,
    'карточка показывает, как движок представился');
  ok(dq('#toastWrap').textContent.indexOf('RODENT V 1.2 AVX2 ЗАПУЩЕН') >= 0,
    'объявление о запуске — с настоящим именем движка: ' + dq('#toastWrap').textContent.slice(0, 60));
  ok(DS.settings().engine === 'rodent4' && /rodent_v_1\.2$/.test(DS.settings().engineExe || ''),
    'выбор движка и путь к exe сохранены в настройках');
  ok(d.log.lines.indexOf('uci') >= 0 && d.log.lines.indexOf('isready') > d.log.lines.indexOf('uci'),
    'рукопожатие: uci, затем isready');
  DA.G.openEngine = 'rodent4';
  DA.renderEngineTab();
  await wait(30);
  const optsUI = dq('#engineDetail');
  ok(optsUI && optsUI.innerHTML.indexOf('UCI_Elo') >= 0 && optsUI.innerHTML.indexOf('PersonalityFile') >= 0,
    'в карточке движка видны настоящие опции Rodent V (UCI_Elo, PersonalityFile)');
  ok(optsUI.innerHTML.indexOf('Список получен от самого движка') >= 0,
    'карточка честно говорит, что опции получены из рукопожатия');

  console.log('\n— 3.2: info и bestmove настоящего Rodent V —');
  let gotBest = null, gotInfo = null;
  const onB = x => { gotBest = x; }, onI = x => { gotInfo = x; };
  DE.on('bestmove', onB); DE.on('info', onI);
  DE.handleUciLine(RODENT_V_INFO);
  DE.handleUciLine('bestmove e2e3 ponder c7c6');
  DE.off('bestmove', onB); DE.off('info', onI);
  ok(gotInfo && gotInfo.depth === 4 && gotInfo.score === '12' && gotInfo.nodes === 811,
    'строка info разобрана: depth 4, score 12 (контракт без префикса cp, как с 3.x), nodes 811');
  ok(gotBest && gotBest.move === 'e2e3' && gotBest.ponder === 'c7c6',
    'bestmove e2e3 ponder c7c6 разобран');
  ok(DA.uciToMove && DA.uciToMove('e2e3') !== null, 'ход UCI переводится в ход на доске');

  console.log('\n— 3.2: архив в браузер не тащим —');
  ok(!/accept="[^"]*\.zip/.test(html), 'поле файла больше не принимает .zip');
  const fileInput = dq('#rodentFile');
  Object.defineProperty(fileInput, 'files', { value: [{ name: 'release-1-2.zip', size: 48238921 }], configurable: true });
  fileInput.dispatchEvent(new dw.Event('change', { bubbles: true }));
  await wait(30);
  ok(dq('#toastWrap').textContent.indexOf('НУЖЕН САМ ФАЙЛ ДВИЖКА') >= 0,
    'на архив приложение отвечает внятным отказом: ' + dq('#toastWrap').textContent.slice(0, 70));
  ok(dq('#rodentProgress').textContent === '', 'сообщение «Читаем файл…» не зависло');

  console.log('\n— 3.2: рабочая папка процесса в обеих обёртках —');
  const mainJs = fs.readFileSync(path.join(ROOT, 'desktop/main.js'), 'utf8');
  ok(/cwd: path\.dirname\(exePath\)/.test(mainJs), 'Electron запускает движок с cwd = папка exe');
  const mainRs = fs.readFileSync(path.join(ROOT, 'desktop/tauri/src/main.rs'), 'utf8');
  ok(/cmd\.current_dir\(parent\)/.test(mainRs), 'Tauri выставляет current_dir = папка exe (родственные personalities/nets/books)');

  console.log('\n— 3.2: справка и ссылки —');
  ok(/release-1-2\.zip/.test(html) && /personalities/.test(html) && /nets/.test(html),
    'справка описывает состав архива Rodent V');
  ok(/alloptions/.test(html) && /nooptions/.test(html), 'справка честно описывает режимы запуска exe');
  ok(/UCI_Elo/.test(html) && /PersonalityFile/.test(html), 'в справке и каталоге есть опции Rodent V');
  ok(DA.RODENT_URLS.vrel === 'https://github.com/nescitus/Rodent-V/releases' &&
    DA.RODENT_URLS.site.indexOf('pkoziol') >= 0, 'ссылки: релизы Rodent V и страница загрузки IV');
  const rules = ddoc.body.innerHTML;
  ok(/удерживайте правую кнопку/i.test(rules) || /Удерживайте/.test(html),
    'правила в справке описывают удержание правой кнопки');

  console.log('\n— 3.2: релиз-файлы версии —');
  ok(V === '3.2', 'version.json: ' + V);
  ok(html.indexOf("var APP_VERSION = '" + V + "'") >= 0, 'версия прошита в index.html');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop/package.json'), 'utf8'));
  ok(pkg.version === PV, 'desktop/package.json: ' + pkg.version);
  const tconf = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop/tauri/tauri.conf.json'), 'utf8'));
  ok(tconf.version === PV, 'tauri.conf.json: ' + tconf.version);
  const cargo = fs.readFileSync(path.join(ROOT, 'desktop/tauri/Cargo.toml'), 'utf8');
  ok(cargo.indexOf('version = "' + PV + '"') >= 0, 'Cargo.toml: ' + PV);
  ok(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').indexOf('chesster-' + V) >= 0, 'кэш sw.js помечен ' + V);
  const bat = fs.readFileSync(path.join(ROOT, 'push-release.bat'), 'utf8');
  ok(/git commit -m "Release 3\.2/.test(bat) && bat.indexOf('git tag v' + PV) >= 0,
    'bat: английский коммит Release 3.2 и тег v' + PV);
  ok(!/[^\x09\x0a\x0d\x20-\x7e]/.test(bat), 'bat: только ASCII');
  ok(DA.CHANGELOG[0][0] === '3.2', 'история изменений начинается с 3.2');
  const distIndex = path.join(ROOT, 'desktop/tauri/dist/index.html');
  ok(fs.existsSync(distIndex) && fs.readFileSync(distIndex, 'utf8') === html,
    'desktop/tauri/dist/index.html совпадает с корневым');
  ok(d.errors.length === 0, 'десктоп-сессия без ошибок консоли' + (d.errors.length ? ': ' + d.errors.join(' | ') : ''));

  console.log('\n============================');
  console.log('3.2: пройдено ' + pass + ', провалено ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
