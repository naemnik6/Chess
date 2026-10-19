/* Смоук-тест интерфейса в jsdom: клики по доске, объявления, кнопки, бот */
const fs = require('fs');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { ({ JSDOM } = require('/tmp/node_modules/jsdom')); }

const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
  virtualConsole: new (require('/tmp/node_modules/jsdom').VirtualConsole)()
    .on('jsdomError', e => { errors.push('jsdomError: ' + e.message + (e.stack ? '\n' + e.stack.split('\n').slice(0, 4).join('\n') : '')); console.log('  !! ОШИБКА В КОДЕ: ' + e.message); })
    .on('error', (...a) => { errors.push('console.error: ' + a.join(' ')); console.log('  !! console.error: ' + a.join(' ')); })
});
const win = dom.window, doc = win.document;
const App = win.ChessApp, C = win.Chess;

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  OK   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }
const txt = id => (doc.getElementById(id).textContent || '').replace(/\s+/g, ' ').trim();
const big = () => txt('statusBig');
const small = () => txt('statusSmall');
const sans = () => App.G.sans.slice();

function tap(sq) {
  const el = doc.querySelector('.sq[data-sq="' + sq + '"]');
  if (!el) throw new Error('нет клетки ' + sq);
  const type = win.PointerEvent ? 'pointerdown' : 'mousedown';
  const E = (type === 'pointerdown' && win.PointerEvent) ? win.PointerEvent : win.MouseEvent;
  el.dispatchEvent(new E(type, { bubbles: true, cancelable: true, button: 0, clientX: 1, clientY: 1 }));
}
function tapName(n) { tap(C.sqFromName(n)); }
function move(uci, promo) {
  tapName(uci.slice(0, 2));
  const targets = App.G.targets.map(m => m.to);
  const to = C.sqFromName(uci.slice(2, 4));
  if (targets.indexOf(to) < 0) throw new Error('ход ' + uci + ' недоступен (цели: ' + App.G.targets.map(m => C.nameOf(m.to)).join(',') + ')');
  if (promo) {
    tapName(uci.slice(2, 4));
    const btn = doc.querySelector('.promo-picks button[data-p="' + promo + '"]');
    if (!btn) throw new Error('нет диалога превращения');
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  } else tapName(uci.slice(2, 4));
}
const click = id => doc.getElementById(id).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

/* кнопки-иконки под доской */
const tb = act => {
  const b = doc.querySelector('#toolbar button[data-act="' + act + '"]');
  if (!b) throw new Error('нет кнопки ' + act);
  b.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
};
const marksBtn = () => doc.querySelector('#toolbar button[data-act="marks"]');
const logText = () => { App.switchTab('events'); return txt('logAll'); };
function modalYes() {
  const b = doc.querySelector('.modal [data-a=yes]');
  if (!b) throw new Error('нет модального окна подтверждения');
  b.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
}
function modalAct(a) {
  const b = doc.querySelector('.modal [data-a=' + a + ']');
  if (b) b.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
}

setTimeout(() => {
  console.log('\n— Рендер —');
  ok(doc.querySelectorAll('.sq').length === 64, 'на доске 64 клетки');
  ok(doc.querySelectorAll('.sq use').length === 32, 'расставлены 32 фигуры');
  ok(txt('statusBig') === 'Ход белых', 'статус: «Ход белых»');
  ok(doc.querySelector('.sq[data-sq="0"] use').getAttribute('href') === '#pc-wR', 'на a1 белая ладья');
  ok(doc.querySelector('.sq[data-sq="60"] use').getAttribute('href') === '#pc-bK', 'на e8 чёрный король');
  ok(doc.querySelectorAll('.crd.file').length === 8 && doc.querySelectorAll('.crd.rank').length === 8, 'координаты a-h и 1-8');
  ok(txt('fenText') === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'FEN начальной позиции');

  console.log('\n— Ходы кликами за обе стороны —');
  move('e2e4');
  ok(sans().join() === 'e4', 'белые сходили e4');
  ok(big() === 'Ход чёрных', 'теперь ход чёрных');
  move('e7e5');
  ok(sans().join() === 'e4,e5', 'чёрные ответили e5');
  move('g1f3'); move('b8c6'); move('f1c4');
  ok(sans().join() === 'e4,e5,Nf3,Nc6,Bc4', 'нотация корректна: ' + sans().join(' '));
  ok(txt('moveCount') === 'Ходов: 5', 'счётчик ходов');

  console.log('\n— Отдельное объявление ШАХА —');
  win.ChessApp.loadFen('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
  move('a1a8');
  ok(/^ШАХ/.test(big()), 'объявлен ШАХ: «' + big() + '»');
  ok(/под боем/.test(small()), 'пояснение к шаху: «' + small().slice(0, 60) + '…»');
  ok(doc.querySelectorAll('.sq.check').length === 1, 'клетка короля подсвечена шахом');
  ok(doc.querySelector('.sq.check').dataset.sq === '60', 'подсвечен именно чёрный король на e8');
  ok(/Шах/.test(logText()), 'шах добавлен в журнал объявлений');
  ok(sans().slice(-1)[0] === 'Ra8+', 'в нотации шах помечен плюсом: ' + sans().slice(-1)[0]);
  ok(txt('resultTag') === '—' && !doc.querySelector('.modal'), 'партия при шахе продолжается');
  ok(App.G.targets.length === 0 && App.canPlay() === true, 'ход перешёл чёрным, играть можно');

  console.log('\n— МАТ (детский мат) —');
  tb('reset'); modalYes();
  ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6'].forEach(u => move(u));
  ok(!/МАТ/.test(big()) && big() === 'Ход белых', 'до решающего хода мата нет: «' + big() + '»');
  move('h5f7');
  ok(/МАТ/.test(big()), 'объявлен МАТ: «' + big() + '»');
  ok(/Белые победили/.test(big()), 'указан победитель: ' + big());
  ok(txt('resultTag') === '1-0', 'результат 1-0');
  ok(sans().slice(-1)[0] === 'Qxf7#', 'в нотации Qxf7#: ' + sans().slice(-1)[0]);
  ok(!!doc.querySelector('.modal'), 'показано окно окончания партии');
  ok(/МАТ/.test(logText()), 'мат записан в журнал');
  ok(doc.querySelectorAll('.sq.check').length === 1, 'король-получатель мата подсвечен');
  ok(App.canPlay() === false, 'ходы заблокированы после мата');
  tapName('e2');
  ok(App.G.selected === null, 'после мата фигуры не выбираются');
  modalAct('review');
  ok(!doc.querySelector('.modal'), 'окно закрылось по кнопке «Разобрать ходы»');

  console.log('\n— ПАТ —');
  win.ChessApp.loadFen('k7/8/K7/8/8/8/8/Q7 w - - 0 1');
  move('a1b2');
  ok(/ПАТ/.test(big()), 'пат объявлен после хода: «' + big() + '»');
  ok(txt('resultTag') === '1/2-1/2', 'результат пата 1/2-1/2');
  ok(doc.querySelectorAll('.sq.check').length === 0, 'при пате шах не подсвечивается');
  ok(/Пат/.test(logText()), 'пат попал в журнал объявлений');
  ok(!!doc.querySelector('.modal'), 'показано окно окончания партии');
  modalAct('review');
  ok(App.canPlay() === false, 'после пата ходить нельзя');

  win.ChessApp.loadFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  ok(/ПАТ/.test(big()), 'пат виден и в готовой позиции: «' + big() + '»');
  modalAct('review');

  console.log('\n— Ничьи: материал, 50 ходов, повторение —');
  win.ChessApp.loadFen('8/8/4k3/8/8/3K1B2/8/8 b - - 0 1');
  ok(/недостаточно материала/i.test(big()) || /НИЧЬЯ/.test(big()), 'недостаток материала: «' + big() + '»');
  modalAct('review');

  win.ChessApp.loadFen('8/8/4k3/8/8/3K4/4R3/8 b - - 99 90');
  move('e6d6');
  ok(/50 ходов/.test(big()), 'правило 50 ходов: «' + big() + '»');
  modalAct('review');

  console.log('\n— Повторение позиции (троекратное) —');
  win.ChessApp.loadFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const seq = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'];
  seq.forEach(u => move(u));
  ok(/повторени/i.test(big()), 'троекратное повторение: «' + big() + '»');
  ok(txt('resultTag') === '1/2-1/2', 'результат ничьей 1/2-1/2');
  modalAct('review');

  console.log('\n— Сброс доски, отмена хода, переворот, история —');
  tb('reset'); modalYes();
  ok(App.G.sans.length === 0 && big() === 'Ход белых', '«Сбросить доску» вернул начальную позицию');
  ok(txt('fenText').startsWith('rnbqkbnr/pppppppp'), 'FEN снова начальный');
  move('e2e4'); move('e7e5'); move('g1f3');
  ok(sans().length === 3, 'три хода сделано');
  tb('undo');
  ok(sans().length === 2 && App.G.view === 2, 'отмена хода: ' + sans().join(' '));
  tb('first');
  ok(App.G.view === 0 && big() === 'Ход белых', 'переход в начало партии');
  tb('next');
  ok(App.G.view === 1 && sans()[0] === 'e4', 'шаг вперёд по истории');
  tb('last');
  ok(App.G.view === App.G.states.length - 1, 'переход в конец');
  const before = doc.querySelector('.sq[data-sq="0"]').getBoundingClientRect;
  tb('flip');
  ok(App.G.flipped === true, 'доска перевёрнута');
  ok(doc.querySelectorAll('.sq')[0].dataset.sq === '7', 'верхняя левая клетка теперь h1');
  tb('flip');
  ok(doc.querySelectorAll('.sq')[0].dataset.sq === '56', 'вернули ориентацию (a8 сверху)');

  console.log('\n— Рокировка, взятие на проходе, превращение —');
  win.ChessApp.loadFen('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
  move('e1g1');
  ok(sans().slice(-1)[0] === 'O-O', 'короткая рокировка O-O');
  ok(doc.querySelector('.sq[data-sq="5"] use').getAttribute('href') === '#pc-wR', 'ладья переехала на f1');
  tb('undo');
  move('e1c1');
  ok(sans().slice(-1)[0] === 'O-O-O', 'длинная рокировка O-O-O');
  ok(doc.querySelector('.sq[data-sq="3"] use').getAttribute('href') === '#pc-wR', 'ладья переехала на d1');

  win.ChessApp.loadFen('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
  move('e5f6');
  ok(sans().slice(-1)[0] === 'exf6', 'взятие на проходе exf6: ' + sans().slice(-1)[0]);
  ok(!doc.querySelector('.sq[data-sq="37"] use'), 'чёрная пешка f5 снята с доски');

  win.ChessApp.loadFen('8/P6k/8/8/8/8/7K/8 w - - 0 1');
  move('a7a8', 'q');
  ok(sans().slice(-1)[0] === 'a8=Q', 'превращение в ферзя a8=Q: ' + sans().slice(-1)[0]);
  ok(doc.querySelector('.sq[data-sq="56"] use').getAttribute('href') === '#pc-wQ', 'на a8 появился ферзь');

  win.ChessApp.loadFen('8/8/8/8/8/k7/p7/7K b - - 0 1');
  move('a2a1', 'n');
  ok(sans().slice(-1)[0].indexOf('a1=N') === 0, 'превращение в коня (чёрные): ' + sans().slice(-1)[0]);

  console.log('\n— Недопустимые ходы запрещены —');
  win.ChessApp.loadFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  tapName('e2');
  const tg = App.G.targets.map(m => C.nameOf(m.to)).sort().join(',');
  ok(tg === 'e3,e4', 'пешка e2 может только e3/e4: ' + tg);
  tapName('e7');
  ok(App.G.selected === null, 'чужую фигуру выбрать нельзя');
  tapName('d1');
  ok(App.G.targets.length === 0, 'у ферзя в начальной позиции нет доступных ходов');
  tapName('e1');
  ok(App.G.targets.length === 0, 'король в начале не имеет ходов');
  // ход в занятую свою клетку
  tapName('e2'); tapName('e1');
  ok(sans().length === 0, 'нелегальный ход не проходит');

  console.log('\n— Сдача и ничья по соглашению —');
  move('e2e4');
  tb('resign'); modalYes();
  ok(/сдались/i.test(big()), 'сдача объявлена: «' + big() + '»');
  ok(/Чёрные сдались/.test(big()), 'сдалась сторона, чей был ход: ' + big());
  ok(txt('resultTag') === '1-0', 'результат после сдачи чёрных 1-0');
  modalAct('review');
  tb('reset'); modalYes();
  move('e2e4'); move('e7e5');
  tb('draw'); modalYes();
  ok(/соглашению/i.test(big()), 'ничья по соглашению: «' + big() + '»');
  ok(txt('resultTag') === '1/2-1/2', 'результат ничьей');
  modalAct('review');

  console.log('\n— Разбор истории завершённой партии —');
  tb('reset'); modalYes();
  ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'].forEach(u => move(u));
  ok(/МАТ/.test(big()), 'мат зафиксирован');
  modalAct('review');
  tb('first');
  ok(App.G.view === 0 && big() === 'Ход белых', 'в начале истории виден статус той позиции: «' + big() + '»');
  ok(/Просмотр партии/.test(small()), 'указано, что идёт разбор: «' + small().slice(0, 58) + '»');
  tb('next'); tb('next'); tb('next'); tb('next');
  ok(App.G.view === 4, 'пролистали 4 полухода');
  tb('last');
  ok(/МАТ/.test(big()), 'в конце истории снова виден итог: «' + big() + '»');
  tb('undo');
  ok(!App.G.result && App.canPlay(), 'отмена хода после мата возобновляет партию');
  ok(big() === 'Ход белых', 'статус вернулся к текущей позиции: «' + big() + '»');

  console.log('\n— PGN / FEN —');
  let pgn = App.pgn();
  ok(/1\. e4 e5 2\./.test(pgn), 'PGN: нумерация ходов с пробелом — ' + JSON.stringify(pgn.trim().split('\n').pop().slice(0, 46)));
  ok(/\[Result "(1-0|0-1|1\/2-1\/2|\*)"\]/.test(pgn), 'PGN: заголовок результата есть');
  ok(/\[White "Аноним"\]/.test(pgn) && /\[Black "Аноним"\]/.test(pgn), 'PGN: без имён игроки записаны как «Аноним»');
  App.switchTab('game');
  const nw = doc.getElementById('nameWhite');
  nw.value = 'Иван'; nw.dispatchEvent(new win.Event('change', { bubbles: true }));
  ok(/\[White "Иван"\]/.test(App.pgn()), 'PGN: имя игрока подставляется в заголовок — ' + App.pgn().match(/\[White "[^"]*"\]/)[0]);
  ok(doc.getElementById('capBottom').textContent.indexOf('Иван') >= 0, 'имя показано под доской рядом со взятыми фигурами');
  nw.value = ''; nw.dispatchEvent(new win.Event('change', { bubbles: true }));
  App.switchTab('moves');
  /* PGN завершённой партии */
  tb('reset'); modalYes();
  ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'].forEach(u => move(u));
  modalAct('review');
  pgn = App.pgn();
  ok(pgn.indexOf('[Result "1-0"]') >= 0 && /4\. Qxf7# 1-0/.test(pgn), 'PGN завершённой партии: ' + JSON.stringify(pgn.trim().split('\n').pop()));
  click('btnCopyFen');
  ok(doc.getElementById('fenInput').value.length > 10, 'FEN попал в поле ввода');

  console.log('\n— Игра против компьютера —');
  tb('reset'); modalYes();
  doc.querySelector('#modeSeg button[data-mode="bot-b"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok(App.G.mode === 'bot-b', 'режим: бот за чёрных');
  App.switchTab('game');
  ok(doc.getElementById('levelWrap').style.display !== 'none', 'на вкладке «Игра» видна настройка уровня бота');
  ok(doc.getElementById('levelSel').value === 'medium', 'уровень по умолчанию — средний');
  App.switchTab('moves');
  move('e2e4');
  setTimeout(() => {
    ok(App.G.sans.length === 2, 'бот ответил: ' + App.G.sans.join(' '));
    ok(App.G.states[App.G.states.length - 1].turn === 'w', 'снова ход белых');
    ok(App.G.thinking === false, 'флаг «думает» сброшен');
    // отмена хода в режиме с ботом снимает оба хода
    tb('undo');
    ok(App.G.sans.length === 0, 'отмена в режиме с ботом сняла ход человека и ответ бота');
    doc.querySelector('#modeSeg button[data-mode="hotseat"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

    console.log('\n— Сохранение и восстановление партии —');
    move('d2d4'); move('g8f6');
    /* сохранение партии отложенное (350 мс) — ждём сброса на диск */
    setTimeout(() => {
    const saved = win.localStorage.getItem('chess-game-v1');
    ok(!!saved && JSON.parse(saved).moves.length === 2, 'партия сохранена в localStorage');
    const st = JSON.parse(win.localStorage.getItem('chess-settings-v1') || '{}');
    ok(typeof st.mode === 'string' && typeof st.volume === 'number', 'настройки хранятся отдельным ключом: mode=' + st.mode + ', volume=' + st.volume);
    const dom2 = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' });
    dom2.window.localStorage.setItem('chess-game-v1', saved);
    dom2.window.localStorage.setItem('chess-settings-v1', win.localStorage.getItem('chess-settings-v1'));
    setTimeout(() => {
      const A2 = dom2.window.ChessApp;
      ok(A2.G.sans.join(' ') === 'd4 Nf6', 'партия восстановлена после перезагрузки: ' + A2.G.sans.join(' '));
      ok(dom2.window.document.querySelectorAll('.sq use').length === 32, 'фигуры на месте после восстановления');

      console.log('\n— Консоль —');
      ok(errors.length === 0, 'ошибок в консоли нет' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
      console.log(`\nИТОГ: ${pass} проверок пройдено, ${fail} провалено`);
      process.exit(fail ? 1 : 0);
    }, 250);
    }, 450);
  }, 2600);
}, 120);
