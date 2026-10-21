/* Тесты версии 2.4: окно настроек с категориями (вместо меню «⋮»), подсказки
   одним верхним слоем с переносом текста, отключение напоминания о выгрузке,
   переезд «Журнала» и «Движка» из вкладок, состояние автоповорота, релиз-файлы. */
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

function boot() {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const calls = { opened: [] };
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
    }
  });
  return { dom, win: dom.window, doc: dom.window.document, errors, calls };
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = boot();
  await wait(250);
  const win = b.win, doc = b.doc;
  const App = win.ChessApp, S = win.Store, G = App.G;
  const q = s => doc.querySelector(s);
  const qa = s => [...doc.querySelectorAll(s)];
  const txt = id => (doc.getElementById(id).textContent || '').replace(/\s+/g, ' ').trim();
  const clickEl = el => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

  console.log('\n— 2.4: вход в настройки, старое меню убрано —');
  ok(q('#btnSettings') !== null && q('#btnSettings').closest('.top-right') !== null, 'в шапке есть кнопка настроек ⚙');
  ok(q('#btnAppMenu') === null && q('#appMenu') === null, 'меню приложения «⋮» убрано');
  ok(q('#btnHelp') === null, 'отдельная кнопка «?» убрана — справка в настройках');
  clickEl(q('#btnSettings'));
  ok(App.settingsOpen(), 'клик по ⚙ открывает окно настроек');
  ok(q('#setWin').getAttribute('aria-hidden') === 'false', 'aria-hidden снят');
  ok(q('#btnSettings').getAttribute('aria-expanded') === 'true', 'aria-expanded выставлен');
  clickEl(q('#btnSetClose'));
  ok(!App.settingsOpen(), 'крестик закрывает настройки');
  App.openSettings();
  clickEl(q('#setBg'));
  ok(!App.settingsOpen(), 'клик по затемнению закрывает настройки');
  App.openSettings();
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok(!App.settingsOpen(), 'Escape закрывает настройки');

  console.log('\n— 2.4: категории —');
  const cats = qa('#setNav button').map(x => x.dataset.sc);
  ok(cats.join(',') === 'view,colors,archive,engine,events,help,about', 'семь категорий: ' + cats.join(', '));
  ok(qa('#setScroll section[data-set]').map(x => x.dataset.set).join(',') === cats.join(','),
    'каждой категории соответствует раздел');
  ok(qa('#setScroll section .set-h').length >= 6, 'у разделов есть заголовки');
  App.openSettings();
  clickEl(q('#setNav button[data-sc=engine]'));
  ok(q('#setNav button.on').dataset.sc === 'engine', 'клик по категории «Движок» подсвечивает её');
  clickEl(q('#setNav button[data-sc=events]'));
  ok(q('#setNav button.on').dataset.sc === 'events', 'клик по категории «Журнал» подсвечивает её');
  ok(/\.set-scroll\{[^}]*scroll-behavior:smooth/.test(css) || /scroll-behavior:smooth/.test(css),
    'переход по категориям — плавной прокруткой');
  ok(/\.set-scroll::-webkit-scrollbar[^{]*\{width:9px\}/.test(css) &&
    /\.set-scroll::-webkit-scrollbar-thumb[^{]*\{[^}]*var\(--scroll-thumb\)/.test(css) &&
    /scrollbar-color:var\(--scroll-thumb\) var\(--scroll-track\)/.test(css),
    'ползунок окна настроек кастомизирован под дизайн приложения (через переменные темы)');
  ok(/\.set-win\{[^}]*z-index:180/.test(css) && /\.modal-bg\{[^}]*z-index:200/.test(css),
    'окна подтверждений (z 200) открываются поверх настроек (z 180)');

  console.log('\n— 2.4: журнал и движок переехали из вкладок —');
  ok(qa('#tabs button').map(x => x.dataset.tab).join(',') === 'moves,archive,players,game,position',
    'в боковом меню пять вкладок, «Журнала» и «Движка» нет');
  ['logAll', 'btnClearLog', 'logCount', 'engineList', 'engineDetail', 'rodentDrop', 'rodentFile',
    'btnRodentExe', 'btnOffload', 'chkCountAnon', 'chkReminder', 'reminderInput', 'versionLine',
    'chkAutoFlip', 'chkPanelAuto', 'chkFullStart'].forEach(id => {
      ok(q('#tabBody #' + id) === null && q('#setWin #' + id) !== null,
        id + ' больше не во вкладках, а в окне настроек');
    });
  App.switchTab('engine');
  ok(G.tab === 'moves', 'старая сохранённая вкладка «Движок» не оставляет панель пустой (сброс на «Ходы»)');
  ok(q('#toolbar button[data-act=flip]') !== null, '«Перевернуть доску» осталось во вкладке «Ходы»');
  /* живые данные: журнал обновляется, пока окно открыто */
  App.openSettings('events');
  App.loadFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  ok(/Позиция выставлена/.test(txt('logAll')), 'журнал в настройках обновляется на лету');
  ok(qa('#engineList .engine-card').length >= 2, 'список движков в настройках отрисован');

  console.log('\n— 2.4: автоповорот — состояние видно —');
  App.closeSettings();
  App.openSettings('view');
  const chkA = q('#chkAutoFlip');
  ok(chkA.checked === false, 'по умолчанию автоповорот выключен, галочка это показывает');
  chkA.checked = true;
  chkA.dispatchEvent(new win.Event('change', { bubbles: true }));
  ok(G.autoFlip === true && S.settings().autoFlip === true, 'галочка включает автоповорот и сохраняет настройку');
  App.setMode('bot-b');
  App.openSettings('view');
  ok(q('#chkAutoFlip').disabled === true, 'в режиме с компьютером автоповорот заблокирован с пояснением');
  ok(q('#chkAutoFlip').parentNode.title.length > 10, 'пояснение блокировки: ' + q('#chkAutoFlip').parentNode.title.slice(0, 40) + '…');
  App.setMode('hotseat');
  App.openSettings('view');
  ok(q('#chkAutoFlip').disabled === false && q('#chkAutoFlip').checked === true, 'в режиме «2 игрока» снова доступен и включён');
  chkA.checked = false;
  chkA.dispatchEvent(new win.Event('change', { bubbles: true }));

  console.log('\n— 2.4: напоминание о выгрузке можно отключить —');
  App.openSettings('archive');
  const chkR = q('#chkReminder');
  ok(chkR.checked === true && q('#reminderInput').disabled === false, 'по умолчанию напоминания включены');
  const inp = q('#reminderInput');
  inp.value = '5';
  inp.dispatchEvent(new win.Event('change', { bubbles: true }));
  ok(S.settings().archiveReminder === 5, 'порог напоминания настраивается: ' + S.settings().archiveReminder);
  for (let i = 0; i < 5; i++) {
    S.saveGame({ title: 'Партия ' + i, white: 'В', black: 'Ч', result: '1-0', reason: 'checkmate', counted: false, pgn: '1. e4 1-0', moves: [] });
  }
  ok(S.countGames() === 5, 'в архиве 5 партий (порог достигнут)');
  q('#toastWrap').innerHTML = '';
  App.maybeRemindOffload();
  ok(/АРХИВ/.test(txt('toastWrap')), 'при включённом напоминании после 5-й партии предлагается выгрузка');
  chkR.checked = false;
  chkR.dispatchEvent(new win.Event('change', { bubbles: true }));
  ok(S.settings().archiveReminderOn === false, 'галочка «Напоминать выгружать архив» снимается и сохраняется');
  ok(q('#reminderInput').disabled === true, 'поле числа партий блокируется, когда напоминания выключены');
  q('#toastWrap').innerHTML = '';
  App.maybeRemindOffload();
  ok(txt('toastWrap') === '', 'с выключенным напоминанием тост не появляется');
  App.openPanel('archive');
  ok(/Напоминание о выгрузке отключено/.test(txt('archInfo')), 'вкладка «Архив» честно пишет, что напоминания выключены');
  chkR.checked = true;
  chkR.dispatchEvent(new win.Event('change', { bubbles: true }));
  q('#toastWrap').innerHTML = '';
  App.maybeRemindOffload();
  ok(/АРХИВ/.test(txt('toastWrap')), 'после включения напоминание снова работает');
  App.closePanel();

  console.log('\n— 2.4: подсказки одним слоем, без ползунков —');
  ok(css.indexOf('[data-tip]:hover::after') < 0 && css.indexOf('[data-tip]:hover::before') < 0,
    'старых CSS-подсказок ::after/::before больше нет');
  ok(/\.js-tip\{position:fixed;z-index:600/.test(css), 'подсказка — фиксированный элемент в слое z-index 600 (поверх панелей 150, настроек 180, модалок 200)');
  ok(/\.js-tip\{[^}]*white-space:normal/.test(css) && /\.js-tip\{[^}]*max-width:250px/.test(css),
    'длинные описания переносятся по словам в пределах 250px');
  ok(/\.js-tip\[hidden\]\{display:none\}/.test(css), 'скрытая подсказка не занимает места');
  App.openPanel('moves');
  const resign = q('#toolbar button[data-act=resign]');
  resign.dispatchEvent(new win.MouseEvent('pointerover', { bubbles: true }));
  const tip = doc.getElementById('tip');
  ok(tip !== null && tip.parentNode === doc.body, 'элемент подсказки #tip живёт прямо под <body> (единый слой)');
  ok(!tip.hidden && tip.querySelector('.tip-txt').textContent === resign.dataset.tip,
    'при наведении на «Сдаться» подсказка показана: ' + tip.querySelector('.tip-txt').textContent);
  const copyPgn = q('#btnExportAll');
  copyPgn.dispatchEvent(new win.MouseEvent('pointerover', { bubbles: true }));
  ok(tip.querySelector('.tip-txt').textContent === copyPgn.dataset.tip, 'переход на другую кнопку меняет текст подсказки');
  ok(copyPgn.dataset.tip.length > 20 && tip.querySelector('.tip-txt').textContent === copyPgn.dataset.tip,
    'длинное описание («Экспорт») показывается целиком и переносится');
  copyPgn.dispatchEvent(new win.MouseEvent('pointerout', { bubbles: true }));
  ok(tip.hidden, 'увод курсора прячет подсказку');
  q('#btnOffload').dispatchEvent(new win.MouseEvent('pointerover', { bubbles: true }));
  ok(!tip.hidden, 'подсказка работает и внутри окна настроек');
  doc.dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true }));
  ok(tip.hidden, 'клик прячет подсказку');
  q('#btnImportPgn').dispatchEvent(new win.FocusEvent('focusin', { bubbles: true }));
  ok(!tip.hidden && tip.querySelector('.tip-txt').textContent === q('#btnImportPgn').dataset.tip,
    'подсказка показывается с клавиатуры (focusin)');
  q('#btnImportPgn').dispatchEvent(new win.FocusEvent('focusout', { bubbles: true }));
  ok(tip.hidden, 'focusout прячет подсказку');
  App.closeSettings();
  App.closePanel();
  ok(b.errors.length === 0, 'ошибок консоли нет' + (b.errors.length ? ': ' + b.errors.join(' | ') : ''));

  console.log('\n— 2.4: релиз-файлы и версия —');
  const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
  ok(ver.version === V && /^\d+\.\d+$/.test(V), 'version.json: ' + V);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8'));
  ok(pkg.version === PV, 'desktop/package.json: ' + PV);
  ok(html.indexOf("var APP_VERSION = '" + V + "'") >= 0, 'версия прошита в index.html');
  ok(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').indexOf('chesster-' + V) >= 0, 'кэш sw.js помечен ' + V);
  const bat = fs.readFileSync(path.join(ROOT, 'push-release.bat'), 'utf8');
  ok(/git commit -m "Release /.test(bat) && bat.indexOf('git tag v' + PV) >= 0, 'bat: английский коммит Release и тег v' + PV);
  ok(!/[^\x09\x0a\x0d\x20-\x7e]/.test(bat), 'bat: только ASCII — текст в GitHub останется читаемым');
  ok(App.CHANGELOG.some(r => r[0] === '2.4' && /окно настроек/i.test(r[1])), 'в журнале изменений есть запись 2.4 про окно настроек');
  ok(qa('#tabs button').length === 5 && qa('#setNav button').length === 7, 'итог: 5 вкладок + 7 категорий настроек');

  console.log('\n============================');
  console.log(V + ' (uitest12): пройдено ' + pass + ', провалено ' + fail);
  process.exit(fail || b.errors.length ? 1 : 0);
})().catch(e => { console.error('UITEST12 HARNESS ERROR', e); process.exit(2); });
