/* =========================================================================
   Интерфейс: доска, игра за обе стороны, объявления шаха/мата/пата/ничьих,
   стрелки, архив партий, профили соперников, импорт и экспорт PGN.
   ========================================================================= */
(function () {
  'use strict';

  /* версия прошивается сборщиком из version.json */
  var APP_VERSION = '/*@APPVERSION@*/';
  var BUILD_STAMP = '/*@BUILD@*/';

  var C = window.Chess;
  var Bot = window.ChessBot;
  var S = window.Store;
  var P = window.Platform;
  var E = window.Engines;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ============================ СОСТОЯНИЕ ============================ */
  var G = {
    startFen: null,
    states: [], keys: [], sans: [], moves: [],
    view: 0, flipped: false, autoFlip: false,
    mode: 'hotseat', level: 'medium', sound: true, volume: 0.75,
    marks: [],
    result: null,
    selected: null, targets: [],
    thinking: false, gen: 0,
    tab: 'moves',
    openEngine: null,     /* раскрытая карточка движка */
    workerSource: null,   /* JS-обвязка потока для внешнего движка */
    savedId: null,          /* id записи в архиве, если текущая партия сохранена */
    playback: null,         /* просмотр партии из архива */
    live: null,             /* снимок живой партии на время просмотра */
    openPlayer: null,       /* открытый профиль */
    modal: null, pendingPromo: null
  };

  var PIECE_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  var PIECE_RU = { k: 'король', q: 'ферзь', r: 'ладья', b: 'слон', n: 'конь', p: 'пешка' };
  var PIECE_ORDER = { q: 0, r: 1, b: 2, n: 3, p: 4, k: 5 };
  var LEVEL_RU = { easy: 'лёгкий', medium: 'средний', hard: 'сильный' };

  function cur() {
    var i = Math.min(G.view, G.states.length - 1);
    if (i !== G.view) G.view = i < 0 ? 0 : i;
    return G.states[G.view];
  }
  function latest() { return G.states[G.states.length - 1]; }
  function lastIdx() { return G.states.length - 1; }
  function atLatest() { return G.view === lastIdx(); }
  function botColor() { return G.mode === 'bot-w' ? 'w' : (G.mode === 'bot-b' ? 'b' : null); }
  function isBotTurn() {
    var bc = botColor();
    return bc !== null && !G.result && atLatest() && cur().turn === bc;
  }
  function canPlay() {
    return !G.playback && !G.result && atLatest() && !G.thinking && !isBotTurn();
  }

  function nom(c) { return c === 'w' ? 'Белые' : 'Чёрные'; }
  function nomLow(c) { return c === 'w' ? 'белые' : 'чёрные'; }
  function gen(c) { return c === 'w' ? 'белых' : 'чёрных'; }
  function dat(c) { return c === 'w' ? 'белым' : 'чёрным'; }

  /* имена игроков для архива и статистики */
  function botName() { return 'Компьютер (' + (LEVEL_RU[G.level] || 'средний') + ')'; }
  function nameFor(color) {
    if (botColor() === color) return botName();
    var n = color === 'w' ? S.settings().meWhite : S.settings().meBlack;
    n = (n || '').trim();
    return n || null;                     /* null = аноним */
  }
  function showName(n) { return S.isAnon(n) ? 'Аноним' : n; }

  /* ============================ ЗВУК ============================ */
  var actx = null;
  function tone(freq, dur, type, gain, when) {
    if (!G.sound || G.volume <= 0) return;
    gain = (gain === undefined ? 0.05 : gain) * G.volume;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = actx || new AC();
      if (actx.state === 'suspended') actx.resume();
      var t0 = actx.currentTime + (when || 0);
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(t0); o.stop(t0 + dur + 0.03);
    } catch (e) { /* звук не обязателен */ }
  }
  function sfx(kind) {
    if (kind === 'move') tone(330, 0.09, 'triangle', 0.5);
    else if (kind === 'capture') { tone(190, 0.11, 'square', 0.42); tone(128, 0.14, 'sine', 0.5, 0.02); }
    else if (kind === 'castle') { tone(300, 0.08, 'triangle', 0.45); tone(420, 0.1, 'triangle', 0.45, 0.07); }
    else if (kind === 'promo') { tone(660, 0.1, 'sine', 0.5); tone(880, 0.11, 'triangle', 0.5, 0.09); tone(1320, 0.15, 'sine', 0.45, 0.18); }
    else if (kind === 'check') { tone(880, 0.11, 'sine', 0.6); tone(1175, 0.14, 'sine', 0.55, 0.09); }
    else if (kind === 'win') { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.24, 'triangle', 0.5, i * 0.1); }); }
    else if (kind === 'lose') { [440, 349, 294, 220].forEach(function (f, i) { tone(f, 0.28, 'sine', 0.5, i * 0.12); }); }
    else if (kind === 'draw') { [440, 440, 330].forEach(function (f, i) { tone(f, 0.22, 'sine', 0.45, i * 0.13); }); }
    else if (kind === 'no') tone(120, 0.14, 'sawtooth', 0.4);
    else if (kind === 'click') tone(500, 0.045, 'sine', 0.3);
    else if (kind === 'mark') tone(700, 0.05, 'sine', 0.28);
    else if (kind === 'save') { tone(660, 0.09, 'sine', 0.4); tone(990, 0.13, 'triangle', 0.38, 0.08); }
  }

  /* ============================ ФИГУРЫ (SVG) ============================ */
  function pieceHTML(pc, cls) {
    if (!pc) return '';
    var id = 'pc-' + (pc === pc.toUpperCase() ? 'w' : 'b') + pc.toUpperCase();
    return '<svg viewBox="0 0 45 45" class="' + (cls || 'pc') + '" aria-hidden="true"><use href="#' + id + '"/></svg>';
  }

  /* ============================ ДОСКА ============================ */
  var boardEl, cellEls = {}, drag = null, builtFlipped = null;

  function displayToSq(drow, dcol) {
    var r = G.flipped ? drow : 7 - drow;
    var f = G.flipped ? 7 - dcol : dcol;
    return r * 8 + f;
  }
  function dispOf(sq) {
    var r = C.rankOf(sq), f = C.fileOf(sq);
    return { r: G.flipped ? r : 7 - r, c: G.flipped ? 7 - f : f };
  }
  function centerOf(sq) { var p = dispOf(sq); return { x: p.c + 0.5, y: p.r + 0.5 }; }
  function n3(v) { return Math.round(v * 1000) / 1000; }

  function buildBoard() {
    boardEl.innerHTML = '';
    cellEls = {};
    for (var drow = 0; drow < 8; drow++) {
      for (var dcol = 0; dcol < 8; dcol++) {
        var sq = displayToSq(drow, dcol);
        var r = C.rankOf(sq), f = C.fileOf(sq);
        var d = document.createElement('div');
        d.className = 'sq ' + (((r + f) % 2 === 0) ? 'dark' : 'light');
        d.dataset.sq = String(sq);
        if (dcol === 0) {
          var rk = document.createElement('span');
          rk.className = 'crd rank'; rk.textContent = String(r + 1);
          d.appendChild(rk);
        }
        if (drow === 7) {
          var fl = document.createElement('span');
          fl.className = 'crd file'; fl.textContent = C.FILES[f];
          d.appendChild(fl);
        }
        var wrap = document.createElement('div');
        wrap.className = 'pcwrap';
        d.appendChild(wrap);
        boardEl.appendChild(d);
        cellEls[sq] = { el: d, wrap: wrap, pc: undefined };
      }
    }
    builtFlipped = G.flipped;
  }

  function renderBoard() {
    var s = cur();
    var last = G.view > 0 ? G.moves[G.view - 1] : null;
    var checked = C.inCheck(s, s.turn) ? C.kingSquare(s, s.turn) : -1;
    var targetSet = {};
    for (var i = 0; i < G.targets.length; i++) {
      var t = G.targets[i];
      targetSet[t.to] = (targetSet[t.to] || 0) | (t.captured || t.ep ? 2 : 1);
    }
    for (var sq = 0; sq < 64; sq++) {
      var cell = cellEls[sq];
      if (!cell) continue;
      var pc = s.b[sq];
      if (cell.pc !== pc) { cell.wrap.innerHTML = pieceHTML(pc); cell.pc = pc; }
      var cl = 'sq ' + ((C.squareColor(sq) === 'dark') ? 'dark' : 'light');
      if (last && (last.from === sq || last.to === sq)) cl += ' last';
      if (G.selected === sq) cl += ' sel';
      if (targetSet[sq]) cl += (targetSet[sq] & 2) ? ' cap-target target' : ' target';
      if (sq === checked) cl += ' check';
      if (drag && drag.from === sq) cl += ' drag-src';
      cell.el.className = cl;
      cell.el.title = pc
        ? (C.nameOf(sq) + ' · ' + (C.colorOf(pc) === 'w' ? 'белая ' : 'чёрная ') + PIECE_RU[C.typeOf(pc)])
        : C.nameOf(sq);
    }
    boardEl.classList.toggle('locked', !canPlay());
  }

  /* ============================ СТРЕЛКИ ПРАВОЙ КНОПКОЙ ============================ */
  var ARROW_COLORS = ['#3aa0ff', '#ffb02e', '#ff5f5f', '#57d97a'];
  var markDrag = null;

  function markSVG(m) {
    if (!m) return '';
    var color = ARROW_COLORS[(m.color || 0) % ARROW_COLORS.length];
    var a = centerOf(m.from);
    if (m.type === 'circle' || m.from === m.to) {
      return '<circle cx="' + n3(a.x) + '" cy="' + n3(a.y) + '" r="0.42" fill="none" ' +
        'stroke="' + color + '" stroke-width="0.11" opacity="0.9"/>';
    }
    var b = centerOf(m.to);
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.05) return '';
    var ux = dx / len, uy = dy / len;
    var head = Math.min(0.5, len * 0.45), half = 0.25;
    var tx = b.x - ux * 0.05, ty = b.y - uy * 0.05;
    var bx = tx - ux * head, by = ty - uy * head;
    var sx = a.x + ux * 0.1, sy = a.y + uy * 0.1;
    var px = -uy * half, py = ux * half;
    return '<line x1="' + n3(sx) + '" y1="' + n3(sy) + '" x2="' + n3(bx) + '" y2="' + n3(by) +
      '" stroke="' + color + '" stroke-width="0.14" stroke-linecap="round" opacity="0.9"/>' +
      '<polygon points="' + n3(tx) + ',' + n3(ty) + ' ' + n3(bx + px) + ',' + n3(by + py) + ' ' +
      n3(bx - px) + ',' + n3(by - py) + '" fill="' + color + '" opacity="0.9"/>';
  }
  function renderMarks(preview) {
    var layer = $('arrowLayer');
    if (!layer) return;
    var html = '';
    for (var i = 0; i < G.marks.length; i++) html += markSVG(G.marks[i]);
    if (preview) html += markSVG(preview);
    layer.innerHTML = html;
    var mb = document.querySelector('#toolbar button[data-act="marks"]');
    if (mb) mb.disabled = G.marks.length === 0;
  }
  function clearMarks(quiet) {
    endMarkDrag();
    if (!G.marks.length) { renderMarks(); return; }
    G.marks = [];
    renderMarks(); save();
    if (!quiet) { sfx('click'); toast('СТРЕЛКИ СТЁРТЫ', 'info', ''); }
  }
  function toggleMark(m) {
    for (var i = 0; i < G.marks.length; i++) {
      var x = G.marks[i];
      if (x.type === m.type && x.from === m.from && (m.type === 'circle' || x.to === m.to)) {
        G.marks.splice(i, 1); return;
      }
    }
    m.color = G.marks.length % ARROW_COLORS.length;
    G.marks.push(m);
  }
  function startMarkDrag(e, sq) {
    endMarkDrag();
    if (e.preventDefault) e.preventDefault();
    markDrag = { from: sq, x: e.clientX || 0, y: e.clientY || 0, moved: false };
    window.addEventListener('pointermove', onMarkMove);
    window.addEventListener('pointerup', onMarkUp);
    window.addEventListener('pointercancel', onMarkUp);
    window.addEventListener('mousemove', onMarkMove);
    window.addEventListener('mouseup', onMarkUp);
  }
  function endMarkDrag() {
    if (!markDrag) return;
    markDrag = null;
    window.removeEventListener('pointermove', onMarkMove);
    window.removeEventListener('pointerup', onMarkUp);
    window.removeEventListener('pointercancel', onMarkUp);
    window.removeEventListener('mousemove', onMarkMove);
    window.removeEventListener('mouseup', onMarkUp);
    renderMarks();
  }
  function onMarkMove(e) {
    if (!markDrag) return;
    var x = e.clientX || 0, y = e.clientY || 0;
    if (Math.abs(x - markDrag.x) > 6 || Math.abs(y - markDrag.y) > 6) markDrag.moved = true;
    var to = sqFromPoint(x, y);
    if (to < 0) to = markDrag.from;
    renderMarks(markDrag.moved ? { type: 'arrow', from: markDrag.from, to: to, color: G.marks.length % ARROW_COLORS.length } : null);
  }
  function onMarkUp(e) {
    var d = markDrag;
    var to = sqFromPoint(e.clientX || 0, e.clientY || 0);
    endMarkDrag();
    if (!d) return;
    if (!d.moved || to < 0 || to === d.from) {
      /* правый клик без перетаскивания или внутри одной клетки — круг-пометка */
      toggleMark({ type: 'circle', from: d.from, to: d.from });
      sfx('mark');
      renderMarks(); save();
      return;
    }
    toggleMark(to === d.from ? { type: 'circle', from: d.from, to: d.from } : { type: 'arrow', from: d.from, to: to });
    sfx('mark');
    renderMarks(); save();
  }

  /* ============================ ВЗЯТЫЕ ФИГУРЫ ============================ */
  function capturedUpTo(viewIdx) {
    var cap = { w: [], b: [] };
    for (var i = 0; i < viewIdx; i++) {
      var m = G.moves[i];
      if (m.captured) cap[C.colorOf(m.captured)].push(m.captured);
    }
    return cap;
  }
  function val(list) {
    var v = 0;
    for (var i = 0; i < list.length; i++) v += PIECE_VAL[C.typeOf(list[i])];
    return v;
  }
  function renderCaps() {
    drawCapRow($('capTop'), G.flipped ? 'w' : 'b');
    drawCapRow($('capBottom'), G.flipped ? 'b' : 'w');
  }
  function drawCapRow(el, side) {
    var cap = capturedUpTo(G.view);
    var taken = cap[C.other(side)];
    /* перевес считаем по фактической расстановке на доске: превращение пешки
       сразу добавляет материал стороне, а потеря фигуры — снимает, независимо
       от того, была ли фигура «настоящей» или превращённой */
    var balance = C.materialBalance(cur());
    var diff = side === 'w' ? balance : -balance;
    taken.sort(function (a, b) { return PIECE_ORDER[C.typeOf(a)] - PIECE_ORDER[C.typeOf(b)]; });
    var isTurn = !G.result && cur().turn === side;
    var sideName = nameFor(side) || nom(side);   /* без имени — просто «Белые»/«Чёрные» */
    var html = '<span class="who"><span class="dot"></span>' + esc(sideName) + '</span><span class="pcs">';
    /* взятые фигуры показываем серыми силуэтами без подложек */
    for (var i = 0; i < taken.length; i++) {
      var cc = C.colorOf(taken[i]) === 'w' ? 'cw' : 'cb';
      html += '<span class="chip ' + cc + '" title="Взята: ' + PIECE_RU[C.typeOf(taken[i])] + '">' + pieceHTML(taken[i], 'cap') + '</span>';
    }
    html += '</span>' +
      (diff > 0 ? '<span class="adv" title="Перевес в материале по фактической расстановке">+' + diff + ' по материалу</span>' : '');
    el.innerHTML = html;
    el.className = 'cap-row' + (isTurn ? ' turn-here' : '');
  }

  /* ============================ ОБЪЯВЛЕНИЯ ============================ */
  function reasonInfo(res, state) {
    var s = state || cur();
    var loser = res.winner ? C.other(res.winner) : s.turn;
    switch (res.reason) {
      case 'checkmate': return {
        kind: 'mate',
        big: 'МАТ · ' + nom(res.winner) + ' победили',
        small: nom(loser) + ' получили мат: король под шахом, а ходов, чтобы спастись, нет. Результат ' + res.result + '.',
        toast: 'МАТ', toastSub: nom(res.winner) + ' победили · ' + res.result,
        log: '<b>МАТ!</b> Победили ' + nomLow(res.winner) + ' · ' + res.result
      };
      case 'stalemate': return {
        kind: 'draw',
        big: 'ПАТ · ничья',
        small: 'У ' + gen(loser) + ' нет ни одного легального хода, но их король не находится под шахом. Результат 1/2-1/2.',
        toast: 'ПАТ', toastSub: 'Ничья · 1/2-1/2',
        log: '<b>Пат.</b> Ничья — у ' + gen(loser) + ' нет ходов, шах не объявлен'
      };
      case 'fifty': return {
        kind: 'draw',
        big: 'НИЧЬЯ · правило 50 ходов',
        small: 'За 50 ходов каждой стороны подряд не было взято ни одной фигуры и ни одна пешка не сходила. Результат 1/2-1/2.',
        toast: 'НИЧЬЯ', toastSub: 'Правило 50 ходов',
        log: '<b>Ничья:</b> правило 50 ходов'
      };
      case 'threefold': return {
        kind: 'draw',
        big: 'НИЧЬЯ · повторение позиции',
        small: 'Одна и та же позиция возникла в третий раз — с той же очередностью хода, теми же правами на рокировку и возможностью взятия на проходе. Результат 1/2-1/2.',
        toast: 'НИЧЬЯ', toastSub: 'Троекратное повторение позиции',
        log: '<b>Ничья:</b> троекратное повторение позиции'
      };
      case 'material': return {
        kind: 'draw',
        big: 'НИЧЬЯ · недостаточно материала',
        small: 'Оставшимися фигурами поставить мат невозможно (король против короля, король с одним слоном или конём, одноцветные слоны). Результат 1/2-1/2.',
        toast: 'НИЧЬЯ', toastSub: 'Недостаточно материала',
        log: '<b>Ничья:</b> недостаточно материала для мата'
      };
      case 'agreement': return {
        kind: 'draw',
        big: 'НИЧЬЯ по соглашению',
        small: 'Стороны согласились на ничью. Результат 1/2-1/2.',
        toast: 'НИЧЬЯ', toastSub: 'По соглашению сторон',
        log: '<b>Ничья</b> по соглашению сторон'
      };
      case 'resign': return {
        kind: 'mate',
        big: nom(loser) + ' сдались',
        small: 'Победили ' + nomLow(res.winner) + '. Результат ' + res.result + '.',
        toast: nom(loser) + ' сдались', toastSub: 'Победили ' + nomLow(res.winner),
        log: '<b>' + nom(loser) + ' сдались.</b> Победили ' + nomLow(res.winner)
      };
      default: return {
        kind: res.draw ? 'draw' : 'mate',
        big: res.text || 'Партия окончена',
        small: (res.text ? res.text + '. ' : '') + 'Результат ' + (res.result || '—') + '.',
        toast: res.text || 'Партия окончена', toastSub: res.result || '',
        log: '<b>' + esc(res.text || 'Партия окончена') + '</b>' + (res.result ? ' · ' + res.result : '')
      };
    }
  }

  function renderStatus() {
    var card = $('statusCard'), s = cur();
    var bigEl = $('statusBig'), smallEl = $('statusSmall'), turnEl = $('statusTurn');
    card.className = 'moves-status';
    var head = $('headStatus');
    $('resultTag').textContent = G.result ? G.result.result : '—';
    $('turnSwatch').className = 'swatch ' + s.turn;
    $('turnSwatch').title = 'Сейчас ход: ' + nomLow(s.turn);

    var turnHTML = '№' + s.full;
    if (G.playback) turnHTML += ' · <b style="color:#c0aef5">архив</b>';
    else if (!atLatest()) turnHTML += ' · <b style="color:#f2c14e">просмотр истории</b>';
    else if (botColor() === s.turn) turnHTML += ' · бот';
    turnEl.innerHTML = turnHTML;

    if (G.thinking) {
      head.className = 'head-status';
      head.textContent = 'Компьютер думает…';
      bigEl.textContent = 'Компьютер думает…';
      smallEl.innerHTML = '<span class="thinking"><span class="spin"></span>считает варианты</span>';
      return;
    }
    if (G.result && atLatest()) {
      var info = reasonInfo(G.result, G.playback ? s : null);
      card.classList.add(info.kind);
      head.className = 'head-status ' + info.kind;
      head.textContent = info.big;
      bigEl.textContent = info.big;
      smallEl.innerHTML = G.playback
        ? 'Партия из архива. ' + esc(info.small)
        : esc(info.small) + (G.savedId
          ? ' <span style="color:#98a1c4">Партия сохранена в архив.</span>'
          : ' <button class="link-btn" id="lnkArchive">Сохранить в архив</button>');
      if (!G.playback && !G.savedId) {
        var lb = $('lnkArchive');
        if (lb) lb.onclick = function () { openPanel('archive'); };
      }
      return;
    }
    if (G.result && !atLatest()) {
      var hist0 = C.status(s, null, null);
      if (hist0.check) card.classList.add('check');
      bigEl.textContent = hist0.check ? 'ШАХ!' : 'Ход ' + gen(s.turn);
      smallEl.textContent = (G.playback ? 'Просмотр партии из архива' : 'Просмотр партии') +
        ': полуход ' + G.view + ' из ' + lastIdx() +
        '. Итог: ' + (G.result.text || '') + ' (' + G.result.result + ').';
      return;
    }
    var st = C.status(s, null, null);
    if (st.check) {
      card.classList.add('check');
      head.className = 'head-status check';
      head.textContent = 'ШАХ! ' + nom(s.turn === 'w' ? 'b' : 'w') + ' под боем';
      bigEl.textContent = 'ШАХ!';
      smallEl.textContent = 'Король ' + gen(s.turn) + ' под боем: нужно уйти из-под шаха, закрыться фигурой или взять атакующую фигуру. Доступно ходов: ' + st.legalMoves.length + '.';
    } else {
      head.className = 'head-status';
      head.textContent = 'Ход ' + gen(s.turn) + (G.playback ? ' · архив' : (!atLatest() ? ' · история' : ''));
      bigEl.textContent = 'Ход ' + gen(s.turn);
      smallEl.textContent = 'Доступных ходов: ' + st.legalMoves.length +
        (botColor() === s.turn ? ' · играет компьютер' : ' · играйте за обе стороны на одной доске');
    }
  }

  /* ============================ ЖУРНАЛ СОБЫТИЙ ============================ */
  var LOG_ICONS = { check: '\u26a1', mate: '\u{1F451}', draw: '\u00bd', arch: '\u{1F5C2}', info: '\u2022' };
  function addLog(text, kind) {
    S.pushLog(text, kind || 'info');
  }
  function renderEvents() {
    var el = $('logAll');
    var logs = S.logs();
    $('logCount').textContent = 'Записей: ' + logs.length + (logs.length >= S.LOG_CAP ? ' (журнал ограничен ' + S.LOG_CAP + ' записями)' : '');
    var badge = $('evBadge');
    badge.textContent = String(logs.length);
    badge.hidden = logs.length === 0;
    if (!logs.length) {
      el.innerHTML = '<div class="log-item info"><span class="ic">\u2022</span>Событий пока нет</div>';
      return;
    }
    var html = '';
    for (var i = logs.length - 1; i >= 0; i--) {
      var it = logs[i];
      html += '<div class="log-item ' + esc(it.kind) + '"><span class="ic">' + (LOG_ICONS[it.kind] || '\u2022') +
        '</span><span>' + it.text + '</span><span class="tm">' + esc(it.t) + '</span></div>';
    }
    el.innerHTML = html;
  }

  /* ============================ ЗАПИСЬ ПАРТИИ ============================ */
  function renderMoves() {
    var el = $('moves');
    if (!G.sans.length) {
      el.innerHTML = '<div class="moves-empty">Ходов пока нет.<br>Нажмите на фигуру и сделайте ход — играть можно за обе стороны.</div>';
    } else {
      var html = '';
      for (var i = 0; i < G.sans.length; i += 2) {
        html += '<div class="mv-row"><div class="mv-no" data-view="' + i + '" title="Показать позицию перед этим ходом">' +
          (i / 2 + 1) + '.</div>' + mvCell(i) + mvCell(i + 1) + '</div>';
      }
      el.innerHTML = html;
      var c = el.querySelector('.mv.cur');
      try { if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest' }); else el.scrollTop = el.scrollHeight; }
      catch (e) { el.scrollTop = el.scrollHeight; }
    }
    $('moveCount').textContent = 'Ходов: ' + G.sans.length + (G.playback ? ' (архив)' : '');
  }
  function mvCell(i) {
    if (i >= G.sans.length) return '<div class="mv empty"></div>';
    var san = G.sans[i];
    var cls = 'mv';
    if (G.view === i + 1) cls += ' cur';
    if (san.indexOf('+') >= 0 || san.indexOf('#') >= 0) cls += ' san-check';
    return '<div class="' + cls + '" data-view="' + (i + 1) + '">' + esc(san) + '</div>';
  }

  function pgnFor(entry) {
    var st = entry || {};
    var white = showName(st.white === undefined ? nameFor('w') : st.white);
    var black = showName(st.black === undefined ? nameFor('b') : st.black);
    var res = st.result || (G.result ? G.result.result : '*');
    var date = (st.date || S.stamp()).replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$1.$2.$3');
    var sans = st.sans || G.sans;
    var startFen = st.startFen !== undefined ? st.startFen : G.startFen;
    var head = '[Event "' + esc(st.title || 'Партия в браузере') + '"]\n[Site "Локально"]\n[Date "' + date + '"]\n' +
      '[Round "-"]\n[White "' + esc(white) + '"]\n[Black "' + esc(black) + '"]\n[Result "' + res + '"]\n' +
      (startFen ? '[SetUp "1"]\n[FEN "' + startFen + '"]\n' : '') +
      (st.reasonText ? '[Termination "' + esc(st.reasonText) + '"]\n' : '') + '\n';
    var body = '', line = '';
    for (var i = 0; i < sans.length; i++) {
      if (i % 2 === 0) line += (i / 2 + 1) + '. ';
      line += sans[i] + ' ';
      if (line.length > 74) { body += line.trim() + '\n'; line = ''; }
    }
    line += res;
    return head + body + line.trim() + '\n';
  }

  /* ============================ ДВИЖКИ ============================ */
  var engineLog = [];
  function pushEngineLog(line) {
    engineLog.push(line);
    if (engineLog.length > 120) engineLog.shift();
    var el = $('uciLog');
    if (el) { el.textContent = engineLog.join('\n'); el.scrollTop = el.scrollHeight; }
  }

  function renderEngineTab() {
    var list = $('engineList');
    var st = E.status();
    var html = '';
    E.list().forEach(function (d) {
      var active = st.active === d.id;
      var ready = d.kind === 'js' ? true : E.isInstalled(d.id);
      var badge = ready
        ? '<span class="ec-badge ok">' + (active ? 'активен' : 'доступен') + '</span>'
        : '<span class="ec-badge no">не установлен</span>';
      var meta = d.kind === 'js'
        ? ('Сила: ' + d.strength)
        : (E.isInstalled(d.id)
          ? ('Установлен: ' + esc(E.installedInfo(d.id).name) + ', ' + S.sizeLabel(E.installedInfo(d.id).size) +
             ', ' + esc(E.installedInfo(d.id).added.slice(0, 10)) + ' · сила: ' + d.strength)
          : 'Сила: ' + d.strength + ' · нужен файл сборки');
      html += '<div class="engine-card' + (active ? ' on' : '') + '" data-engine="' + d.id + '">' +
        '<div class="ec-top"><span class="ec-name">' + esc(d.name) + '</span>' + badge + '</div>' +
        '<div class="ec-meta">' + meta + '</div>' +
        '<div class="ec-actions">' +
        (active ? '' : '<button class="btn btn-mini" data-ea="use" data-e="' + d.id + '"' +
          (ready ? '' : ' disabled') + '>Сделать активным</button>') +
        '<button class="btn btn-mini" data-ea="about" data-e="' + d.id + '">Подробнее</button>' +
        (d.kind === 'js' ? '<span class="hint" style="align-self:center">работает сразу, ничего не скачивая</span>' : '') +
        '</div></div>';
    });
    list.innerHTML = html;

    var det = $('engineDetail');
    if (G.openEngine) {
      var d2 = E.byId(G.openEngine);
      if (d2) {
        det.innerHTML = '<h4>' + esc(d2.name) + '</h4><div class="hint">' + esc(d2.about) + '</div>' +
          (d2.homepage ? '<div class="hint" style="margin-top:6px">Домашняя страница: ' + esc(d2.homepage) + '</div>' : '') +
          renderEngineOptions(d2) +
          '<div class="lbl" style="margin-top:11px">Журнал UCI</div>' +
          '<div class="ec-log" id="uciLog">' + esc(engineLog.join('\n') || '— пусто —') + '</div>';
        bindEngineOptions(d2);
      } else det.innerHTML = '';
    } else {
      det.innerHTML = '<div class="hint" style="margin-top:8px">Нажмите «Подробнее», чтобы настроить параметры движка ' +
        'и посмотреть журнал UCI.</div>';
    }

    /* блок Rodent IV */
    var r = E.byId('rodent4');
    var installed = E.isInstalled('rodent4');
    $('rodentInfo').innerHTML = installed
      ? ('Установлен: <b>' + esc(E.installedInfo('rodent4').name) + '</b> · ' +
         S.sizeLabel(E.installedInfo('rodent4').size) + ' · добавлен ' +
         esc(E.installedInfo('rodent4').added.slice(0, 16).replace('T', ' ')) +
         '<br>Хранится в ' + esc(E.installedInfo('rodent4').storage) + ' — место архива партий не расходуется.' +
         (st.active === 'rodent4' ? '<br><b>Сейчас компьютер играет этим движком.</b>' : ''))
      : ('Не установлен. Место подготовлено: каталог движков, UCI-транспорт в Web Worker, ' +
         'настройка силы через DepthLimit/NodeLimit/MoveTime/MultiPV и пресеты под уровни «Лёгкий/Средний/Сильный». ' +
         'Осталось добавить саму сборку.');
    $('btnRodentUse').disabled = !installed;
    $('btnRodentTest').disabled = !installed;
    $('btnRodentDel').disabled = !installed;
    var nativeOk = P.nativeEngineAvailable();
    $('btnRodentExe').disabled = !nativeOk;
    $('btnRodentExe').setAttribute('data-tip', nativeOk
      ? 'Выбрать исполняемый файл Rodent IV и запустить его отдельным процессом'
      : 'Доступно только в десктоп-версии (Electron/Tauri): в браузере добавьте WASM-сборку');
    $('rodentHelp').innerHTML = RODENT_HELP;
  }

  function renderEngineOptions(d) {
    if (d.kind !== 'uci') {
      return '<div class="lbl" style="margin-top:11px">Уровень</div>' +
        '<select class="sel" id="builtinLevel" style="width:100%">' +
        d.levels.map(function (l) {
          return '<option value="' + l.id + '"' + (G.level === l.id ? ' selected' : '') + '>' +
            esc(l.label) + ' (глубина ' + l.depth + ')</option>';
        }).join('') + '</select>';
    }
    var o = E.getOptions(d.id);
    var html = '<div class="lbl" style="margin-top:11px">Параметры UCI</div>';
    d.uciOptions.forEach(function (op) {
      var v = o[op.name] !== undefined ? o[op.name] : '';
      html += '<div class="opt-row"><label for="opt_' + op.name + '">' + esc(op.label) +
        ' <span style="color:#6c769c">(' + op.name + ')</span></label>' +
        '<input id="opt_' + op.name + '" data-opt="' + op.name + '" value="' + esc(v) + '" ' +
        (op.type === 'spin' ? 'type="number"' : 'type="text"') + '></div>';
    });
    html += '<div class="row" style="gap:6px;margin-top:6px">' +
      Object.keys(d.presets).map(function (p) {
        return '<button class="btn btn-mini" data-preset="' + p + '">Пресет: ' + esc(p) + '</button>';
      }).join('') + '</div>';
    return html;
  }
  function bindEngineOptions(d) {
    var sel = $('builtinLevel');
    if (sel) sel.onchange = function () {
      G.level = sel.value;
      S.setSetting('level', G.level);
      renderGameTab(); save();
    };
    document.querySelectorAll('#engineDetail [data-opt]').forEach(function (inp) {
      inp.onchange = function () {
        var v = inp.type === 'number' ? parseInt(inp.value, 10) : inp.value;
        E.setOption(d.id, inp.dataset.opt, isNaN(v) ? inp.value : v);
        pushEngineLog('setoption name ' + inp.dataset.opt + ' value ' + v);
      };
    });
    document.querySelectorAll('#engineDetail [data-preset]').forEach(function (b) {
      b.onclick = function () {
        E.applyPreset(d.id, b.dataset.preset);
        pushEngineLog('применён пресет ' + b.dataset.preset + ': ' + JSON.stringify(E.getOptions(d.id)));
        renderEngineTab();
      };
    });
  }

  var RODENT_HELP =
    'Слой движка уже на месте: каталог, установка файла в IndexedDB, запуск в Web Worker, ' +
    'протокол UCI (uci / isready / ucinewgame / position fen / go / stop), подписка на info и bestmove, ' +
    'ограничение глубины, узлов и времени, MultiPV, пресеты под три уровня и настройка «личности».<br><br>' +
    'Чего не хватает, чтобы партию считал Rodent IV:<br>' +
    '1. <b>Сборки движка для браузера.</b> Rodent IV распространяется как исполняемый файл Windows и в ' +
    'веб-сборку не вкладывается (лицензия и размер). Нужен бинарник, скомпилированный в WebAssembly или ' +
    'asm.js, либо сборка, которую можно запустить нативно в десктоп-обёртке.<br>' +
    '2. <b>JS-обвязки потока</b> (~100-200 строк): загрузить WASM, подменить файловый ввод-вывод и потоки ' +
    'на обмен postMessage, прокинуть строки UCI. Её передают в Engines.start() параметром workerSource — ' +
    'место под неё готово.<br>' +
    '3. <b>Преобразования хода.</b> Движок отвечает в нотации UCI (e2e4, e7e8q); у движка правил уже есть ' +
    'Chess.findMove, который принимает from/to/promo, — достаточно разобрать строку.<br><br>' +
    'После этого переключение сводится к Engines.setActive(&#39;rodent4&#39;), остальное приложение делает само: ' +
    'тот же поиск хода, тот же интерфейс, те же объявления.';

  function platformNoteHTML() {
    var i = P.info();
    return i.desktop
      ? '🖥 Запущено как приложение на компьютере: обёртка <b>' + esc(i.env) + '</b>' +
        (i.appVersion ? ' v' + esc(i.appVersion) : '') +
        '. Файлы сохраняются через системный диалог, внешние ссылки открываются в браузере.'
      : '🌐 Запущено в браузере. Десктоп-обёртка (Electron/Tauri) находится в папке <b>desktop/</b>: ' +
        'она открывает этот же index.html и добавляет нативное сохранение файлов, системные уведомления, ' +
        'иконку в трее и запуск внешнего движка отдельным процессом.';
  }

  function onEngineFile(fileInput) {
    var f = fileInput.files && fileInput.files[0];
    if (!f) return;
    $('rodentProgress').textContent = 'Читаем ' + f.name + ' (' + S.sizeLabel(f.size) + ')…';
    var rd = new FileReader();
    rd.onload = function () {
      E.install('rodent4', { name: f.name, size: f.size, data: rd.result })
        .then(function (meta) {
          $('rodentProgress').textContent = '';
          addLog('<b>Движок добавлен:</b> ' + esc(meta.name) + ' (' + S.sizeLabel(meta.size) +
            ') — сохранён в ' + esc(meta.storage) + ', вне архива партий.', 'arch');
          toast('ДВИЖОК ДОБАВЛЕН', 'arch', meta.name + ' · ' + S.sizeLabel(meta.size));
          S.setSetting('engine', E.activeId());
          sfx('save');
          render();
        })
        .catch(function (err) {
          $('rodentProgress').textContent = 'Не удалось сохранить: ' + err.message;
          toast('ОШИБКА УСТАНОВКИ', 'check', err.message);
          sfx('no');
        });
    };
    rd.onerror = function () {
      $('rodentProgress').textContent = 'Не удалось прочитать файл';
      sfx('no');
    };
    rd.readAsArrayBuffer(f);
  }

  function useRodent() {
    if (!E.setActive('rodent4')) { toast('Движок недоступен', 'check', 'сначала добавьте файл сборки'); sfx('no'); return; }
    S.setSetting('engine', 'rodent4');
    addLog('Активный движок: <b>Rodent IV</b>. Уровень силы задаётся пресетом UCI.', 'arch');
    toast('RODENT IV АКТИВЕН', 'arch', 'параметры — в карточке движка');
    render();
    /* пробуем запустить, если есть обвязка потока; иначе честно сообщаем, что нечего запускать */
    testEngine('rodent4');
  }
  function testEngine(id) {
    if (!E.isInstalled(id)) { toast('Движок не установлен', 'check', ''); return; }
    pushEngineLog('--- проверка ' + id + ' ---');
    E.start(id, { workerSource: G.workerSource || null }).then(function (r) {
      pushEngineLog('движок готов: ' + JSON.stringify(r));
      toast('ДВИЖОК ОТВЕЧАЕТ', 'arch', id + ' готов к работе');
      renderEngineTab();
    }).catch(function (err) {
      pushEngineLog('ошибка запуска: ' + err.message);
      toast('ДВИЖОК НЕ ЗАПУСТИЛСЯ', 'check', err.message);
      renderEngineTab();
    });
  }
  function deleteEngine(id) {
    confirmBox('Удалить файл движка?', 'Сборка будет удалена из локального хранилища. Архив партий и статистика не пострадают. Компьютер вернётся к встроенному боту.', 'Удалить', true, function (okb) {
      if (!okb) return;
      E.uninstall(id).then(function () {
        S.setSetting('engine', E.activeId());
        addLog('Файл движка <b>' + esc(id) + '</b> удалён из хранилища.', 'arch');
        toast('ДВИЖОК УДАЛЁН', 'info', 'компьютер снова считает встроенным ботом');
        render();
      });
    });
  }

  function renderPosition() {
    $('fenText').textContent = C.toFen(cur());
  }

  /* ============================ АРХИВ ============================ */
  function reasonTextOf(reason, result) {
    var fake = { reason: reason, result: result, winner: result === '1-0' ? 'w' : (result === '0-1' ? 'b' : null), draw: result === '1/2-1/2', text: '' };
    return reasonInfo(fake).big;
  }
  function renderQuota() {
    var q = S.quotaInfo();
    var chkU = $('chkUnlimited');
    if (chkU) {
      chkU.checked = !!q.unlimited;
      chkU.disabled = S.fileTransport();
      chkU.parentNode.title = S.fileTransport()
        ? 'В версии для компьютера архив хранится файлом на устройстве и не ограничен'
        : 'В браузере отключать лимит рискованно: при переполнении localStorage новые партии могут не сохраниться';
    }
    if (q.unlimited) {
      $('quotaPct').textContent = 'без лимита';
      $('quotaPct').className = 'q-pct';
      var fillU = $('quotaFill');
      fillU.style.width = '100%';
      fillU.className = 'qf qf-unlim';
      $('quotaReserve').style.display = 'none';
      $('quotaText').innerHTML = 'Занято <b>' + S.sizeLabel(q.used) + '</b> на устройстве · партий: ' + q.games +
        (q.path ? '<br>Файл архива: <span style="word-break:break-all">' + esc(q.path) + '</span>'
                : '<br>Ограничения размера нет: данные хранятся вне localStorage');
      $('quotaHelp').innerHTML =
        '<b>Режим без ограничений.</b> В версии для компьютера архив партий хранится обычным файлом ' +
        '<b>archive.json</b> в папке данных приложения, а не в localStorage, поэтому квартильные предупреждения ' +
        'и автоматическое удаление старых партий не применяются: партии накапливаются на устройстве, пока хватает диска. ' +
        'Занятое место показано выше; средняя партия весит ' + S.sizeLabel(q.avg) + '.<br><br>' +
        'Выгрузка в PGN остаётся полезной как резервная копия: кнопка «📦 Выгрузить…» скачивает файл, а архив можно ' +
        'очистить вручную, если захочется освободить место.';
      return;
    }
    $('quotaReserve').style.display = '';
    var pctEl = $('quotaPct');
    pctEl.textContent = q.pct.toFixed(q.pct < 10 ? 1 : 0) + '%';
    pctEl.className = 'q-pct' + (q.level ? ' lv' + q.level : '');
    var fill = $('quotaFill');
    fill.style.width = Math.max(0, Math.min(100, q.pctOfTotal)) + '%';
    fill.className = 'qf' + (q.level ? ' lv' + q.level : '');
    $('quotaReserve').style.left = (q.limit / q.total * 100) + '%';
    var fits = Math.round(q.limit / q.avg);
    $('quotaText').innerHTML =
      'Занято <b>' + S.sizeLabel(q.used) + '</b> из ' + S.sizeLabel(q.limit) +
      ' · свободно ' + S.sizeLabel(q.free) + '<br>В архиве ' + q.games + ' ' + plural(q.games, 'партия', 'партии', 'партий') +
      ' · влезет ещё примерно <b>' + q.freeGames + '</b>';
    $('quotaHelp').innerHTML =
      '<b>Сколько весит одна партия.</b> В среднем ' + S.sizeLabel(q.avg) + ': запись ходов, PGN-текст, имена, дата и название. ' +
      'Короткая партия — около 1 КБ, длинная — 4-6 КБ.' +
      (q.games ? ' Число выше посчитано по вашему архиву.' : ' Пока архив пуст, берётся оценка ' +
        S.sizeLabel(S.quotaInfo().avg) + ' на партию.') + '<br><br>' +
      '<b>Сколько отведено места.</b> Бюджет архива — ' + S.sizeLabel(q.limit) + ', это примерно ' + fits + ' ' +
      plural(fits, 'партия', 'партии', 'партий') + ' при текущем среднем размере. Столько выбрано потому, что браузер обычно ' +
      'даёт странице около 5 МБ общего хранилища: архив занимает из них ~1.8 МБ, а остальное остаётся про запас под настройки, ' +
      'журнал событий, текущую партию и другие данные сайта. На силу игры бюджет не влияет: движок и компьютер-соперник ' +
      'считаются в оперативной памяти и общее хранилище не расходуют.<br><br>' +
      '<b>Сколько партий осталось до заполнения.</b> Сейчас свободно места ещё примерно на ' + q.freeGames + ' ' +
      plural(q.freeGames, 'партию', 'партии', 'партий') + '. Предупреждения приходят на 80 %, 90 %, 95 % и 100 %.<br><br>' +
      '<b>Что будет при заполнении.</b> После 100 % новые партии пишутся в резерв на ' + q.reserveGames +
      ' партии сверх бюджета. Резерв не входит в общие ' + S.sizeLabel(q.limit) + ', поэтому шкала может показывать чуть больше ' +
      '100 % — синий штрих на ней отмечает, где резерв начинается. Когда заканчивается и резерв, самая старая партия удаляется ' +
      'из хранилища автоматически, чтобы освободить место под новую; статистика профилей уменьшается на удалённую партию, ' +
      'а событие записывается в журнал.<br><br>' +
      '<b>Как освободить место.</b> Выгрузите архив одним PGN-файлом кнопкой ниже: файл скачается, архив очистится, ' +
      'а статистика профилей останется. Держать в браузере только недавние партии — рекомендуемый режим.';
  }

  function renderArchive() {
    var list = S.archive();
    var bytes = S.archiveBytes();
    var remind = parseInt(S.settings().archiveReminder, 10) || 30;
    renderQuota();
    var info = $('archInfo');
    var over = list.length >= remind;
    info.className = 'arch-info' + (over ? ' warn' : '');
    info.innerHTML = 'В архиве <b>' + list.length + '</b> ' + plural(list.length, 'партия', 'партии', 'партий') +
      ' · ' + S.sizeLabel(bytes) + '<br>Занято хранилищем: ' + S.usageLabel() +
      (over ? '<br>Накопилось много партий — выгрузите их в PGN-файл, архив очистится, а статистика профилей останется.'
        : '<br>Напоминание о выгрузке — каждые ' + remind + ' ' + plural(remind, 'партию', 'партии', 'партий') + '.');
    var badge = $('arBadge');
    badge.textContent = String(list.length);
    badge.hidden = list.length === 0;

    var q = ($('archSearch').value || '').trim().toLowerCase();
    var el = $('archList');
    var shown = list.filter(function (g) {
      if (!q) return true;
      return ((g.title || '') + ' ' + showName(g.white) + ' ' + showName(g.black) + ' ' + (g.date || '')).toLowerCase().indexOf(q) >= 0;
    });
    $('btnSaveGame').disabled = G.playback ? true : (G.sans.length === 0);
    $('btnExportAll').disabled = $('btnOffload').disabled = list.length === 0;

    if (!shown.length) {
      el.innerHTML = '<div class="arch-empty">' + (list.length
        ? 'Ничего не найдено по запросу «' + esc(q) + '».'
        : 'Архив пуст. Завершённые партии можно сохранять сюда: после мата, пата или ничьей появится предложение сохранить, а кнопку «💾 Текущую» можно нажать в любой момент.') + '</div>';
      return;
    }
    var html = '';
    shown.forEach(function (g) {
      var rc = g.result === '1/2-1/2' ? 'rdraw' : (g.result === '*' || !g.result ? 'rstar' : 'r10');
      var fullMoves = Math.ceil((g.plies || 0) / 2);
      html += '<div class="arch-item" data-id="' + g.id + '">' +
        '<div class="ai-top"><span class="ai-title" title="' + esc(g.title) + '">' + esc(g.title) + '</span>' +
        '<span class="ai-res ' + rc + '">' + esc(g.result || '*') + '</span></div>' +
        '<div class="ai-meta">' + esc(showName(g.white)) + ' — ' + esc(showName(g.black)) +
        ' · ' + fullMoves + ' ' + plural(fullMoves, 'ход', 'хода', 'ходов') + ' · ' + esc(g.date || '') +
        (g.reasonText ? ' · ' + esc(g.reasonText) : '') +
        (g.counted ? '' : ' · <i>без статистики</i>') + '</div>' +
        '<div class="ai-btns">' +
        '<button data-a="play" data-tip="Воспроизвести партию на доске">▶</button>' +
        '<button data-a="pgn" data-tip="Показать PGN партии">⧉</button>' +
        '<button data-a="down" data-tip="Скачать PGN этой партии">⬇</button>' +
        '<button data-a="rename" data-tip="Переименовать партию">✎</button>' +
        '<button data-a="del" class="del" data-tip="Удалить партию из архива">🗑</button>' +
        '</div></div>';
    });
    el.innerHTML = html;
  }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  function snapshotGame() {
    return {
      startFen: G.startFen, states: G.states, keys: G.keys, sans: G.sans, moves: G.moves,
      view: G.view, result: G.result, savedId: G.savedId, marks: G.marks, gen: G.gen
    };
  }
  function buildHistory(startFen, savedMoves) {
    var start = startFen ? C.fromFen(startFen) : C.startState();
    var out = { states: [start], keys: [C.positionKey(start, C.legalMoves(start))], sans: [], moves: [] };
    var s = start;
    for (var i = 0; i < (savedMoves || []).length; i++) {
      var lm = C.legalMoves(s);
      var m = C.findMove(lm, savedMoves[i].f, savedMoves[i].t, savedMoves[i].p);
      if (!m) break;
      out.sans.push(C.moveToSan(s, m, lm));
      s = C.makeMove(s, m);
      out.states.push(s); out.moves.push(m);
      out.keys.push(C.positionKey(s, C.legalMoves(s)));
    }
    return out;
  }

  /* сохранение текущей партии в архив */
  function saveCurrentGame(opts) {
    opts = opts || {};
    if (!G.sans.length && !opts.force) { toast('Партия пуста', 'info', 'ходов ещё нет — сохранять нечего'); return null; }
    var white = opts.white !== undefined ? opts.white : nameFor('w');
    var black = opts.black !== undefined ? opts.black : nameFor('b');
    var result = opts.result || (G.result ? G.result.result : '*');
    var reason = opts.reason || (G.result ? G.result.reason : null);
    var reasonText = opts.reasonText || (G.result ? reasonInfo(G.result).big : 'не завершена');
    var title = opts.title || S.nextAutoTitle(showName(white), showName(black));
    var entry = S.saveGame({
      title: title,
      white: white, black: black,
      date: S.stamp(),
      result: result, reason: reason, reasonText: reasonText,
      plies: G.sans.length,
      startFen: G.startFen || null,
      pgn: pgnFor({ white: white, black: black, result: result, sans: G.sans, startFen: G.startFen || null, reasonText: reasonText, title: title, date: S.stamp() }),
      moves: G.moves.map(function (m) { return { f: m.from, t: m.to, p: m.promo || null }; }),
      counted: opts.counted !== undefined ? opts.counted : true
    });
    G.savedId = entry.id;
    addLog('<b>Партия сохранена в архив:</b> ' + esc(entry.title) + ' · ' + esc(showName(entry.white)) + ' — ' +
      esc(showName(entry.black)) + ' · ' + entry.result + (entry.counted ? '' : ' (без статистики)'), 'arch');
    sfx('save');
    toast('СОХРАНЕНО В АРХИВ', 'arch', entry.title);
    render(); save();
    checkQuota(entry.evicted);
    maybeRemindOffload();
    return entry;
  }

  /* пороги 80/90/95/100 % и вытеснение самых старых партий, когда резерв кончился */
  function checkQuota(evicted) {
    var q = S.quotaInfo();
    if (q.unlimited) return;                 /* архив на устройстве: предупреждений нет */
    var prev = S.settings().archiveWarnLevel || 0;
    if (q.level > prev) {
      S.setSetting('archiveWarnLevel', q.level);
      var msg = q.level >= 100
        ? 'Бюджет архива заполнен. Новые партии пишутся в резерв на ' + q.reserveGames +
          ' партии; когда закончится и он, самые старые партии будут удаляться автоматически.'
        : 'Занято ' + q.level + ' % бюджета архива (' + S.sizeLabel(q.used) + ' из ' + S.sizeLabel(q.limit) +
          '). Свободно ещё примерно на ' + q.freeGames + ' ' + plural(q.freeGames, 'партию', 'партии', 'партий') +
          '. Выгрузите архив в PGN-файл, чтобы освободить место.';
      addLog('<b>Место под архив: ' + q.level + ' %.</b> ' + msg, q.level >= 100 ? 'mate' : 'arch');
      toast('АРХИВ: ' + q.level + ' %', q.level >= 100 ? 'mate' : 'arch', msg.slice(0, 96));
    } else if (q.level < prev) {
      S.setSetting('archiveWarnLevel', q.level);      /* место освободилось — порог снижаем */
    }
    if (evicted && evicted.length) {
      var names = evicted.map(function (g) { return esc(g.title); }).join(', ');
      addLog('<b>Не хватило места:</b> автоматически удалены самые старые партии (' + evicted.length +
        '): ' + names + '. Статистика профилей уменьшена соответственно.', 'mate');
      toast('УДАЛЕНЫ СТАРЫЕ ПАРТИИ: ' + evicted.length, 'mate', 'резерв закончился — выгрузите архив в файл');
    }
  }

  function maybeRemindOffload() {
    if (S.isUnlimited()) return;
    var remind = parseInt(S.settings().archiveReminder, 10) || 30;
    var cnt = S.countGames();
    if (remind > 0 && cnt > 0 && cnt % remind === 0) {
      addLog('В архиве ' + cnt + ' ' + plural(cnt, 'партия', 'партии', 'партий') +
        ' (' + S.sizeLabel(S.archiveBytes()) + '). Хороший момент выгрузить их в PGN-файл и очистить архив.', 'arch');
      toast('АРХИВ: ' + cnt + ' ' + plural(cnt, 'ПАРТИЯ', 'ПАРТИИ', 'ПАРТИЙ').toLowerCase(), 'arch',
        'вкладка «Архив» → «Выгрузить всё и очистить»');
    }
  }

  /* воспроизведение партии из архива */
  function openPlayback(id) {
    var g = S.getGame(id);
    if (!g) return;
    G.live = snapshotGame();
    var h = buildHistory(g.startFen, g.moves);
    G.startFen = g.startFen || null;
    G.states = h.states; G.keys = h.keys; G.sans = h.sans; G.moves = h.moves;
    G.view = lastIdx();
    G.selected = null; G.targets = []; G.marks = [];
    G.playback = { id: g.id, title: g.title };
    G.savedId = g.id;
    /* партия могла быть сохранена незавершённой — тогда итога нет */
    var finished = g.result && g.result !== '*';
    G.result = finished ? {
      reason: g.reason || 'result', winner: g.result === '1-0' ? 'w' : (g.result === '0-1' ? 'b' : null),
      draw: g.result === '1/2-1/2', result: g.result,
      text: g.reasonText || reasonTextOf(g.reason || 'result', g.result)
    } : null;
    G.gen++; G.thinking = false;
    $('playbackBar').hidden = false;
    $('playbackTitle').textContent = g.title + ' · ' + showName(g.white) + ' — ' + showName(g.black) +
      ' · ' + (finished ? g.result : 'партия не завершена');
    addLog('Открыта партия из архива: <b>' + esc(g.title) + '</b>', 'arch');
    switchTab('moves');
    render();
  }
  function closePlayback() {
    if (!G.playback || !G.live) return;
    var l = G.live;
    G.startFen = l.startFen; G.states = l.states; G.keys = l.keys; G.sans = l.sans; G.moves = l.moves;
    G.view = l.view; G.result = l.result; G.savedId = l.savedId; G.marks = l.marks || [];
    G.gen++; G.thinking = false;
    G.playback = null; G.live = null;
    $('playbackBar').hidden = true;
    render(); save();
    maybeBot();
  }

  /* выгрузка архива: сначала файл и копия текста, очистка — только по явному подтверждению */
  function offloadArchive(keepStats) {
    var cnt = S.countGames();
    if (!cnt) { toast('Архив пуст', 'info', ''); return; }
    var text = S.pgnAll({ reverse: true });
    var name = 'shakhmaty-arhiv-' + S.stamp().replace(/[^0-9]/g, '').slice(0, 12) + '.pgn';
    var shown = text.length > 60000 ? text.slice(0, 60000) + '\n\n; … остальное в скачиваемом файле' : text;
    var box = openModal(
      '<h2>Выгрузка архива</h2>' +
      '<p>Партий: <b>' + cnt + '</b> (' + S.sizeLabel(S.archiveBytes()) + '). Сначала сохраните файл — ' +
      'кнопка ниже должна начать скачивание <b>' + esc(name) + '</b>. Если браузер не дал скачать файл ' +
      '(например, страница открыта в песочнице), скопируйте текст вручную. Архив очистится только после ' +
      'вашего подтверждения.</p>' +
      '<div class="pgn-view">' + esc(shown) + '</div>' +
      '<label class="chk"><input type="checkbox" id="keepStats"' + (keepStats === false ? '' : ' checked') +
      '> Сохранить статистику профилей</label>' +
      '<div class="hint">Без галочки профили игроков и их счёт будут сброшены полностью.</div>' +
      '<div class="btns" style="margin-top:10px">' +
      '<button class="btn" data-a="down">⬇ Скачать файл</button>' +
      '<button class="btn" data-a="copy">⧉ Скопировать</button>' +
      '<button class="btn danger" data-a="wipe">🗑 Очистить архив</button>' +
      '<button class="btn" data-a="close">Закрыть</button>' +
      '</div>' +
      '<button class="btn btn-mini wide lichess" data-a="lichess" style="margin-top:8px">' +
      '↗ Скопировать и перейти на Lichess</button>', true);
    box.classList.add('wide');
    box.querySelector('[data-a=down]').onclick = function () {
      downloadText(name, text, function () { toast('Файл сохранён', 'arch', name); });
    };
    box.querySelector('[data-a=copy]').onclick = function () { copyText(text, 'все партии архива'); };
    box.querySelector('[data-a=lichess]').onclick = function () { closeModal(); openLichess(text, null); };
    box.querySelector('[data-a=close]').onclick = function () { closeModal(); };
    box.querySelector('[data-a=wipe]').onclick = function () {
      var keep = box.querySelector('#keepStats').checked;
      closeModal();
      var cleared = S.countGames();
      S.clearArchive({ keepStats: keep });
      G.savedId = null;
      checkQuota(null);
      addLog('<b>Архив очищен после выгрузки:</b> ' + cleared + ' ' + plural(cleared, 'партия', 'партии', 'партий') +
        ' выгружены в файл <b>' + esc(name) + '</b>. Статистика профилей ' + (keep ? 'сохранена.' : 'сброшена.'), 'arch');
      toast('АРХИВ ВЫГРУЖЕН И ОЧИЩЕН', 'arch', cleared + ' ' + plural(cleared, 'партия', 'партии', 'партий') + ' в файле');
      sfx('save');
      render();
    };
  }

  /* импорт PGN */
  function importPgn(text, counted) {
    var games = S.splitPgnGames(text);
    var imported = 0, badMoves = 0, skipped = 0, names = [], evictedAll = [];
    games.forEach(function (g) {
      var sans = S.parseSanList(g.movetext);
      if (!sans.length) { skipped++; return; }
      var startFen = g.tags.FEN && C.fromFen(g.tags.FEN) ? g.tags.FEN : null;
      var start = startFen ? C.fromFen(startFen) : C.startState();
      var states = [start], moves = [], okSans = [], s = start;
      for (var i = 0; i < sans.length; i++) {
        var lm = C.legalMoves(s);
        var m = C.moveFromSan(s, sans[i]);
        if (!m) { badMoves++; break; }
        okSans.push(C.moveToSan(s, m, lm));
        moves.push({ f: m.from, t: m.to, p: m.promo || null });
        s = C.makeMove(s, m);
        states.push(s);
      }
      if (!moves.length) { skipped++; return; }
      var result = g.tags.Result && /^(1-0|0-1|1\/2-1\/2|\*)$/.test(g.tags.Result) ? g.tags.Result : '*';
      var st = C.status(s, null, C.legalMoves(s));
      var reason = null, reasonText = 'из импорта PGN';
      if (st.over) { reason = st.reason; reasonText = reasonInfo(st, s).big; }
      else if (result === '1-0' || result === '0-1') { reason = 'resign'; reasonText = 'Партия сдана (по данным PGN)'; }
      else if (result === '1/2-1/2') { reason = 'agreement'; reasonText = 'Ничья (по данным PGN)'; }
      var white = (g.tags.White || '').trim() || null;
      var black = (g.tags.Black || '').trim() || null;
      if (white === '?' ) white = null;
      if (black === '?' ) black = null;
      var title = (g.tags.Event && g.tags.Event !== '?' && g.tags.Event !== 'Партия в браузере')
        ? g.tags.Event
        : S.nextAutoTitle(showName(white), showName(black));
      var savedEntry = S.saveGame({
        title: title, white: white, black: black,
        date: g.tags.Date && /^\d{4}\.\d{2}\.\d{2}$/.test(g.tags.Date) ? g.tags.Date + ' 00:00' : S.stamp(),
        result: result, reason: reason, reasonText: reasonText,
        plies: moves.length, startFen: startFen,
        pgn: pgnFor({ white: white, black: black, result: result, sans: okSans, startFen: startFen, reasonText: reasonText, title: title, date: g.tags.Date }),
        moves: moves, counted: !!counted
      });
      if (savedEntry.evicted && savedEntry.evicted.length) evictedAll = evictedAll.concat(savedEntry.evicted);
      imported++;
      names.push(showName(white) + '—' + showName(black));
    });
    addLog('<b>Импорт PGN:</b> добавлено ' + imported + ' ' + plural(imported, 'партия', 'партии', 'партий') +
      (skipped ? ', пропущено ' + skipped : '') + (badMoves ? ', нераспознанных ходов ' + badMoves : '') +
      (counted ? ' (со статистикой профилей)' : ' (без статистики профилей)'), 'arch');
    toast('ИМПОРТ: ' + imported + ' ' + plural(imported, 'ПАРТИЯ', 'ПАРТИИ', 'ПАРТИЙ').toLowerCase(), imported ? 'arch' : 'check',
      imported ? (badMoves ? 'часть ходов не распознана: ' + badMoves : 'партии добавлены в архив') : 'не найдено ни одной партии');
    if (imported) sfx('save');
    render();
    checkQuota(evictedAll);
    return { imported: imported, badMoves: badMoves, skipped: skipped, names: names };
  }

  /* ============================ ПРОФИЛИ ============================ */
  function renderPlayers() {
    var ps = S.players();
    var counted = 0;
    ps.forEach(function (p) { counted += p.played; });
    $('playersCount').textContent = 'Профилей: ' + ps.length + ' · учтённых партий: ' + Math.round(counted / 2);
    $('chkCountAnon').checked = S.settings().countAnon !== false;
    var body = $('playersBody');
    if (!ps.length) {
      body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#6c769c;padding:16px">Профилей пока нет. ' +
        'Они появляются после партий, сохранённых в архив со статистикой.</td></tr>';
      $('playerDetail').innerHTML = '';
      return;
    }
    var html = '';
    ps.forEach(function (p) {
      var score = p.played ? Math.round(((p.won + p.drawn * 0.5) / p.played) * 100) : 0;
      html += '<tr data-name="' + esc(p.name) + '"' + (G.openPlayer === p.name ? ' class="on"' : '') + '>' +
        '<td><span class="nm">' + esc(p.anon ? 'Аноним' : p.name) + (p.anon ? ' <span class="anon">сводный</span>' : '') + '</span></td>' +
        '<td>' + p.played + '</td><td>' + p.won + '</td><td>' + p.drawn + '</td><td>' + p.lost + '</td>' +
        '<td>' + score + '</td></tr>';
    });
    body.innerHTML = html;
    renderPlayerDetail();
  }

  function renderPlayerDetail() {
    var el = $('playerDetail');
    if (!G.openPlayer) { el.innerHTML = '<div class="hint" style="margin-top:8px">Нажмите на строку игрока, чтобы увидеть подробный профиль.</div>'; return; }
    var p = S.player(G.openPlayer);
    if (!p) { G.openPlayer = null; el.innerHTML = ''; return; }
    var score = p.played ? Math.round(((p.won + p.drawn * 0.5) / p.played) * 100) : 0;
    var games = S.archive().filter(function (g) {
      return (g.counted !== false) && (keyOf(g.white) === p.name || keyOf(g.black) === p.name);
    });
    /* личные встречи */
    var h2h = {};
    games.forEach(function (g) {
      var opp = keyOf(g.white) === p.name ? g.black : g.white;
      var k = opp === null ? S.ANON : opp;
      h2h[k] = h2h[k] || { w: 0, d: 0, l: 0, n: 0 };
      h2h[k].n++;
      if (g.result === '1/2-1/2') h2h[k].d++;
      else if ((g.result === '1-0') === (keyOf(g.white) === p.name)) h2h[k].w++;
      else h2h[k].l++;
    });
    var html = '<h4>' + esc(p.anon ? 'Аноним' : p.name) + (p.anon ? ' <span class="anon">сводный профиль</span>' : '') + '</h4>' +
      '<div class="stats">' +
      stat('Партий', p.played) + stat('Побед', p.won) + stat('Ничьих', p.drawn) + stat('Поражений', p.lost) +
      stat('Очков', score + '%') + stat('Матов', p.mates) + stat('Получено матов', p.mated) +
      stat('Сдался', p.resigned) + stat('Белыми', p.asWhite) + stat('Чёрными', p.asBlack) +
      '</div>' +
      '<div class="hint">Первая партия: ' + esc(p.first) + ' · последняя: ' + esc(p.last) + '</div>';
    var keys = Object.keys(h2h).sort(function (a, b) { return h2h[b].n - h2h[a].n; });
    if (keys.length) {
      html += '<div class="lbl" style="margin-top:11px">Личные встречи</div>';
      keys.slice(0, 8).forEach(function (k) {
        var r = h2h[k];
        html += '<div class="h2h">против <b>' + esc(k === S.ANON ? 'Анонима' : k) + '</b>: ' + r.n + ' ' +
          plural(r.n, 'партия', 'партии', 'партий') + ' — +' + r.w + ' =' + r.d + ' −' + r.l + '</div>';
      });
    }
    if (games.length) {
      html += '<div class="lbl" style="margin-top:11px">Партии в архиве (' + games.length + ')</div><div class="games">';
      games.slice(0, 12).forEach(function (g) {
        var mine = keyOf(g.white) === p.name ? 'белыми' : 'чёрными';
        var res = g.result === '*' ? '—' : ((g.result === '1/2-1/2') ? 'ничья' :
          (((g.result === '1-0') === (keyOf(g.white) === p.name)) ? 'победа' : 'поражение'));
        html += '<div class="g" data-id="' + g.id + '" title="Воспроизвести партию">▶ <span>' + esc(g.title) +
          '</span><span style="margin-left:auto;color:#98a1c4">' + mine + ' · ' + res + '</span></div>';
      });
      html += '</div>';
    }
    if (!p.anon) {
      html += '<div class="pd-btns"><button class="btn btn-mini" data-pa="rename">Переименовать</button>' +
        '<button class="btn btn-mini danger" data-pa="delete">Удалить профиль</button></div>';
    } else {
      html += '<div class="hint" style="margin-top:9px">Сюда попадают все партии, где имя игрока не указано. ' +
        'Если без имени играли обе стороны, партия учитывается один раз, а победы и поражения в ней не разделяются ' +
        '(их невозможно приписать конкретному игроку) — таких партий: ' + (p.selfGames || 0) + '. ' +
        'Профиль можно обнулить кнопкой «Очистить анонима» — сами партии останутся в архиве.</div>';
    }
    el.innerHTML = html;
  }
  function keyOf(name) { return S.isAnon(name) ? S.ANON : name; }
  function stat(label, value) { return '<span class="st">' + esc(label) + '<b>' + esc(value) + '</b></span>'; }

  /* ============================ МЕНЮ ПРИЛОЖЕНИЯ (⋮) ============================
     Заменило нативную панель «Партия/Вид/Инструменты/Справка», которая в
     полноэкранном режиме оставалась видимой полосой сверху. */
  function appMenuOpen() { return $('appMenuPop').classList.contains('open'); }
  function toggleAppMenu(force) {
    var open = force !== undefined ? force : !appMenuOpen();
    $('appMenuPop').classList.toggle('open', open);
    $('btnAppMenu').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) sfx('click');
  }
  function toggleFullscreen() {
    P.isFullscreen().then(function (on) {
      P.setFullscreen(!on);
      toast(!on ? 'ПОЛНЫЙ ЭКРАН' : 'ОКОННЫЙ РЕЖИМ', 'info', 'F11 — переключить обратно');
    });
  }
  var CHANGELOG = [
    ['1.0', 'Первая версия: игра за обе стороны на одной доске, сброс, полные правила (рокировка, взятие на проходе, превращение), отдельные объявления шаха, мата, пата и всех ничьих, запись партии, компьютер-соперник.'],
    ['1.1', 'Взятые фигуры стали видны на тёмном фоне; подсветка шаха перемещена под фигуру короля без всплывающей плашки; стрелки и круги правой кнопкой мыши; громкость звука с ползунком.'],
    ['1.2', 'Разгрузка интерфейса: вкладки и панель иконок с подсказками; архив партий в PGN с названиями и именами; профили соперников со счётом и личными встречами; анонимы; импорт PGN с выбором учёта в статистике; выгрузка архива файлом.'],
    ['1.3', 'Меню открывается иконкой в правом верхнем углу, доска на всё окно; исправлено смещение фигур влево; выделено место под архив: шкала с процентами, резерв на 3 партии, пороги 80/90/95/100 %, автоудаление самых старых; кнопки «Скопировать и перейти на Lichess».'],
    ['2.0', 'Версия для компьютера: обёртки Electron и Tauri, иконки, PWA с офлайн-кэшем; слой платформ и движков; размечено место под Rodent IV (UCI, пресеты, установка сборки); ссылка Lichess исправлена с мёртвого /import на /paste.'],
    ['2.1', 'Полноэкранный запуск без нативной панели меню; меню приложения «⋮»; перевес материала считается по доске (корректно с превращениями); статус партии во вкладке «Ходы» с автооткрытием при итоге; чип состояния в шапке; версионирование и проверка обновлений.'],
    ['2.2', 'Панель управления переехала во вкладку «Ходы» двумя рядами; материал — колонка слева серыми силуэтами; меню-оверлей без сдвига доски; подсказки под кнопками без обрезания; автоповорот только для двух игроков; название окна Chess; приоритет Windows; конвейер релизов.'],
    ['2.3', 'Архив в десктопе хранится файлом на устройстве без ограничений (и отключаемый лимит в браузере); перевес материала отдельной строкой под именем; «Отмена» в диалоге превращения по центру; стрелки: правый клик и тяга в клетке рисуют круг, повтор удаляет пометку, короткий левый клик или ход стирают всё; убран подзаголовок под логотипом; убраны лишние полосы прокрутки в панели; «История изменений» в меню приложения; релизы и тесты только под Windows.'],
    ['план', 'Лаунчер версий (выбор установленных версий, список изменений, новости) — оценён, ждёт своего часа; автообновления через GitHub Actions после привязки репозитория; NNUE-движок в браузере/десктопе.'],
  ];
  function showChangelog() {
    var html = '<h2>История изменений</h2><div class="rules-body">';
    CHANGELOG.forEach(function (row) {
      html += '<h3>Версия ' + esc(row[0]) + '</h3><p>' + esc(row[1]) + '</p>';
    });
    html += '</div><div class="btns" style="margin-top:12px"><button class="btn primary wide" data-a="close">Закрыть</button></div>';
    var box = openModal(html, false, null);
    box.classList.add('wide');
    box.querySelector('[data-a=close]').onclick = function () { closeModal(); };
  }

  function showAbout() {
    var i = P.info();
    var q = S.quotaInfo();
    openModal('<h2>О программе</h2>' +
      '<p><b>Шахматы, версия ' + esc(APP_VERSION) + '</b>' + (BUILD_STAMP ? ' (сборка ' + esc(BUILD_STAMP) + ')' : '') + '<br>' +
      'Режим запуска: ' + esc(i.desktop ? 'приложение на компьютере (' + i.env + ')' : 'браузер') +
      (i.desktop && i.appVersion ? ', обёртка ' + esc(i.appVersion) : '') + '.<br>' +
      'Партий в архиве: ' + S.countGames() + ' · занято архивом ' + S.sizeLabel(q.used) + ' из ' + S.sizeLabel(q.limit) +
      ' (' + q.pct.toFixed(0) + '%).<br>Всего данных в хранилище: ' + esc(S.usageLabel()) + '.</p>' +
      '<p>Полные правила шахмат, игра за обе стороны, компьютер, архив партий в PGN, профили соперников, ' +
      'стрелки разбора и место под внешние движки (Rodent IV). Один файл, работает без интернета.</p>' +
      '<div class="btns"><button class="btn" data-a="updates">Проверить обновления</button>' +
      '<button class="btn primary" data-a="close">Закрыть</button></div>')
      .querySelector('[data-a=close]').onclick = function () { closeModal(); };
    var ub = document.querySelector('.modal [data-a=updates]');
    if (ub) ub.onclick = function () { closeModal(); checkUpdates(); };
  }
  function checkUpdates() {
    var b = P.bridge();
    if (b && typeof b.checkUpdates === 'function') {
      b.checkUpdates();
      toast('ПРОВЕРКА ОБНОВЛЕНИЙ', 'info', 'обёртка выполнит её и покажет результат');
      return;
    }
    openModal('<h2>Обновления</h2><p>Текущая версия: <b>' + esc(APP_VERSION) + '</b>' +
      (BUILD_STAMP ? ' (сборка ' + esc(BUILD_STAMP) + ')' : '') + '.</p>' +
      '<div class="hint" style="margin-bottom:10px">Браузер и PWA получают новую версию сами: сервис-воркер ' +
      'заменит кэш и предложит обновиться при следующем открытии. На компьютере обновления ставит ' +
      'установщик новой версии — данные (архив, профили, настройки) сохраняются.</div>' +
      '<div class="btns"><button class="btn primary wide" data-a="close">Понятно</button></div>')
      .querySelector('[data-a=close]').onclick = function () { closeModal(); };
  }

  /* ============================ ВЫДВИЖНОЕ МЕНЮ ============================ */
  function panelOpen() { return $('panel').classList.contains('open'); }
  function openPanel(tab) {
    if (tab) switchTab(tab);
    $('panel').classList.add('open');
    $('panel').setAttribute('aria-hidden', 'false');
    $('drawerBg').classList.toggle('on', window.innerWidth < 1200);
    document.body.classList.add('panel-open');
    $('btnPanel').setAttribute('aria-expanded', 'true');
    renderTab();
    sfx('click');
  }
  function closePanel() {
    $('panel').classList.remove('open');
    $('panel').setAttribute('aria-hidden', 'true');
    $('drawerBg').classList.remove('on');
    document.body.classList.remove('panel-open');
    $('btnPanel').setAttribute('aria-expanded', 'false');
  }
  function togglePanel() { if (panelOpen()) closePanel(); else openPanel(); }

  /* ============================ ВКЛАДКИ ============================ */
  function switchTab(tab) {
    G.tab = tab;
    S.setSetting('activeTab', tab);
    document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    document.querySelectorAll('#tabBody > section').forEach(function (s) { s.classList.toggle('on', s.dataset.panel === tab); });
    renderTab();
  }
  function renderTab() {
    if (G.tab === 'events') renderEvents();
    else if (G.tab === 'archive') renderArchive();
    else if (G.tab === 'players') renderPlayers();
    else if (G.tab === 'game') renderGameTab();
    else if (G.tab === 'engine') renderEngineTab();
    else if (G.tab === 'position') renderPosition();
  }
  /* не трогаем значение поля, если в нём сейчас курсор пользователя */
  function setVal(el, v) {
    if (!el) return;
    v = v === null || v === undefined ? '' : String(v);
    if (document.activeElement !== el && el.value !== v) el.value = v;
  }
  function renderGameTab() {
    document.querySelectorAll('#modeSeg button').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === G.mode); });
    $('levelWrap').style.display = botColor() ? '' : 'none';
    setVal($('levelSel'), G.level);
    $('botHint').textContent = botColor() ? ('Компьютер играет за ' + gen(botColor()) + ', уровень: ' + (LEVEL_RU[G.level] || G.level)) :
      'Обе стороны играют на одной доске — ходите по очереди за белых и за чёрных.';
    setVal($('nameWhite'), botColor() === 'w' ? botName() : (S.settings().meWhite || ''));
    setVal($('nameBlack'), botColor() === 'b' ? botName() : (S.settings().meBlack || ''));
    $('nameWhite').disabled = botColor() === 'w';
    $('nameBlack').disabled = botColor() === 'b';
    setVal($('reminderInput'), S.settings().archiveReminder);
    var chkA = $('chkAutoFlip');
    if (chkA) {
      chkA.checked = !!G.autoFlip;
      chkA.disabled = !!botColor();
      chkA.parentNode.title = botColor()
        ? 'В партиях с компьютером доска не переворачивается: вы всегда видите её со своей стороны'
        : '';
    }
    var chk = $('chkPanelAuto');
    if (chk) chk.checked = S.settings().panelAutoOpen !== false;
    var chkF = $('chkFullStart');
    if (chkF) {
      chkF.checked = S.settings().startFullscreen !== false;
      chkF.onchange = function () { S.setSetting('startFullscreen', chkF.checked); };
    }
    var vl = $('versionLine');
    if (vl) {
      vl.innerHTML = 'Версия приложения: <b>' + esc(APP_VERSION) + '</b>' +
        (BUILD_STAMP ? ' · сборка ' + esc(BUILD_STAMP) : '') +
        ' · режим: <b>' + esc(P.isDesktop() ? 'компьютер (' + P.info().env + ')' : 'браузер') + '</b>' +
        (P.isDesktop() && P.info().appVersion ? ' · обёртка ' + esc(P.info().appVersion) : '') +
        '.<br>Обновления: браузер — перезагрузка страницы; PWA — сервис-воркер применит новую версию сам; ' +
        'компьютер — меню «Справка → Проверить обновления».';
    }
  }

  /* ============================ ОБЩИЙ РЕНДЕР ============================ */
  function render() {
    $('platformNote').innerHTML = platformNoteHTML();
    if (builtFlipped !== G.flipped) buildBoard();
    renderBoard(); renderCaps(); renderStatus(); renderMoves(); renderPosition(); renderTab(); renderControls();
    renderMarks();
    $('live').textContent = $('statusBig').textContent + '. ' + $('statusSmall').textContent;
    P.setTitle('Chess — ' + $('statusBig').textContent.replace(/\s+/g, ' ').trim());
    $('arBadge').textContent = String(S.countGames());
    $('arBadge').hidden = S.countGames() === 0;
    var evb = $('evBadge');
    evb.textContent = String(S.logs().length);
    evb.hidden = S.logs().length === 0;
  }

  function renderControls() {
    var locked = !!G.playback;
    setAct('undo', !locked && G.states.length > 1 && !G.thinking);
    setAct('reset', !locked);
    setAct('flip', true);
    setAct('marks', !locked && G.marks.length > 0);
    setAct('draw', !locked && !G.result && !G.thinking);
    setAct('resign', !locked && !G.result && !G.thinking);
    setAct('first', G.view > 0);
    setAct('prev', G.view > 0);
    setAct('next', !atLatest());
    setAct('last', !atLatest());
    var audible = G.sound && G.volume > 0;
    $('btnSound').classList.toggle('on', audible);
    $('btnSound').textContent = audible ? '\u{1F50A}' : '\u{1F507}';
    $('btnSound').setAttribute('data-tip', audible ? 'Звук включён: нажмите, чтобы изменить громкость' : 'Звук выключен: нажмите, чтобы настроить');
    $('volIcon').textContent = audible ? (G.volume > 0.55 ? '\u{1F50A}' : '\u{1F509}') : '\u{1F507}';
    setVal($('volRange'), Math.round(G.volume * 100));
    $('volVal').textContent = G.sound ? Math.round(G.volume * 100) + '%' : 'выкл';
    $('chkAutoFlip').checked = !!G.autoFlip;
  }
  function setAct(act, enabled) {
    var b = document.querySelector('#toolbar button[data-act="' + act + '"]');
    if (b) b.disabled = !enabled;
  }

  /* ============================ ХОДЫ ============================ */
  function pushMove(m) {
    var s = latest();
    var legal = C.legalMoves(s);
    var san = C.moveToSan(s, m, legal);
    var mover = s.turn;
    var ns = C.makeMove(s, m);
    var nlegal = C.legalMoves(ns);
    G.states.push(ns); G.moves.push(m); G.sans.push(san);
    G.keys.push(C.positionKey(ns, nlegal));
    G.view = lastIdx();
    return { state: ns, san: san, mover: mover, legal: nlegal, moveNo: s.full };
  }

  function afterMove(ap, opts) {
    opts = opts || {};
    var st = C.status(ap.state, G.keys, ap.legal);
    var mark = ap.moveNo + (ap.mover === 'w' ? '.' : '\u2026');
    if (st.over) {
      G.result = { reason: st.reason, winner: st.winner, draw: st.draw, result: st.result, text: st.text };
      var info = reasonInfo(G.result, ap.state);
      addLog(info.log + ' <span style="opacity:.6">(' + mark + ' ' + ap.san + ')</span>', info.kind);
      if (!opts.silent) {
        toast(info.toast, info.kind, info.toastSub);
        sfx(info.kind === 'draw' ? 'draw' : (G.result.winner && botColor() === G.result.winner ? 'lose' : 'win'));
        /* итог партии живёт во вкладке «Ходы»: если меню закрыто — открываем его там */
        if (!panelOpen()) openPanel('moves');
        showEndModal(G.result);
      }
    } else if (st.check) {
      addLog('<b>Шах</b> ' + dat(ap.state.turn) + ' <span style="opacity:.6">(' + mark + ' ' + ap.san + ')</span>', 'check');
      if (!opts.silent) sfx('check');
    } else if (!opts.silent) {
      sfx(ap.move.promo ? 'promo' : ap.move.castle ? 'castle' : (ap.move.captured || ap.move.ep) ? 'capture' : 'move');
    }
    if (G.autoFlip && !G.result && !botColor()) G.flipped = ap.state.turn === 'b';
    G.selected = null; G.targets = [];
  }

  function doMove(m) {
    if (G.thinking || G.result || !atLatest() || G.playback || !m) return;
    var legal = C.legalMoves(cur());
    var real = null;
    for (var i = 0; i < legal.length; i++) {
      if (legal[i].from === m.from && legal[i].to === m.to && (legal[i].promo || null) === (m.promo || null)) { real = legal[i]; break; }
    }
    if (!real) { sfx('no'); return; }
    G.savedId = null;                     /* партия изменилась — старая запись архива уже не о ней */
    var ap = pushMove(real);
    ap.move = real;
    afterMove(ap);
    G.marks = [];
    render(); save();
    maybeBot();
  }

  function select(sq) {
    G.selected = sq;
    G.targets = C.legalMoves(cur(), sq);
    renderBoard();
    sfx('click');
  }
  function pickMove(from, to, promo) { return C.findMove(G.targets, from, to, promo); }
  function isPromotion(from, to) {
    for (var i = 0; i < G.targets.length; i++) {
      var m = G.targets[i];
      if (m.from === from && m.to === to && m.promo) return true;
    }
    return false;
  }
  function hasMove(from, to) { return isPromotion(from, to) || !!C.findMove(G.targets, from, to, null); }

  /* ============================ ВЗАИМОДЕЙСТВИЕ ============================ */
  function sqFromPoint(x, y) {
    var r = boardEl.getBoundingClientRect();
    if (!r.width) return -1;
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return -1;
    var cw = r.width / 8, ch = r.height / 8;
    var dcol = Math.max(0, Math.min(7, Math.floor((x - r.left) / cw)));
    var drow = Math.max(0, Math.min(7, Math.floor((y - r.top) / ch)));
    return displayToSq(drow, dcol);
  }
  function flashLocked() {
    if (G.playback) { toast('Просмотр архива', 'info', 'вернитесь к своей партии, чтобы ходить'); return; }
    if (G.thinking) { toast('Подождите', 'info', 'ходит компьютер'); return; }
    if (G.result) { toast('Партия окончена', 'info', G.result.text || ''); return; }
    if (!atLatest()) { toast('Просмотр истории', 'info', 'вернитесь к последнему ходу (кнопка ⏭)'); return; }
    if (isBotTurn()) { toast('Ход компьютера', 'info', ''); }
  }

  function onDown(e) {
    var el = e.target && e.target.closest ? e.target.closest('.sq') : null;
    if (!el) return;
    var sq = parseInt(el.dataset.sq, 10);
    endDrag();
    if (G.modal) return;
    if (e.button === 2) { startMarkDrag(e, sq); return; }
    if (e.button) return;
    if (!canPlay()) { flashLocked(); return; }
    var s = cur();
    if (G.selected !== null && hasMove(G.selected, sq)) {
      if (e.preventDefault) e.preventDefault();
      var from = G.selected;
      var promo = isPromotion(from, sq);
      var chosen = promo ? null : pickMove(from, sq, null);
      G.selected = null; G.targets = [];
      if (promo) openPromo(from, sq); else doMove(chosen);
      render();
      return;
    }
    var pc = s.b[sq];
    if (pc && C.colorOf(pc) === s.turn) {
      if (e.preventDefault) e.preventDefault();
      select(sq);
      startDrag(e, sq, pc, el);
    } else {
      if (pc && C.colorOf(pc) !== s.turn) sfx('no');
      G.selected = null; G.targets = [];
      renderBoard();
    }
  }

  function startDrag(e, sq, pc, el) {
    var r = boardEl.getBoundingClientRect();
    if (!r.width) return;
    var g = $('ghost');
    g.innerHTML = pieceHTML(pc);
    g.style.setProperty('--gsz', (r.width / 8 * 1.12) + 'px');
    g.style.display = 'block';
    moveGhost(e.clientX || 0, e.clientY || 0);
    drag = { from: sq, moved: false, x: e.clientX || 0, y: e.clientY || 0 };
    el.classList.add('drag-src');
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
    window.addEventListener('pointercancel', onDragUp);
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragUp);
  }
  function moveGhost(x, y) { var g = $('ghost'); g.style.left = x + 'px'; g.style.top = y + 'px'; }
  function onDragMove(e) {
    if (!drag) return;
    var x = e.clientX || 0, y = e.clientY || 0;
    if (Math.abs(x - drag.x) > 4 || Math.abs(y - drag.y) > 4) drag.moved = true;
    moveGhost(x, y);
  }
  function endDrag() {
    if (!drag) return;
    drag = null;
    $('ghost').style.display = 'none';
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);
    window.removeEventListener('pointercancel', onDragUp);
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragUp);
    for (var sq in cellEls) cellEls[sq].el.classList.remove('drag-src');
  }
  function onDragUp(e) {
    if (!drag) return;
    var from = drag.from, moved = drag.moved;
    endDrag();
    if (!moved) {
      /* короткое нажатие левой кнопки стирает все стрелки и круги */
      if (G.marks.length) clearMarks(true);
      return;
    }
    if (!canPlay()) { render(); return; }
    var to = sqFromPoint(e.clientX || 0, e.clientY || 0);
    if (to < 0 || to === from) { render(); return; }
    if (hasMove(from, to)) {
      if (isPromotion(from, to)) { G.selected = from; openPromo(from, to); }
      else { var dm = pickMove(from, to, null); G.selected = null; G.targets = []; doMove(dm); }
    } else {
      sfx('no');
      G.selected = from; G.targets = C.legalMoves(cur(), from);
    }
    render();
  }

  /* ============================ МОДАЛЬНЫЕ ОКНА ============================ */
  function openModal(html, sticky, promo) {
    closeModal();
    var bg = document.createElement('div');
    bg.className = 'modal-bg';
    var box = document.createElement('div');
    box.className = 'modal';
    box.innerHTML = html;
    if (sticky) box.dataset.sticky = '1';
    bg.appendChild(box);
    document.body.appendChild(bg);
    G.modal = { bg: bg, box: box, promo: promo || null };
    bg.addEventListener('pointerdown', function (e) { if (e.target === bg && !sticky) closeModal(); });
    bg.addEventListener('mousedown', function (e) { if (e.target === bg && !sticky) closeModal(); });
    return box;
  }
  function closeModal() {
    if (!G.modal) return;
    var promo = G.modal.promo;
    G.modal.bg.remove();
    G.modal = null;
    if (promo && !G.result && !G.playback && atLatest() && !G.thinking) {
      G.selected = promo.from;
      G.targets = C.legalMoves(cur(), promo.from);
      renderBoard();
    }
  }
  function confirmBox(title, text, okLabel, danger, cb, extraHTML) {
    var box = openModal('<h2>' + esc(title) + '</h2><p>' + text + '</p>' + (extraHTML || '') +
      '<div class="btns"><button class="btn" data-a="no">Отмена</button>' +
      '<button class="btn ' + (danger ? 'danger' : 'primary') + '" data-a="yes">' + esc(okLabel) + '</button></div>');
    box.querySelector('[data-a=yes]').onclick = function () { closeModal(); cb(true, box); };
    box.querySelector('[data-a=no]').onclick = function () { closeModal(); cb(false, box); };
    return box;
  }

  function openPromo(from, to) {
    var color = cur().turn;
    var picks = ['q', 'r', 'b', 'n'];
    var names = { q: 'Ферзь', r: 'Ладья', b: 'Слон', n: 'Конь' };
    var html = '<h2>Превращение пешки</h2><p>Пешка дошла до последней горизонтали. Выберите фигуру:</p><div class="promo-picks">';
    picks.forEach(function (p) {
      html += '<button data-p="' + p + '">' + pieceHTML(color === 'w' ? p.toUpperCase() : p, 'promo') +
        '<span>' + names[p] + '</span></button>';
    });
    html += '</div><div class="btns"><button class="btn wide" data-a="cancel">Отмена</button></div>';
    var box = openModal(html, false, { from: from, to: to });
    picks.forEach(function (p) {
      box.querySelector('[data-p="' + p + '"]').onclick = function () {
        closeModal();
        G.targets = C.legalMoves(cur(), from);
        var m = pickMove(from, to, p);
        if (m) doMove(m); else render();
      };
    });
    box.querySelector('[data-a=cancel]').onclick = function () { closeModal(); render(); };
  }

  /* окно завершения партии с сохранением в архив */
  /* если название оставили предложенным, а имена вписали — пересобираем название по именам */
  function finalTitle(input, w, b) {
    var t = (input.value || '').trim();
    if (!t || t === input.dataset.auto) t = S.nextAutoTitle(showName(w), showName(b));
    return t;
  }

  function showEndModal(res) {
    var info = reasonInfo(res);
    var badge = res.draw
      ? '<span class="result-badge draw">НИЧЬЯ · 1/2-1/2</span>'
      : '<span class="result-badge win">' + esc(nom(res.winner)) + ' ПОБЕДИЛИ · ' + esc(res.result) + '</span>';
    var wName = nameFor('w') || '', bName = nameFor('b') || '';
    var title = S.nextAutoTitle(showName(wName || null), showName(bName || null));
    var autoAttr = ' data-auto="' + esc(title) + '"';
    var html = badge + '<h2>' + esc(info.big) + '</h2><p>' + esc(info.small) + '</p>' +
      '<div class="save-form">' +
      '<div class="lbl">Сохранить партию в архив</div>' +
      '<input class="inp" id="svTitle" value="' + esc(title) + '"' + autoAttr + ' aria-label="Название партии">' +
      '<div class="row" style="gap:6px;margin-top:8px">' +
      '<input class="inp" id="svWhite" value="' + esc(wName) + '" placeholder="Белые: без имени = аноним" aria-label="Имя белых">' +
      '<input class="inp" id="svBlack" value="' + esc(bName) + '" placeholder="Чёрные: без имени = аноним" aria-label="Имя чёрных">' +
      '</div>' +
      '<label class="chk"><input type="checkbox" id="svCounted" checked> Учитывать в статистике профилей</label>' +
      '</div>' +
      '<div class="btns" style="margin-top:12px">' +
      '<button class="btn primary" data-a="save">💾 Сохранить в архив</button>' +
      '<button class="btn" data-a="later">Позже</button>' +
      '<button class="btn" data-a="review">Разобрать ходы</button>' +
      '<button class="btn" data-a="new">Новая партия</button>' +
      '</div>';
    var box = openModal(html);
    box.querySelector('[data-a=save]').onclick = function () {
      var w = box.querySelector('#svWhite').value.trim() || null;
      var b = box.querySelector('#svBlack').value.trim() || null;
      var t = finalTitle(box.querySelector('#svTitle'), w, b);
      var counted = box.querySelector('#svCounted').checked;
      /* имена запоминаем как значения по умолчанию */
      if (botColor() !== 'w') S.setSetting('meWhite', w || '');
      if (botColor() !== 'b') S.setSetting('meBlack', b || '');
      closeModal();
      saveCurrentGame({ title: t, white: w, black: b, counted: counted });
    };
    box.querySelector('[data-a=later]').onclick = function () { closeModal(); };
    box.querySelector('[data-a=review]').onclick = function () { closeModal(); };
    box.querySelector('[data-a=new]').onclick = function () { closeModal(); newGame(true); };
  }

  function showPgnModal(title, pgn) {
    var box = openModal('<h2>' + esc(title) + '</h2><div class="pgn-view">' + esc(pgn) + '</div>' +
      '<div class="btns" style="margin-top:12px"><button class="btn" data-a="copy">⧉ Скопировать</button>' +
      '<button class="btn" data-a="close">Закрыть</button></div>' +
      '<button class="btn btn-mini wide lichess" data-a="lichess" style="margin-top:8px">' +
      '↗ Скопировать и перейти на Lichess</button>', false, null);
    box.classList.add('wide');
    box.querySelector('[data-a=copy]').onclick = function () { copyText(pgn, 'PGN партии'); };
    box.querySelector('[data-a=close]').onclick = function () { closeModal(); };
    box.querySelector('[data-a=lichess]').onclick = function () { closeModal(); openLichess(pgn, null); };
  }

  function openImportModal() {
    var html = '<h2>Импорт партий из PGN</h2>' +
      '<p>Вставьте текст PGN (можно несколько партий подряд) или выберите файл. Партии добавятся в архив, их можно будет воспроизвести на доске.</p>' +
      '<textarea class="inp" id="impText" placeholder="1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *"></textarea>' +
      '<div class="row" style="margin-top:9px;gap:8px">' +
      '<input type="file" id="impFile" accept=".pgn,.txt,text/plain" class="inp" style="padding:6px">' +
      '</div>' +
      '<label class="chk"><input type="checkbox" id="impCounted" checked> Учитывать импортированные партии в статистике профилей</label>' +
      '<div class="hint">Если галочку снять, партии попадут в архив, но имена игроков не изменят счёт в профилях.</div>' +
      '<div class="btns" style="margin-top:12px"><button class="btn" data-a="cancel">Отмена</button>' +
      '<button class="btn primary" data-a="do">⬆ Импортировать</button></div>';
    var box = openModal(html, false, null);
    box.classList.add('wide');
    var fileInput = box.querySelector('#impFile');
    fileInput.onchange = function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { box.querySelector('#impText').value = String(rd.result || ''); };
      rd.onerror = function () { toast('Не удалось прочитать файл', 'check', ''); };
      rd.readAsText(f);
    };
    box.querySelector('[data-a=do]').onclick = function () {
      var text = box.querySelector('#impText').value || '';
      var counted = box.querySelector('#impCounted').checked;
      if (!text.trim()) { toast('Пусто', 'check', 'вставьте PGN или выберите файл'); sfx('no'); return; }
      closeModal();
      importPgn(text, counted);
      switchTab('archive');
    };
    box.querySelector('[data-a=cancel]').onclick = function () { closeModal(); };
  }

  function renameGame(id) {
    var g = S.getGame(id);
    if (!g) return;
    var box = openModal('<h2>Название партии</h2><p>Сейчас: «' + esc(g.title) + '»</p>' +
      '<input class="inp" id="rnTitle" value="' + esc(g.title) + '" aria-label="Новое название">' +
      '<div class="btns" style="margin-top:12px"><button class="btn" data-a="no">Отмена</button>' +
      '<button class="btn primary" data-a="yes">Сохранить</button></div>');
    var inp = box.querySelector('#rnTitle');
    inp.focus(); inp.select();
    box.querySelector('[data-a=yes]').onclick = function () {
      var t = inp.value.trim() || g.title;
      S.updateGame(id, { title: t });
      addLog('Партия в архиве переименована: <b>' + esc(t) + '</b>', 'arch');
      closeModal(); render();
    };
    box.querySelector('[data-a=no]').onclick = function () { closeModal(); };
    inp.onkeydown = function (e) { if (e.key === 'Enter') box.querySelector('[data-a=yes]').click(); };
  }

  function renamePlayer(name) {
    var box = openModal('<h2>Переименовать профиль</h2><p>Профиль «' + esc(name) + '» — счёт и партии будут перенесены на новое имя.</p>' +
      '<input class="inp" id="plName" value="' + esc(name) + '" aria-label="Новое имя">' +
      '<div class="btns" style="margin-top:12px"><button class="btn" data-a="no">Отмена</button>' +
      '<button class="btn primary" data-a="yes">Переименовать</button></div>');
    var inp = box.querySelector('#plName');
    inp.focus(); inp.select();
    box.querySelector('[data-a=yes]').onclick = function () {
      var t = inp.value.trim();
      if (!t) { toast('Имя не может быть пустым', 'check', 'пустое имя = аноним'); sfx('no'); return; }
      S.renamePlayer(name, t);
      G.openPlayer = t;
      addLog('Профиль переименован: <b>' + esc(name) + '</b> → <b>' + esc(t) + '</b>', 'arch');
      closeModal(); render();
    };
    box.querySelector('[data-a=no]').onclick = function () { closeModal(); };
    inp.onkeydown = function (e) { if (e.key === 'Enter') box.querySelector('[data-a=yes]').click(); };
  }

  function showHelp() {
    openModal('<h2>Как играть и что объявляется</h2><div class="rules-body">' + RULES_HTML + '</div>' +
      '<div class="btns" style="margin-top:14px"><button class="btn primary wide" data-a="close">Понятно</button></div>')
      .querySelector('[data-a=close]').onclick = function () { closeModal(); };
  }

  var RULES_HTML =
    '<h3>Версия</h3><p>Шахматы ' + esc(APP_VERSION) + (BUILD_STAMP ? ' (сборка ' + esc(BUILD_STAMP) + ')' : '') +
    '. Проверить обновления на компьютере: меню «Справка → Проверить обновления»; в браузере и PWA новая версия применяется сама.</p>' +
    '<h3>Ходы</h3><p>Нажмите на свою фигуру — подсветятся доступные ходы (точка — пустое поле, красный круг — взятие), затем нажмите на клетку назначения. Фигуру можно перетащить мышью или пальцем. Ходить можно за обе стороны по очереди.</p>' +
    '<h3>Шах</h3><p>Король под боем: клетка короля подсвечивается красным кольцом (подсветка лежит под фигурой и не засвечивает её), в статусе появляется «ШАХ!», в журнале — запись, в нотации — знак <code>+</code>.</p>' +
    '<h3>Мат</h3><p>Шах, от которого нет защиты. Партия заканчивается победой атакующей стороны (<code>1-0</code> или <code>0-1</code>), в нотации — <code>#</code>.</p>' +
    '<h3>Пат</h3><p>У стороны, чей ход, нет легальных ходов, но король не под шахом. Это ничья <code>1/2-1/2</code>.</p>' +
    '<h3>Ничьи</h3><ul>' +
    '<li><b>Правило 50 ходов</b> — 50 ходов каждой стороны без взятий и ходов пешкой (применяется автоматически).</li>' +
    '<li><b>Троекратное повторение</b> — позиция возникла в третий раз с теми же правами рокировки и взятием на проходе (автоматически).</li>' +
    '<li><b>Недостаточно материала</b> — мат невозможен в принципе.</li>' +
    '<li><b>По соглашению</b> — кнопка ½ под доской.</li>' +
    '<li><b>Сдача</b> — кнопка ⚑ под доской: поражение стороны, чей ход.</li></ul>' +
    '<h3>Стрелки и пометки</h3><p>Зажмите <b>правую кнопку мыши</b> и протяните от клетки к клетке — нарисуется стрелка. Пометок может быть несколько, цвета чередуются. Повторная стрелка между теми же клетками удаляется. Движение внутри одной клетки рисует круг. Короткий правый клик стирает всё (то же делает кнопка ➶).</p>' +
    '<h3>Архив партий</h3><p>После завершения партии предлагается сохранить её в архив: можно задать название и имена игроков. Сохранённую партию можно воспроизвести на доске, посмотреть её PGN, переименовать или удалить. Имена складываются в профили: сыграно, победы, ничьи, поражения, процент очков, маты, сдачи, личные встречи.</p>' +
    '<h3>Пустое имя = аноним</h3><p>Если имя не указано, партия сохраняется как анонимная. Все анонимы попадают в один сводный профиль «Аноним» (в таблице он последний, с пометкой). Если без имени играли обе стороны, партия учитывается один раз, но победы и поражения не разделяются — их некому приписать. Галочка «Учитывать анонимные партии в статистике» на вкладке «Профили» разрешает или запрещает такой учёт, а кнопка «Очистить анонима» обнуляет сводный профиль, не трогая партии в архиве.</p>' +
    '<h3>Выгрузка архива</h3><p>Чтобы браузер не хранил лишнего, архив можно выгрузить одним PGN-файлом и очистить: кнопка «📦 Выгрузить всё и очистить архив». Статистика профилей при этом сохраняется (галочку можно снять). Напоминание о выгрузке приходит каждые N партий — число настраивается на вкладке «Игра».</p>' +
    '<h3>Импорт PGN</h3><p>Кнопка «⬆ Импорт» принимает текст или файл с партиями. При импорте предлагается выбрать, учитывать ли эти партии в статистике профилей.</p>' +
    '<h3>Горячие клавиши</h3><p><span class="kbd">←</span> <span class="kbd">→</span> — разбор ходов, <span class="kbd">↑</span> <span class="kbd">↓</span> — в начало/конец, <span class="kbd">F</span> — перевернуть доску, <span class="kbd">Z</span> — вернуть ход, <span class="kbd">N</span> — новая партия, <span class="kbd">Esc</span> — снять выделение или закрыть окно.</p>' +
    '<h3>Правила полностью</h3><p>Рокировка (включая запрет при шахе и через битое поле), взятие на проходе, превращение пешки с выбором фигуры, запрет ходов, оставляющих своего короля под шахом. Движок сверен с эталонным perft до 5-й глубины.</p>';

  /* ============================ ОБЪЯВЛЕНИЕ НАД ДОСКОЙ ============================ */
  var toastTimer = null;
  function toast(text, kind, sub) {
    var wrap = $('toastWrap');
    wrap.innerHTML = '<div class="toast ' + (kind || 'info') + '">' + esc(text) +
      (sub ? '<span class="t2">' + esc(sub) + '</span>' : '') + '</div>';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { wrap.innerHTML = ''; toastTimer = null; }, 2500);
  }

  /* ============================ КОМАНДЫ ============================ */
  function newGame(skipConfirm) {
    if (G.playback) { closePlayback(); }
    var start = function () {
      G.result = null; G.selected = null; G.targets = []; G.view = 0;
      G.startFen = null; G.marks = []; G.savedId = null;
      G.gen++; G.thinking = false;
      if (G.playback) { G.playback = null; G.live = null; $('playbackBar').hidden = true; }
      var s = C.startState();
      G.states = [s]; G.moves = []; G.sans = [];
      G.keys = [C.positionKey(s, C.legalMoves(s))];
      addLog('Новая партия. ' + nom(s.turn) + ' начинают. ' + esc(showName(nameFor('w'))) + ' — ' + esc(showName(nameFor('b'))) + '.', 'info');
      endDrag(); closeModal();
      render(); save();
      toast('НОВАЯ ПАРТИЯ', 'info', 'ход ' + gen(s.turn));
      maybeBot();
    };
    if (skipConfirm || G.sans.length === 0) start();
    else confirmBox('Сбросить доску?', 'Текущая партия (' + G.sans.length + ' ход.) будет потеряна: фигуры вернутся в начальную расстановку, запись ходов очистится. В архив она не попадёт.', 'Сбросить доску', true, function (ok) { if (ok) start(); });
  }

  function undo() {
    if (G.thinking || G.playback) return;
    if (G.states.length < 2) { toast('Отменять нечего', 'info', ''); sfx('no'); return; }
    G.states.pop(); G.moves.pop(); G.sans.pop(); G.keys.pop();
    G.view = lastIdx();
    var bc = botColor();
    while (bc && G.states.length > 1 && latest().turn === bc) {
      G.states.pop(); G.moves.pop(); G.sans.pop(); G.keys.pop();
      G.view = lastIdx();
    }
    G.result = null; G.view = lastIdx();
    G.selected = null; G.targets = []; G.marks = []; G.savedId = null;
    closeModal();
    addLog('Ход возвращён. Позиция после ' + (G.sans.length ? '<b>' + esc(G.sans[G.sans.length - 1]) + '</b>' : 'начала партии') + '.', 'info');
    sfx('click');
    render(); save();
  }

  function navigate(view) {
    G.view = Math.max(0, Math.min(lastIdx(), view));
    G.selected = null; G.targets = [];
    endDrag();
    render();
  }

  function flipBoard() {
    G.flipped = !G.flipped;
    S.setSetting('flipped', G.flipped);
    sfx('click');
    render(); save();
  }

  function resign() {
    if (G.result || G.thinking || G.playback) return;
    var loser = cur().turn;
    confirmBox('Сдаться?', esc(showName(nameFor(loser))) + ' (' + nomLow(loser) + ') признают поражение, партия закончится. Её можно будет сохранить в архив.', 'Сдаться', true, function (ok) {
      if (!ok) return;
      G.result = {
        reason: 'resign', winner: C.other(loser), draw: false,
        result: loser === 'w' ? '0-1' : '1-0', text: nom(loser) + ' сдались'
      };
      var info = reasonInfo(G.result);
      addLog(info.log, info.kind);
      toast(info.toast, info.kind, info.toastSub);
      sfx('lose');
      render(); save();
      showEndModal(G.result);
    });
  }

  function agreeDraw() {
    if (G.result || G.thinking || G.playback) return;
    confirmBox('Ничья по соглашению?', 'Обе стороны согласны завершить партию вничью (1/2-1/2)? Партию можно будет сохранить в архив.', 'Согласны на ничью', false, function (ok) {
      if (!ok) return;
      G.result = { reason: 'agreement', winner: null, draw: true, result: '1/2-1/2', text: 'Ничья по соглашению' };
      var info = reasonInfo(G.result);
      addLog(info.log, info.kind);
      toast(info.toast, info.kind, info.toastSub);
      sfx('draw');
      render(); save();
      showEndModal(G.result);
    });
  }

  /* ============================ КОМПЬЮТЕР ============================ */
  function maybeBot() {
    if (!isBotTurn() || G.thinking || G.result || G.playback) return;
    G.thinking = true;
    var gen0 = G.gen, level = G.level;
    render();
    setTimeout(function () {
      if (gen0 !== G.gen) return;
      var s = cur(), m = null;
      try {
        var res = E.searchMove(s, C.toFen(s), level, function (d) {
          if (d && d.depth) pushEngineLog('info depth ' + d.depth + (d.score ? ' score ' + d.score : ''));
        });
        /* поиск может быть асинхронным (внешний движок) или мгновенным (встроенный) */
        if (res && typeof res.then === 'function') {
          res.then(function (r) { afterSearch(gen0, r); })
            .catch(function (err) {
              pushEngineLog('сбой внешнего движка: ' + err.message + ' — считаю встроенным ботом');
              afterSearch(gen0, { move: Bot.search(cur(), level) });
            });
          return;
        }
        m = res.move;
      } catch (err) { m = C.legalMoves(s)[0] || null; }
      if (gen0 !== G.gen) return;
      G.thinking = false;
      if (m) doMove(m); else render();
    }, 260);
  }

  /* разбор ответа движка: встроенный бот даёт объект хода, UCI — строку вида e2e4 / e7e8q */
  function afterSearch(gen0, r) {
    if (gen0 !== G.gen) return;
    G.thinking = false;
    var m = r && r.move ? r.move : null;
    if (!m && r && r.uci) m = uciToMove(r.uci);
    if (!m) { render(); return; }
    if (r && r.engine && r.engine !== 'builtin') {
      pushEngineLog('bestmove ' + r.uci + ' (глубина ' + (r.depth || '?') + ', ' + r.timeMs + ' мс)');
    }
    doMove(m);
  }
  function uciToMove(uci) {
    var s = cur();
    var from = C.sqFromName(uci.slice(0, 2));
    var to = C.sqFromName(uci.slice(2, 4));
    var promo = uci.length > 4 ? uci[4] : null;
    return C.findMove(C.legalMoves(s), from, to, promo);
  }

  /* ============================ СОХРАНЕНИЕ ============================ */
  var saveTimer = null;
  function flushSave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    S.setGame({
      startFen: G.startFen,
      moves: G.moves.map(function (m) { return { f: m.from, t: m.to, p: m.promo || null }; }),
      view: G.view, marks: G.marks, savedId: G.savedId,
      result: G.result ? {
        reason: G.result.reason, winner: G.result.winner, draw: G.result.draw,
        result: G.result.result, text: G.result.text
      } : null
    });
  }
  function save(immediate) {
    if (immediate || G.result) { flushSave(); return; }
    if (saveTimer) return;
    saveTimer = setTimeout(function () { saveTimer = null; flushSave(); }, 350);
  }

  function restore() {
    var d = S.game();
    var st = S.settings();
    G.mode = st.mode || 'hotseat';
    G.level = st.level || 'medium';
    G.sound = st.sound !== false;
    G.volume = typeof st.volume === 'number' ? st.volume : 0.75;
    G.flipped = !!st.flipped;
    G.autoFlip = !!st.autoFlip;
    G.tab = st.activeTab || 'moves';
    if (st.engine && st.engine !== 'builtin' && E.isInstalled(st.engine)) E.setActive(st.engine);
    if (!d || !Array.isArray(d.moves)) return false;
    var h = buildHistory(d.startFen, d.moves);
    G.startFen = d.startFen || null;
    G.states = h.states; G.keys = h.keys; G.sans = h.sans; G.moves = h.moves;
    G.marks = Array.isArray(d.marks) ? d.marks : [];
    G.savedId = d.savedId || null;
    G.result = d.result || null;
    if (G.result && !G.result.text) G.result.text = reasonInfo(G.result, latest()).big;
    G.view = Math.max(0, Math.min(lastIdx(), typeof d.view === 'number' ? d.view : lastIdx()));
    return G.sans.length > 0 || !!G.startFen;
  }

  /* ============================ КОПИРОВАНИЕ И ФАЙЛЫ ============================ */
  function copyText(text, label) {
    function done(ok) {
      if (ok) toast('СКОПИРОВАНО', 'info', label);
      else toast('Скопируйте вручную', 'check', 'текст показан в окне — выделите и скопируйте');
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallback(); });
        return;
      }
    } catch (e) { }
    fallback();
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand('copy');
        ta.remove();
        done(ok);
      } catch (e) { done(false); }
    }
  }
  /* «Скопировать и перейти на Lichess».
     FEN  → lichess.org/analysis/<позиция> (позиция подставляется сразу);
     PGN  → lichess.org/paste?pgn=<текст> (страница вставки PGN; прежний адрес
            /import у Lichess больше не существует и отдаёт 404).
     Если PGN слишком длинный для адреса — открываем /paste и кладём текст в буфер. */
  var LICHESS = 'https://lichess.org';
  var LICHESS_URL_LIMIT = 7000;      /* запас: у разных браузеров предел адреса ~8-64 тыс. знаков */
  function lichessUrl(text, fen) {
    if (fen) return LICHESS + '/analysis/' + encodeURIComponent(fen).replace(/%20/g, '_').replace(/%2F/g, '/');
    var withPgn = LICHESS + '/paste?pgn=' + encodeURIComponent(text);
    return withPgn.length <= LICHESS_URL_LIMIT ? withPgn : LICHESS + '/paste';
  }
  function openLichess(text, fen) {
    var url = lichessUrl(text, fen);
    var inline = url.indexOf('/paste?pgn=') > 0 || !!fen;
    copyText(text, fen ? 'FEN позиции' : 'PGN партии');
    P.openExternal(url).then(function (res) {
      if (res.ok) {
        toast('ОТКРЫВАЕМ LICHESS', 'arch', fen
          ? 'FEN скопирован и подставлен в адрес анализа'
          : (inline ? 'PGN скопирован и подставлен в форму на lichess.org/paste'
            : 'PGN в буфере обмена — вставьте его в форму на открывшейся странице'));
        return;
      }
      var box0 = openModal('<h2>Откройте Lichess вручную</h2>' +
        '<p>Браузер не дал открыть новую вкладку. Текст уже скопирован в буфер обмена — ' +
        'вставьте его на странице Lichess.</p>' +
        '<div class="pgn-view">' + esc(res.url || url) + '</div>' +
        '<div class="btns" style="margin-top:12px"><button class="btn" data-a="copy">⧉ Скопировать ссылку</button>' +
        '<button class="btn primary" data-a="close">Закрыть</button></div>');
      box0.querySelector('[data-a=copy]').onclick = function () { copyText(res.url || url, 'ссылка на Lichess'); };
      box0.querySelector('[data-a=close]').onclick = function () { closeModal(); };
    });
  }

  function downloadText(filename, text, after) {
    P.saveFile(filename, text, 'application/x-chess-pgn').then(function (res) {
      if (!res.ok) {
        /* ни нативного сохранения, ни скачивания в браузере — показываем текст для ручного копирования */
        showPgnModal(filename + ' — скопируйте текст вручную', text);
        return;
      }
      if (after) after(res);
      if (res.how === 'native' && res.path) toast('ФАЙЛ СОХРАНЁН', 'arch', res.path);
    });
  }

  /* ============================ FEN ============================ */
  function validateFen(fen) {
    var parts = String(fen || '').trim().split(/\s+/);
    if (parts.length < 4) return 'FEN должен содержать минимум 4 поля: расстановка, чей ход, рокировки, взятие на проходе.';
    if (!/^[rnbqkpRNBQKP1-8]+(\/[rnbqkpRNBQKP1-8]+){7}$/.test(parts[0])) return 'Неверная расстановка (первое поле FEN).';
    if (parts[1] !== 'w' && parts[1] !== 'b') return 'Неверно указан ход (должно быть w или b).';
    if (!/^(K?Q?k?q?|-)$/.test(parts[2])) return 'Неверно указаны права рокировки.';
    if (!/^(-|[a-h][36])$/.test(parts[3])) return 'Неверно указано поле взятия на проходе.';
    var s;
    try { s = C.fromFen(fen); } catch (e) { return 'Не удалось разобрать FEN.'; }
    var kw = 0, kb = 0;
    for (var i = 0; i < 64; i++) { if (s.b[i] === 'K') kw++; if (s.b[i] === 'k') kb++; }
    if (kw !== 1 || kb !== 1) return 'На доске должен быть ровно один белый и один чёрный король.';
    if (C.inCheck(s, C.other(s.turn))) return 'Недопустимая позиция: король стороны, которая только что сходила, под шахом.';
    return null;
  }

  function loadFen(fen) {
    var err = validateFen(fen);
    if (err) { toast('ОШИБКА В FEN', 'check', err); sfx('no'); return false; }
    var s = C.fromFen(fen.trim());
    G.startFen = C.toFen(s);
    G.states = [s]; G.moves = []; G.sans = [];
    G.keys = [C.positionKey(s, C.legalMoves(s))];
    G.view = 0; G.result = null; G.selected = null; G.targets = [];
    G.gen++; G.thinking = false; G.marks = []; G.savedId = null;
    if (G.playback) { G.playback = null; G.live = null; $('playbackBar').hidden = true; }
    addLog('Позиция выставлена из FEN. Ход ' + gen(s.turn) + '.', 'info');
    endDrag(); closeModal();
    buildBoard(); render(); save();
    toast('ПОЗИЦИЯ ВЫСТАВЛЕНА', 'info', 'ход ' + gen(s.turn));
    var st0 = C.status(s, G.keys, C.legalMoves(s));
    if (st0.over) {
      G.result = { reason: st0.reason, winner: st0.winner, draw: st0.draw, result: st0.result, text: st0.text };
      var info0 = reasonInfo(G.result, s);
      addLog(info0.log + ' <span style="opacity:.6">(в выставленной позиции)</span>', info0.kind);
      render(); save();
      toast(info0.toast, info0.kind, info0.toastSub);
      sfx(info0.kind === 'draw' ? 'draw' : 'win');
      showEndModal(G.result);
    }
    maybeBot();
    return true;
  }

  /* ============================ ПРИВЯЗКА СОБЫТИЙ ============================ */
  function setMode(mode) {
    G.mode = mode;
    S.setSetting('mode', mode);
    G.selected = null; G.targets = [];
    addLog(mode === 'hotseat' ? 'Режим: два игрока на одной доске.' :
      'Режим: компьютер играет за ' + gen(botColor()) + ' (' + (LEVEL_RU[G.level] || G.level) + ').', 'info');
    render(); save();
    maybeBot();
  }

  function bind() {
    boardEl = $('board');
    buildBoard();

    if (typeof window.PointerEvent === 'function') boardEl.addEventListener('pointerdown', onDown);
    boardEl.addEventListener('mousedown', function (e) {
      if (typeof window.PointerEvent === 'function') return;
      onDown(e);
    });
    boardEl.addEventListener('dragstart', function (e) { e.preventDefault(); });
    boardEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.querySelector('.board-frame').addEventListener('contextmenu', function (e) { e.preventDefault(); });

    /* кнопки-иконки под доской */
    $('toolbar').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b || b.disabled) return;
      var act = b.dataset.act;
      if (act === 'first') navigate(0);
      else if (act === 'prev') navigate(G.view - 1);
      else if (act === 'next') navigate(G.view + 1);
      else if (act === 'last') navigate(lastIdx());
      else if (act === 'undo') undo();
      else if (act === 'reset') newGame(false);
      else if (act === 'flip') flipBoard();
      else if (act === 'marks') clearMarks(false);
      else if (act === 'draw') agreeDraw();
      else if (act === 'resign') resign();

    });

    $('btnClosePlayback').onclick = closePlayback;


    /* вкладки */
    $('tabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tab]');
      if (!b) return;
      sfx('click');
      switchTab(b.dataset.tab);
    });

    /* звук: поповер */
    $('btnSound').onclick = function (e) {
      e.stopPropagation();
      var w = $('soundPop');
      var open = w.classList.toggle('open');
      $('btnSound').setAttribute('aria-expanded', open ? 'true' : 'false');
      sfx('click');
    };
    $('soundPanel').addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    document.addEventListener('pointerdown', function (e) {
      var w = $('soundPop');
      if (w.classList.contains('open') && !w.contains(e.target)) {
        w.classList.remove('open');
        $('btnSound').setAttribute('aria-expanded', 'false');
      }
      var am = $('appMenuPop');
      if (am.classList.contains('open') && !am.contains(e.target)) toggleAppMenu(false);
    });
    $('volIcon').onclick = toggleSound;
    $('volRange').oninput = function () {
      G.volume = parseInt($('volRange').value, 10) / 100;
      if (G.volume > 0 && !G.sound) G.sound = true;
      S.setSettings({ volume: G.volume, sound: G.sound });
      renderControls();
    };
    $('volRange').onchange = function () { save(); if (G.sound && G.volume > 0) sfx('move'); };
    $('chkAutoFlip').onchange = function () {
      G.autoFlip = $('chkAutoFlip').checked;
      S.setSetting('autoFlip', G.autoFlip);
      if (G.autoFlip) G.flipped = cur().turn === 'b';
      render(); save();
    };
    $('btnHelp').onclick = showHelp;

    /* меню приложения */
    $('btnAppMenu').onclick = function (e) { e.stopPropagation(); toggleAppMenu(); };
    $('appMenu').addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    $('appMenu').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-am]');
      if (!b) return;
      toggleAppMenu(false);
      var a = b.dataset.am;
      if (a === 'new') newGame(false);
      else if (a === 'undo') undo();
      else if (a === 'save') { openPanel('archive'); $('btnSaveGame').click(); }
      else if (a === 'offload') { openPanel('archive'); $('btnOffload').click(); }
      else if (a === 'fullscreen') toggleFullscreen();
      else if (a === 'flip') flipBoard();
      else if (a === 'panel') togglePanel();
      else if (a === 'autoflip') { $('chkAutoFlip').checked = !G.autoFlip; $('chkAutoFlip').onchange(); }
      else if (a === 'marks') clearMarks(false);
      else if (a === 'fen') { openPanel('position'); $('btnCopyFen').click(); }
      else if (a === 'pgn') { openPanel('position'); $('btnCopyPgn').click(); }
      else if (a === 'lichess') openLichess(pgnFor({}), null);
      else if (a === 'help') showHelp();
      else if (a === 'changelog') showChangelog();
      else if (a === 'updates') checkUpdates();
      else if (a === 'about') showAbout();
    });

    /* выдвижное меню */
    $('btnPanel').onclick = function (e) { e.stopPropagation(); togglePanel(); };
    $('btnPanelClose').onclick = closePanel;
    $('drawerBg').onclick = closePanel;
    window.addEventListener('resize', function () {
      if (panelOpen()) $('drawerBg').classList.toggle('on', window.innerWidth < 1200);
    });

    /* ходы */
    $('moves').addEventListener('click', function (e) {
      var el = e.target.closest('[data-view]');
      if (!el) return;
      navigate(parseInt(el.dataset.view, 10));
    });

    /* журнал */
    $('btnClearLog').onclick = function () {
      confirmBox('Очистить журнал?', 'Все записи о событиях (шахи, маты, ничьи, сохранения) будут удалены. Партии в архиве и статистика профилей не пострадают.', 'Очистить', true, function (ok) {
        if (!ok) return;
        S.clearLogs();
        S.pushLog('Журнал событий очищен.', 'info');
        render();
      });
    };

    /* архив */
    $('chkUnlimited').onchange = function () {
      S.setSetting('archiveUnlimited', $('chkUnlimited').checked);
      addLog($('chkUnlimited').checked
        ? 'Ограничение размера архива отключено в настройках.'
        : 'Ограничение размера архива включено снова: ' + S.sizeLabel(S.ARCHIVE_BUDGET) + ' + резерв.', 'arch');
      render();
    };
    $('archSearch').addEventListener('input', function () { renderArchive(); });
    $('btnSaveGame').onclick = function () {
      if (!G.sans.length) { toast('Партия пуста', 'info', 'сделайте хотя бы один ход'); return; }
      var box = openModal('<h2>Сохранить партию в архив</h2><p>Ходов: ' + G.sans.length +
        (G.result ? ', результат ' + esc(G.result.result) : ', партия ещё не завершена (в архиве будет «*»)') + '.</p>' +
        '<div class="save-form"><div class="lbl">Название</div>' +
        (function () {
          var auto = S.nextAutoTitle(showName(nameFor('w')), showName(nameFor('b')));
          return '<input class="inp" id="svTitle" value="' + esc(auto) + '" data-auto="' + esc(auto) + '">';
        })() +
        '<div class="row" style="gap:6px;margin-top:8px">' +
        '<input class="inp" id="svWhite" value="' + esc(nameFor('w') || '') + '" placeholder="Белые: без имени = аноним">' +
        '<input class="inp" id="svBlack" value="' + esc(nameFor('b') || '') + '" placeholder="Чёрные: без имени = аноним">' +
        '</div><label class="chk"><input type="checkbox" id="svCounted" checked> Учитывать в статистике профилей</label></div>' +
        '<div class="btns" style="margin-top:12px"><button class="btn" data-a="no">Отмена</button>' +
        '<button class="btn primary" data-a="yes">💾 Сохранить</button></div>');
      box.querySelector('[data-a=yes]').onclick = function () {
        var w = box.querySelector('#svWhite').value.trim() || null;
        var b = box.querySelector('#svBlack').value.trim() || null;
        var t = finalTitle(box.querySelector('#svTitle'), w, b);
        var counted = box.querySelector('#svCounted').checked;
        if (botColor() !== 'w') S.setSetting('meWhite', w || '');
        if (botColor() !== 'b') S.setSetting('meBlack', b || '');
        closeModal();
        saveCurrentGame({ title: t, white: w, black: b, counted: counted });
        switchTab('archive');
      };
      box.querySelector('[data-a=no]').onclick = function () { closeModal(); };
    };
    $('btnImportPgn').onclick = openImportModal;
    $('btnImportPgn2').onclick = openImportModal;
    $('btnExportAll').onclick = function () {
      downloadText('shakhmaty-arhiv.pgn', S.pgnAll({ reverse: true }), function () {
        toast('Файл сохранён', 'arch', 'все партии архива в shakhmaty-arhiv.pgn');
      });
    };
    $('btnOffload').onclick = function () { offloadArchive(true); };
    $('archList').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-a]');
      var item = e.target.closest('.arch-item');
      if (!item) return;
      var id = item.dataset.id;
      var g = S.getGame(id);
      if (!g) return;
      var a = btn ? btn.dataset.a : 'play';
      if (a === 'play') openPlayback(id);
      else if (a === 'pgn') showPgnModal(g.title, g.pgn || pgnFor({ sans: (buildHistory(g.startFen, g.moves).sans), result: g.result, white: g.white, black: g.black, startFen: g.startFen, title: g.title, date: g.date, reasonText: g.reasonText }));
      else if (a === 'down') downloadText('partiya.pgn', g.pgn || '', function () { toast('Файл сохранён', 'arch', g.title); });
      else if (a === 'rename') renameGame(id);
      else if (a === 'del') {
        confirmBox('Удалить партию?', '«' + esc(g.title) + '» будет удалена из архива. Статистика профилей будет уменьшена на эту партию.', 'Удалить', true, function (ok) {
          if (!ok) return;
          S.removeGame(id);
          addLog('Партия удалена из архива: <b>' + esc(g.title) + '</b>', 'arch');
          render();
        });
      }
    });

    /* профили */
    $('chkCountAnon').onchange = function () {
      S.setSetting('countAnon', $('chkCountAnon').checked);
      addLog($('chkCountAnon').checked ? 'Анонимные партии учитываются в статистике.' : 'Анонимные партии больше не учитываются в статистике.', 'info');
      render();
    };
    $('btnClearAnon').onclick = function () {
      confirmBox('Очистить профиль «Аноним»?', 'Сводный счёт анонимных партий обнулится. Сами партии останутся в архиве, но перестанут учитываться в статистике.', 'Очистить', true, function (ok) {
        if (!ok) return;
        S.clearAnonStats();
        addLog('Сводный профиль «Аноним» очищен.', 'arch');
        render();
      });
    };
    $('playersBody').addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-name]');
      if (!tr) return;
      G.openPlayer = G.openPlayer === tr.dataset.name ? null : tr.dataset.name;
      sfx('click');
      renderPlayers();
    });
    $('playerDetail').addEventListener('click', function (e) {
      var g = e.target.closest('.g[data-id]');
      if (g) { openPlayback(g.dataset.id); return; }
      var b = e.target.closest('button[data-pa]');
      if (!b || !G.openPlayer) return;
      if (b.dataset.pa === 'rename') renamePlayer(G.openPlayer);
      else if (b.dataset.pa === 'delete') {
        var nm = G.openPlayer;
        confirmBox('Удалить профиль?', 'Профиль «' + esc(nm) + '» и его счёт будут удалены. Партии в архиве останутся, но перестанут учитываться в статистике.', 'Удалить профиль', true, function (ok) {
          if (!ok) return;
          S.deletePlayer(nm);
          G.openPlayer = null;
          addLog('Профиль удалён: <b>' + esc(nm) + '</b>', 'arch');
          render();
        });
      }
    });

    /* вкладка «Игра» */
    $('modeSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-mode]');
      if (b) setMode(b.dataset.mode);
    });
    $('levelSel').onchange = function () {
      G.level = $('levelSel').value;
      S.setSetting('level', G.level);
      addLog('Уровень компьютера: ' + (LEVEL_RU[G.level] || G.level) + '.', 'info');
      renderGameTab(); save();
    };
    function bindName(id, color) {
      $(id).onchange = function () {
        var v = $(id).value.trim();
        S.setSetting(color === 'w' ? 'meWhite' : 'meBlack', v);
        renderCaps();
      };
    }
    bindName('nameWhite', 'w');
    bindName('nameBlack', 'b');
    $('chkPanelAuto').onchange = function () {
      S.setSetting('panelAutoOpen', $('chkPanelAuto').checked);
    };
    $('reminderInput').onchange = function () {
      var v = Math.max(5, Math.min(1000, parseInt($('reminderInput').value, 10) || 30));
      $('reminderInput').value = v;
      S.setSetting('archiveReminder', v);
      renderArchive();
    };

    /* вкладка «Движок» */
    $('engineList').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-ea]');
      if (!b) {
        var card = e.target.closest('[data-engine]');
        if (card) { G.openEngine = G.openEngine === card.dataset.engine ? null : card.dataset.engine; renderEngineTab(); }
        return;
      }
      if (b.disabled) return;
      if (b.dataset.ea === 'about') {
        G.openEngine = G.openEngine === b.dataset.e ? null : b.dataset.e;
        renderEngineTab();
      } else if (b.dataset.ea === 'use') {
        if (b.dataset.e === 'rodent4') useRodent();
        else {
          E.setActive(b.dataset.e);
          S.setSetting('engine', b.dataset.e);
          addLog('Активный движок: <b>' + esc(E.byId(b.dataset.e).name) + '</b>.', 'arch');
          render();
        }
      }
    });
    $('rodentFile').onchange = function () { onEngineFile($('rodentFile')); };
    $('btnRodentExe').onclick = function () {
      if (!P.nativeEngineAvailable()) {
        toast('ТОЛЬКО В ДЕСКТОП-ВЕРСИИ', 'info', 'в браузере Rodent IV подключается своей WASM-сборкой через поле выше');
        return;
      }
      P.pickEngineFile().then(function (res) {
        if (!res || res.canceled || !res.path) return;
        pushEngineLog('запуск процесса: ' + res.path);
        return E.startNative(res.path).then(function (r) {
          pushEngineLog('движок запущен: ' + JSON.stringify(r));
          S.setSettings({ engine: 'rodent4', engineExe: res.path });
          addLog('<b>Rodent IV запущен как процесс</b> (' + esc(res.path) + ').', 'arch');
          toast('RODENT IV ЗАПУЩЕН', 'arch', 'нативный процесс, UCI-поток подключён');
          render();
        });
      }).catch(function (err) {
        pushEngineLog('ошибка запуска процесса: ' + err.message);
        toast('ДВИЖОК НЕ ЗАПУСТИЛСЯ', 'check', err.message);
      });
    };
    $('btnRodentUse').onclick = useRodent;
    $('btnRodentTest').onclick = function () { testEngine('rodent4'); };
    $('btnRodentDel').onclick = function () { deleteEngine('rodent4'); };
    var drop = $('rodentDrop');
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      $('rodentFile').files = e.dataTransfer.files;
      onEngineFile($('rodentFile'));
    });

    /* вкладка «Позиция» */
    $('btnCopyFen').onclick = function () {
      $('fenInput').value = C.toFen(cur());
      copyText(C.toFen(cur()), 'FEN позиции');
    };
    $('btnLichessFen').onclick = function () {
      $('fenInput').value = C.toFen(cur());
      openLichess(C.toFen(cur()), C.toFen(cur()));
    };
    $('fenText').onclick = function () { $('fenInput').value = C.toFen(cur()); $('fenInput').focus(); };
    $('btnLoadFen').onclick = function () {
      var v = $('fenInput').value;
      if (!v.trim()) { toast('Пусто', 'info', 'вставьте FEN в поле'); sfx('no'); return; }
      confirmBox('Выставить позицию?', 'Текущая партия будет заменена позицией из FEN. Ходы текущей партии пропадут (сохраните её в архив, если она нужна).', 'Выставить', true, function (ok) {
        if (ok) loadFen(v);
      });
    };
    $('fenInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $('btnLoadFen').click(); }
    });
    $('btnCopyPgn').onclick = function () { copyText(pgnFor({}), 'PGN текущей партии'); };
    $('btnLichessPgn').onclick = function () { openLichess(pgnFor({}), null); };
    $('btnDownloadPgn').onclick = function () {
      downloadText('partiya.pgn', pgnFor({}), function () { toast('Файл сохранён', 'info', 'partiya.pgn'); });
    };

    /* клавиатура */
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (G.modal) { if (e.key === 'Escape') closeModal(); return; }
      if (typing) return;
      var k = e.key;
      if (k === 'ArrowLeft') { e.preventDefault(); navigate(G.view - 1); }
      else if (k === 'ArrowRight') { e.preventDefault(); navigate(G.view + 1); }
      else if (k === 'ArrowUp') { e.preventDefault(); navigate(0); }
      else if (k === 'ArrowDown') { e.preventDefault(); navigate(lastIdx()); }
      else if (k === 'f' || k === 'F' || k === 'а' || k === 'А') flipBoard();
      else if (k === 'z' || k === 'Z' || k === 'я' || k === 'Я') { if (e.ctrlKey || e.metaKey) e.preventDefault(); undo(); }
      else if (k === 'n' || k === 'N' || k === 'т' || k === 'Т') newGame(false);
      else if (k === 'Escape') {
        var w = $('soundPop');
        if (w.classList.contains('open')) { w.classList.remove('open'); return; }
        if (panelOpen()) { closePanel(); return; }
        if (G.playback) { closePlayback(); return; }
        G.selected = null; G.targets = []; renderBoard();
      }
      else if (k === 'm' || k === 'M' || k === 'ь' || k === 'Ь') { togglePanel(); }
      else if (k === 'F11') { e.preventDefault(); toggleFullscreen(); }
    });
  }

  function toggleSound() {
    G.sound = !G.sound;
    if (G.sound && G.volume <= 0) G.volume = 0.75;
    S.setSettings({ sound: G.sound, volume: G.volume });
    if (G.sound) sfx('move');
    renderControls(); save();
  }

  /* ============================ СТАРТ ============================ */
  /* офлайн-режим: кэшируем приложение сервис-воркером, если страница открыта
     по http(s) и рядом лежит sw.js. В песочницах, на file:// и в обёртке — пропускаем. */
  function registerServiceWorker() {
    try {
      if (!navigator.serviceWorker) return;
      if (!/^https?:$/.test(location.protocol)) return;
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        addLog('Офлайн-режим включён: приложение закэшировано сервис-воркером.', 'info');
        var seen = 0;
        reg.addEventListener('updatefound', function () {
          var nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', function () {
            if (nw.state === 'installed' && seen++ === 0 && navigator.serviceWorker.controller) {
              toast('ДОСТУПНА НОВАЯ ВЕРСИЯ', 'info', 'применится при следующем открытии');
            }
          });
        });
      }).catch(function () { /* sw.js рядом нет — работаем как обычно */ });
    } catch (e) { /* регистрация не критична */ }
  }

  /* меню десктоп-обёртки дублирует частые действия */
  function bindDesktopMenu() {
    P.onMenu('new', function () { newGame(false); });
    P.onMenu('undo', function () { undo(); });
    P.onMenu('save', function () { openPanel('archive'); var b = $('btnSaveGame'); if (b) b.click(); });
    P.onMenu('offload', function () { openPanel('archive'); var b = $('btnOffload'); if (b) b.click(); });
    P.onMenu('flip', flipBoard);
    P.onMenu('panel', function () { togglePanel(); });
    P.onMenu('marks', function () { clearMarks(false); });
    P.onMenu('fen', function () { openPanel('position'); $('btnCopyFen').click(); });
    P.onMenu('pgn', function () { openPanel('position'); $('btnCopyPgn').click(); });
    P.onMenu('lichess', function () { openLichess(pgnFor({}), null); });
    P.onMenu('help', showHelp);
  }

  function init() {
    S.reload();                 /* перечитываем хранилище (важно при загрузке страницы) */
    var moved = S.migrateLocalStorageArchive();
    if (moved) addLog('Архив партий (' + moved + ' ' + plural(moved, 'партия', 'партии', 'партий') +
      ') перенесён из localStorage в файл на устройстве: ограничения браузера больше не действуют.', 'arch');
    document.body.classList.toggle('desktop', P.isDesktop());
    E.on('info', function (d) {
      pushEngineLog('info depth ' + (d.depth || '?') + (d.score !== undefined ? ' score ' + d.score : '') +
        (d.nodes ? ' nodes ' + d.nodes : ''));
    });
    E.on('error', function (d) {
      pushEngineLog('ошибка движка: ' + d.message);
      toast('СБОЙ ДВИЖКА', 'check', d.message);
      G.thinking = false;
      render();
    });
    E.restoreInstalled().then(function () { render(); }).catch(function () { });
    P.notifyReady();
    registerServiceWorker();
    bindDesktopMenu();
    bind();
    var restored = restore();
    if (!restored) {
      var s = C.startState();
      G.states = [s]; G.moves = []; G.sans = []; G.result = null;
      G.keys = [C.positionKey(s, C.legalMoves(s))];
    }
    if (!S.logs().length) {
      addLog('Шахматы запущены. Играйте за обе стороны на одной доске.', 'info');
    } else if (restored) {
      addLog('Партия восстановлена (' + G.sans.length + ' ход.).', 'info');
    }
    switchTab(G.tab);
    render();
    var fv = $('footVersion');
    if (fv) fv.innerHTML = 'Шахматы <b>' + esc(APP_VERSION) + '</b>' +
      (BUILD_STAMP ? ' · сборка ' + esc(BUILD_STAMP) : '') +
      ' · данных в хранилище: ' + esc(S.usageLabel());
    /* на компьютере меню открыто сразу: окно большое, и панель не мешает доске */
    if (P.isDesktop() && S.settings().panelAutoOpen !== false) openPanel(G.tab);
    /* и сразу во весь экран, если пользователь не отключил это в настройках */
    if (P.isDesktop() && S.settings().startFullscreen !== false) P.setFullscreen(true);
    maybeBot();
  }

  window.ChessApp = {
    G: G, newGame: newGame, doMove: doMove, undo: undo, navigate: navigate,
    flip: flipBoard, resign: resign, agreeDraw: agreeDraw, setMode: setMode,
    select: select, toast: toast, pgn: function () { return pgnFor({}); },
    render: render, canPlay: canPlay, loadFen: loadFen, validateFen: validateFen,
    cur: cur, switchTab: switchTab, saveCurrentGame: saveCurrentGame, importPgn: importPgn,
    openPlayback: openPlayback, closePlayback: closePlayback, offloadArchive: offloadArchive,
    openPanel: openPanel, closePanel: closePanel, togglePanel: togglePanel, panelOpen: panelOpen,
    renderEngineTab: renderEngineTab, useRodent: useRodent, testEngine: testEngine,
    Engines: E, Platform: P, lichessUrl: lichessUrl, uciToMove: uciToMove,
    LICHESS_FEN: function () {
      return 'https://lichess.org/analysis/' + encodeURIComponent(C.toFen(cur())).replace(/%20/g, '_').replace(/%2F/g, '/');
    },
    openLichess: openLichess, checkQuota: checkQuota, renderQuota: renderQuota,
    showChangelog: showChangelog, CHANGELOG: CHANGELOG,
    toggleAppMenu: toggleAppMenu, appMenuOpen: appMenuOpen, toggleFullscreen: toggleFullscreen,
    showAbout: showAbout, checkUpdates: checkUpdates,
    version: function () {
      return { app: APP_VERSION, build: BUILD_STAMP, env: P.info().env, wrapper: P.info().appVersion };
    }
  };

  /* отложенное сохранение обязательно сбрасываем при уходе со страницы */
  window.addEventListener('pagehide', function () { if (saveTimer) flushSave(); });
  window.addEventListener('beforeunload', function () { if (saveTimer) flushSave(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && saveTimer) flushSave();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
