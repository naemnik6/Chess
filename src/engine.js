/* =========================================================================
   Шахматный движок (правила, генерация ходов, определения конца игры)
   Работает и в браузере (window.Chess), и в Node (module.exports) — для тестов.
   ========================================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Chess = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var FILES = 'abcdefgh';
  var W = 'w', B = 'b';

  /* Права на рокировку (биты) */
  var CR = { WK: 1, WQ: 2, BK: 4, BQ: 8 };

  var KNIGHT_D = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  var KING_D   = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  var BISHOP_D = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  var ROOK_D   = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  /* ---------- утилиты по полям ---------- */
  function colorOf(pc) { return pc === pc.toUpperCase() ? W : B; }
  function typeOf(pc) { return pc.toLowerCase(); }
  function other(c) { return c === W ? B : W; }
  function rankOf(sq) { return sq >> 3; }
  function fileOf(sq) { return sq & 7; }
  function sqOf(r, f) { return r * 8 + f; }
  function inside(r, f) { return r >= 0 && r < 8 && f >= 0 && f < 8; }
  function nameOf(sq) { return FILES[fileOf(sq)] + (rankOf(sq) + 1); }
  function sqFromName(n) { return sqOf(parseInt(n[1], 10) - 1, FILES.indexOf(n[0])); }
  function squareColor(sq) { return (rankOf(sq) + fileOf(sq)) % 2 === 0 ? 'dark' : 'light'; }

  function mk(from, to, captured, promo, ep, castle, doublePush) {
    return {
      from: from, to: to,
      captured: captured || null,
      promo: promo || null,
      ep: !!ep,
      castle: castle || null,
      double: !!doublePush
    };
  }

  /* ---------- начальная позиция ---------- */
  function startState() {
    var b = new Array(64).fill(null);
    var back = 'rnbqkbnr';
    for (var f = 0; f < 8; f++) {
      b[sqOf(7, f)] = back[f];
      b[sqOf(6, f)] = 'p';
      b[sqOf(1, f)] = 'P';
      b[sqOf(0, f)] = back[f].toUpperCase();
    }
    return { b: b, turn: W, cr: 15, ep: -1, half: 0, full: 1 };
  }

  function cloneState(s) {
    return { b: s.b.slice(), turn: s.turn, cr: s.cr, ep: s.ep, half: s.half, full: s.full };
  }

  function kingSquare(s, color) {
    var k = color === W ? 'K' : 'k';
    for (var i = 0; i < 64; i++) if (s.b[i] === k) return i;
    return -1;
  }

  /* ---------- атаковано ли поле ---------- */
  function isAttacked(s, sq, by) {
    var b = s.b;
    var r = rankOf(sq), f = fileOf(sq);

    /* пешки */
    var pr = by === W ? r - 1 : r + 1;
    var pawn = by === W ? 'P' : 'p';
    if (inside(pr, f - 1) && b[sqOf(pr, f - 1)] === pawn) return true;
    if (inside(pr, f + 1) && b[sqOf(pr, f + 1)] === pawn) return true;

    /* кони */
    var kn = by === W ? 'N' : 'n';
    for (var i = 0; i < KNIGHT_D.length; i++) {
      var rr = r + KNIGHT_D[i][0], ff = f + KNIGHT_D[i][1];
      if (inside(rr, ff) && b[sqOf(rr, ff)] === kn) return true;
    }

    /* короли */
    var kg = by === W ? 'K' : 'k';
    for (i = 0; i < KING_D.length; i++) {
      rr = r + KING_D[i][0]; ff = f + KING_D[i][1];
      if (inside(rr, ff) && b[sqOf(rr, ff)] === kg) return true;
    }

    /* линейные фигуры */
    var r1 = by === W ? 'R' : 'r', q1 = by === W ? 'Q' : 'q';
    var b1 = by === W ? 'B' : 'b', q2 = q1;
    var d, pc, rr2, ff2;
    for (i = 0; i < ROOK_D.length; i++) {
      d = ROOK_D[i]; rr2 = r + d[0]; ff2 = f + d[1];
      while (inside(rr2, ff2)) {
        pc = b[sqOf(rr2, ff2)];
        if (pc) { if (pc === r1 || pc === q1) return true; break; }
        rr2 += d[0]; ff2 += d[1];
      }
    }
    for (i = 0; i < BISHOP_D.length; i++) {
      d = BISHOP_D[i]; rr2 = r + d[0]; ff2 = f + d[1];
      while (inside(rr2, ff2)) {
        pc = b[sqOf(rr2, ff2)];
        if (pc) { if (pc === b1 || pc === q2) return true; break; }
        rr2 += d[0]; ff2 += d[1];
      }
    }
    return false;
  }

  function inCheck(s, color) {
    var k = kingSquare(s, color);
    return k >= 0 && isAttacked(s, k, other(color));
  }

  /* ---------- рокировка ---------- */
  function genCastling(s, color, out) {
    var home = color === W ? 0 : 7;
    var king = color === W ? 'K' : 'k';
    var rook = color === W ? 'R' : 'r';
    var enemy = other(color);
    var ksq = sqOf(home, 4);
    if (s.b[ksq] !== king) return;
    if (isAttacked(s, ksq, enemy)) return;

    if (s.cr & (color === W ? CR.WK : CR.BK)) {
      var f5 = sqOf(home, 5), f6 = sqOf(home, 6), rs = sqOf(home, 7);
      if (!s.b[f5] && !s.b[f6] && s.b[rs] === rook &&
          !isAttacked(s, f5, enemy) && !isAttacked(s, f6, enemy)) {
        out.push(mk(ksq, f6, null, null, false, 'K', false));
      }
    }
    if (s.cr & (color === W ? CR.WQ : CR.BQ)) {
      var d1 = sqOf(home, 1), d2 = sqOf(home, 2), d3 = sqOf(home, 3), rq = sqOf(home, 0);
      if (!s.b[d1] && !s.b[d2] && !s.b[d3] && s.b[rq] === rook &&
          !isAttacked(s, d3, enemy) && !isAttacked(s, d2, enemy)) {
        out.push(mk(ksq, d2, null, null, false, 'Q', false));
      }
    }
  }

  /* ---------- псевдолегальные ходы ---------- */
  function addPawnMoves(out, from, to, captured, promoRank, color) {
    if (promoRank) {
      out.push(mk(from, to, captured, color === W ? 'Q' : 'q', false, null, false));
      out.push(mk(from, to, captured, color === W ? 'R' : 'r', false, null, false));
      out.push(mk(from, to, captured, color === W ? 'B' : 'b', false, null, false));
      out.push(mk(from, to, captured, color === W ? 'N' : 'n', false, null, false));
    } else {
      out.push(mk(from, to, captured, null, false, null, false));
    }
  }

  function genPseudo(s, color, onlyFrom) {
    var out = [];
    var b = s.b;
    var dir = color === W ? 1 : -1;
    var startRank = color === W ? 1 : 6;
    var promoRank = color === W ? 7 : 0;
    var enemy = other(color);

    for (var sq = 0; sq < 64; sq++) {
      if (onlyFrom !== undefined && onlyFrom !== null && sq !== onlyFrom) continue;
      var pc = b[sq];
      if (!pc || colorOf(pc) !== color) continue;
      var r = rankOf(sq), f = fileOf(sq), t = typeOf(pc);

      if (t === 'p') {
        var r1 = r + dir;
        if (inside(r1, f) && !b[sqOf(r1, f)]) {
          addPawnMoves(out, sq, sqOf(r1, f), null, r1 === promoRank, color);
          var r2 = r + 2 * dir;
          if (r === startRank && !b[sqOf(r2, f)]) {
            out.push(mk(sq, sqOf(r2, f), null, null, false, null, true));
          }
        }
        for (var di = -1; di <= 1; di += 2) {
          var ff = f + di, rr = r + dir;
          if (!inside(rr, ff)) continue;
          var to = sqOf(rr, ff), target = b[to];
          if (target && colorOf(target) === enemy) {
            addPawnMoves(out, sq, to, target, rr === promoRank, color);
          } else if (!target && to === s.ep) {
            /* взятие на проходе: фиксируем снятую пешку как captured —
               это нужно для панели материала, сортировки ходов и добора взятий */
            out.push(mk(sq, to, color === W ? 'p' : 'P', null, true, null, false));
          }
        }
      } else if (t === 'n' || t === 'k') {
        var deltas = t === 'n' ? KNIGHT_D : KING_D;
        for (var i = 0; i < deltas.length; i++) {
          rr = r + deltas[i][0]; ff = f + deltas[i][1];
          if (!inside(rr, ff)) continue;
          to = sqOf(rr, ff); target = b[to];
          if (!target) out.push(mk(sq, to, null, null, false, null, false));
          else if (colorOf(target) === enemy) out.push(mk(sq, to, target, null, false, null, false));
        }
        if (t === 'k' && (onlyFrom === undefined || onlyFrom === null || onlyFrom === sq)) {
          genCastling(s, color, out);
        }
      } else {
        var dirs = t === 'b' ? BISHOP_D : (t === 'r' ? ROOK_D : BISHOP_D.concat(ROOK_D));
        for (i = 0; i < dirs.length; i++) {
          var d = dirs[i];
          rr = r + d[0]; ff = f + d[1];
          while (inside(rr, ff)) {
            to = sqOf(rr, ff); target = b[to];
            if (!target) out.push(mk(sq, to, null, null, false, null, false));
            else {
              if (colorOf(target) === enemy) out.push(mk(sq, to, target, null, false, null, false));
              break;
            }
            rr += d[0]; ff += d[1];
          }
        }
      }
    }
    return out;
  }

  /* ---------- выполнение хода ---------- */
  function makeMove(s, m) {
    var pc = s.b[m.from];
    var color = colorOf(pc);
    var ns = {
      b: s.b.slice(),
      turn: other(s.turn),
      cr: s.cr,
      ep: -1,
      half: s.half + 1,
      full: s.full + (s.turn === B ? 1 : 0)
    };
    ns.b[m.from] = null;
    ns.b[m.to] = m.promo
      ? (color === W ? m.promo.toUpperCase() : m.promo.toLowerCase())
      : pc;

    if (m.ep) ns.b[color === W ? m.to - 8 : m.to + 8] = null;

    if (m.castle) {
      var home = color === W ? 0 : 7;
      if (m.castle === 'K') {
        ns.b[sqOf(home, 5)] = ns.b[sqOf(home, 7)];
        ns.b[sqOf(home, 7)] = null;
      } else {
        ns.b[sqOf(home, 3)] = ns.b[sqOf(home, 0)];
        ns.b[sqOf(home, 0)] = null;
      }
    }

    /* права на рокировку */
    if (typeOf(pc) === 'k') ns.cr &= color === W ? ~(CR.WK | CR.WQ) : ~(CR.BK | CR.BQ);
    if (typeOf(pc) === 'r') {
      if (m.from === sqOf(0, 0)) ns.cr &= ~CR.WQ;
      if (m.from === sqOf(0, 7)) ns.cr &= ~CR.WK;
      if (m.from === sqOf(7, 0)) ns.cr &= ~CR.BQ;
      if (m.from === sqOf(7, 7)) ns.cr &= ~CR.BK;
    }
    if (m.to === sqOf(0, 0)) ns.cr &= ~CR.WQ;   /* взяли ладью на её поле */
    if (m.to === sqOf(0, 7)) ns.cr &= ~CR.WK;
    if (m.to === sqOf(7, 0)) ns.cr &= ~CR.BQ;
    if (m.to === sqOf(7, 7)) ns.cr &= ~CR.BK;

    if (m.double) ns.ep = color === W ? m.from + 8 : m.from - 8;
    if (typeOf(pc) === 'p' || m.captured) ns.half = 0;
    return ns;
  }

  /* ---------- легальные ходы ---------- */
  function legalMoves(s, onlyFrom) {
    var pseudo = genPseudo(s, s.turn, onlyFrom);
    var out = [];
    for (var i = 0; i < pseudo.length; i++) {
      var m = pseudo[i];
      var ns = makeMove(s, m);
      var k = kingSquare(ns, s.turn);
      if (k >= 0 && !isAttacked(ns, k, other(s.turn))) out.push(m);
    }
    return out;
  }

  function findMove(legal, from, to, promo) {
    for (var i = 0; i < legal.length; i++) {
      var m = legal[i];
      if (m.from === from && m.to === to) {
        if (m.promo) {
          if (promo && m.promo.toLowerCase() === promo.toLowerCase()) return m;
        } else if (!promo) return m;
      }
    }
    return null;
  }

  /* ---------- разбор хода из нотации (SAN) ---------- */
  function normSan(str) {
    return String(str || '').toUpperCase()
      .replace(/0\s*-\s*0\s*-\s*0/g, 'O-O-O')
      .replace(/0\s*-\s*0/g, 'O-O')
      .replace(/[=!?:]+/g, '')
      .replace(/[+#]+/g, '')
      .replace(/\u00d7/g, 'X')
      .replace(/[Xx=\-\s]/g, '');
  }

  /**
   * Находит легальный ход, соответствующий записи SAN ('Nf3', 'exd5', 'O-O', 'e8=Q+'...).
   * Сначала точное сравнение нормализованной записи, затем запасной вариант по полю назначения.
   */
  function moveFromSan(state, san) {
    var legal = legalMoves(state);
    if (!legal.length) return null;
    var target = normSan(san);
    var i, m;
    for (i = 0; i < legal.length; i++) {
      if (normSan(moveToSan(state, legal[i], legal)) === target) return legal[i];
    }
    /* запасной путь: последнее поле в записи — клетка назначения */
    var str = String(san || '').toUpperCase();
    var fields = str.match(/[A-H][1-8]/g);
    if (fields && fields.length) {
      var to = sqFromName(fields[fields.length - 1].toLowerCase());
      var promoM = str.match(/=?([QRBN])[+#]?\s*$/);
      var cands = [];
      for (i = 0; i < legal.length; i++) {
        if (legal[i].to !== to) continue;
        if (promoM && (legal[i].promo || '').toUpperCase() !== promoM[1]) continue;
        if (!promoM && legal[i].promo) continue;
        cands.push(legal[i]);
      }
      if (cands.length === 1) return cands[0];
      /* если кандидатов несколько — уточняем буквой фигуры и клеткой отправления */
      var pieceLetter = str.match(/^([KQRBN])/);
      if (pieceLetter) {
        var want = pieceLetter[1].toLowerCase();
        cands = cands.filter(function (c) {
          var pc = state.b[c.from];
          return pc && typeOf(pc) === want;
        });
        if (cands.length === 1) return cands[0];
      }
      var dis = str.match(/^[KQRBN]?([A-H])?([1-8])?/);
      if (dis && cands.length > 1) {
        cands = cands.filter(function (c) {
          if (dis[1] && FILES[fileOf(c.from)] !== dis[1].toLowerCase()) return false;
          if (dis[2] && String(rankOf(c.from) + 1) !== dis[2]) return false;
          return true;
        });
        if (cands.length === 1) return cands[0];
      }
    }
    return null;
  }

  /* ---------- FEN ---------- */
  function toFen(s) {
    var out = '';
    for (var r = 7; r >= 0; r--) {
      var empty = 0;
      for (var f = 0; f < 8; f++) {
        var pc = s.b[sqOf(r, f)];
        if (!pc) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        out += pc;
      }
      if (empty) out += empty;
      if (r > 0) out += '/';
    }
    var cast = '';
    if (s.cr & CR.WK) cast += 'K';
    if (s.cr & CR.WQ) cast += 'Q';
    if (s.cr & CR.BK) cast += 'k';
    if (s.cr & CR.BQ) cast += 'q';
    return out + ' ' + s.turn + ' ' + (cast || '-') + ' ' +
      (s.ep >= 0 ? nameOf(s.ep) : '-') + ' ' + s.half + ' ' + s.full;
  }

  function fromFen(fen) {
    var parts = String(fen).trim().split(/\s+/);
    var rows = parts[0].split('/');
    var b = new Array(64).fill(null);
    var r = 7;
    for (var i = 0; i < rows.length && r >= 0; i++ , r--) {
      var f = 0;
      for (var j = 0; j < rows[i].length; j++) {
        var ch = rows[i][j];
        if (ch >= '1' && ch <= '8') { f += parseInt(ch, 10); continue; }
        if (f < 8) b[sqOf(r, f)] = ch;
        f++;
      }
    }
    var cr = 0;
    var cs = parts[2] || '-';
    if (cs.indexOf('K') >= 0) cr |= CR.WK;
    if (cs.indexOf('Q') >= 0) cr |= CR.WQ;
    if (cs.indexOf('k') >= 0) cr |= CR.BK;
    if (cs.indexOf('q') >= 0) cr |= CR.BQ;
    var ep = (parts[3] && parts[3] !== '-' && /^[a-h][1-8]$/.test(parts[3])) ? sqFromName(parts[3]) : -1;
    return {
      b: b,
      turn: parts[1] === 'b' ? B : W,
      cr: cr,
      ep: ep,
      half: parseInt(parts[4] || '0', 10) || 0,
      full: parseInt(parts[5] || '1', 10) || 1
    };
  }

  /* ---------- ключ позиции (для повторения) ---------- */
  function positionKey(s, legal) {
    var str = '';
    for (var i = 0; i < 64; i++) str += s.b[i] || '.';
    var cast = '';
    if (s.cr & CR.WK) cast += 'K';
    if (s.cr & CR.WQ) cast += 'Q';
    if (s.cr & CR.BK) cast += 'k';
    if (s.cr & CR.BQ) cast += 'q';
    var epStr = '-';
    if (s.ep >= 0) {
      /* поле взятия на проходе учитываем только если взятие реально возможно */
      if (!legal) epStr = nameOf(s.ep);
      else {
        for (i = 0; i < legal.length; i++) {
          if (legal[i].ep && legal[i].to === s.ep) { epStr = nameOf(s.ep); break; }
        }
      }
    }
    return str + ' ' + s.turn + ' ' + (cast || '-') + ' ' + epStr;
  }

  /* ---------- недостаточно материала ---------- */
  function insufficientMaterial(s) {
    var minors = [];
    for (var i = 0; i < 64; i++) {
      var pc = s.b[i];
      if (!pc) continue;
      var t = typeOf(pc);
      if (t === 'k') continue;
      if (t === 'p' || t === 'r' || t === 'q') return false;
      minors.push({ t: t, sq: i, c: colorOf(pc) });
    }
    if (minors.length === 0) return true;                       /* К vs К */
    if (minors.length === 1) return true;                       /* К+С/К+К против К */
    var allBishops = true, sqColor = null;
    for (i = 0; i < minors.length; i++) {
      if (minors[i].t !== 'b') { allBishops = false; break; }
      var c = squareColor(minors[i].sq);
      if (sqColor === null) sqColor = c;
      else if (sqColor !== c) { allBishops = false; break; }
    }
    return allBishops;   /* одни слоны на одноцветных полях */
  }

  /* ---------- запись хода (SAN) ---------- */
  function moveToSan(s, m, legal) {
    var str;
    if (m.castle === 'K') str = 'O-O';
    else if (m.castle === 'Q') str = 'O-O-O';
    else {
      var pc = s.b[m.from];
      var t = typeOf(pc);
      var to = nameOf(m.to);
      if (t === 'p') {
        str = (m.captured || m.ep) ? (FILES[fileOf(m.from)] + 'x' + to) : to;
        if (m.promo) str += '=' + m.promo.toUpperCase();
      } else {
        var ambiguous = false, sameFile = false, sameRank = false;
        var list = legal || legalMoves(s);
        for (var i = 0; i < list.length; i++) {
          var o = list[i];
          if (o.from === m.from || o.to !== m.to) continue;
          var opc = s.b[o.from];
          if (!opc || opc !== pc) continue;
          ambiguous = true;
          if (fileOf(o.from) === fileOf(m.from)) sameFile = true;
          if (rankOf(o.from) === rankOf(m.from)) sameRank = true;
        }
        var dis = '';
        if (ambiguous) {
          if (!sameFile) dis = FILES[fileOf(m.from)];
          else if (!sameRank) dis = String(rankOf(m.from) + 1);
          else dis = nameOf(m.from);
        }
        str = t.toUpperCase() + dis + (m.captured ? 'x' : '') + to;
      }
    }
    var ns = makeMove(s, m);
    if (inCheck(ns, ns.turn)) {
      str += legalMoves(ns).length === 0 ? '#' : '+';
    }
    return str;
  }

  /* ---------- статус партии ---------- */
  var REASON = {
    checkmate: { text: 'Мат', draw: false },
    stalemate: { text: 'Пат', draw: true },
    fifty: { text: 'Ничья: правило 50 ходов', draw: true },
    threefold: { text: 'Ничья: троекратное повторение позиции', draw: true },
    material: { text: 'Ничья: недостаточно материала', draw: true },
    agreement: { text: 'Ничья по соглашению сторон', draw: true },
    resign: { text: 'Партия сдана', draw: false },
    timeout: { text: 'Просрочка времени', draw: false }
  };

  function repetitionCount(keys, key) {
    var c = 0;
    for (var i = 0; i < keys.length; i++) if (keys[i] === key) c++;
    return c;
  }

  /**
   * Полная диагностика позиции.
   * keys — массив ключей всех позиций партии ВКЛЮЧАЯ текущую (для повторения).
   */
  function status(s, keys, legal) {
    var moves = legal || legalMoves(s);
    var check = inCheck(s, s.turn);
    var res = {
      over: false, reason: null, winner: null, result: null,
      check: check, legalMoves: moves, text: null, draw: false
    };
    if (moves.length === 0) {
      if (check) {
        res.over = true; res.reason = 'checkmate';
        res.winner = other(s.turn);
        res.result = s.turn === W ? '0-1' : '1-0';
        res.text = REASON.checkmate.text;
      } else {
        res.over = true; res.reason = 'stalemate';
        res.result = '1/2-1/2'; res.draw = true;
        res.text = REASON.stalemate.text;
      }
      return res;
    }
    if (insufficientMaterial(s)) {
      res.over = true; res.reason = 'material'; res.result = '1/2-1/2';
      res.draw = true; res.text = REASON.material.text; return res;
    }
    if (s.half >= 100) {
      res.over = true; res.reason = 'fifty'; res.result = '1/2-1/2';
      res.draw = true; res.text = REASON.fifty.text; return res;
    }
    if (keys && keys.length) {
      if (repetitionCount(keys, positionKey(s, moves)) >= 3) {
        res.over = true; res.reason = 'threefold'; res.result = '1/2-1/2';
        res.draw = true; res.text = REASON.threefold.text; return res;
      }
    }
    return res;
  }

  function endBy(reason, winnerColor) {
    var r = REASON[reason] || { text: reason, draw: false };
    return {
      over: true, reason: reason, winner: winnerColor || null, draw: !!r.draw,
      text: r.text,
      result: r.draw ? '1/2-1/2' : (winnerColor === W ? '1-0' : '0-1')
    };
  }

  /* ---------- perft (для тестов) ---------- */
  function perft(s, depth) {
    if (depth === 0) return 1;
    var moves = legalMoves(s);
    if (depth === 1) return moves.length;
    var n = 0;
    for (var i = 0; i < moves.length; i++) n += perft(makeMove(s, moves[i]), depth - 1);
    return n;
  }

  /* ---------- список фигур (для «взятых» фигур) ---------- */
  function piecesOf(s, color) {
    var out = [];
    for (var i = 0; i < 64; i++) {
      var pc = s.b[i];
      if (pc && colorOf(pc) === color) out.push(pc);
    }
    return out;
  }

  var VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  function materialBalance(s) {   /* >0 — перевес белых */
    var w = 0, b = 0;
    for (var i = 0; i < 64; i++) {
      var pc = s.b[i];
      if (!pc) continue;
      if (colorOf(pc) === W) w += VALUES[typeOf(pc)]; else b += VALUES[typeOf(pc)];
    }
    return w - b;
  }

  return {
    W: W, B: B, CR: CR, FILES: FILES,
    startState: startState, cloneState: cloneState, makeMove: makeMove,
    legalMoves: legalMoves, genPseudo: genPseudo, isAttacked: isAttacked,
    inCheck: inCheck, kingSquare: kingSquare, findMove: findMove,
    moveToSan: moveToSan, moveFromSan: moveFromSan, normSan: normSan, toFen: toFen, fromFen: fromFen, positionKey: positionKey,
    insufficientMaterial: insufficientMaterial, status: status, endBy: endBy,
    perft: perft, piecesOf: piecesOf, materialBalance: materialBalance,
    rankOf: rankOf, fileOf: fileOf, sqOf: sqOf, nameOf: nameOf, sqFromName: sqFromName,
    colorOf: colorOf, typeOf: typeOf, other: other, squareColor: squareColor,
    REASON: REASON
  };
});
