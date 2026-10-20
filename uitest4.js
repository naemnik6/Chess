/* Тесты нововведений: стрелки правой кнопкой, подсветка шаха, фишки взятых фигур, громкость */
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
const layer = () => doc.getElementById('arrowLayer').innerHTML;

win.Element.prototype.getBoundingClientRect = function () {
  return this.id === 'board'
    ? { left: 0, top: 0, right: 800, bottom: 800, width: 800, height: 800, x: 0, y: 0 }
    : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
};
function pt(name) {
  const sq = C.sqFromName(name), r = C.rankOf(sq), f = C.fileOf(sq);
  const drow = G.flipped ? r : 7 - r, dcol = G.flipped ? 7 - f : f;
  return { x: dcol * 100 + 50, y: drow * 100 + 50 };
}
function pev(type, target, x, y, button) {
  const E = win.PointerEvent || win.MouseEvent;
  target.dispatchEvent(new E(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: button || 0, pointerId: 1, pointerType: 'mouse' }));
}
const sqEl = n => doc.querySelector('.sq[data-sq="' + C.sqFromName(n) + '"]');
function rightDrag(from, to) {
  const a = pt(from), b = pt(to);
  pev('pointerdown', sqEl(from), a.x, a.y, 2);
  pev('pointermove', win, (a.x + b.x) / 2, (a.y + b.y) / 2, 2);
  pev('pointermove', win, b.x, b.y, 2);
  pev('pointerup', win, b.x, b.y, 2);
}
function rightWiggle(name) {          /* правая кнопка с небольшим движением внутри клетки */
  const a = pt(name);
  pev('pointerdown', sqEl(name), a.x, a.y, 2);
  pev('pointermove', win, a.x + 22, a.y + 18, 2);
  pev('pointerup', win, a.x + 22, a.y + 18, 2);
}
function rightClick(name) { const p = pt(name); pev('pointerdown', sqEl(name), p.x, p.y, 2); pev('pointerup', win, p.x, p.y, 2); }
function tap(name) { const p = pt(name); pev('pointerdown', sqEl(name), p.x, p.y, 0); }
const click = id => doc.getElementById(id).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

/* кнопки-иконки под доской */
const tb = act => {
  const b = doc.querySelector('#toolbar button[data-act="' + act + '"]');
  if (!b) throw new Error('нет кнопки ' + act);
  b.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
};
const marksBtn = () => doc.querySelector('#toolbar button[data-act="marks"]');
const logText = () => { App.openSettings('events'); const t = txt('logAll'); App.closeSettings(); return t; };
const modal = a => { const b = doc.querySelector('.modal [data-a=' + a + ']'); if (b) b.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); };

setTimeout(() => {
  console.log('\n— Стрелки правой кнопкой мыши —');
  ok(doc.getElementById('arrows') && doc.getElementById('arrowLayer'), 'слой стрелок присутствует в разметке');
  ok(marksBtn().disabled === true, 'кнопка «стереть стрелки» неактивна, пока их нет');
  rightDrag('e2', 'e4');
  ok(G.marks.length === 1 && G.marks[0].type === 'arrow', 'стрелка нарисована: ' + JSON.stringify(G.marks[0]));
  ok(G.marks[0].from === C.sqFromName('e2') && G.marks[0].to === C.sqFromName('e4'), 'стрелка e2 → e4');
  ok(/<line/.test(layer()) && /<polygon/.test(layer()), 'в слое есть древко и наконечник стрелки');
  ok(G.sans.length === 0 && G.selected === null, 'правая кнопка НЕ делает ход и не выбирает фигуру');

  rightDrag('d2', 'd4');
  ok(G.marks.length === 2, 'вторая стрелка добавлена');
  ok(G.marks[0].color !== G.marks[1].color, 'стрелки разного цвета: ' + G.marks.map(m => m.color).join(','));
  rightDrag('e2', 'e4');
  ok(G.marks.length === 1, 'повторная стрелка между теми же клетками удаляет её');
  ok(layer().indexOf('#3aa0ff') < 0 || G.marks.length === 1, 'в слое осталась одна стрелка');

  rightWiggle('c4');
  ok(G.marks.some(m => m.type === 'circle'), 'движение внутри клетки рисует круг-пометку');
  ok(G.marks.filter(m => m.type === 'circle')[0].from === C.sqFromName('c4'), 'круг стоит на c4');
  ok(/<circle/.test(layer()), 'круг отрисован в слое');

  rightClick('c4');
  ok(G.marks.filter(m => m.type === 'circle').length === 0, 'повторный короткий правый клик удалил именно этот круг');
  ok(G.marks.length === 1, 'остальные пометки повтор не тронул');
  rightClick('a1');
  ok(G.marks.length === 2, 'короткий правый клик на новой клетке рисует свой круг, а не стирает всё');
  pev('pointerdown', sqEl('h1'), 5, 5, 0); pev('pointerup', win, 5, 5, 0);
  ok(G.marks.length === 0 && layer() === '', 'короткий ЛЕВЫЙ клик стирает все пометки');
  rightDrag('g1', 'f3');
  ok(G.marks.length === 1, 'стрелка снова нарисована');
  ok(marksBtn().disabled === false, 'кнопка очистки стала активной');
  tb('marks');
  ok(G.marks.length === 0, 'кнопка ➶ стерла стрелки');

  console.log('\n— Стрелки и ходы / переворот доски —');
  rightDrag('b1', 'c3');
  const before = layer();
  ok(before.length > 0, 'стрелка на доске');
  tb('flip');
  ok(layer() !== before && layer().length > 0, 'после переворота стрелка пересчитана под новую ориентацию');
  ok(G.marks.length === 1 && G.marks[0].from === C.sqFromName('b1'), 'сама стрелка привязана к клеткам, а не к пикселям');
  tb('flip');
  tap('e2'); tap('e4');
  ok(G.sans.length === 1, 'ход сделан');
  ok(G.marks.length === 0, 'после хода стрелки автоматически стёрты');
  rightDrag('e2', 'e4');
  tb('reset'); modal('yes');
  ok(G.marks.length === 0, 'сброс доски тоже стирает стрелки');
  tap('e2'); tap('e4');
  ok(G.sans.length === 1, 'ход для отмены сделан');
  rightDrag('e2', 'e4');
  ok(G.marks.length === 1, 'стрелка нарисована до отмены хода');
  App.undo();
  ok(G.marks.length === 0, 'отмена хода стирает стрелки');
  ok(marksBtn().disabled === true, 'кнопка очистки снова неактивна');

  console.log('\n— Подсветка шаха без громоздкой плашки —');
  App.loadFen('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
  modal('yes');
  tap('a1'); tap('a8');
  ok(G.sans.slice(-1)[0] === 'Ra8+', 'ход с шахом: ' + G.sans.slice(-1)[0]);
  ok(/^ШАХ/.test(big()), 'в статусе объявлен шах: «' + big() + '»');
  ok(doc.querySelectorAll('.sq.check').length === 1, 'подсвечена клетка короля');
  ok(doc.querySelector('.sq.check').dataset.sq === '60', 'подсвечен король на e8');
  ok(!/ШАХ/i.test(txt('toastWrap')), 'громоздкой плашки «ШАХ» над доской нет (текущая плашка: «' + (txt('toastWrap') || 'пусто') + '»)');
  ok(doc.querySelector('.sq.check .pcwrap use') !== null, 'фигура короля осталась в клетке (подсветка — отдельный слой)');
  ok(/Шах/.test(logText()), 'шах объявлен в журнале событий');
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  ok(/\.sq \.pcwrap\{[^}]*z-index:2[^}]*\}/.test(css), 'в CSS фигура поднята над подсветками (z-index:2)');
  ok(/\.sq::before,\.sq::after\{z-index:1\}/.test(css), 'подсветки лежат под фигурами (z-index:1)');
  ok(/\.sq\.check::after\{[^}]*rgba\(255,60,60,0\) 30%/.test(css), 'центр подсветки шаха прозрачный — короля не засвечивает');
  ok(/\.crd\{position:absolute;z-index:3/.test(css), 'координаты поверх подсветки');

  console.log('\n— Взятые фигуры на светлых фишках —');
  App.loadFen('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
  modal('yes');
  tap('e5'); tap('f6');
  ok(G.sans.slice(-1)[0] === 'exf6', 'взятие состоялось: ' + G.sans.slice(-1)[0]);
  const chips = doc.querySelectorAll('.cap-row .chip');
  ok(chips.length === 1, 'взятая фигура показана на фишке: ' + chips.length);
  ok(chips[0].querySelector('svg use') !== null, 'внутри фишки картинка фигуры');
  ok(/\.cap-row \.chip\.cw svg\{filter:grayscale\(1\) brightness\(\.66\)\}/.test(css) &&
    /\.cap-row \.chip\.cb svg\{filter:grayscale\(1\) invert\(\.66\)\}/.test(css),
    'взятые фигуры показаны серыми силуэтами (без подложек-полей)');
  ok(doc.querySelectorAll('#capBottom .chip.cb').length === 1, 'силуэт взятой чёрной фигуры помечен классом cb');
  ok(doc.getElementById('capBottom').querySelector('.chip') !== null, 'фишка у белых — именно они взяли фигуру');
  ok(doc.getElementById('capTop').querySelector('.chip') === null, 'у чёрных взятых фигур пока нет');
  tap('a7'); tap('a6');
  tap('f6'); tap('g7');   /* белая пешка берёт ещё одну */
  ok(G.sans.slice(-1)[0] === 'fxg7', 'второе взятие: ' + G.sans.slice(-1)[0]);
  ok(doc.querySelectorAll('#capBottom .chip').length === 2, 'две взятые фигуры на фишках у белых');
  ok(doc.querySelectorAll('#capTop .chip').length === 0, 'у чёрных по-прежнему ничего не взято');

  console.log('\n— Громкость —');
  ok(G.volume === 0.75, 'громкость по умолчанию 75%: ' + G.volume);
  ok(txt('volVal') === '75%', 'значение показано в интерфейсе: ' + txt('volVal'));
  const rng = doc.getElementById('volRange');
  rng.value = '40'; rng.dispatchEvent(new win.Event('input', { bubbles: true }));
  ok(Math.abs(G.volume - 0.4) < 1e-9, 'ползунок меняет громкость: ' + G.volume);
  ok(txt('volVal') === '40%', 'подпись обновилась: ' + txt('volVal'));
  rng.dispatchEvent(new win.Event('change', { bubbles: true }));
  ok(JSON.parse(win.localStorage.getItem('chess-settings-v1')).volume === 0.4, 'громкость сохраняется в настройках');
  /* кнопка звука теперь открывает панель со шкалой */
  click('btnSound');
  ok(doc.getElementById('soundPop').classList.contains('open'), 'кнопка 🔊 открывает панель громкости');
  ok(doc.getElementById('soundPanel').querySelector('#volRange') !== null, 'шкала громкости находится внутри панели');
  ok(doc.getElementById('btnSound').getAttribute('aria-expanded') === 'true', 'aria-expanded выставлен');
  pev('pointerdown', doc.body, 5, 5, 0);
  ok(!doc.getElementById('soundPop').classList.contains('open'), 'клик мимо панели закрывает её');
  click('volIcon');
  ok(G.sound === false && txt('volVal') === 'выкл', 'значок в панели глушит звук: ' + txt('volVal'));
  ok(txt('btnSound') === '\u{1F507}', 'иконка кнопки сменилась на выключенную');
  click('volIcon');
  ok(G.sound === true && txt('volVal') === '40%', 'повторное нажатие включает звук обратно');
  rng.value = '0'; rng.dispatchEvent(new win.Event('input', { bubbles: true }));
  ok(G.volume === 0 && txt('volVal') === '0%', 'нулевая громкость допустима');
  tap('e2'); tap('e4');
  ok(G.sans.length > 0, 'при нулевой громкости игра продолжается без ошибок');
  rng.value = '100'; rng.dispatchEvent(new win.Event('input', { bubbles: true }));
  ok(G.volume === 1 && G.sound === true, 'поднятие ползунка включает звук: ' + G.volume);
  ok(/gain = \(gain === undefined \? 0\.05 : gain\) \* G\.volume/.test(html), 'громкость применяется как множитель в tone()');

  console.log('\n— Восстановление настроек —');
  const saved = win.localStorage.getItem('chess-game-v1');
  const savedSet = win.localStorage.getItem('chess-settings-v1');
  const dom2 = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
  dom2.window.localStorage.setItem('chess-game-v1', saved);
  dom2.window.localStorage.setItem('chess-settings-v1', savedSet);
  setTimeout(() => {
    const G2 = dom2.window.ChessApp.G;
    ok(Math.abs(G2.volume - 1) < 1e-9, 'громкость восстановлена после перезагрузки: ' + G2.volume);
    ok(dom2.window.document.getElementById('volVal').textContent === '100%', 'ползунок и подпись восстановлены');
    ok(errors.length === 0, 'ошибок в консоли нет' + (errors.length ? ': ' + errors[0] : ''));
    console.log(`\nИТОГ: ${pass} пройдено, ${fail} провалено`);
    process.exit(fail || errors.length ? 1 : 0);
  }, 150);
}, 200);
