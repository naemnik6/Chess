/* Проверка движка: perft по эталонным позициям + юнит-тесты правил */
const C = require('./src/engine.js');

const cases = [
  {
    name: 'Начальная позиция',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    depths: { 1: 20, 2: 400, 3: 8902, 4: 197281 }
  },
  {
    name: 'Kiwipete',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    depths: { 1: 48, 2: 2039, 3: 97862 }
  },
  {
    name: 'Позиция 3 (взятие на проходе, связки)',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    depths: { 1: 14, 2: 191, 3: 2812, 4: 43238 }
  },
  {
    name: 'Позиция 4 (превращения)',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    depths: { 1: 6, 2: 264, 3: 9467 }
  },
  {
    name: 'Позиция 5',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    depths: { 1: 44, 2: 1486, 3: 62379 }
  },
  {
    name: 'Позиция 6',
    fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    depths: { 1: 46, 2: 2079, 3: 89890 }
  }
];

let fail = 0;
for (const c of cases) {
  const s = C.fromFen(c.fen);
  for (const d of Object.keys(c.depths)) {
    const t0 = Date.now();
    const n = C.perft(s, +d);
    const ms = Date.now() - t0;
    const ok = n === c.depths[d];
    if (!ok) fail++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${c.name} d${d}: ${n} (ожидалось ${c.depths[d]}) ${ms}ms`);
  }
}

/* --- точечные проверки правил --- */
function assert(cond, msg) {
  if (!cond) { fail++; console.log('FAIL  ' + msg); } else console.log('OK    ' + msg);
}

/* Мат */
let s = C.fromFen('6k1/5ppp/8/8/8/8/8/R6K w - - 0 1');
let st = C.status(s);
assert(st.check === false && st.legalMoves.length > 0, 'обычная позиция не заканчивает партию');

s = C.fromFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
st = C.status(s);
assert(st.reason === 'checkmate' && st.winner === 'b', 'дурацкий мат определён как мат (победили чёрные)');

/* Пат */
s = C.fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
st = C.status(s);
assert(st.reason === 'stalemate' && st.draw, 'пат определён');

/* Взятие на проходе */
s = C.fromFen('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
let moves = C.legalMoves(s);
assert(moves.some(m => m.ep && m.to === C.sqFromName('f6')), 'взятие на проходе доступно');

/* Рокировка через битое поле запрещена */
s = C.fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
moves = C.legalMoves(s);
assert(moves.filter(m => m.castle).length === 2, 'обе рокировки разрешены');
s = C.fromFen('r3k2r/8/8/8/8/8/3n4/R3K2R w KQkq - 0 1');
moves = C.legalMoves(s);
assert(moves.filter(m => m.castle === 'K').length === 0, 'короткая рокировка под боем запрещена');
assert(moves.filter(m => m.castle === 'Q').length === 1, 'длинная рокировка разрешена');

/* Недостаточно материала */
assert(C.insufficientMaterial(C.fromFen('8/8/4k3/8/8/3K4/8/8 w - - 0 1')), 'К против К — ничья');
assert(C.insufficientMaterial(C.fromFen('8/8/4k3/8/8/3K1B2/8/8 w - - 0 1')), 'К+С против К — ничья');
assert(C.insufficientMaterial(C.fromFen('8/8/2b1k3/8/8/3K1B2/8/8 w - - 0 1')), 'К+С против К+С (одноцветные) — ничья');
assert(!C.insufficientMaterial(C.fromFen('8/8/2b1k3/8/8/3K1N2/8/8 w - - 0 1')), 'К+С против К+К — не ничья по материалу');
assert(C.insufficientMaterial(C.fromFen('8/5b2/4k3/8/8/3K1B2/8/8 w - - 0 1')), 'слоны на одноцветных полях (f3/f7) — ничья');
assert(!C.insufficientMaterial(C.fromFen('8/6b1/4k3/8/8/3K1B2/8/8 w - - 0 1')), 'слоны на полях разного цвета — не ничья');
assert(C.insufficientMaterial(C.fromFen('8/8/4k3/8/8/3K1N2/8/8 w - - 0 1')), 'К+К против К — ничья');
assert(!C.insufficientMaterial(C.fromFen('8/8/4k3/8/8/3K1R2/8/8 w - - 0 1')), 'К+Л против К — не ничья');

/* Правило 50 ходов */
s = C.fromFen('8/8/4k3/8/8/3K4/4R3/8 w - - 100 80');
st = C.status(s);
assert(st.reason === 'fifty' && st.draw, 'правило 50 ходов срабатывает');

/* Троекратное повторение */
const s0 = C.startState();
const seq = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'];
let cur = s0, keys = [C.positionKey(cur, C.legalMoves(cur))], last = null;
for (const uci of seq) {
  const m = C.findMove(C.legalMoves(cur), C.sqFromName(uci.slice(0, 2)), C.sqFromName(uci.slice(2, 4)));
  cur = C.makeMove(cur, m);
  keys.push(C.positionKey(cur, C.legalMoves(cur)));
}
st = C.status(cur, keys);
assert(st.reason === 'threefold', 'троекратное повторение определено');

/* SAN */
s = C.startState();
moves = C.legalMoves(s);
let m = C.findMove(moves, C.sqFromName('e2'), C.sqFromName('e4'));
assert(C.moveToSan(s, m, moves) === 'e4', 'SAN: e4');
s = C.fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
m = C.findMove(C.legalMoves(s), C.sqFromName('b1'), C.sqFromName('c3'));
assert(C.moveToSan(s, m, C.legalMoves(s)) === 'Nc3', 'SAN: Nc3');
s = C.fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
m = C.findMove(C.legalMoves(s), C.sqFromName('e1'), C.sqFromName('g1'));
assert(C.moveToSan(s, m, C.legalMoves(s)) === 'O-O', 'SAN: O-O');
s = C.fromFen('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
m = C.findMove(C.legalMoves(s), C.sqFromName('e2'), C.sqFromName('e4'));
assert(C.moveToSan(s, m, C.legalMoves(s)) === 'e4', 'SAN: e4 (двойной ход пешки)');
s = C.fromFen('r1bqkbnr/1ppp1ppp/p1n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 1');
m = C.findMove(C.legalMoves(s), C.sqFromName('c4'), C.sqFromName('f7'));
if (m) assert(C.moveToSan(s, m, C.legalMoves(s)) === 'Bxf7+', 'SAN: Bxf7+ с шахом');

/* Двойная запись при неоднозначности */
s = C.fromFen('8/8/8/3k4/8/8/8/R3K2R w KQ - 0 1');
m = C.findMove(C.legalMoves(s), C.sqFromName('a1'), C.sqFromName('d1'));
/* d1 занят королём — другой пример */
s = C.fromFen('8/8/8/8/8/4k3/8/R2R2K1 w - - 0 1');
m = C.findMove(C.legalMoves(s), C.sqFromName('a1'), C.sqFromName('b1'));
assert(C.moveToSan(s, m, C.legalMoves(s)) === 'Rab1', 'SAN: неоднозначность Rab1');

/* FEN round-trip */
const fens = cases.map(c => c.fen);
let rt = true;
for (const f of fens) {
  const st2 = C.fromFen(f);
  if (C.toFen(st2).split(' ').slice(0, 4).join(' ') !== f.split(' ').slice(0, 4).join(' ')) rt = false;
}
assert(rt, 'FEN: сериализация/разбор без потерь');

console.log(fail === 0 ? '\nВСЕ ТЕСТЫ ПРОЙДЕНЫ' : `\nОШИБОК: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
