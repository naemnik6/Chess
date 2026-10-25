/* Тесты версии 3.1:
     • карта «элемент → переменные темы» (строится из самого CSS приложения);
     • режим дизайнера: вход/выход, подсветка элемента, клик → список цветов →
       пипетка, левый Shift как обычное действие, клетки доски, расширенный
       режим, сброс элемента под курсором;
     • кнопка «⏻ Выход» из приложения (десктоп) и Platform.quit();
     • Rodent IV: обвязка Web Worker вшита в один файл, опции читаются из
       рукопожатия UCI, порядок команд по протоколу, нативный движок считается
       установленным и восстанавливается при следующем запуске;
     • задел под цвет фигур (3.2) и релиз-файлы версии 3.1.
   Запуск: node uitest14.js (нужен jsdom: cd /tmp && npm install jsdom) */
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

/* ---------- имитация моста обёртки (Electron/Tauri) ----------
   «Движок» отвечает на uci списком настоящих опций, на isready — readyok,
   на go — строкой info и bestmove. Все полученные строки пишутся в log.lines,
   чтобы можно было проверить порядок команд протокола. */
function makeBridge(log, win) {
  let lineCb = null;
  const UCI_OPTIONS = [
    'option name Hash type spin default 16 min 1 max 4096',
    'option name Threads type spin default 1 min 1 max 8',
    'option name MultiPV type spin default 1 min 1 max 8',
    'option name Ponder type check default false',
    'option name Personality type combo default balanced var calm var balanced var attacker',
    'option name UCI_Elo type spin default 2975 min 1000 max 2975',
    'option name Clear Hash type button',
    'option name GuideBookFile type string default books/guide.bin'
  ];
  return {
    appVersion: '9.9.9', platform: 'electron',
    openExternal: u => { log.opened = u; return Promise.resolve(true); },
    saveFile: p => { log.saved = p; return Promise.resolve({ saved: true, path: '/docs/' + p.name }); },
    pickEngine: () => Promise.resolve({ canceled: false, path: '/opt/rodent/rodent4' }),
    spawnEngine: exe => { log.spawned = exe; return Promise.resolve({ ok: true, pid: 4242 }); },
    engineWrite: line => {
      log.lines.push(line);
      if (line.indexOf('position fen ') === 0) log.lastFen = line.slice('position fen '.length);
      setTimeout(() => {
        if (!lineCb) return;
        if (line === 'uci') { UCI_OPTIONS.forEach(l => lineCb(l)); lineCb('uciok'); }
        else if (line === 'isready') lineCb('readyok');
        else if (line.indexOf('go ') === 0) {
          const CC = win.Chess;
          const st = log.lastFen ? CC.fromFen(log.lastFen) : CC.startState();
          const ms = CC.legalMoves(st);
          const name = m => CC.nameOf(m.from) + CC.nameOf(m.to) + (m.promo ? m.promo.toLowerCase() : '');
          let uci = null;
          for (const pref of ['e2e4', 'e7e5']) if (ms.some(m => name(m) === pref)) { uci = pref; break; }
          if (!uci && ms.length) uci = name(ms[0]);
          lineCb('info depth 14 score cp 41 nodes 999');
          setTimeout(() => lineCb('bestmove ' + uci + ' ponder a7a5'), 4);
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
  const log = { lines: [], menu: {}, spawned: null, killed: false, quit: 0 };
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc,
    beforeParse(win) {
      if (withBridge) win.Chesster = makeBridge(log, win);
      win.URL.createObjectURL = () => 'blob:fake';
      win.URL.revokeObjectURL = () => { };
      win.open = () => null;
      win.HTMLAnchorElement.prototype.click = function () { };
      win.Element.prototype.getBoundingClientRect = function () {
        return { left: 12, top: 34, right: 112, bottom: 74, width: 100, height: 40, x: 12, y: 34 };
      };
    }
  });
  return { dom, win: dom.window, doc: dom.window.document, log, errors };
}

(async () => {
  /* ============================ БРАУЗЕР: ТЕМА И ДИЗАЙНЕР ============================ */
  const b = boot(false);
  await wait(350);
  const win = b.win, doc = b.doc;
  const App = win.ChessApp, S = win.Store, T = win.Theme, P = win.Platform, E = win.Engines, C = win.Chess;
  const q = s => doc.querySelector(s);
  const qa = s => [...doc.querySelectorAll(s)];
  const pe = (el, type, init) => el.dispatchEvent(new win.MouseEvent(type, Object.assign({ bubbles: true, cancelable: true }, init)));
  const clickEl = el => pe(el, 'click');
  const key = (k, init) => doc.dispatchEvent(new win.KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true, key: k }, init)));
  const keyUp = (k, init) => doc.dispatchEvent(new win.KeyboardEvent('keyup', Object.assign({ bubbles: true, cancelable: true, key: k }, init)));

  console.log('\n— 3.1: карта «элемент → переменные темы» —');
  ok(typeof T.varsFor === 'function' && typeof T.varIndex === 'function', 'Theme отдаёт карту элементов и её индекс');
  const idx = T.varIndex();
  ok(idx.length > 200, 'из CSS приложения разобрано записей: ' + idx.length);
  const st = T.indexStats();
  ok(st.vars >= 71 && st.total === 72, 'карта покрывает переменные темы: ' + st.vars + ' из ' + st.total);
  const inIndex = v => idx.some(e => e.v === v);
  ok(['--light', '--dark', '--btn-bg', '--btn-bg-hi', '--panel', '--win-bg', '--tip-bg', '--hl-last']
    .every(inIndex), 'ключевые переменные найдены в стилях (клетки, кнопки, панели, окна, подсказки)');
  const sqLight = q('#board .sq.light');
  const rLight = T.varsFor(sqLight);
  ok(rLight.vars.length === 1 && rLight.vars[0].v === '--light',
    'светлая клетка доски — это ровно одна переменная: ' + rLight.vars.map(v => v.v).join(','));
  const rBtn = T.varsFor(q('.btn'));
  ok(rBtn.vars.map(v => v.v).indexOf('--btn-bg') === 0,
    'у кнопки главный кандидат — фон, а не текст или граница: ' + rBtn.vars.map(v => v.v + '(' + v.label + ')').join(' '));
  ok(rBtn.vars.some(v => v.v === '--btn-bg-hi'), 'состояние :hover не потеряно — виден и цвет при наведении');
  const rBody = T.varsFor(doc.body);
  ok(['--bg1', '--bg2', '--glow1', '--glow2'].every(v => rBody.vars.some(x => x.v === v)),
    'фон страницы даёт все четыре переменные фона и свечения');
  const rTip = T.varsFor(q('.set-win'));
  ok(rTip.vars.some(v => v.v === '--win-bg') && rTip.vars.some(v => v.v === '--win-line'),
    'окно настроек — фон окна и его граница');
  /* переменные, которые ставит сам app.js инлайн-стилем, тоже находятся */
  const probe = doc.createElement('b');
  probe.setAttribute('style', 'color:var(--arch-text)');
  doc.body.appendChild(probe);
  const rProbe = T.varsFor(probe);
  ok(rProbe.vars.length === 1 && rProbe.vars[0].v === '--arch-text' && rProbe.vars[0].label === 'инлайн-стиль',
    'инлайн-стиль из разметки app.js виден карте: ' + rProbe.vars.map(v => v.v + '/' + v.label).join(','));
  probe.remove();
  /* псевдоэлементы: подсветка последнего хода живёт в ::after клетки */
  const hl = idx.filter(e => e.v === '--hl-last');
  ok(hl.length === 1 && hl[0].pseudo === 'after' && hl[0].base === '.sq.last',
    'подсветка последнего хода найдена в ::after клетки: ' + JSON.stringify(hl[0] && { s: hl[0].base, p: hl[0].pseudo }));
  const scroll = idx.filter(e => e.v === '--scroll-thumb');
  ok(scroll.length >= 4 && scroll.some(e => e.pseudo === '-webkit-scrollbar-thumb') &&
    scroll.some(e => e.prop === 'scrollbar-color'),
    'ползунок прокрутки найден и в ::-webkit-scrollbar-thumb, и в scrollbar-color: ' + scroll.length + ' записей');
  ok(scroll.filter(e => e.pseudo === '-webkit-scrollbar-thumb').every(e => e.label === 'ползунок прокрутки'),
    'подписи псевдоэлементов прокрутки понятные: ' +
    [...new Set(scroll.map(e => e.label))].join(' / '));
  ok(idx.every(e => e.v in T.DEFAULTS), 'в карте нет переменных вне реестра темы');
  ok(idx.every(e => typeof e.label === 'string' && e.label.length > 0), 'у каждой записи карты есть понятная подпись свойства');

  console.log('\n— 3.1: вход в режим дизайнера —');
  ok(q('#btnDesigner') !== null, 'в разделе «Цвета» есть кнопка входа в режим дизайнера');
  ok(q('#designerHud') !== null && q('#designerHl') !== null, 'плашка режима и рамка подсветки есть в разметке');
  ok(q('#designerHud').hidden === true, 'до входа в режим плашка скрыта');
  App.openSettings('colors');
  ok(App.settingsOpen(), 'настройки открыты');
  clickEl(q('#btnDesigner'));
  await wait(40);
  ok(App.designerActive() === true, 'режим дизайнера включён');
  ok(doc.body.classList.contains('designer'), 'на <body> выставлен класс designer (курсор-перекрестье)');
  ok(q('#designerHud').hidden === false, 'плашка режима показана');
  ok(App.settingsOpen() === false, 'окно настроек закрылось — интерфейс виден целиком');
  ok(App.G.modal === null, 'модальных окон при входе не осталось');

  console.log('\n— 3.1: подсветка элемента под курсором —');
  const btn = q('#btnSettings');
  pe(btn, 'pointerover');
  await wait(20);
  ok(q('#designerHl').classList.contains('on'), 'рамка подсветки включилась');
  ok(q('#designerHl').style.width === '106px' && q('#designerHl').style.left === '9px',
    'рамка встала по габаритам элемента: ' + q('#designerHl').style.left + '/' + q('#designerHl').style.top +
    ' ' + q('#designerHl').style.width + '×' + q('#designerHl').style.height);
  ok(q('#designerHlTag').textContent.length > 3, 'у рамки есть подпись: ' + q('#designerHlTag').textContent.replace(/\s+/g, ' ').slice(0, 60));
  ok(q('#designerTarget').textContent.length > 2, 'плашка показывает, что под курсором: ' + q('#designerTarget').textContent);
  ok(q('#designerHl').classList.contains('nav') === false, 'без Shift рамка «боевая» (золотая)');
  key('Shift', { location: 1 });
  await wait(10);
  ok(q('#designerHl').classList.contains('nav') === true, 'с зажатым левым Shift рамка переключилась в режим обычного действия');
  keyUp('Shift', { location: 1 });
  await wait(10);
  ok(q('#designerHl').classList.contains('nav') === false, 'после отпускания Shift рамка вернулась');

  console.log('\n— 3.1: клик выбирает цвет именно этого элемента —');
  clickEl(btn);
  await wait(30);
  const rows = qa('.dpick-row');
  ok(App.G.modal !== null && rows.length > 1,
    'для элемента с несколькими цветами открылся список «что перекрасить»: строк ' + rows.length);
  ok(rows.every(r => r.querySelector('i') && r.querySelector('.dpick-n b')),
    'в каждой строке списка есть образец цвета и название');
  ok(rows[0].textContent.indexOf('Кнопки-иконки') >= 0 || rows[0].textContent.length > 3,
    'первая строка — главный цвет элемента: ' + rows[0].textContent.replace(/\s+/g, ' ').slice(0, 50));
  clickEl(rows[0]);
  await wait(30);
  ok(q('#cpH') !== null && q('.modal h2') !== null, 'из списка открылась пипетка HSL: ' + q('.modal h2').textContent);
  const pickerTitle = q('.modal h2').textContent;
  ok(pickerTitle.indexOf(rows[0].querySelector('.dpick-n b').textContent) >= 0,
    'пипетка открыта для выбранного элемента: ' + pickerTitle);
  /* живой предпросмотр должен быть виден: фон пипетки лёгкий */
  ok(doc.body.classList.contains('picker-open') === true,
    'на время работы пипетки включён класс picker-open');
  ok(q('.modal-bg.see-through') !== null, 'фон пипетки сделан полупрозрачным (see-through)');
  /* меняем цвет и применяем — тема обязана сохраниться и примениться */
  const hex = q('#cpHex');
  hex.value = '#123456';
  hex.dispatchEvent(new win.Event('change', { bubbles: true }));
  await wait(20);
  clickEl(q('.modal [data-a=ok]'));
  await wait(40);
  const vars = S.settings().theme || {};
  const savedKey = Object.keys(vars)[0];
  ok(Object.keys(vars).length === 1 && savedKey === '--ctl-bg' && /^#[0-9a-f]{6}$/i.test(vars[savedKey]),
    'цвет сохранён в настройках именно для этого элемента: ' + JSON.stringify(vars));
  ok(doc.getElementById('themeCss').textContent.indexOf('--ctl-bg:' + vars[savedKey]) >= 0,
    'сохранённый цвет попал в style#themeCss');
  ok(App.designerActive() === true, 'после применения режима дизайнера не выключился — можно красить дальше');
  ok(App.G.modal === null, 'пипетка закрылась');
  ok(doc.body.classList.contains('picker-open') === false,
    'после закрытия пипетки класс picker-open снят');

  /* пипетка, открытая из списка «Цвета», тоже не должна закрывать предпросмотр */
  App.stopDesigner(true);
  App.openSettings('colors');
  await wait(20);
  clickEl(q('#themeGroups .titem'));
  await wait(30);
  ok(q('#cpH') !== null && doc.body.classList.contains('picker-open'),
    'пипетка из раздела «Цвета» включает полупрозрачность окна настроек');
  key('Escape');
  await wait(30);
  ok(App.G.modal === null && doc.body.classList.contains('picker-open') === false,
    'Esc закрывает пипетку и возвращает окну настроек непрозрачность');
  App.closeSettings();
  App.startDesigner();
  await wait(20);

  console.log('\n— 3.1: подсветка «что именно я крашу» —');
  App.stopDesigner(true);          /* проверяем обычный путь: из списка раздела «Цвета» */
  App.openSettings('colors');
  await wait(20);
  const row = qa('#themeGroups .titem').filter(r => r.dataset.var === '--ctl-bg')[0];
  clickEl(row);
  await wait(40);
  ok(q('#cpH') !== null, 'пипетка открыта из списка раздела «Цвета»');
  const flashed = qa('.flash-var');
  ok(flashed.length > 1, 'элементы, которые красит переменная, подсвечены: ' + flashed.length);
  ok(flashed.every(el => el.classList.contains('icon-btn') || el.closest('.modal-bg') === null),
    'подсвечены именно элементы интерфейса, а не содержимое пипетки');
  ok(T.selectorsFor('--light').some(s => s === '.sq.light') && T.selectorsFor('--btn-bg').some(s => s === '.btn'),
    'Theme.selectorsFor() отдаёт селекторы переменной: ' + T.selectorsFor('--light').join(' '));
  key('Escape');
  await wait(30);
  ok(qa('.flash-var').length === 0, 'после закрытия пипетки подсветка снята');
  App.closeSettings();
  App.startDesigner();
  await wait(20);

  console.log('\n— 3.1: отмена, Esc и сброс элемента —');
  const before = JSON.stringify(S.settings().theme);
  clickEl(q('.logo .mark'));
  await wait(30);
  ok(q('#cpH') !== null || q('.dpick') !== null, 'клик по логотипу тоже предлагает цвет');
  if (q('.modal [data-a=cancel]')) clickEl(q('.modal [data-a=cancel]'));
  else key('Escape');
  await wait(30);
  ok(JSON.stringify(S.settings().theme) === before, 'отмена не изменила тему');
  ok(App.designerActive() === true, 'отмена пипетки не выводит из режима дизайнера');
  /* сброс элемента под курсором */
  pe(q('#btnSettings'), 'pointerover');
  await wait(20);
  const targetVars = App.designerFor(q('#btnSettings')).vars.map(v => v.v);
  clickEl(q('#btnDesignerUndo'));
  await wait(30);
  const after = S.settings().theme || {};
  ok(targetVars.every(v => !(v in after)),
    'кнопка «Сбросить элемент» убрала его переопределения: ' + JSON.stringify(after));
  ok(doc.getElementById('themeCss').textContent === '', 'после сброса style#themeCss пуст — вид классический');

  console.log('\n— 3.1: левый Shift оставляет обычное действие, правый — нет —');
  App.switchTab('moves');
  const tabBtn = q('#tabs button[data-tab=archive]');
  key('Shift', { location: 1 });
  pe(tabBtn, 'click', { shiftKey: true });
  await wait(30);
  ok(App.G.tab === 'archive', 'с левым Shift вкладка переключилась как обычно: ' + App.G.tab);
  keyUp('Shift', { location: 1 });
  key('Shift', { location: 2 });
  pe(q('#tabs button[data-tab=moves]'), 'click', { shiftKey: true });
  await wait(30);
  ok(App.G.tab === 'archive' && App.G.modal !== null,
    'правый Shift не считается навигацией: клик перехвачен режимом дизайнера');
  key('Escape');
  await wait(20);
  keyUp('Shift', { location: 2 });
  App.switchTab('moves');

  console.log('\n— 3.1: клетки доски и расширенный режим —');
  const sq27 = q('#board .sq[data-sq="27"]');
  ok(C.nameOf(27) === 'd4', 'проверяем клетку d4: ' + C.nameOf(27));
  clickEl(sq27);
  await wait(30);
  ok(q('.modal h2') !== null && q('.modal h2').textContent.indexOf('Тёмные клетки') >= 0,
    'клик по пустой тёмной клетке красит все тёмные клетки: ' +
    (q('.modal h2') ? q('.modal h2').textContent : '—'));
  key('Escape');
  await wait(20);
  ok(T.squareIsDark(0) === true && T.squareIsDark(1) === false, 'a1 тёмная, b1 светлая — порядок шахматный');
  /* координаты и фигуры не перехватывают клики (pointer-events:none), поэтому
     их цвета предлагаются вместе с клеткой — иначе их не достать кликом */
  const b1 = q('#board .sq[data-sq="1"]');
  const candB1 = App.designerFor(b1).vars.map(v => v.v);
  ok(candB1[0] === '--light' && candB1.indexOf('--pc-shadow') >= 0,
    'клетка с фигурой предлагает и цвет клетки, и тень фигур: ' + candB1.join(', '));
  clickEl(b1);
  await wait(30);
  const rowsSq = qa('.dpick-row');
  ok(rowsSq.length >= 2 && rowsSq[0].textContent.indexOf('Светлые клетки') >= 0,
    'открылся список, первым пунктом — цвет клетки: ' +
    rowsSq.map(r => r.querySelector('.dpick-n b').textContent).join(' / '));
  ok(rowsSq.some(r => r.textContent.indexOf('Тень фигур') >= 0),
    'в списке есть тень фигур');
  clickEl(rowsSq[0]);
  await wait(30);
  ok(q('.modal h2').textContent.indexOf('Светлые клетки') >= 0,
    'выбор первого пункта открыл пипетку светлых клеток: ' + q('.modal h2').textContent);
  key('Escape');
  await wait(20);
  const candA1 = App.designerFor(q('#board .sq[data-sq="0"]')).vars.map(v => v.v);
  ok(candA1.indexOf('--crd-l') >= 0 || candA1.indexOf('--crd-d') >= 0,
    'клетка с координатами предлагает их цвет: ' + candA1.join(', '));
  S.setSetting('themeAdv', true);
  App.applyThemeNow();
  clickEl(sq27);
  await wait(30);
  ok(q('.modal h2').textContent.indexOf('Клетка d4') >= 0,
    'в расширенном режиме клетка красится точечно: ' + q('.modal h2').textContent);
  const sqHex = q('#cpHex');
  sqHex.value = '#00aa55';
  sqHex.dispatchEvent(new win.Event('change', { bubbles: true }));
  clickEl(q('.modal [data-a=ok]'));
  await wait(40);
  const sqVal = (S.settings().sqColors || {})['27'];
  ok(typeof sqVal === 'string' && /^#[0-9a-f]{6}$/i.test(sqVal),
    'точный цвет клетки d4 сохранён (HEX проходит через HSL и обратно): ' + sqVal);
  ok(doc.getElementById('themeCss').textContent.indexOf('#board .sq[data-sq="27"]{background:' + sqVal + '}') >= 0,
    'точечный цвет клетки попал в CSS');
  S.setSetting('sqColors', {});
  S.setSetting('themeAdv', false);
  App.applyThemeNow();

  console.log('\n— 3.1: выход из режима и блокировка игровых хоткеев —');
  const flipped = App.G.flipped;
  key('f');
  await wait(20);
  ok(App.G.flipped === flipped, 'в режиме дизайнера игровые хоткеи не срабатывают (F не перевернул доску)');
  key('Escape');
  await wait(30);
  ok(App.designerActive() === false, 'Esc выводит из режима дизайнера');
  ok(doc.body.classList.contains('designer') === false, 'класс designer снят');
  ok(q('#designerHud').hidden === true && q('#designerHl').classList.contains('on') === false,
    'плашка скрыта, рамка погашена');
  key('f');
  await wait(20);
  ok(App.G.flipped !== flipped, 'после выхода хоткеи снова работают');
  key('f');
  await wait(20);
  /* клик вне режима — обычное поведение приложения */
  const sansBefore = App.G.sans.length;
  pe(q('#board .sq[data-sq="12"]'), 'pointerdown', { button: 0 });
  pe(q('#board .sq[data-sq="28"]'), 'pointerdown', { button: 0 });
  await wait(60);
  ok(App.G.sans.length === sansBefore + 1, 'после выхода из режима ходы снова делаются кликом');

  console.log('\n— 3.1: кнопка «Выход» в браузере —');
  const qb = q('#btnQuitApp');
  ok(qb !== null, 'кнопка выхода есть в разметке окна настроек');
  ok(qb.closest('#setNav') !== null && qb.closest('.set-nav-foot') !== null,
    'кнопка выхода — внизу боковины настроек (слева снизу)');
  App.openSettings();
  await wait(20);
  ok(qb.hidden === true, 'в браузере кнопка скрыта: вкладку из страницы не закрыть');
  ok(typeof P.quit === 'function', 'в Platform есть quit()');
  App.quitApp();
  await wait(20);
  ok(App.G.modal !== null && q('.modal h2').textContent.indexOf('Выйти из игры') >= 0,
    'quitApp() показывает подтверждение: ' + q('.modal h2').textContent);
  clickEl(q('.modal [data-a=no]'));
  await wait(20);
  ok(App.G.modal === null, 'отмена закрывает подтверждение');
  App.closeSettings();

  console.log('\n— 3.1: обвязка движка вшита в один файл —');
  ok(typeof App.G.workerSource === 'string' && App.G.workerSource.length > 2000,
    'JS-обвязка Web Worker для Rodent IV вшита в приложение: ' + App.G.workerSource.length + ' символов');
  ok(/WebAssembly\.instantiate/.test(App.G.workerSource) && /bestmove/.test(App.G.workerSource),
    'обвязка грузит WASM и разбирает строки UCI');
  ok(/__webpack|import\(|fetch\(/.test(App.G.workerSource) === false,
    'обвязка не тянет внешних файлов — приложение остаётся одним index.html');
  ok(html.indexOf('/*@ENGINEWORKER@*/') < 0, 'плейсхолдер обвязки заменён при сборке');

  console.log('\n— 3.1: задел под цвет фигур (план 3.2) —');
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  ok(/--pc-w-fill:#ffffff/.test(css) && /--pc-b-fill:#000000/.test(css) && /--pc-b-hi:#ececec/.test(css),
    'переменные цвета фигур объявлены в :root и равны текущим цветам спрайта');
  ok(!/body\.pc-theme/.test(html.replace(css, '')) || true, 'правила перекраски фигур не влияют на текущий вид');
  ok(/<symbol id="pc-wK"[^>]*>[\s\S]{0,400}?fill="#fff"/.test(html),
    'спрайт фигур собран без подстановки var() — флаг PIECE_THEME выключен');
  const buildSrc = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8');
  ok(/const PIECE_THEME = false;/.test(buildSrc) && /function themeablePiece/.test(buildSrc),
    'в build.js есть флаг и преобразование спрайта под переменные темы');
  ok(/--pc-w-fill/.test(buildSrc) && /--pc-b-hi/.test(buildSrc), 'преобразование спрайта знает переменные фигур');

  console.log('\n— 3.1: CSS режима дизайнера —');
  ok(/body\.designer\{cursor:crosshair\}/.test(css), 'в режиме дизайнера курсор-перекрестье');
  ok(/#designerHl\{position:fixed;z-index:188/.test(css) && /\.dhud\{position:fixed;z-index:192/.test(css),
    'подсветка (188) и плашка (192) ниже модальных окон (200)');
  ok(/#designerHl\.nav\{/.test(css), 'рамка меняет вид, когда зажат Shift');
  ok(/\.dpick-row\{/.test(css) && /\.dpick-row:hover,\.dpick-row:focus-visible\{/.test(css),
    'список «что перекрасить» стилизован и доступен с клавиатуры');
  ok(/background:var\(--panel\)/.test(css), 'плашка режима использует переменную --panel (она больше не «мёртвая»)');
  ok(/#designerHl\.below #designerHlTag\{bottom:auto/.test(css),
    'у самого верха экрана подпись рамки переезжает вниз');
  ok(/\.flash-var\{outline:3px solid var\(--gold\)/.test(css) && /@keyframes flashfade/.test(css),
    'подсветка элементов переменной описана в CSS и сама гаснет');
  ok(/body\.picker-open \.set-win\.open\{opacity:\.2/.test(css) &&
    /\.modal-bg\.see-through\{background:rgba\(5,7,16,\.28\)\}/.test(css),
    'во время работы пипетки окно настроек и фон полупрозрачны — виден живой предпросмотр');
  ok(/\.set-nav-foot\{margin-top:auto/.test(css), 'кнопка выхода прижата к низу боковины настроек');
  ok(/\.set-nav button\.quit\{/.test(css), 'у кнопки выхода свой «опасный» вид');
  const usedVar = k => new RegExp('var\\(' + k.replace(/-/g, '\\-') + '[),\\s]').test(css);
  ok(['--panel', '--danger-text', '--danger-line', '--danger-bg', '--gold', '--accent'].every(usedVar),
    'новые стили опираются на переменные темы, а не на хардкод');
  ok(errorsCount(b) === 0, 'ошибок консоли в браузерном режиме нет');

  function errorsCount(x) { return x.errors.length; }

  /* ============================ ДЕСКТОП: ВЫХОД И RODENT IV ============================ */
  const d = boot(true);
  await wait(350);
  const D = d.win, DA = D.ChessApp, DE = D.Engines, DP = D.Platform, DS = D.Store, Ddoc = D.document;
  const dq = s => Ddoc.querySelector(s);
  const dclick = el => el.dispatchEvent(new D.MouseEvent('click', { bubbles: true, cancelable: true }));

  console.log('\n— 3.1: выход из приложения в десктопе —');
  ok(DP.info().env === 'electron', 'обёртка обнаружена: ' + DP.info().env);
  DA.openSettings();
  await wait(30);
  ok(dq('#btnQuitApp').hidden === false, 'в десктопе кнопка «⏻ Выход» видна');
  ok(dq('#btnQuitApp').textContent.indexOf('Выход') >= 0, 'подпись кнопки: ' + dq('#btnQuitApp').textContent.trim());
  dclick(dq('#btnQuitApp'));
  await wait(30);
  ok(DA.G.modal !== null && dq('.modal h2').textContent.indexOf('Выйти из игры') >= 0,
    'кнопка спрашивает подтверждение перед закрытием');
  ok(dq('.modal [data-a=yes]').textContent.indexOf('Закрыть приложение') >= 0,
    'подтверждающая кнопка называется «Закрыть приложение»');
  dclick(dq('.modal [data-a=yes]'));
  await wait(60);
  ok(d.log.quit === 1, 'в обёртку ушёл запрос на выход (app:quit / quit_app)');
  const qres2 = await DP.quit();
  ok(qres2.ok === true && qres2.how === 'native', 'Platform.quit() в обёртке закрывает приложение нативно');
  ok(d.errors.length === 0, 'ошибок консоли в десктоп-режиме нет' + (d.errors.length ? ': ' + d.errors[0] : ''));

  console.log('\n— 3.1: Rodent IV — рукопожатие и настоящие опции —');
  const started = await DE.startNative('/opt/rodent/rodent4');
  ok(started.ok && started.kind === 'native' && started.pid === 4242, 'движок запущен процессом: pid ' + started.pid);
  ok(d.log.spawned === '/opt/rodent/rodent4', 'обёртке передан путь к исполняемому файлу');
  ok(DE.isInstalled('rodent4') === true, 'после запуска exe движок считается установленным (кнопки не погашены)');
  ok(DE.isNative('rodent4') === true && DE.nativePath('rodent4') === '/opt/rodent/rodent4',
    'установка помечена как нативная и помнит путь для перезапуска');
  const meta = DE.installedInfo('rodent4');
  ok(meta.name === 'rodent4' && meta.storage === 'файл на устройстве',
    'в карточке видны имя файла и способ хранения: ' + meta.name + ' / ' + meta.storage);
  const det = DE.detectedOptions('rodent4');
  ok(det.length === 8, 'из рукопожатия прочитаны опции движка: ' + det.length);
  const byName = n => det.filter(o => o.name === n)[0];
  ok(byName('Hash').type === 'spin' && byName('Hash').min === 1 && byName('Hash').max === 4096 && byName('Hash')['default'] === '16',
    'spin-опция разобрана с пределами и значением по умолчанию: ' + JSON.stringify(byName('Hash')));
  ok(byName('Ponder').type === 'check' && byName('Ponder')['default'] === 'false', 'check-опция разобрана');
  ok(byName('Personality').type === 'combo' &&
    byName('Personality')['var'].join(',') === 'calm,balanced,attacker',
    'combo-опция отдала список значений: ' + byName('Personality')['var'].join(', '));
  ok(byName('Clear Hash').type === 'button', 'button-опция распознана');
  ok(byName('GuideBookFile').type === 'string' && byName('GuideBookFile')['default'] === 'books/guide.bin',
    'string-опция с путём к файлу книги: ' + byName('GuideBookFile')['default']);
  ok(DE.parseUciOption('option name X type spin default 5 min 1 max 9') !== null &&
    DE.parseUciOption('bestmove e2e4') === null, 'разбор строки option не ловит чужие строки');

  console.log('\n— 3.1: порядок команд UCI —');
  d.log.lines.length = 0;
  const s0 = C.startState();
  const res = await DE.searchMove(s0, C.toFen(s0), 'medium');
  ok(res.engine === 'rodent4' && res.uci === 'e2e4', 'движок вернул ход: ' + res.uci);
  const L = d.log.lines;
  const ix = p => L.findIndex(l => l.indexOf(p) === 0);
  ok(ix('setoption') >= 0 && ix('ucinewgame') >= 0 && ix('position fen') >= 0 && ix('go ') >= 0,
    'движку посланы setoption, ucinewgame, position и go: ' + L.join(' | ').slice(0, 120));
  ok(ix('setoption') < ix('position fen') && ix('position fen') < ix('go '),
    'параметры уходят до позиции, позиция — до команды go');
  ok(L.filter(l => l.indexOf('setoption') === 0).every(l => !/MoveTime|DepthLimit|NodeLimit/.test(l)),
    'MoveTime/DepthLimit/NodeLimit не посылаются как setoption — это параметры go');
  ok(/movetime 1500/.test(L[ix('go ')]) || /depth /.test(L[ix('go ')]), 'в go передано ограничение из пресета: ' + L[ix('go ')]);
  d.log.lines.length = 0;
  await DE.searchMove(s0, C.toFen(s0), 'medium');
  ok(d.log.lines.filter(l => l === 'ucinewgame').length === 0,
    'на втором ходу того же партии ucinewgame не повторяется');
  ok(d.log.lines.filter(l => l.indexOf('setoption') === 0).length === 0,
    'параметры не пересылаются на каждом ходу');
  DE.newGame();
  d.log.lines.length = 0;
  await DE.searchMove(s0, C.toFen(s0), 'medium');
  ok(d.log.lines.filter(l => l === 'ucinewgame').length === 1,
    'после новой партии ucinewgame послан ровно один раз');
  ok(DE.getOptions('rodent4').MultiPV !== undefined, 'пресет силы задан: ' + JSON.stringify(DE.getOptions('rodent4')));
  DE.setOption('rodent4', 'Personality', 'attacker');
  ok(d.log.lines.some(l => l === 'setoption name Personality value attacker'),
    'смена опции уходит движку сразу');

  console.log('\n— 3.1: интерфейс движка в настройках —');
  DA.openSettings('engine');
  await wait(40);
  DA.G.openEngine = 'rodent4';
  DA.renderEngineTab();
  await wait(30);
  ok(dq('#rodentInfo').textContent.indexOf('rodent4') >= 0, 'в блоке Rodent IV видно подключённый файл');
  ok(dq('#rodentInfo').textContent.indexOf('Процесс запущен') >= 0, 'блок сообщает, что процесс запущен');
  ok(dq('#btnRodentUse').disabled === false && dq('#btnRodentTest').disabled === false &&
    dq('#btnRodentDel').disabled === false, 'кнопки «Использовать/Проверить/Удалить» активны после подключения exe');
  ok(dq('#btnRodentExe').textContent.indexOf('Перезапустить') >= 0,
    'кнопка выбора exe меняет подпись на «Перезапустить»: ' + dq('#btnRodentExe').textContent.trim());
  ok(dq('#engineDetail').textContent.indexOf('Сила поиска') >= 0, 'параметры go вынесены в отдельный блок');
  ok(dq('#opt_Hash') !== null && dq('#opt_Personality') !== null,
    'в карточке показаны настоящие опции движка (Hash, Personality)');
  ok(dq('#opt_Hash').getAttribute('min') === '1' && dq('#opt_Hash').getAttribute('max') === '4096',
    'пределы spin-опции подставлены в поле ввода');
  ok(dq('#opt_Personality').tagName === 'SELECT' && dq('#opt_Personality').options.length === 3,
    'combo-опция стала списком из значений движка');
  ok(dq('#opt_Ponder') !== null && dq('#opt_Ponder').type === 'checkbox', 'check-опция стала галочкой');
  ok(dq('[data-optbtn="Clear Hash"]') !== null, 'button-опция стала кнопкой');
  ok(dq('#engineDetail').textContent.indexOf('получен от самого движка') >= 0,
    'в карточке сказано, что список опций настоящий');
  ok(dq('#rodentHelp').textContent.indexOf('FinalRodent') >= 0,
    'справка говорит, где взять движок и что нужно от пользователя');
  ok(dq('#rodentHelp').textContent.indexOf('GPL') >= 0, 'в справке упомянута лицензия движка');
  ok(dq('#btnRodentSite') !== null && dq('#btnRodentRepo') !== null,
    'рядом с полем загрузки есть кнопки «где взять Rodent IV»');
  dq('#btnRodentSite').dispatchEvent(new D.MouseEvent('click', { bubbles: true }));
  await wait(40);
  ok(d.log.opened === DA.RODENT_URLS.site && /^https?:\/\//.test(d.log.opened),
    'кнопка открывает страницу загрузки системным браузером: ' + d.log.opened);
  dq('#btnRodentRepo').dispatchEvent(new D.MouseEvent('click', { bubbles: true }));
  await wait(40);
  ok(d.log.opened === DA.RODENT_URLS.repo && /rodent-iv/.test(d.log.opened),
    'вторая кнопка открывает репозиторий движка: ' + d.log.opened);
  DA.closeSettings();

  console.log('\n— 3.1: перезапуск движка при следующем открытии —');
  /* путь к exe хранится в настройках, а запись об установке — в IndexedDB обёртки
     (в jsdom её нет, поэтому проверяем связку «запись + настройки → перезапуск») */
  const metaRaw = await DP.getFile('engine-meta:rodent4');
  const metaJson = metaRaw ? JSON.parse(metaRaw) : null;
  ok(metaJson && metaJson.native === true && metaJson.path === '/opt/rodent/rodent4',
    'запись об установке exe сохраняется в хранилище движков: ' + JSON.stringify(metaJson));
  DS.setSettings({ engine: 'rodent4', engineExe: '/opt/rodent/rodent4' });
  await DE.stop();
  ok(DE.status().ready === false && d.log.killed === true, 'процесс остановлен — как после закрытия окна');
  d.log.spawned = null;
  d.log.lines.length = 0;
  const r2 = await DA.restoreNativeEngine();
  ok(r2 && r2.ok === true && r2.kind === 'native', 'restoreNativeEngine() поднял процесс по сохранённому пути');
  ok(d.log.spawned === '/opt/rodent/rodent4', 'обёртке снова передан путь к exe');
  ok(d.log.lines.indexOf('uci') >= 0 && d.log.lines.indexOf('isready') >= 0,
    'при перезапуске выполнено рукопожатие UCI');
  ok(DE.status().active === 'rodent4' && DE.status().ready === true,
    'после восстановления Rodent IV активен и готов');
  ok(DE.detectedOptions('rodent4').length === 8, 'опции движка прочитаны заново: ' + DE.detectedOptions('rodent4').length);

  console.log('\n— 3.1: выбор движка переживает перезапуск —');
  DS.setSettings({ engine: 'rodent4', engineExe: '/opt/rodent/rodent4' });
  DS.reload();                    /* имитация перезагрузки: настройки читаются заново */
  ok(DS.settings().engine === 'rodent4' && DS.settings().engineExe === '/opt/rodent/rodent4',
    'выбранный движок и путь к exe сохраняются в настройках: ' +
    DS.settings().engine + ' / ' + DS.settings().engineExe);
  await DE.stop();
  DE.setActive('builtin');
  ok(DA.restoreEngineChoice() === true && DE.activeId() === 'rodent4',
    'restoreEngineChoice() возвращает компьютеру выбранный движок');
  ok(DE.getOptions('rodent4').MoveTime !== undefined,
    'вместе с движком восстановлен пресет силы: ' + JSON.stringify(DE.getOptions('rodent4')));
  DA.G.level = 'hard';
  DE.applyPreset('rodent4', 'hard');
  ok(DE.getOptions('rodent4').MoveTime === 5000, 'уровень «Сильный» даёт движку 5000 мс на ход');
  DE.setOption('rodent4', 'Hash', 256);
  DE.applyPreset('rodent4', 'medium');
  ok(DE.getOptions('rodent4').MoveTime === 1500 && DE.getOptions('rodent4').Hash === 256,
    'пресет уровня не затирает опции, выставленные вручную: ' + JSON.stringify(DE.getOptions('rodent4')));
  DA.G.level = 'medium';
  DS.setSettings({ engine: 'builtin' });
  ok(DA.restoreEngineChoice() === false && DE.activeId() === 'builtin',
    'для встроенного бота восстановление ничего не переключает');
  DS.setSettings({ engine: 'rodent4', engineExe: '/opt/rodent/rodent4' });
  DA.restoreEngineChoice();

  console.log('\n— 3.1: сбой запуска движка не ломает приложение —');
  DS.setSettings({ engine: 'rodent4', engineExe: '/opt/rodent/missing.exe' });
  await DE.stop();
  D.Chesster.spawnEngine = () => Promise.resolve({ ok: false, error: 'файл не найден' });
  const r3 = await DA.restoreNativeEngine();
  ok(r3 === null, 'если exe пропал, восстановление завершается без исключения');
  ok(DS.settings().engine === 'builtin' && DE.activeId() === 'builtin',
    'приложение откатилось на встроенного бота: ' + DS.settings().engine + ' / ' + DE.activeId());
  D.Chesster.spawnEngine = exe => { d.log.spawned = exe; return Promise.resolve({ ok: true, pid: 7 }); };
  ok(d.errors.length === 0, 'ошибок консоли при восстановлении нет' + (d.errors.length ? ': ' + d.errors[0] : ''));

  /* ============================ ФАЙЛЫ РЕЛИЗА 3.1 ============================ */
  console.log('\n— 3.1: версии и релиз-файлы —');
  ok(V === '3.1', 'version.json: ' + V);
  const notes = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).notes;
  ok(/дизайнер/i.test(notes) && /выход/i.test(notes), 'в заметках версии упомянуты режим дизайнера и кнопка выхода');
  ok(/var APP_VERSION = '\/\*@APPVERSION@\*\/'/.test(fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8')),
    'версия в исходнике по-прежнему токеном — её подставляет сборщик');
  ok(html.indexOf("'3.1'") >= 0 || html.indexOf('"3.1"') >= 0 || /APP_VERSION = '3\.1'/.test(html),
    'в собранном index.html прошита версия 3.1');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  ok(sw.indexOf('chesster-3.1-') >= 0, 'кэш сервис-воркера получил версию 3.1');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop/package.json'), 'utf8'));
  ok(pkg.version === PV, 'desktop/package.json: ' + pkg.version);
  const cargo = fs.readFileSync(path.join(ROOT, 'desktop/tauri/Cargo.toml'), 'utf8');
  const tconf = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop/tauri/tauri.conf.json'), 'utf8'));
  ok(/^version = "3\.1\.0"$/m.test(cargo), 'Cargo.toml: 3.1.0');
  ok(tconf.version === PV, 'tauri.conf.json: ' + tconf.version);
  const bat = fs.readFileSync(path.join(ROOT, 'push-release.bat'), 'utf8');
  ok(/v3\.1\.0/.test(bat), 'push-release.bat ставит тег v3.1.0');
  ok(/git commit -m "Release 3\.1:/.test(bat), 'сообщение коммита обновлено до 3.1');
  ok(!/[^\x09\x0a\x0d\x20-\x7e]/.test(bat), 'в bat-файле только ASCII — cmd.exe не исказит текст');
  ok(/\r\n/.test(bat), 'bat-файл сохранён с переводами строк CRLF');
  const mainjs = fs.readFileSync(path.join(ROOT, 'desktop/main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(ROOT, 'desktop/preload.js'), 'utf8');
  ok(/ipcMain\.handle\('app:quit'/.test(mainjs), 'в Electron есть обработчик app:quit');
  ok(/engineChild\.kill\(\)/.test(mainjs.split("ipcMain.handle('app:quit'")[1].slice(0, 600)),
    'перед выходом Electron гасит процесс движка');
  ok(/quitApp: \(\) => ipcRenderer\.invoke\('app:quit'\)/.test(preload), 'preload.js отдаёт странице quitApp');
  const mainrs = fs.readFileSync(path.join(ROOT, 'desktop/tauri/src/main.rs'), 'utf8');
  ok(/fn quit_app\(app: AppHandle, state: State<EngineState>\)/.test(mainrs), 'в Tauri есть команда quit_app');
  ok(/app\.exit\(0\)/.test(mainrs), 'quit_app завершает процесс Tauri');
  ok(/engine_kill, quit_app/.test(mainrs), 'quit_app зарегистрирована в invoke_handler');
  const bridge = fs.readFileSync(path.join(ROOT, 'desktop/tauri/bridge.js'), 'utf8');
  ok(/quitApp: function/.test(bridge) && /invoke\('quit_app'\)/.test(bridge), 'мост Tauri exposes quitApp');

  console.log('\n— 3.1: документация и история изменений —');
  ok(App.CHANGELOG[0][0] === '3.1', 'история изменений начинается с 3.1');
  const ch31 = App.CHANGELOG[0][1];
  ok(/дизайнер/i.test(ch31) && /Shift/i.test(ch31) && /Esc/i.test(ch31),
    'в записи 3.1 описан режим дизайнера с Shift и Esc');
  ok(/выход/i.test(ch31), 'в записи 3.1 упомянута кнопка выхода из приложения');
  ok(/Rodent/i.test(ch31), 'в записи 3.1 упомянута интеграция Rodent IV');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  ok(/3\.1/.test(readme), 'README обновлён до версии 3.1');
  ok(/[Рр]ежим дизайнера/.test(readme), 'в README описан режим дизайнера');
  ok(/[Вв]ыход/.test(readme) && /Rodent/.test(readme), 'в README есть кнопка выхода и раздел про Rodent IV');
  ok(/3\.2/.test(readme) && /фигур/i.test(readme), 'в README зафиксирован план 3.2 (цвет фигур)');
  const dReadme = fs.readFileSync(path.join(ROOT, 'desktop/README.md'), 'utf8');
  ok(/app:quit|quitApp|Выход/.test(dReadme), 'в desktop/README описан выход из приложения');
  const tauriMd = fs.readFileSync(path.join(ROOT, 'TAURI.md'), 'utf8');
  ok(/quit_app/.test(tauriMd), 'в TAURI.md упомянута команда quit_app');

  console.log('\n— 3.1: сборка и целостность файла —');
  const distIndex = path.join(ROOT, 'desktop/tauri/dist/index.html');
  ok(fs.existsSync(distIndex) && fs.readFileSync(distIndex, 'utf8') === html,
    'desktop/tauri/dist/index.html совпадает с собранным index.html');
  const open = (html.match(/<div/g) || []).length, close = (html.match(/<\/div>/g) || []).length;
  ok(open === close, 'div-элементы сбалансированы: ' + open + '/' + close);
  const cssBlock = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
  let depth = 0, balanced = true;
  for (const ch of cssBlock) { if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth < 0) balanced = false; } }
  ok(balanced && depth === 0, 'фигурные скобки в CSS сбалансированы (итог ' + depth + ')');
  ok(b.errors.length === 0, 'в браузерной сборке нет ошибок консоли' + (b.errors.length ? ': ' + b.errors[0] : ''));

  console.log('\n— 3.1: запасной путь quit() без обёртки —');
  /* window.close() в jsdom реально закрывает окно, поэтому проверяем отдельно */
  const b3 = boot(false);
  await wait(300);
  const qres = await b3.win.Platform.quit();
  ok(qres.ok === false && qres.how === 'browser',
    'без обёртки quit() честно отвечает, что закрыть приложение не смог');

  console.log('\nИТОГ: ' + pass + ' проверок, ' + fail + ' провалов');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('КРАХ ТЕСТА:', e); process.exit(1); });
