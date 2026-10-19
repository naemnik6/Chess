/* Стресс-тест: drag-and-drop, клавиатура, автоповорот, 25 случайных партий через UI */
const fs = require('fs');
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); }
catch (e) { ({ JSDOM, VirtualConsole } = require('/tmp/node_modules/jsdom')); }
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => { errors.push(e.message); console.log('  !! ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 5).join('\n')); });
vc.on('error', (...a) => { errors.push(String(a)); console.log('  !! console.error ' + a.join(' ')); });
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const win = dom.window, doc = win.document;
const App = win.ChessApp, C = win.Chess, G = App.G;

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (fail++, console.log('  FAIL ' + m)); };
const txt = id => (doc.getElementById(id).textContent || '').replace(/\s+/g, ' ').trim();
const big = () => txt('statusBig');

/* --- геометрическая заглушка: доска 800x800 в (0,0) --- */
function fakeRect(el) {
  if (el && el.id === 'board') return { left: 0, top: 0, right: 800, bottom: 800, width: 800, height: 800, x: 0, y: 0 };
  return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
}
win.Element.prototype.getBoundingClientRect = function () { return fakeRect(this); };

function ptOf(name) {   /* центр клетки в экранных координатах */
  const sq = C.sqFromName(name), r = C.rankOf(sq), f = C.fileOf(sq);
  const drow = G.flipped ? r : 7 - r, dcol = G.flipped ? 7 - f : f;
  return { x: dcol * 100 + 50, y: drow * 100 + 50 };
}
function ev(type, target, x, y) {
  const E = win.PointerEvent || win.MouseEvent;
  target.dispatchEvent(new E(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: 'mouse' }));
}
function tap(name) { const p = ptOf(name); const el = doc.elementFromPoint ? null : null; const sqEl = doc.querySelector('.sq[data-sq="' + C.sqFromName(name) + '"]'); ev('pointerdown', sqEl, p.x, p.y); }
function drag(from, to) {
  const a = ptOf(from), b = ptOf(to);
  ev('pointerdown', doc.querySelector('.sq[data-sq="' + C.sqFromName(from) + '"]'), a.x, a.y);
  ev('pointermove', win, (a.x + b.x) / 2, (a.y + b.y) / 2);
  ev('pointermove', win, b.x, b.y);
  ev('pointerup', win, b.x, b.y);
}
const key = k => doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true }));
const click = id => doc.getElementById(id).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

/* кнопки-иконки под доской */
const tb = act => {
  const b = doc.querySelector('#toolbar button[data-act="' + act + '"]');
  if (!b) throw new Error('нет кнопки ' + act);
  b.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
};
const marksBtn = () => doc.querySelector('#toolbar button[data-act="marks"]');
const setAutoFlip = on => {
  const c = doc.getElementById('chkAutoFlip');
  c.checked = on;
  c.dispatchEvent(new win.Event('change', { bubbles: true }));
};
const logText = () => { App.switchTab('events'); return txt('logAll'); };
const modalYes = () => { const b = doc.querySelector('.modal [data-a=yes]'); if (b) b.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); };

setTimeout(() => {
  console.log('\n— Перетаскивание фигур (drag-and-drop) —');
  drag('e2', 'e4');
  ok(G.sans.join() === 'e4', 'ход перетаскиванием: ' + G.sans.join(' '));
  ok(doc.getElementById('ghost').style.display === 'none', 'призрак фигуры убран после отпускания');
  ok(doc.querySelectorAll('.sq.drag-src').length === 0, 'класс перетаскивания снят');
  drag('e7', 'e5');
  ok(G.sans.join() === 'e4,e5', 'чёрные тоже ходят перетаскиванием: ' + G.sans.join(' '));
  drag('g1', 'f3');
  ok(G.sans.length === 3, 'третий ход перетаскиванием');
  /* недопустимое перетаскивание */
  drag('f3', 'e5');
  ok(G.sans.length === 3, 'нелегальный drag не сделал хода');
  /* перетаскивание чужой фигуры (сейчас ход чёрных) */
  drag('e4', 'e5');
  ok(G.sans.length === 3, 'чужую фигуру перетащить нельзя');
  /* клик-клик тоже работает */
  tap('d7'); tap('d5');
  ok(G.sans.length === 4, 'ход кликом после перетаскиваний: ' + G.sans.slice(-1)[0]);

  console.log('\n— Клавиатура и кнопки просмотра —');
  key('ArrowLeft');
  ok(G.view === 3, '← шаг назад по истории');
  key('ArrowLeft'); key('ArrowLeft');
  ok(G.view === 1, '← ещё два шага');
  key('ArrowUp');
  ok(G.view === 0, '↑ в начало партии');
  key('ArrowDown');
  ok(G.view === G.states.length - 1, '↓ в конец партии');
  key('f');
  ok(G.flipped === true && doc.querySelectorAll('.sq')[0].dataset.sq === '7', 'F перевернул доску');
  key('f');
  ok(G.flipped === false, 'F вернул ориентацию');
  key('Escape');
  ok(G.selected === null, 'Escape снимает выделение');
  key('z');
  ok(G.sans.length === 3, 'Z отменил ход');
  const viewBefore = G.view;
  key('ArrowLeft');
  ok(G.view === viewBefore - 1, 'просмотр истории с клавиатуры');
  ok(/просмотр истории/.test(txt('statusTurn')), 'в статусе помечен просмотр истории');
  tap('e2');
  ok(G.sans.length === 3, 'из истории ходить нельзя');
  tb('last');
  ok(App.canPlay(), 'вернулись к последнему ходу — можно играть');

  console.log('\n— Автоповорот доски —');
  tb('reset'); modalYes();
  setAutoFlip(true);
  ok(G.autoFlip === true && G.flipped === false, 'автоповорот включён (сейчас ход белых — доска не повёрнута)');
  drag('e2', 'e4');
  ok(G.sans.join() === 'e4', 'ход белых состоялся: ' + G.sans.join(' '));
  ok(G.flipped === true, 'после хода белых доска автоматически повёрнута к чёрным');
  ok(doc.querySelectorAll('.sq')[0].dataset.sq === '7', 'сетка клеток перестроена под новую ориентацию (h1 сверху)');
  ok(doc.querySelector('.crd.file').textContent === 'h', 'координаты файлов пересчитаны после поворота');
  drag('e7', 'e5');
  ok(G.sans.join() === 'e4,e5', 'чёрные сходили в повёрнутой ориентации: ' + G.sans.join(' '));
  ok(G.flipped === false, 'после хода чёрных доска снова повёрнута к белым');
  setAutoFlip(false);
  ok(G.autoFlip === false, 'автоповорот выключен');
  tb('reset'); modalYes();

  console.log('\n— 25 случайных партий через интерфейс (фиксированный ГСЧ) —');
  /* детерминированный генератор, чтобы тест был воспроизводимым */
  let seed = 20261011;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const reasons = {};
  let totalPlies = 0;
  for (let game = 0; game < 25; game++) {
    tb('reset'); modalYes();
    ok(G.sans.length === 0 && G.states.length === 1, `партия ${game + 1}: доска сброшена`);
    let plies = 0;
    while (!G.result && plies < 240) {
      const s = App.cur();
      const legal = C.legalMoves(s);
      if (!legal.length) break;
      const m = legal[Math.floor(rnd() * legal.length)];
      App.doMove(m);
      plies++;
      /* инварианты после каждого хода */
      if (G.states.length !== G.sans.length + 1 || G.keys.length !== G.states.length ||
          G.moves.length !== G.sans.length || G.view !== G.states.length - 1) {
        ok(false, `партия ${game + 1}: рассинхрон истории на полуходе ${plies}`);
        break;
      }
      const board = C.toFen(App.cur()).split(' ')[0];
      const kings = (board.match(/K/g) || []).length + (board.match(/k/g) || []).length;
      if (kings !== 2) { ok(false, `партия ${game + 1}: пропали короли (${fen})`); break; }
    }
    totalPlies += plies;
    if (G.result) {
      ok(true, `партия ${game + 1}: завершена за ${plies} полуходов — ${G.result.reason}`);
      reasons[G.result.reason] = (reasons[G.result.reason] || 0) + 1;
      const valid = ['checkmate', 'stalemate', 'fifty', 'threefold', 'material'].indexOf(G.result.reason) >= 0;
      if (!valid) ok(false, 'неизвестная причина: ' + G.result.reason);
      const expect = G.result.reason === 'checkmate' ? (G.result.winner === 'w' ? '1-0' : '0-1')
        : G.result.draw ? '1/2-1/2' : null;
      if (expect && G.result.result !== expect) ok(false, `неверный результат ${G.result.result} для ${G.result.reason}`);
      ok(!!doc.querySelector('.modal'), `партия ${game + 1}: показано окно итога`);
      modalYes();  /* «Новая партия» */
    } else {
      /* партия не обязана завершиться: при случайной игре счётчик 50 ходов постоянно обнуляется */
      ok(G.sans.length === plies && G.view === G.states.length - 1,
        `партия ${game + 1}: не завершена за ${plies} полуходов, но история цела и инварианты соблюдены`);
      tb('reset'); modalYes();
    }
  }
  const finished = Object.values(reasons).reduce((a, b) => a + b, 0);
  console.log(`  завершилось партий: ${finished} из 25 (остальные обрезаны лимитом 240 полуходов — это нормально для случайной игры)`);
  console.log('  причины завершений:', JSON.stringify(reasons), '| всего полуходов:', totalPlies);
  /* конкретные исходы проверены детерминированно: мат, пат и все виды ничьих — в uitest.js,
     правило 50 ходов в длинной игре — в секции ниже. Здесь важны инварианты и отсутствие ошибок. */
  ok(totalPlies > 4000, 'сыграно много полуходов через интерфейс без единой ошибки: ' + totalPlies);

  console.log('\n— Ничейные условия в длинной «тихой» партии —');
  tb('reset'); modalYes();
  let plies = 0;
  while (!G.result && plies < 500) {
    const st = App.cur();
    let legal = C.legalMoves(st);
    if (!legal.length) break;
    const quiet = legal.filter(m => !m.captured && !m.ep && C.typeOf(st.b[m.from]) !== 'p');
    const pool = quiet.length ? quiet : legal;
    App.doMove(pool[Math.floor(rnd() * pool.length)]);
    plies++;
  }
  ok(!!G.result, `тихая партия завершилась за ${plies} полуходов: ${G.result ? G.result.reason : 'НЕ ЗАВЕРШЕНА'}`);
  ok(G.result && G.result.draw === true && G.result.result === '1/2-1/2',
    'и это ничья 1/2-1/2 (' + (G.result ? G.result.text : '') + ')');
  ok(plies < 500, 'партия не затянулась дальше лимита (сработало правило 50 ходов или повторение)');
  modalYes();

  console.log('\n— Ошибки консоли —');
  ok(errors.length === 0, 'за весь стресс-тест ошибок не было' + (errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''));
  console.log(`\nИТОГ: ${pass} пройдено, ${fail} провалено`);
  process.exit(fail || errors.length ? 1 : 0);
}, 200);
