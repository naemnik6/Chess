/* =========================================================================
   Простой, но вменяемый ИИ: негамакс + альфа-бета, итеративное углубление,
   квивесценция (добор взятий), таблицы позиционной оценки.
   ========================================================================= */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var C = isNode ? require('./engine.js') : (root && root.Chess);
  var api = factory(C);
  if (isNode) module.exports = api;
  if (root) root.ChessBot = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (C) {
  'use strict';

  var MATE = 1000000;
  var VAL = { p: 100, n: 320, b: 335, r: 500, q: 950, k: 0 };

  /* Таблицы заданы «сверху вниз» (a8 первым) — переворачиваем под a1 = 0 */
  function flip(t) {
    var out = new Array(64);
    for (var r = 0; r < 8; r++) for (var f = 0; f < 8; f++) out[r * 8 + f] = t[(7 - r) * 8 + f];
    return out;
  }
  var mirror = function (sq) { return (7 - (sq >> 3)) * 8 + (sq & 7); };

  var PST = {
    p: flip([
      0, 0, 0, 0, 0, 0, 0, 0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, -5, -10, 0, 0, -10, -5, 5,
      5, 10, 10, -20, -20, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0]),
    n: flip([
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50]),
    b: flip([
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20]),
    r: flip([
      0, 0, 0, 0, 0, 0, 0, 0,
      5, 10, 10, 10, 10, 10, 10, 5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      0, 0, 0, 5, 5, 0, 0, 0]),
    q: flip([
      -20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20]),
    k: flip([
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      20, 20, 0, 0, 0, 0, 20, 20,
      20, 30, 10, 0, 0, 10, 30, 20])
  };

  /* Оценка с точки зрения белых */
  function evaluate(s) {
    var score = 0;
    for (var sq = 0; sq < 64; sq++) {
      var pc = s.b[sq];
      if (!pc) continue;
      var t = pc.toLowerCase();
      var white = pc === pc.toUpperCase();
      var v = VAL[t] + PST[t][white ? sq : mirror(sq)];
      score += white ? v : -v;
    }
    return score;
  }
  function evalSide(s) { return s.turn === C.W ? evaluate(s) : -evaluate(s); }

  function order(moves, s) {
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var sc = 0;
      if (m.captured) {
        sc += 10 * VAL[C.typeOf(m.captured)] - VAL[C.typeOf(s.b[m.from] || 'p')];
      }
      if (m.promo) sc += 800;
      m._o = sc;
    }
    moves.sort(function (a, b) { return b._o - a._o; });
    return moves;
  }

  var nodes = 0, deadline = 0, nodeCap = Infinity;
  var ABORT = { abort: true };
  function overBudget() { return Date.now() > deadline || nodes > nodeCap; }

  function quiesce(s, alpha, beta, ply, qply) {
    nodes++;
    if ((nodes & 1023) === 0 && overBudget()) throw ABORT;
    var stand = evalSide(s);
    if (qply >= 4 || ply >= 64) return stand;
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    var all = C.legalMoves(s);
    var caps = [];
    for (var i = 0; i < all.length; i++) if (all[i].captured || all[i].promo) caps.push(all[i]);
    order(caps, s);
    for (i = 0; i < caps.length; i++) {
      var sc = -quiesce(C.makeMove(s, caps[i]), -beta, -alpha, ply + 1, qply + 1);
      if (sc >= beta) return beta;
      if (sc > alpha) alpha = sc;
    }
    return alpha;
  }

  function negamax(s, depth, alpha, beta, ply) {
    nodes++;
    if ((nodes & 1023) === 0 && overBudget()) throw ABORT;

    var legal = C.legalMoves(s);
    if (legal.length === 0) return C.inCheck(s, s.turn) ? -(MATE - ply) : 0;
    if (depth <= 0) return quiesce(s, alpha, beta, ply, 0);
    if (C.insufficientMaterial(s) || s.half >= 100) return 0;

    order(legal, s);
    var best = -Infinity;
    for (var i = 0; i < legal.length; i++) {
      var sc = -negamax(C.makeMove(s, legal[i]), depth - 1, -beta, -alpha, ply + 1);
      if (sc > best) best = sc;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  function searchRoot(s, depth) {
    var legal = order(C.legalMoves(s), s);
    if (!legal.length) return null;
    var scored = [];
    for (var i = 0; i < legal.length; i++) {
      if (overBudget()) throw ABORT;
      /* полное окно для каждого корневого хода — чтобы оценки были точными
         и среди равноценных ходов можно было выбирать случайно */
      var sc = -negamax(C.makeMove(s, legal[i]), depth - 1, -Infinity, Infinity, 1);
      scored.push({ m: legal[i], sc: sc });
    }
    scored.sort(function (a, b) { return b.sc - a.sc; });
    return scored;
  }

  /* Ограничения подобраны так, чтобы интерфейс не «залипал» надолго */
  var LEVELS = {
    easy:   { depth: 2, tol: 220, blunder: 0.18, timeMs: 700,  maxNodes: 60000 },
    medium: { depth: 3, tol: 60,  blunder: 0.04, timeMs: 1800, maxNodes: 250000 },
    hard:   { depth: 4, tol: 0,   blunder: 0,    timeMs: 3200, maxNodes: 900000 }
  };

  /**
   * Возвращает ход для стороны, чей сейчас ход.
   * level: 'easy' | 'medium' | 'hard'
   */
  function search(state, level) {
    var cfg = LEVELS[level] || LEVELS.medium;
    var legal = C.legalMoves(state);
    if (!legal.length) return null;
    if (legal.length === 1) return legal[0];

    deadline = Date.now() + cfg.timeMs;
    nodeCap = cfg.maxNodes || Infinity;
    nodes = 0;

    var scored = null;
    for (var d = 1; d <= cfg.depth; d++) {
      try {
        scored = searchRoot(state, d);
      } catch (e) {
        if (e !== ABORT) throw e;
        break;              /* не успели — берём результат прошлой глубины */
      }
      if (!scored) break;
      if (Math.abs(scored[0].sc) > MATE / 2) break;
    }
    if (!scored || !scored.length) return legal[Math.floor(Math.random() * legal.length)];

    /* «человеческая» непредсказуемость на лёгком уровне */
    if (cfg.blunder && Math.random() < cfg.blunder) {
      return legal[Math.floor(Math.random() * legal.length)];
    }
    var best = scored[0].sc;
    var pool = [];
    for (var i = 0; i < scored.length; i++) {
      if (scored[i].sc >= best - cfg.tol) pool.push(scored[i].m);
    }
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : scored[0].m;
  }

  return { search: search, evaluate: evaluate, LEVELS: LEVELS };
});
