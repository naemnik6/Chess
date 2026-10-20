/* Тесты режимов с компьютером, гонок и диалога превращения */
const fs = require('fs');
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); }
catch (e) { ({ JSDOM, VirtualConsole } = require('/tmp/node_modules/jsdom')); }
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => { errors.push(e.message); console.log('  !! ' + e.message); });
vc.on('error', (...a) => { errors.push(String(a)); console.log('  !! console.error ' + a.join(' ')); });
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const win = dom.window, doc = win.document;
const App = win.ChessApp, C = win.Chess, G = App.G;

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (fail++, console.log('  FAIL ' + m)); };
const txt = id => (doc.getElementById(id).textContent || '').replace(/\s+/g, ' ').trim();
const big = () => txt('statusBig');
function tapName(n) {
  const el = doc.querySelector('.sq[data-sq="' + C.sqFromName(n) + '"]');
  const T = win.PointerEvent ? 'pointerdown' : 'mousedown';
  const E = (T === 'pointerdown' && win.PointerEvent) ? win.PointerEvent : win.MouseEvent;
  el.dispatchEvent(new E(T, { bubbles: true, cancelable: true, button: 0, clientX: 1, clientY: 1 }));
}
function move(uci, promo) {
  tapName(uci.slice(0, 2)); tapName(uci.slice(2, 4));
  if (promo) doc.querySelector('.promo-picks button[data-p="' + promo + '"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
}
const click = id => doc.getElementById(id).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

/* кнопки-иконки под доской */
const tb = act => {
  const b = doc.querySelector('#toolbar button[data-act="' + act + '"]');
  if (!b) throw new Error('нет кнопки ' + act);
  b.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
};
const marksBtn = () => doc.querySelector('#toolbar button[data-act="marks"]');
const logText = () => { App.openSettings('events'); const t = txt('logAll'); App.closeSettings(); return t; };
const setMode = m => doc.querySelector('#modeSeg button[data-mode="' + m + '"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const modal = a => { const b = doc.querySelector('.modal [data-a=' + a + ']'); if (b) b.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); };
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await wait(150);

  console.log('\n— Компьютер играет белыми —');
  setMode('bot-w');
  tb('reset'); modal('yes');
  ok(G.mode === 'bot-w' && G.thinking === true, 'компьютер задумался над первым ходом за белых');
  ok(/Компьютер думает/.test(big()), 'в статусе видно, что считает компьютер: «' + big() + '»');
  ok(App.canPlay() === false, 'доска заблокирована на время расчёта');
  tapName('e7');
  ok(G.selected === null, 'во время расчёта фигуры не выбираются');
  await wait(1500);
  ok(G.sans.length === 1, 'компьютер сделал первый ход: ' + G.sans.join(' '));
  ok(App.cur().turn === 'b', 'теперь ход человека (чёрные)');
  ok(G.thinking === false, 'флаг расчёта сброшен');
  move('e7e5');
  await wait(2200);
  ok(G.sans.length === 3, 'человек и компьютер обменялись ходами: ' + G.sans.join(' '));
  ok(App.cur().turn === 'b', 'после ответа компьютера снова ход человека');

  console.log('\n— Сброс доски во время расчёта бота (гонка) —');
  setMode('bot-b');
  tb('reset'); modal('yes');
  move('e2e4');
  ok(G.thinking === true, 'бот за чёрных считает ответ');
  tb('reset'); modal('yes');
  ok(G.sans.length === 0 && G.states.length === 1, 'доска сброшена: ходов ' + G.sans.length);
  await wait(2500);
  ok(G.sans.length === 0 && G.states.length === 1, 'устаревший ответ бота НЕ применился к новой партии');
  ok(App.cur().turn === 'w' && G.thinking === false, 'в новой партии ход белых, бот ничего не «довесил»');
  ok(C.toFen(App.cur()).indexOf('rnbqkbnr/pppppppp') === 0, 'позиция осталась начальной: ' + C.toFen(App.cur()).slice(0, 30));

  console.log('\n— Диалог превращения —');
  setMode('hotseat');
  App.loadFen('8/P6k/8/8/8/8/7K/8 w - - 0 1');
  tapName('a7'); tapName('a8');
  ok(!!doc.querySelector('.promo-picks'), 'открылся выбор фигуры для превращения');
  ok(doc.querySelectorAll('.promo-picks button').length === 4, 'четыре варианта: ферзь, ладья, слон, конь');
  ok(doc.querySelectorAll('.promo-picks use').length === 4, 'в диалоге показаны картинки фигур');
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok(!doc.querySelector('.modal'), 'Esc закрыл диалог');
  ok(G.selected === C.sqFromName('a7'), 'после отмены выделение пешки вернулось');
  ok(G.targets.length === 4 && G.targets.every(m => m.promo), '4 варианта превращения пешки a8: ' + G.targets.length);
  tapName('a8');
  doc.querySelector('.modal [data-a=cancel]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok(!doc.querySelector('.modal') && G.selected === C.sqFromName('a7'), 'кнопка «Отмена» тоже возвращает выделение');
  tapName('a8');
  doc.querySelector('.promo-picks button[data-p=r]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok(G.sans.slice(-1)[0] === 'a8=R', 'превращение в ладью состоялось: ' + G.sans.slice(-1)[0]);
  ok(doc.querySelector('.sq[data-sq="56"] use').getAttribute('href') === '#pc-wR', 'на a8 стоит белая ладья');

  console.log('\n— Партия с компьютером до мата —');
  setMode('bot-b');
  doc.getElementById('levelSel').value = 'easy';
  doc.getElementById('levelSel').dispatchEvent(new win.Event('change', { bubbles: true }));
  ok(G.level === 'easy', 'уровень бота переключается');
  App.loadFen('k7/8/1K6/8/8/8/8/7R w - - 0 1');
  move('h1h8');
  ok(G.result && G.result.reason === 'checkmate', 'человек поставил мат компьютеру: ' + (G.result ? G.result.reason : '—'));
  ok(G.result.winner === 'w' && G.result.result === '1-0', 'победа белых, результат 1-0');
  ok(G.sans.slice(-1)[0] === 'Rh8#', 'нотация: ' + G.sans.slice(-1)[0]);
  const after = G.sans.length;
  await wait(1500);
  ok(G.sans.length === after, 'после мата компьютер не делает ходов');
  ok(/МАТ/.test(big()), 'в статусе объявлен МАТ: «' + big() + '»');
  ok(!!doc.querySelector('.modal'), 'показано окно итога партии');

  console.log('\n— Длительная игра с компьютером без ошибок —');
  modal('new');
  tb('reset'); modal('yes');
  let plies = 0;
  while (!G.result && plies < 24) {
    if (G.thinking || !App.canPlay()) { await wait(100); continue; }
    const legal = C.legalMoves(App.cur());
    if (!legal.length) break;
    App.doMove(legal[Math.floor(Math.random() * legal.length)]);
    plies++;
    await wait(30);
  }
  ok(plies >= 20 || !!G.result, 'сыграно полуходов человеком: ' + plies + ' (результат: ' + (G.result ? G.result.reason : 'партия идёт') + ')');
  ok(G.states.length === G.sans.length + 1 && G.view === G.states.length - 1, 'история партии согласована');
  ok(errors.length === 0, 'ошибок нет' + (errors.length ? ': ' + errors[0] : ''));

  console.log(`\nИТОГ: ${pass} пройдено, ${fail} провалено`);
  process.exit(fail || errors.length ? 1 : 0);
})();
