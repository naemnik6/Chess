/* Глубокий perft — эталонные значения из chessprogramming wiki */
const C = require('./src/engine.js');
const cases = [
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 5, 4865609],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 4, 4085603],
  ['r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', 4, 3894594],
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 5, 674624],
];
let fail = 0;
for (const [fen, d, exp] of cases) {
  const t0 = Date.now();
  const n = C.perft(C.fromFen(fen), d);
  const ok = n === exp; if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} d${d}: ${n} / ожидалось ${exp}  (${Date.now() - t0}ms)`);
}
console.log(fail ? 'ЕСТЬ ОШИБКИ' : 'ГЛУБОКИЙ PERFT: ВСЁ ВЕРНО');
