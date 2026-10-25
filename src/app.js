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
    /* JS-обвязка потока для внешнего UCI-движка (Rodent IV в WASM): сборщик
       заменяет весь этот строковый литерал на текст desktop/rodent4-worker.js,
       поэтому приложение остаётся одним файлом и запускает движок без интернета */
    workerSource: '/*@ENGINEWORKER@*/',
    designer: false,        /* режим дизайнера: красим интерфейс кликом (3.1) */
    designerTarget: null,   /* элемент под курсором и его переменные темы */
    savedId: null,          /* id записи в архиве, если текущая партия сохранена */
    playback: null,         /* просмотр партии из архива */
    live: null,             /* снимок живой партии на время просмотра */
    openPlayer: null,       /* открытый профиль */
    isFull: false,          /* полный экран (для кнопки в настройках) */
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
    if (G.playback) turnHTML += ' · <b style="color:var(--arch-text)">архив</b>';
    else if (!atLatest()) turnHTML += ' · <b style="color:var(--gold)">просмотр истории</b>';
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
          ? ' <span style="color:var(--muted)">Партия сохранена в архив.</span>'
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
    var info = E.installedInfo('rodent4');
    var native = installed && E.isNative('rodent4');
    var detN = E.detectedOptions('rodent4').length;
    $('rodentInfo').innerHTML = installed
      ? (native
        ? ('Подключён исполняемый файл: <b>' + esc(info.name) + '</b> · добавлен ' +
           esc(String(info.added).slice(0, 16).replace('T', ' ')) + '<br>Путь: <code>' + esc(info.path || '') + '</code>' +
           ' — запускается отдельным процессом обёртки, в хранилище браузера не копируется.' +
           (st.native ? '<br><b>Процесс запущен, UCI-поток подключён.</b>' : '<br>Процесс не запущен — нажмите «Проверить».') +
           (detN ? '<br>Движок объявил опций: <b>' + detN + '</b> (видны в карточке движка).' : ''))
        : ('Установлен: <b>' + esc(info.name) + '</b> · ' +
           S.sizeLabel(info.size) + ' · добавлен ' +
           esc(String(info.added).slice(0, 16).replace('T', ' ')) +
           '<br>Хранится в ' + esc(info.storage) + ' — место архива партий не расходуется.' +
           (detN ? '<br>Движок объявил опций: <b>' + detN + '</b>.' : ''))) +
        ((st.active === 'rodent4' && !native) ? '<br><b>Сейчас компьютер играет этим движком.</b>' : '') +
        ((st.active === 'rodent4' && native && st.native) ? '<br><b>Сейчас компьютер играет этим движком.</b>' : '')
      : ('Не установлен. Место подготовлено: каталог движков, UCI-транспорт (Web Worker для WASM-сборки ' +
         'и отдельный процесс для exe), разбор настоящих опций движка, настройка силы через ' +
         'MoveTime/DepthLimit/NodeLimit и пресеты «Лёгкий/Средний/Сильный». Осталось добавить саму сборку: ' +
         'в десктопе — исполняемый файл, в браузере — WASM.');
    $('btnRodentUse').disabled = !installed;
    $('btnRodentTest').disabled = !installed;
    $('btnRodentDel').disabled = !installed;
    var nativeOk = P.nativeEngineAvailable();
    $('btnRodentExe').disabled = !nativeOk;
    $('btnRodentExe').innerHTML = native ? '\u{1F5A5} Перезапустить exe…' : '\u{1F5A5} Выбрать exe…';
    $('btnRodentExe').setAttribute('data-tip', nativeOk
      ? (native ? 'Заново выбрать исполняемый файл Rodent IV и перезапустить процесс'
        : 'Выбрать исполняемый файл Rodent IV и запустить его отдельным процессом')
      : 'Доступно только в десктоп-версии (Electron/Tauri): в браузере добавьте WASM-сборку');
    $('rodentHelp').innerHTML = RODENT_HELP;
  }

  /* Наши параметры поиска (MoveTime/DepthLimit/NodeLimit) идут в команду go,
     а не в setoption: их знает приложение, а не движок, поэтому они показаны
     отдельным блоком и остаются доступными всегда. */
  var GO_OPTS = ['MoveTime', 'DepthLimit', 'NodeLimit'];
  var GO_RU = {
    MoveTime: 'Время на ход, мс', DepthLimit: 'Ограничение глубины', NodeLimit: 'Ограничение по узлам'
  };
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
    function field(op, val) {
      var id = 'opt_' + op.name;
      var lab = '<label for="' + id + '">' + esc(op.label || op.name) +
        ' <span style="color:var(--muted2)">(' + esc(op.name) + ')</span></label>';
      if (op.type === 'check') {
        return '<label class="chk" style="margin:4px 0"><input type="checkbox" id="' + id +
          '" data-opt="' + esc(op.name) + '"' + (val === true || val === 'true' ? ' checked' : '') + '> ' +
          esc(op.label || op.name) + ' <span style="color:var(--muted2)">(' + esc(op.name) + ')</span></label>';
      }
      if (op.type === 'combo') {
        return '<div class="opt-row">' + lab + '<select class="sel" id="' + id + '" data-opt="' + esc(op.name) + '">' +
          (op['var'] || []).map(function (v) {
            return '<option value="' + esc(v) + '"' + (String(v) === String(val) ? ' selected' : '') + '>' + esc(v) + '</option>';
          }).join('') + '</select></div>';
      }
      if (op.type === 'button') {
        return '<div class="opt-row"><span>' + esc(op.label || op.name) +
          ' <span style="color:var(--muted2)">(' + esc(op.name) + ')</span></span>' +
          '<button class="btn btn-mini" data-optbtn="' + esc(op.name) + '">Нажать</button></div>';
      }
      var attrs = op.type === 'spin'
        ? 'type="number"' + (op.min !== undefined ? ' min="' + op.min + '"' : '') + (op.max !== undefined ? ' max="' + op.max + '"' : '')
        : 'type="text"';
      return '<div class="opt-row">' + lab + '<input id="' + id + '" data-opt="' + esc(op.name) + '" ' + attrs +
        ' value="' + esc(val === undefined || val === null ? '' : val) + '"></div>';
    }

    var html = '<div class="lbl" style="margin-top:11px">Сила поиска (команда go)</div>';
    d.uciOptions.filter(function (op) { return GO_OPTS.indexOf(op.name) >= 0; }).forEach(function (op) {
      html += field({ name: op.name, label: GO_RU[op.name] || op.label, type: 'spin', min: op.min, max: op.max },
        o[op.name] !== undefined ? o[op.name] : '');
    });
    html += '<div class="row" style="gap:6px;margin-top:6px">' +
      Object.keys(d.presets).map(function (p) {
        return '<button class="btn btn-mini" data-preset="' + p + '">Пресет: ' + esc(LEVEL_RU[p] || p) + '</button>';
      }).join('') + '</div>';

    /* опции самого движка: настоящий список приходит от него при рукопожатии
       (uciok), а до запуска показываем типовые имена из каталога */
    var det = E.detectedOptions(d.id);
    html += '<div class="lbl" style="margin-top:14px">Параметры движка (setoption)</div>' +
      '<div class="hint" style="margin-bottom:7px">' + (det.length
        ? 'Список получен от самого движка при рукопожатии: ' + det.length + ' настоящих опций с его типами и пределами.'
        : 'Движок ещё не отвечал на uci — показаны типовые опции. Нажмите «Проверить» (или «Выбрать exe…»), и список заменится настоящим.') + '</div>';
    var defs = det.length ? det : d.uciOptions.filter(function (op) { return GO_OPTS.indexOf(op.name) < 0; });
    if (!defs.length) html += '<div class="hint">Движок не объявил ни одной опции.</div>';
    defs.forEach(function (op) {
      var val = o[op.name] !== undefined ? o[op.name] : (op['default'] !== undefined ? op['default'] : '');
      html += field(op, val);
    });
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
        var v;
        if (inp.type === 'checkbox') v = inp.checked;
        else if (inp.type === 'number') { v = parseInt(inp.value, 10); if (isNaN(v)) v = inp.value; }
        else v = inp.value;
        E.setOption(d.id, inp.dataset.opt, v);
        pushEngineLog('setoption name ' + inp.dataset.opt + ' value ' + v);
      };
    });
    /* кнопочные опции UCI (например Clear Hash) значения не имеют */
    document.querySelectorAll('#engineDetail [data-optbtn]').forEach(function (b) {
      b.onclick = function () {
        E.send('setoption name ' + b.dataset.optbtn);
        pushEngineLog('setoption name ' + b.dataset.optbtn);
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

  /* где брать сам движок: приложение его не распространяет (GPL 3.0 и размер),
     но ссылки открывает системным браузером через слой платформы */
  var RODENT_URLS = {
    site: 'http://www.pkoziol.cal24.pl/rodent/download.htm',
    repo: 'https://github.com/nescitus/rodent-iv'
  };
  function openRodentUrl(kind) {
    var url = RODENT_URLS[kind];
    if (!url) return;
    addLog('Открываю страницу Rodent IV: ' + esc(url), 'arch');
    P.openExternal(url).then(function (res) {
      if (!res || !res.ok) toast('БРАУЗЕР НЕ ОТКРЫЛСЯ', 'check', url);
    }).catch(function () { toast('БРАУЗЕР НЕ ОТКРЫЛСЯ', 'check', url); });
  }

  var RODENT_HELP =
    '<b>Что уже сделано в приложении</b><br>' +
    'Каталог движков; установка файла в IndexedDB (вне архива партий); запуск исполняемого файла ' +
    'отдельным процессом в десктоп-обёртке; запуск WASM-сборки в Web Worker (JS-обвязка потока вшита ' +
    'в приложение); протокол UCI (uci / isready / ucinewgame / setoption / position fen / go / stop); ' +
    'чтение настоящих опций движка из рукопожатия uciok; подписка на info и bestmove; перевод хода из ' +
    'нотации UCI (e2e4, e7e8q) в ход на доске; ограничение силы (время на ход, глубина, узлы) и пресеты ' +
    '«Лёгкий / Средний / Сильный»; перезапуск движка при следующем открытии приложения.<br><br>' +
    '<b>Вариант 1 — версия для компьютера (три действия, ничего программировать не нужно)</b><br>' +
    '1. Скачайте Rodent IV: финальный пакет автора — FinalRodent.7z на pkoziol.cal24.pl/rodent/download.htm ' +
    '(или исходники и сборки в репозитории github.com/nescitus/rodent-iv). Движок распространяется под GPL 3.0 ' +
    'и в наше приложение не вложен: вы добавляете свою копию, она остаётся на вашем устройстве.<br>' +
    '2. Распакуйте архив (нужен 7-Zip) и запомните папку: рядом с exe лежат каталоги personalities и books — ' +
    'мы запускаем процесс с рабочей папкой движка, поэтому он найдёт свои файлы.<br>' +
    '3. Здесь нажмите «🖥 Выбрать exe…» и укажите исполняемый файл. Приложение запустит его процессом, ' +
    'спросит uci/isready, прочитает список опций и сделает Rodent IV активным движком.<br>' +
    'Дальше компьютер играет им; путь запоминается, и при следующем запуске процесс поднимется сам. ' +
    'Сила — пресетами внизу карточки движка, стиль — опцией Personality из настоящего списка опций движка.<br><br>' +
    '<b>Вариант 2 — браузер и PWA</b><br>' +
    'Здесь нужен Rodent IV, скомпилированный в WebAssembly (или asm.js): официально движок распространяется ' +
    'только как исполняемый файл, готовой веб-сборки у автора нет. Если вы соберёте её сами (Emscripten, ' +
    'WASI-stdio), перетащите файл в поле выше — обвязка потока уже вшита и ожидает от модуля экспорты ' +
    'init() и commandLine() (или command()), а вывод движка перехватывает через fd_write.<br><br>' +
    '<b>Итого от вас нужен только файл движка.</b> Если запуск не удался — раскройте «Журнал UCI» в карточке ' +
    'движка: там видны все строки обмена. Чаще всего мешают антивирус (блокирует запуск exe), 32-битная ' +
    'сборка без UCI или путь с кириллицей в старой сборке движка.';

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
    E.newGame();
    addLog('Активный движок: <b>Rodent IV</b>. Уровень силы задаётся пресетом UCI.', 'arch');
    toast('RODENT IV АКТИВЕН', 'arch', 'параметры — в карточке движка');
    render();
    /* пробуем запустить: exe — процессом обёртки, WASM-сборку — в Web Worker */
    testEngine('rodent4');
  }
  function testEngine(id) {
    if (!E.isInstalled(id)) { toast('Движок не установлен', 'check', ''); return; }
    pushEngineLog('--- проверка ' + id + (E.isNative(id) ? ' (процесс обёртки)' : ' (Web Worker)') + ' ---');
    E.start(id, { workerSource: G.workerSource }).then(function (r) {
      pushEngineLog('движок готов: ' + JSON.stringify(r));
      var n = E.detectedOptions(id).length;
      if (n) pushEngineLog('опции движка получены: ' + E.detectedOptions(id).map(function (o) { return o.name; }).join(', '));
      toast('ДВИЖОК ОТВЕЧАЕТ', 'arch', id + ' готов к работе' + (n ? ' · опций: ' + n : ''));
      renderEngineTab();
      sfx('save');
    }).catch(function (err) {
      pushEngineLog('ошибка запуска: ' + err.message);
      toast('ДВИЖОК НЕ ЗАПУСТИЛСЯ', 'check', err.message);
      renderEngineTab();
      sfx('no');
    });
  }

  /* Выбор движка восстанавливается из настроек. Вызывается и при старте, и
     после чтения хранилища движков: установка внешнего движка лежит в IndexedDB,
     которая отвечает асинхронно, поэтому на момент restore() её ещё не видно. */
  function restoreEngineChoice() {
    var st = S.settings();
    /* если в настройках значится внешний движок, а его сборки больше нет
       (удалили файл, очистили хранилище), честно возвращаемся к встроенному боту */
    if (!st.engine || st.engine === 'builtin') { E.setActive('builtin'); return false; }
    if (!E.isInstalled(st.engine)) { E.setActive('builtin'); return false; }
    if (E.activeId() !== st.engine) {
      E.setActive(st.engine);
      /* уровень «Лёгкий/Средний/Сильный» для внешнего движка — это пресет UCI */
      E.applyPreset(st.engine, G.level);
    }
    return true;
  }

  /* Перезапуск нативного движка при старте приложения: путь к exe сохранён в
     настройках, а сам процесс после закрытия окна, естественно, не живёт.
     Без этого компьютер после перезапуска молча играл бы встроенным ботом,
     хотя в настройках выбран Rodent IV. */
  function restoreNativeEngine() {
    if (!P.nativeEngineAvailable()) return Promise.resolve(null);
    var st = S.settings();
    if (st.engine !== 'rodent4' || !st.engineExe) return Promise.resolve(null);
    if (!E.isInstalled('rodent4') || !E.isNative('rodent4')) return Promise.resolve(null);
    pushEngineLog('восстанавливаю процесс движка: ' + st.engineExe);
    return E.startNative(st.engineExe).then(function (r) {
      E.setActive('rodent4');
      E.newGame();
      pushEngineLog('движок восстановлен: ' + JSON.stringify(r));
      addLog('<b>Rodent IV</b> запущен снова (' + esc(st.engineExe) + ') — компьютер играет им.', 'arch');
      renderEngineTab();
      return r;
    }).catch(function (err) {
      pushEngineLog('не удалось восстановить движок: ' + err.message);
      addLog('Движок <b>Rodent IV</b> не запустился (' + esc(err.message) + ') — компьютер играет встроенным ботом.', 'check');
      S.setSetting('engine', 'builtin');
      E.setActive('builtin');
      toast('RODENT IV НЕ ЗАПУСТИЛСЯ', 'check', err.message);
      renderEngineTab();
      return null;
    });
  }

  function deleteEngine(id) {
    confirmBox('Удалить файл движка?', 'Сборка будет удалена из локального хранилища (или отключена от исполняемого файла). Архив партий и статистика не пострадают. Компьютер вернётся к встроенному боту.', 'Удалить', true, function (okb) {
      if (!okb) return;
      E.uninstall(id).then(function () {
        S.setSettings({ engine: E.activeId(), engineExe: null });
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
        'Выгрузка в PGN остаётся полезной как резервная копия: кнопка «📦 Выгрузить всё и очистить архив» ' +
        'в окне настроек (⚙ → «Архив») скачивает файл и очищает архив, а статистика профилей сохраняется.';
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
      '<b>Как освободить место.</b> Выгрузите архив одним PGN-файлом: кнопка «📦 Выгрузить всё и очистить архив» ' +
      'в окне настроек (⚙ → «Архив»). Файл скачается, архив очистится, а статистика профилей останется. ' +
      'Держать в браузере только недавние партии — рекомендуемый режим.';
  }

  function renderArchive() {
    var list = S.archive();
    var bytes = S.archiveBytes();
    var remind = parseInt(S.settings().archiveReminder, 10) || 30;
    var remindOn = S.settings().archiveReminderOn !== false;
    renderQuota();
    var info = $('archInfo');
    var over = remindOn && list.length >= remind;
    info.className = 'arch-info' + (over ? ' warn' : '');
    info.innerHTML = 'В архиве <b>' + list.length + '</b> ' + plural(list.length, 'партия', 'партии', 'партий') +
      ' · ' + S.sizeLabel(bytes) + '<br>Занято хранилищем: ' + S.usageLabel() +
      (over ? '<br>Накопилось много партий — выгрузите их в PGN-файл, архив очистится, а статистика профилей останется.'
        : (remindOn
          ? '<br>Напоминание о выгрузке — каждые ' + remind + ' ' + plural(remind, 'партию', 'партии', 'партий') + '.'
          : '<br>Напоминание о выгрузке отключено — включить можно в настройках (⚙ → «Архив»).'));
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
    if (S.settings().archiveReminderOn === false) return;   /* пользователь отключил напоминания */
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
    var body = $('playersBody');
    if (!ps.length) {
      body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted2);padding:16px">Профилей пока нет. ' +
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
          '</span><span style="margin-left:auto;color:var(--muted)">' + mine + ' · ' + res + '</span></div>';
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

  /* ============================ ОКНО НАСТРОЕК (⚙) ============================
     Заменило меню приложения «⋮» и отдельную кнопку «?»: дубли кнопок убраны,
     технические пункты собраны в полноценном окне с категориями (Вид, Архив,
     Движок, Журнал, Справка, О программе). Клик по категории прокручивает к
     разделу; можно просто листать окно — боковина подсвечивает текущий раздел.
     Секции окна постоянно живут в DOM, поэтому журнал, движок и галочки
     доступны коду в любой момент, а окно открывается мгновенно. */
  var SET_CATS = ['view', 'colors', 'archive', 'engine', 'events', 'help', 'about'];
  function settingsOpen() { return $('setWin').classList.contains('open'); }
  function setNavActive(cat) {
    document.querySelectorAll('#setNav button').forEach(function (b) { b.classList.toggle('on', b.dataset.sc === cat); });
  }
  function scrollToCat(cat) {
    setNavActive(cat);
    var sec = document.querySelector('#setScroll section[data-set="' + cat + '"]');
    var sc = $('setScroll');
    if (sec && sc) { try { sc.scrollTop = Math.max(0, sec.offsetTop - 10); } catch (e) { /* нет раскладки — остаётся подсветка */ } }
  }
  function buildSettingsContent() {
    var rules = $('helpRules');
    if (rules) rules.innerHTML = RULES_HTML;
    var ch = $('helpChangelog');
    if (ch) {
      var html = '';
      CHANGELOG.forEach(function (row) {
        html += '<h3>Версия ' + esc(row[0]) + '</h3><p>' + esc(row[1]) + '</p>';
      });
      ch.innerHTML = html;
    }
    buildThemeUI();
  }
  function renderAbout() {
    var i = P.info();
    var q = S.quotaInfo();
    var vl = $('versionLine');
    if (vl) {
      vl.innerHTML = 'Версия приложения: <b>' + esc(APP_VERSION) + '</b>' +
        (BUILD_STAMP ? ' · сборка ' + esc(BUILD_STAMP) : '') +
        ' · режим: <b>' + esc(i.desktop ? 'компьютер (' + i.env + ')' : 'браузер') + '</b>' +
        (i.desktop && i.appVersion ? ' · обёртка ' + esc(i.appVersion) : '') +
        '.<br>Обновления: браузер — перезагрузка страницы; PWA — сервис-воркер применит новую версию сам; ' +
        'компьютер — кнопка «Проверить обновления» ниже.';
    }
    var ai = $('aboutInfo');
    if (ai) {
      /* в режиме «без ограничений» (десктоп-файл или снятый лимит браузера)
         quotaInfo возвращает limit/pct = null — учитываем это, иначе toFixed(null)
         ронял раздел «О программе» в десктопе */
      var quotaLine = q.unlimited
        ? 'Партий в архиве: ' + S.countGames() + ' · занято архивом ' + S.sizeLabel(q.used) +
          ' — без ограничений' + (q.path ? ' (файл ' + esc(q.path) + ')' : '') + '.'
        : 'Партий в архиве: ' + S.countGames() + ' · занято архивом ' + S.sizeLabel(q.used) +
          ' из ' + S.sizeLabel(q.limit) + ' (' + (typeof q.pct === 'number' ? q.pct : 0).toFixed(0) + '%).';
      ai.innerHTML = quotaLine + '<br>Всего данных в хранилище: ' + esc(S.usageLabel()) + '.' +
        '<br>Полные правила шахмат, игра за обе стороны, компьютер, архив партий в PGN, профили соперников, ' +
        'стрелки разбора и место под внешние движки (Rodent IV). Один файл, работает без интернета.';
    }
  }
  /* живые данные окна настроек: журнал, движок, «О программе», галочки */
  function renderSettingsLive() {
    renderEvents();
    renderEngineTab();
    renderAbout();
    renderColorsLive();
    var cp = $('chkPanelAuto');
    if (cp) cp.checked = S.settings().panelAutoOpen !== false;
    var cf = $('chkFullStart');
    if (cf) cf.checked = S.settings().startFullscreen !== false;
    var cr = $('chkReminder');
    if (cr) {
      var on = S.settings().archiveReminderOn !== false;
      cr.checked = on;
      $('reminderInput').disabled = !on;
      setVal($('reminderInput'), S.settings().archiveReminder);
    }
    var ca = $('chkAutoFlip');
    if (ca) { ca.checked = !!G.autoFlip; ca.disabled = !!botColor(); }
    var cn = $('chkCountAnon');
    if (cn) cn.checked = S.settings().countAnon !== false;
    var sai = $('setArchInfo');
    if (sai) {
      var n = S.countGames();
      sai.innerHTML = 'В архиве <b>' + n + '</b> ' + plural(n, 'партия', 'партии', 'партий') +
        ' · ' + S.sizeLabel(S.archiveBytes()) +
        '. Список партий, поиск и шкала места — во вкладке «Архив» бокового меню.';
    }
    var fs = $('btnSetFullscreen');
    if (fs) fs.innerHTML = G.isFull ? '\u{1F5D7} Выйти из полного экрана' : '\u{1F5A5} Полный экран';
    /* кнопка выхода из приложения видна только там, где приложение есть чем
       закрыть: в браузере вкладку из страницы не закрыть, поэтому скрываем */
    var qb = $('btnQuitApp');
    if (qb) qb.hidden = !P.isDesktop();
  }
  function openSettings(cat) {
    hideTip();
    var sp = $('soundPop');
    if (sp.classList.contains('open')) {
      sp.classList.remove('open');
      $('btnSound').setAttribute('aria-expanded', 'false');
    }
    buildSettingsContent();
    renderSettingsLive();
    $('setWin').classList.add('open');
    $('setWin').setAttribute('aria-hidden', 'false');
    $('setBg').classList.add('on');
    $('btnSettings').setAttribute('aria-expanded', 'true');
    document.body.classList.add('settings-open');
    scrollToCat(SET_CATS.indexOf(cat) >= 0 ? cat : 'view');
    sfx('click');
  }
  function closeSettings() {
    hideTip();
    $('setWin').classList.remove('open');
    $('setWin').setAttribute('aria-hidden', 'true');
    $('setBg').classList.remove('on');
    $('btnSettings').setAttribute('aria-expanded', 'false');
    document.body.classList.remove('settings-open');
  }
  function toggleSettings() { if (settingsOpen()) closeSettings(); else openSettings(); }
  function toggleFullscreen() {
    P.isFullscreen().then(function (on) {
      P.setFullscreen(!on);
      toast(!on ? 'ПОЛНЫЙ ЭКРАН' : 'ОКОННЫЙ РЕЖИМ', 'info', 'F11 — переключить обратно');
    });
  }

  /* ============================ ПОДСКАЗКИ КНОПОК ============================
     Один общий элемент #tip под <body> (position:fixed, верхний слой).
     Старые CSS-подсказки через ::after внутри прокручиваемых панелей
     обрезались краями секций, прятались под вкладки и растягивали панель
     горизонтальным ползунком; теперь подсказка всегда видна целиком,
     а длинный текст переносится по словам. */
  var tipEl = null, tipTxt = null, tipArrow = null, tipOwner = null;
  function ensureTip() {
    if (tipEl) return tipEl;
    tipEl = document.createElement('div');
    tipEl.id = 'tip';
    tipEl.className = 'js-tip';
    tipEl.setAttribute('role', 'tooltip');
    tipArrow = document.createElement('span');
    tipArrow.className = 'tip-arrow';
    tipTxt = document.createElement('span');
    tipTxt.className = 'tip-txt';
    tipEl.appendChild(tipArrow);
    tipEl.appendChild(tipTxt);
    tipEl.hidden = true;
    document.body.appendChild(tipEl);
    return tipEl;
  }
  function showTip(el) {
    /* в режиме дизайнера подсказки не показываем: там своя подпись элемента
       (рамка подсветки), и два слоя текста поверх интерфейса мешают целиться */
    if (G.designer) { hideTip(); return; }
    var text = el.getAttribute('data-tip');
    if (!text) { hideTip(); return; }
    ensureTip();
    tipOwner = el;
    tipTxt.textContent = text;
    tipEl.hidden = false;
    tipEl.classList.remove('above', 'below');
    var r = el.getBoundingClientRect();
    var vw = window.innerWidth || 1024, vh = window.innerHeight || 768;
    var tw = tipEl.offsetWidth || 0, th = tipEl.offsetHeight || 0;
    /* вниз, если помещается; иначе вверх; совсем не помещается — прижать к краю */
    var below = r.bottom + 10 + th <= vh - 6 || r.top - 10 - th < 6;
    var top = below ? r.bottom + 9 : Math.max(6, r.top - th - 9);
    var left = Math.round(r.left + r.width / 2 - tw / 2);
    left = Math.max(6, Math.min(left, Math.max(6, vw - tw - 6)));
    tipEl.style.top = Math.round(top) + 'px';
    tipEl.style.left = left + 'px';
    tipEl.classList.add(below ? 'below' : 'above');
    var ax = Math.round(r.left + r.width / 2 - left);
    tipArrow.style.left = Math.max(12, Math.min(ax, Math.max(12, tw - 12))) + 'px';
  }
  function hideTip() {
    tipOwner = null;
    if (tipEl) tipEl.hidden = true;
  }
  function tipFromEvent(e) {
    var t = e.target;
    return t && t.closest ? t.closest('[data-tip]') : null;
  }
  function bindTooltips() {
    document.addEventListener('pointerover', function (e) {
      var t = tipFromEvent(e);
      if (t === tipOwner) return;
      if (t) showTip(t); else hideTip();
    });
    document.addEventListener('pointerout', function (e) {
      if (!tipOwner) return;
      var to = e.relatedTarget;
      if (to && tipOwner.contains && tipOwner.contains(to)) return;   /* движение внутри кнопки */
      hideTip();
    });
    document.addEventListener('pointerdown', function () { hideTip(); }, true);
    document.addEventListener('scroll', function () { hideTip(); }, true);
    window.addEventListener('resize', hideTip);
    document.addEventListener('focusin', function (e) { var t = tipFromEvent(e); if (t) showTip(t); });
    document.addEventListener('focusout', hideTip);
  }

  /* ============================ ЦВЕТОВАЯ ТЕМА (3.0) ============================
     Категория «Цвета» в окне настроек: реестр из 72 элементов интерфейса и
     доски (Theme.GROUPS), HSL-пипетка с палитрой, HEX-полем, прозрачностью и
     двухцветными градиентами, 7 готовых палитр, экспорт/импорт темы в JSON и
     точечная раскраска отдельных клеток (расширенный режим, по умолчанию
     выключен — как и договаривались, сначала только общие цвета клеток).
     Переопределения живут в настройках (theme, sqColors, themeAdv) и
     применяются элементом <style id="themeCss"> в конце <head>: он
     перекрывает переменные :root и, в расширенном режиме, фон отдельных
     клеток по их постоянному индексу data-sq (0…63, a1…h8). */
  var T = window.Theme || null;

  function themeStore() {
    var st = S.settings();
    return {
      vars: (st.theme && typeof st.theme === 'object' && !Array.isArray(st.theme)) ? st.theme : {},
      sq: (st.sqColors && typeof st.sqColors === 'object' && !Array.isArray(st.sqColors)) ? st.sqColors : {},
      adv: st.themeAdv === true
    };
  }
  function applyThemeNow() {
    if (!T) return;
    var t = themeStore();
    T.apply(t.vars, t.sq, t.adv);
  }

  /* ---------- построение раздела (один раз за сессию) ---------- */
  function buildThemeUI() {
    if (!T) return;
    var pres = $('themePresets');
    if (pres && !pres.childElementCount) {
      var ph = '';
      T.PRESETS.forEach(function (p) {
        ph += '<button class="btn btn-mini" data-preset="' + esc(p.id) + '" data-tip="' +
          (p.vars ? 'Применить готовую палитру «' + esc(p.name) + '»' : 'Вернуть цвета по умолчанию') + '">' +
          esc(p.name) + '</button>';
      });
      pres.innerHTML = ph;
    }
    var gr = $('themeGroups');
    if (gr && !gr.childElementCount) {
      var gh = '';
      T.GROUPS.forEach(function (g) {
        gh += '<details class="tgroup" data-gr="' + esc(g.id) + '"><summary>' + esc(g.name) +
          '<span class="tg-count" hidden></span></summary><div>';
        g.items.forEach(function (it) {
          gh += '<div class="titem" data-var="' + esc(it.v) + '" data-tip="Изменить цвет: ' + esc(it.n) + '">' +
            '<button class="tsw" type="button" aria-label="Изменить цвет: ' + esc(it.n) + '"><i></i></button>' +
            '<span class="tname">' + esc(it.n) + '</span>' +
            '<code class="tcur"></code>' +
            '<button class="trst" data-tip="Сбросить к значению по умолчанию" hidden>✕</button>' +
            '</div>';
        });
        gh += '</div></details>';
      });
      gr.innerHTML = gh;
    }
    var mb = $('miniBoard');
    if (mb && !mb.childElementCount) {
      var mh = '';
      for (var drow = 0; drow < 8; drow++) {          /* верхний ряд — 8-я горизонталь */
        for (var f = 0; f < 8; f++) {
          var sq = (7 - drow) * 8 + f;
          mh += '<button data-msq="' + sq + '"><i></i></button>';
        }
      }
      mb.innerHTML = mh;
      var rk = $('miniRanks');
      if (rk && !rk.childElementCount) {
        var rh = '';
        for (var r = 8; r >= 1; r--) rh += '<span>' + r + '</span>';
        rk.innerHTML = rh;
      }
      var fl = $('miniFiles');
      if (fl && !fl.childElementCount) {
        fl.innerHTML = 'abcdefgh'.split('').map(function (c) { return '<span>' + c + '</span>'; }).join('');
      }
    }
  }

  /* ---------- живое обновление раздела ---------- */
  function renderColorsLive() {
    if (!T) return;
    var t = themeStore();
    document.querySelectorAll('#themeGroups .titem').forEach(function (row) {
      var v = row.dataset.var;
      var val = T.effective(t.vars, v);
      var sw = row.querySelector('.tsw i');
      if (sw) sw.style.background = val;
      var cur = row.querySelector('.tcur');
      if (cur) cur.textContent = val;
      var rst = row.querySelector('.trst');
      if (rst) rst.hidden = !Object.prototype.hasOwnProperty.call(t.vars, v);
    });
    document.querySelectorAll('#themeGroups .tgroup').forEach(function (g) {
      var n = 0;
      g.querySelectorAll('.trst').forEach(function (b) { if (!b.hidden) n++; });
      var c = g.querySelector('.tg-count');
      if (c) { c.hidden = (n === 0); c.textContent = 'изменено: ' + n; }
    });
    var chk = $('chkThemeAdv');
    if (chk) chk.checked = t.adv;
    var ed = $('sqEditor');
    if (ed) ed.hidden = !t.adv;
    if (t.adv) {
      var nSq = 0;
      document.querySelectorAll('#miniBoard button').forEach(function (b) {
        var sq = parseInt(b.dataset.msq, 10);
        var own = Object.prototype.hasOwnProperty.call(t.sq, String(sq));
        if (own) nSq++;
        var val = own ? t.sq[String(sq)] : T.effective(t.vars, T.squareIsDark(sq) ? '--dark' : '--light');
        var i = b.querySelector('i');
        if (i) i.style.background = val;
        b.classList.toggle('own', own);
        b.setAttribute('data-tip', 'Клетка ' + C.nameOf(sq) +
          (own ? ' — собственный цвет, клик меняет его' : ' — клик задать собственный цвет'));
        b.setAttribute('aria-label', 'Клетка ' + C.nameOf(sq) + (own ? ', собственный цвет' : ''));
      });
      var info = $('sqEditorInfo');
      if (info) info.innerHTML = 'Раскрашено клеток: <b>' + nSq + '</b> из 64';
    }
  }

  /* ---------- HSL-пипетка ----------
     target: { v:'--light' } — элемент реестра, { sq: 12 } — клетка доски.
     Во время регулировки значение применяется «вживую» ко всему
     приложению; «Применить» сохраняет его в настройки, «Отмена» и Esc
     откатывают предпросмотр (хук G.pickerCancel в closeModal). */
  function openColorPicker(target) {
    if (!T || !target) return;
    var t = themeStore();
    var isSq = (target.sq !== undefined && target.sq !== null);
    var item = null, name = '', curVal = '', sq = 0;
    if (isSq) {
      sq = parseInt(target.sq, 10) || 0;
      name = 'Клетка ' + C.nameOf(sq);
      curVal = Object.prototype.hasOwnProperty.call(t.sq, String(sq))
        ? t.sq[String(sq)]
        : T.effective(t.vars, T.squareIsDark(sq) ? '--dark' : '--light');
    } else {
      item = T.BY_VAR[target.v];
      if (!item) return;
      name = item.n;
      curVal = T.effective(t.vars, item.v);
    }
    var canGrad = isSq ? true : !!item.g;

    function cc(o) { return { h: o.h, s: o.s, l: o.l, a: o.a }; }
    var st = { grad: false, angle: 145, c1: null, c2: null, main: null, active: 'main' };
    var g = T.parseGradient(curVal);
    if (g && canGrad) {
      st.grad = true; st.angle = g.angle; st.c1 = g.c1; st.c2 = g.c2;
      st.main = cc(g.c1); st.active = 'c1';
    } else {
      var c0 = T.parseColor(curVal) || (g ? g.c1 : null) || { h: 222, s: 40, l: 40, a: 1 };
      st.main = cc(c0);
      st.c1 = cc(c0);
      st.c2 = cc({ h: c0.h, s: c0.s, l: Math.max(0, c0.l - 18), a: c0.a });
    }

    var palH = '';
    T.PALETTE.forEach(function (col) {
      palH += '<button class="cp-pal" data-c="' + col + '" style="background:' + col + '" title="' + col + '" aria-label="Цвет ' + col + '"></button>';
    });
    var html = '<h2>🎨 ' + esc(name) + '</h2>' +
      '<div class="cp-top">' +
        '<div class="cp-preview"><i id="cpPrev"></i></div>' +
        '<div class="cp-right"><div class="cp-palette">' + palH + '</div><div class="cp-val" id="cpVal"></div></div>' +
      '</div>' +
      '<div class="cp-row"><span class="cp-lab">Тон (H)</span><input type="range" id="cpH" min="0" max="360" step="1" aria-label="Тон"><span class="cp-num" id="cpHn"></span></div>' +
      '<div class="cp-row"><span class="cp-lab">Насыщенность (S)</span><input type="range" id="cpS" min="0" max="100" step="1" aria-label="Насыщенность"><span class="cp-num" id="cpSn"></span></div>' +
      '<div class="cp-row"><span class="cp-lab">Светлота (L)</span><input type="range" id="cpL" min="0" max="100" step="1" aria-label="Светлота"><span class="cp-num" id="cpLn"></span></div>' +
      '<div class="cp-row"><span class="cp-lab">Прозрачность (A)</span><input type="range" id="cpA" min="0" max="100" step="1" aria-label="Прозрачность"><span class="cp-num" id="cpAn"></span></div>' +
      '<div class="cp-row"><span class="cp-lab">HEX-код</span><input class="inp cp-hex" id="cpHex" maxlength="9" spellcheck="false" aria-label="HEX-код"><span class="cp-target-hint" id="cpTarget"></span></div>' +
      (canGrad
        ? '<label class="chk"><input type="checkbox" id="cpGrad"> Двухцветный градиент</label>' +
          '<div id="cpGradBox" hidden>' +
            '<div class="cp-row"><span class="cp-lab">Угол</span><input type="range" id="cpAngle" min="0" max="360" step="1" aria-label="Угол градиента"><span class="cp-num" id="cpAnglen"></span></div>' +
            '<div class="cp-stops">' +
              '<button class="cp-stop" id="cpStop1" type="button"><i></i>Начало</button>' +
              '<button class="cp-stop" id="cpStop2" type="button"><i></i>Конец</button>' +
            '</div>' +
            '<div class="cp-grad-preview" id="cpGradPrev"></div>' +
            '<div class="cp-target-hint">Ползунки выше меняют цвет выбранного стопа градиента.</div>' +
          '</div>'
        : '<div class="cp-target-hint">Для этого элемента градиент недоступен: значение подставляется внутрь других цветов.</div>') +
      '<div class="btns" style="grid-template-columns:1fr 1fr 1fr;margin-top:12px">' +
        '<button class="btn" data-a="def" data-tip="Вернуть значение по умолчанию">↺ По умолчанию</button>' +
        '<button class="btn" data-a="cancel">Отмена</button>' +
        '<button class="btn primary" data-a="ok">Применить</button>' +
      '</div>';
    var box = openModal(html, true);
    /* Живой предпросмотр должен быть виден: фон пипетки делается лёгким, а окно
       настроек (если пипетку открыли из раздела «Цвета») уходит в полупрозрачность.
       Иначе пользователь двигает ползунки, глядя на затемнённый фон, и не понимает,
       что именно меняется. Класс снимается в closeModal. */
    if (box.parentNode) box.parentNode.classList.add('see-through');
    document.body.classList.add('picker-open');

    var $h = box.querySelector('#cpH'), $s = box.querySelector('#cpS'),
      $l = box.querySelector('#cpL'), $a = box.querySelector('#cpA'),
      $hn = box.querySelector('#cpHn'), $sn = box.querySelector('#cpSn'),
      $ln = box.querySelector('#cpLn'), $an = box.querySelector('#cpAn'),
      $hex = box.querySelector('#cpHex'), $prev = box.querySelector('#cpPrev'),
      $val = box.querySelector('#cpVal'), $tgt = box.querySelector('#cpTarget'),
      $gchk = box.querySelector('#cpGrad'), $gbox = box.querySelector('#cpGradBox'),
      $ang = box.querySelector('#cpAngle'), $angn = box.querySelector('#cpAnglen'),
      $st1 = box.querySelector('#cpStop1'), $st2 = box.querySelector('#cpStop2'),
      $gprev = box.querySelector('#cpGradPrev');

    function activeColor() {
      if (st.grad) return st.active === 'c2' ? st.c2 : st.c1;
      return st.main;
    }
    function draftValue() {
      return st.grad ? T.fmtGradient(st.angle, st.c1, st.c2) : T.fmtColor(st.main);
    }
    function livePreview(v) {
      if (!T.validValue(v)) return;
      if (isSq) {
        var sqm = Object.assign({}, t.sq);
        sqm[String(sq)] = v;
        T.apply(t.vars, sqm, true);
      } else {
        var vars = Object.assign({}, t.vars);
        vars[item.v] = v;
        T.apply(vars, t.sq, t.adv);
      }
    }
    function updateUI() {
      var c = activeColor();
      $h.value = c.h; $s.value = c.s; $l.value = c.l; $a.value = Math.round(c.a * 100);
      $hn.textContent = c.h + '°';
      $sn.textContent = c.s + '%';
      $ln.textContent = c.l + '%';
      $an.textContent = Math.round(c.a * 100) + '%';
      $h.style.setProperty('--cp-track', 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)');
      $s.style.setProperty('--cp-track', 'linear-gradient(90deg,' + T.fmtColor({ h: c.h, s: 0, l: c.l, a: 1 }) + ',' + T.fmtColor({ h: c.h, s: 100, l: c.l, a: 1 }) + ')');
      $l.style.setProperty('--cp-track', 'linear-gradient(90deg,#000,' + T.fmtColor({ h: c.h, s: c.s, l: 50, a: 1 }) + ',#fff)');
      $a.style.setProperty('--cp-track', 'linear-gradient(90deg,rgba(10,13,26,0),' + T.fmtColor({ h: c.h, s: c.s, l: c.l, a: 1 }) + ')');
      var rgb = T.hslToRgb(c.h, c.s, c.l);
      $hex.value = T.rgbToHex(rgb.r, rgb.g, rgb.b);
      var v = draftValue();
      $prev.style.background = v;
      $val.textContent = v;
      if (canGrad) {
        $gbox.hidden = !st.grad;
        $gchk.checked = st.grad;
        if (st.grad) {
          $ang.value = st.angle;
          $angn.textContent = st.angle + '°';
          $st1.querySelector('i').style.background = T.fmtColor(st.c1);
          $st2.querySelector('i').style.background = T.fmtColor(st.c2);
          $st1.classList.toggle('on', st.active === 'c1');
          $st2.classList.toggle('on', st.active === 'c2');
          $gprev.style.background = T.fmtGradient(st.angle, st.c1, st.c2);
        }
      }
      $tgt.textContent = st.grad
        ? (st.active === 'c2' ? 'Редактируется конец градиента' : 'Редактируется начало градиента')
        : '';
      livePreview(v);
    }

    [$h, $s, $l, $a].forEach(function (el) {
      el.addEventListener('input', function () {
        var c = activeColor();
        c.h = parseInt($h.value, 10); c.s = parseInt($s.value, 10);
        c.l = parseInt($l.value, 10); c.a = parseInt($a.value, 10) / 100;
        updateUI();
      });
    });
    $hex.addEventListener('change', function () {
      var raw = String($hex.value || '').trim();
      var rgb = T.hexToRgb(raw);
      if (!rgb) { updateUI(); return; }
      var hsl = T.rgbToHsl(rgb.r, rgb.g, rgb.b);
      var c = activeColor();
      c.h = hsl.h; c.s = hsl.s; c.l = hsl.l;
      var digits = raw.replace(/^#/, '').length;
      if (digits === 4 || digits === 8) c.a = rgb.a;   /* прозрачность — только из 8-значного HEX */
      updateUI();
    });
    box.querySelector('.cp-palette').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.cp-pal') : null;
      if (!b) return;
      var pc = T.parseColor(b.dataset.c);
      if (!pc) return;
      var c = activeColor();
      c.h = pc.h; c.s = pc.s; c.l = pc.l;             /* прозрачность сохраняем */
      updateUI();
    });
    if (canGrad) {
      $gchk.addEventListener('change', function () {
        st.grad = $gchk.checked;
        if (st.grad) {
          st.c1 = cc(st.main);
          st.c2 = cc({ h: st.main.h, s: st.main.s, l: Math.max(0, st.main.l - 18), a: st.main.a });
          st.active = 'c1';
        } else {
          st.main = cc(st.active === 'c2' ? st.c2 : st.c1);
          st.active = 'main';
        }
        updateUI();
      });
      $ang.addEventListener('input', function () { st.angle = parseInt($ang.value, 10); updateUI(); });
      $st1.addEventListener('click', function () { st.active = 'c1'; updateUI(); });
      $st2.addEventListener('click', function () { st.active = 'c2'; updateUI(); });
    }

    function commit(v) {
      if (isSq) {
        var sqm = Object.assign({}, t.sq);
        if (v === null) delete sqm[String(sq)];
        else if (T.validValue(v)) sqm[String(sq)] = v;
        S.setSetting('sqColors', sqm);
      } else {
        var vars = Object.assign({}, t.vars);
        if (v === null) delete vars[item.v];
        else if (T.validValue(v)) vars[item.v] = v;
        S.setSetting('theme', vars);
      }
      G.pickerCancel = null;
      clearFlash();
      closeModal();
      applyThemeNow();
      renderColorsLive();
      sfx('click');
    }
    box.querySelector('[data-a=ok]').addEventListener('click', function () { commit(draftValue()); });
    box.querySelector('[data-a=cancel]').addEventListener('click', function () { closeModal(); });
    box.querySelector('[data-a=def]').addEventListener('click', function () { commit(null); });

    /* Esc и любой другой путь закрытия окна — откат предпросмотра */
    G.pickerCancel = function () { T.apply(t.vars, t.sq, t.adv); clearFlash(); };
    updateUI();
    flashThemeTargets(target);
  }

  /* ---------- подсветка «что именно я крашу» ----------
     При открытии пипетки все элементы, которые красит эта переменная, на
     полторы секунды обводятся золотом: список из 72 названий сам по себе
     не отвечает на вопрос «где это видно?», а подсветка отвечает сразу. */
  var flashTimer = null, flashEls = [];
  function clearFlash() {
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
    (flashEls || []).forEach(function (el) { try { el.classList.remove('flash-var'); } catch (e) { } });
    flashEls = [];
  }
  function flashThemeTargets(target) {
    if (!T) return;
    clearFlash();
    var sels = [];
    if (target && target.sq !== undefined && target.sq !== null) {
      sels = ['#board .sq[data-sq="' + (parseInt(target.sq, 10) || 0) + '"]'];
    } else if (target && target.v) {
      sels = T.selectorsFor(target.v);
      /* переменные, которые app.js ставит инлайн-стилем, ищем по атрибуту */
      if (!sels.length) sels = ['[style*="' + target.v + '"]'];
    }
    var els = [];
    sels.forEach(function (sel) {
      try {
        Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) {
          if (els.length >= 60) return;
          if (el.closest && el.closest('.modal-bg')) return;
          els.push(el);
        });
      } catch (e) { /* селектор не поддерживается — пропускаем */ }
    });
    els.forEach(function (el) {
      el.classList.remove('flash-var');
      void el.offsetWidth;              /* перезапуск анимации */
      el.classList.add('flash-var');
    });
    flashEls = els;
    flashTimer = setTimeout(clearFlash, 1600);
  }

  /* ---------- сброс одного элемента ---------- */
  function resetThemeVar(v) {
    if (!T || !T.validVar(v)) return;
    var vars = Object.assign({}, S.settings().theme || {});
    delete vars[v];
    S.setSetting('theme', vars);
    applyThemeNow();
    renderColorsLive();
  }

  /* ---------- готовые палитры ---------- */
  function applyPreset(id) {
    if (!T) return;
    var p = null;
    T.PRESETS.forEach(function (x) { if (x.id === id) p = x; });
    if (!p) return;
    var vars = {};
    if (p.vars) {
      for (var k in p.vars) {
        if (T.validVar(k) && T.validValue(p.vars[k])) vars[k] = p.vars[k];
      }
    }
    S.setSetting('theme', vars);
    applyThemeNow();
    renderColorsLive();
    toast('ПАЛИТРА «' + p.name.toUpperCase() + '»', 'arch',
      p.vars ? 'Цвета применены — их можно донастроить по элементам' : 'Восстановлены цвета по умолчанию');
  }

  /* ---------- сброс всей темы ---------- */
  function resetTheme() {
    confirmBox('Сбросить цвета?',
      'Цвета всех элементов, клеток и градиенты вернутся к значениям по умолчанию. Действие необратимо.',
      'Сбросить', true, function (yes) {
        if (!yes) return;
        S.setSetting('theme', {});
        S.setSetting('sqColors', {});
        applyThemeNow();
        renderColorsLive();
        toast('ТЕМА СБРОШЕНА', 'info', 'Восстановлено оформление по умолчанию');
      });
  }

  /* ---------- экспорт темы ---------- */
  function exportTheme() {
    var t = themeStore();
    var json = JSON.stringify({ format: 'chesster-theme', v: 3, theme: t.vars, squares: t.sq, adv: t.adv }, null, 2);
    var box = openModal('<h2>Экспорт темы</h2>' +
      '<p>Скопируйте текст — это ваша тема целиком (цвета элементов, клетки, градиенты). Его можно импортировать на любом устройстве.</p>' +
      '<textarea class="inp" id="themeJsonOut" rows="9" readonly>' + esc(json) + '</textarea>' +
      '<div class="btns" style="margin-top:10px"><button class="btn" data-a="copy">⧉ Скопировать</button>' +
      '<button class="btn primary" data-a="close">Закрыть</button></div>');
    box.querySelector('[data-a=close]').addEventListener('click', function () { closeModal(); });
    box.querySelector('[data-a=copy]').addEventListener('click', function () {
      var ta = box.querySelector('#themeJsonOut');
      var done = function () { toast('СКОПИРОВАНО', 'info', 'JSON темы — в буфере обмена'); };
      var fallback = function () {
        try { ta.focus(); ta.select(); document.execCommand('copy'); done(); } catch (e) { /* пользователь скопирует вручную */ }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).then(done, fallback);
      else fallback();
    });
  }

  /* ---------- импорт темы ---------- */
  function importTheme() {
    var box = openModal('<h2>Импорт темы</h2>' +
      '<p>Вставьте JSON ранее экспортированной темы. Невалидные и подозрительные значения отбрасываются.</p>' +
      '<textarea class="inp" id="themeJsonIn" rows="9" spellcheck="false"></textarea>' +
      '<div class="hint" id="themeImpHint" style="margin-top:6px"></div>' +
      '<div class="btns" style="margin-top:10px"><button class="btn" data-a="cancel">Отмена</button>' +
      '<button class="btn primary" data-a="ok">Применить тему</button></div>');
    box.querySelector('[data-a=cancel]').addEventListener('click', function () { closeModal(); });
    box.querySelector('[data-a=ok]').addEventListener('click', function () {
      var hint = box.querySelector('#themeImpHint');
      var raw = box.querySelector('#themeJsonIn').value;
      var data = null;
      try { data = JSON.parse(raw); } catch (e) { data = null; }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        hint.textContent = 'Это не похоже на JSON темы.';
        return;
      }
      var vars = {}, sq = {}, applied = 0, dropped = 0;
      var src = (data.theme && typeof data.theme === 'object') ? data.theme : {};
      for (var k in src) {
        /* градиент — только элементам, которые его поддерживают (фон, а не текст) */
        var it = T.BY_VAR[k];
        if (it && T.validValue(src[k]) && (!T.isGradient(src[k]) || it.g)) { vars[k] = src[k]; applied++; }
        else dropped++;
      }
      var srcSq = (data.squares && typeof data.squares === 'object') ? data.squares : {};
      for (var ks in srcSq) {
        if (T.validSquareKey(ks) && T.validValue(srcSq[ks])) { sq[String(Number(ks))] = srcSq[ks]; applied++; }
        else dropped++;
      }
      if (!applied) {
        hint.textContent = 'В файле нет ни одного допустимого значения.' + (dropped ? ' Отброшено: ' + dropped + '.' : '');
        return;
      }
      S.setSetting('theme', vars);
      S.setSetting('sqColors', sq);
      S.setSetting('themeAdv', data.adv === true && Object.keys(sq).length > 0);
      applyThemeNow();
      renderColorsLive();
      closeModal();
      toast('ТЕМА ПРИМЕНЕНА', 'arch', 'Значений: ' + applied + (dropped ? ' · отброшено: ' + dropped : ''));
    });
  }

  /* ---------- привязка кнопок раздела ---------- */
  function bindThemeUI() {
    if (!T) return;
    var br = $('btnThemeReset');
    if (br) br.addEventListener('click', resetTheme);
    var be = $('btnThemeExport');
    if (be) be.addEventListener('click', exportTheme);
    var bi = $('btnThemeImport');
    if (bi) bi.addEventListener('click', importTheme);
    var ca = $('chkThemeAdv');
    if (ca) ca.addEventListener('change', function () {
      S.setSetting('themeAdv', ca.checked);
      applyThemeNow();
      renderColorsLive();
      if (ca.checked) toast('ТОЧЕЧНЫЙ РЕЖИМ', 'arch', 'Мини-доска ниже: клик по клетке меняет её цвет');
    });
    var sc = $('btnSqClear');
    if (sc) sc.addEventListener('click', function () {
      confirmBox('Очистить цвета клеток?',
        'Собственные цвета всех клеток будут удалены; общие цвета светлых и тёмных клеток останутся.',
        'Очистить', true, function (yes) {
          if (!yes) return;
          S.setSetting('sqColors', {});
          applyThemeNow();
          renderColorsLive();
        });
    });
    var pres = $('themePresets');
    if (pres) pres.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-preset]') : null;
      if (b) applyPreset(b.dataset.preset);
    });
    var gr = $('themeGroups');
    /* клавиатура: строка реестра открывается Enter/Пробелом на образце цвета */
    if (gr) gr.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      var row = e.target.closest ? e.target.closest('.titem') : null;
      if (!row || e.target.closest('.trst')) return;
      e.preventDefault();
      openColorPicker({ v: row.dataset.var });
    });
    if (gr) gr.addEventListener('click', function (e) {
      var near = function (sel) { return e.target.closest ? e.target.closest(sel) : null; };
      var rst = near('.trst');
      if (rst) {
        var rowR = near('.titem');
        if (rowR) resetThemeVar(rowR.dataset.var);
        return;
      }
      var row = near('.titem');
      if (row) openColorPicker({ v: row.dataset.var });
    });
    var mb = $('miniBoard');
    if (mb) mb.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-msq]') : null;
      if (b) openColorPicker({ sq: parseInt(b.dataset.msq, 10) });
    });
    var bd = $('btnDesigner');
    if (bd) bd.addEventListener('click', startDesigner);
  }

  /* ============================ РЕЖИМ ДИЗАЙНЕРА (3.1) ============================
     Список из 72 элементов — это точно, но непонятно: «Границы элементов»
     ещё нужно найти глазами. В режиме дизайнера пользователь красит то, что
     видит: окно настроек закрывается, под курсором подсвечивается элемент,
     а клик открывает список цветов, которые этот элемент формируют, и
     пипетку для каждого из них.

     Как определяется элемент: Theme.varsFor разбирает собственный CSS
     приложения и находит правила, подходящие под элемент (псевдоклассы
     :hover/:focus при этом отбрасываются — они лишь состояние того же
     элемента). Поэтому карта не разъезжается со стилями и не пишется руками.

     Правила режима:
       • клик — выбрать цвет (если цветов несколько — сначала список «что
         именно перекрасить»);
       • левый Shift+клик — обычное действие элемента (переход по вкладке,
         кнопка): клик не перехватывается, рамка подсветки становится синей;
       • Esc — выход в любом месте (если открыта пипетка, первый Esc закрывает
         её и откатывает цвет, второй — выводит из режима);
       • игровые хоткеи (F, M, N, стрелки) в режиме не работают, чтобы
         случайное нажатие не перевернуло доску посреди настройки. */
  var designerBound = false;
  var designerLastEl = null;
  var shiftLeft = null;          /* null — Shift не нажат; true — левый; false — правый */

  function designerActive() { return G.designer === true; }
  /* левый Shift — навигация. Если клавишу нажали до входа в режим (события
     keydown не было), не блокируем обычное действие: shiftKey важнее точности */
  function isNavEvent(e) { return !!e && e.shiftKey === true && shiftLeft !== false; }
  /* слои, которые живут своей жизнью: пипетка цвета, плашка режима, подсказка */
  function designerExempt(el) {
    if (!el || !el.closest) return false;
    return !!el.closest('.modal-bg, #designerHud, #tip');
  }

  /* что именно перекрасит клик по этому элементу */
  function designerFor(el) {
    if (!T || !el || !el.closest) return { el: null, vars: [], sq: null };
    var sqEl = el.closest('#board .sq[data-sq]');
    if (sqEl) {
      var sq = parseInt(sqEl.dataset.sq, 10);
      var adv = themeStore().adv;
      var dark = T.squareIsDark(sq);
      var list = [adv
        ? {
          sq: sq, n: 'Клетка ' + C.nameOf(sq), label: 'собственный цвет клетки',
          group: 'Доска и клетки', g: true, rank: 0, order: 0
        }
        : {
          v: dark ? '--dark' : '--light', n: dark ? 'Тёмные клетки' : 'Светлые клетки',
          label: 'фон', group: 'Доска и клетки', g: true, rank: 0, order: 0
        }];
      /* Координаты и фигуры не перехватывают клики (pointer-events:none), поэтому
         клик всегда попадает в саму клетку. Чтобы их цвета тоже можно было
         поменять кликом, добавляем переменные самой клетки (подсветка хода,
         шаха, взятия) и её оформленных потомков (координаты, тень фигур). */
      var seen = {};
      seen[list[0].v || ('sq' + sq)] = 1;
      var addFrom = function (node) {
        T.varsFor(node, 0).vars.forEach(function (x) {
          if (list.length >= 9 || seen[x.v]) return;
          if (x.v === '--light' || x.v === '--dark') return;   /* цвет клетки уже первым пунктом */
          seen[x.v] = 1;
          list.push(x);
        });
      };
      addFrom(sqEl);
      Array.prototype.forEach.call(sqEl.querySelectorAll('.crd, .pc'), addFrom);
      return { el: sqEl, sq: sq, adv: adv, vars: list };
    }
    var r = T.varsFor(el);
    return { el: r.el, vars: r.vars, sq: null };
  }

  function setDesignerTarget(text) {
    var el = $('designerTarget');
    if (el) el.textContent = text || 'наведите курсор на элемент';
  }

  /* рамка под курсором и подпись: какие цвета формируют этот элемент */
  function designerPaint(target, nav) {
    var hl = $('designerHl');
    if (!hl) return;
    var res = designerFor(target);
    G.designerTarget = res;
    var box = res.el || target;
    var r = null;
    try { r = box.getBoundingClientRect(); } catch (e) { r = null; }
    if (!r || (!r.width && !r.height)) { hl.classList.remove('on'); setDesignerTarget(''); return; }
    hl.style.left = Math.round(r.left - 3) + 'px';
    hl.style.top = Math.round(r.top - 3) + 'px';
    hl.style.width = Math.max(6, Math.round(r.width + 6)) + 'px';
    hl.style.height = Math.max(6, Math.round(r.height + 6)) + 'px';
    hl.classList.add('on');
    hl.classList.toggle('nav', !!nav);
    /* у самого верха экрана подпись не помещается над рамкой — уводим её вниз */
    hl.classList.toggle('below', r.top < 46);
    var tag = $('designerHlTag');
    if (tag) {
      if (!res.vars.length) {
        tag.innerHTML = 'этот элемент не перекрашивается';
      } else {
        var it0 = res.vars[0];
        var txt = '<b>' + esc(it0.n) + '</b>' + (it0.label ? ' · ' + esc(it0.label) : '');
        if (res.vars.length > 1) {
          txt += '<br>и ещё ' + (res.vars.length - 1) + ': ' +
            esc(res.vars.slice(1).map(function (x) { return x.n; }).join(', '));
        } else {
          txt += '<br>' + (nav ? 'Shift: обычное действие' : 'клик — изменить цвет');
        }
        tag.innerHTML = txt;
      }
    }
    setDesignerTarget(res.vars.length ? res.vars[0].n : 'не перекрашивается');
  }

  function designerHover(e) {
    if (!designerActive()) return;
    if (designerExempt(e.target)) {
      var hl = $('designerHl');
      if (hl) hl.classList.remove('on');
      G.designerTarget = null;
      setDesignerTarget('');
      return;
    }
    designerLastEl = e.target;
    designerPaint(e.target, isNavEvent(e));
  }
  function refreshDesigner() {
    if (designerLastEl) designerPaint(designerLastEl, shiftLeft === true);
  }

  function designerClick(e) {
    if (!designerActive()) return;
    if (designerExempt(e.target)) return;      /* пипетка и плашка работают как обычно */
    if (isNavEvent(e)) return;                 /* Shift — обычное действие элемента */
    e.preventDefault();
    e.stopPropagation();
    var res = designerFor(e.target);
    if (!res.vars.length) {
      toast('Этот элемент не перекрашивается', 'info', 'кликните по панели, кнопке, тексту или клетке доски');
      sfx('no');
      return;
    }
    if (res.vars.length === 1) { pickDesignerVar(res.vars[0]); return; }
    openDesignerChooser(res);
  }

  function pickDesignerVar(item) {
    if (!item) return;
    if (item.sq !== undefined && item.sq !== null) openColorPicker({ sq: item.sq });
    else openColorPicker({ v: item.v });
  }

  /* список «что именно перекрасить»: у кнопки это фон, фон при наведении,
     граница и текст — четыре разные переменные темы */
  function openDesignerChooser(res) {
    var t = themeStore();
    var html = '<h2>🎨 Что перекрасить?</h2>' +
      '<p>Этот элемент формируют несколько цветов темы. Выберите нужный — откроется пипетка.</p>' +
      '<div class="dpick">';
    res.vars.forEach(function (it, i) {
      var val = (it.sq !== undefined && it.sq !== null)
        ? (Object.prototype.hasOwnProperty.call(t.sq, String(it.sq))
          ? t.sq[String(it.sq)]
          : T.effective(t.vars, T.squareIsDark(it.sq) ? '--dark' : '--light'))
        : T.effective(t.vars, it.v);
      html += '<button class="dpick-row" type="button" data-i="' + i + '">' +
        '<i style="background:' + esc(val) + '"></i>' +
        '<span class="dpick-n"><b>' + esc(it.n) + '</b>' +
        '<span>' + esc((it.group ? it.group + ' · ' : '') + (it.label || '')) + '</span></span>' +
        '<span class="dpick-where">' + esc(val) + '</span>' +
        '</button>';
    });
    html += '</div><div class="btns"><button class="btn" data-a="cancel">Отмена</button></div>';
    var box = openModal(html, true);
    box.classList.add('wide');      /* строки списка длинные: обычная ширина 470 мала */
    var list = box.querySelector('.dpick');
    if (list) list.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.dpick-row') : null;
      if (!b) return;
      pickDesignerVar(res.vars[parseInt(b.dataset.i, 10)]);
      sfx('click');
    });
    var cancel = box.querySelector('[data-a=cancel]');
    if (cancel) cancel.addEventListener('click', function () { closeModal(); });
  }

  /* сброс элемента под курсором: убираем его переопределения из темы */
  function resetDesignerElement() {
    var res = G.designerTarget;
    if (!res || !res.vars.length) {
      toast('Наведите курсор на элемент', 'info', 'сброс работает по элементу под курсором');
      sfx('no');
      return;
    }
    var vars = Object.assign({}, S.settings().theme || {});
    var n = 0;
    res.vars.forEach(function (it) {
      if (it.v && Object.prototype.hasOwnProperty.call(vars, it.v)) { delete vars[it.v]; n++; }
    });
    if (res.sq !== null && res.sq !== undefined) {
      var sqm = Object.assign({}, S.settings().sqColors || {});
      if (Object.prototype.hasOwnProperty.call(sqm, String(res.sq))) {
        delete sqm[String(res.sq)];
        S.setSetting('sqColors', sqm);
        n++;
      }
    }
    if (!n) { toast('Тут уже цвета по умолчанию', 'info', 'сбрасывать нечего'); sfx('no'); return; }
    S.setSetting('theme', vars);
    applyThemeNow();
    toast('ЦВЕТА СБРОШЕНЫ', 'info', n === 1 ? 'элемент вернулся к оформлению по умолчанию' : 'переопределений удалено: ' + n);
    sfx('click');
    refreshDesigner();
  }

  function startDesigner() {
    if (!T) return;
    if (G.modal) closeModal();
    closeSettings();
    hideTip();
    G.designer = true;
    G.designerTarget = null;
    designerLastEl = null;
    document.body.classList.add('designer');
    var hud = $('designerHud');
    if (hud) hud.hidden = false;
    setDesignerTarget('');
    bindDesigner();
    addLog('Включён <b>режим дизайнера</b>: клик по элементу меняет его цвет, левый Shift+клик — обычное действие, Esc — выход.', 'arch');
    toast('РЕЖИМ ДИЗАЙНЕРА', 'arch', 'клик — цвет элемента · левый Shift+клик — как обычно · Esc — выход');
    sfx('click');
  }
  function stopDesigner(silent) {
    if (!G.designer) return;
    G.designer = false;
    G.designerTarget = null;
    designerLastEl = null;
    document.body.classList.remove('designer');
    var hud = $('designerHud');
    if (hud) hud.hidden = true;
    var hl = $('designerHl');
    if (hl) hl.classList.remove('on', 'nav');
    hideTip();
    if (!silent) {
      addLog('Режим дизайнера выключен.', 'info');
      sfx('click');
    }
  }

  function bindDesigner() {
    if (designerBound) return;
    designerBound = true;
    /* перехват в фазе capture: обработчики доски, вкладок и кнопок не успевают
       сработать, поэтому в режиме дизайнера нельзя случайно сделать ход */
    document.addEventListener('pointerover', function (e) { if (designerActive()) designerHover(e); }, true);
    document.addEventListener('pointerdown', function (e) {
      if (!designerActive() || designerExempt(e.target) || isNavEvent(e)) return;
      e.stopPropagation();
    }, true);
    document.addEventListener('mousedown', function (e) {
      if (!designerActive() || designerExempt(e.target) || isNavEvent(e)) return;
      e.stopPropagation();
    }, true);
    document.addEventListener('click', function (e) { if (designerActive()) designerClick(e); }, true);
    document.addEventListener('contextmenu', function (e) {
      if (!designerActive() || designerExempt(e.target) || isNavEvent(e)) return;
      e.preventDefault();
      e.stopPropagation();     /* правый клик рисует стрелки разбора — в режиме дизайнера не надо */
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Shift' || e.key === 'ShiftLeft' || e.key === 'ShiftRight') {
        shiftLeft = (e.location !== 2);
        if (designerActive()) refreshDesigner();
      }
    }, true);
    document.addEventListener('keyup', function (e) {
      if (e.key === 'Shift' || e.key === 'ShiftLeft' || e.key === 'ShiftRight') {
        shiftLeft = null;
        if (designerActive()) refreshDesigner();
      }
    }, true);
    window.addEventListener('blur', function () { shiftLeft = null; });
    /* рамка позиционирована фиксированно: при прокрутке и изменении размера
       она остаётся на старом месте, поэтому её проще погасить до следующего
       наведения курсора */
    var hideHl = function () {
      if (!designerActive()) return;
      var h = $('designerHl');
      if (h) h.classList.remove('on');
    };
    document.addEventListener('scroll', hideHl, true);
    window.addEventListener('resize', hideHl);
    var done = $('btnDesignerDone');
    if (done) done.addEventListener('click', function () { stopDesigner(); });
    var und = $('btnDesignerUndo');
    if (und) und.addEventListener('click', resetDesignerElement);
    var rst = $('btnDesignerReset');
    if (rst) rst.addEventListener('click', function () { resetTheme(); refreshDesigner(); });
  }

  /* ---------- выход из приложения (3.1) ----------
     Кнопка «⏻ Выход» внизу боковины настроек: в полноэкранном запуске у окна
     нет ни заголовка, ни крестика, и закрыть приложение было нечем. В браузере
     кнопка скрыта — вкладку страница закрыть не может. */
  function quitApp() {
    var i = P.info();
    var text = i.desktop
      ? 'Приложение закроется. Текущая партия, архив, статистика и цветовая тема сохранены — ' +
        'при следующем запуске всё будет на месте.'
      : 'В браузере закрыть вкладку из страницы нельзя: используйте Ctrl+W (Cmd+W на Mac). ' +
        'В версии для компьютера эта кнопка закрывает приложение.';
    confirmBox('Выйти из игры?', text, i.desktop ? 'Закрыть приложение' : 'Понятно', true, function (ok) {
      if (!ok || !i.desktop) return;
      try { flushSave(); } catch (e) { /* партия сохранится следующим автосохранением */ }
      addLog('Выход из приложения.', 'info');
      P.quit().then(function (res) {
        if (res && res.ok) return;
        toast('НЕ УДАЛОСЬ ЗАКРЫТЬ', 'check', 'закройте окно обычным способом');
        sfx('no');
      }).catch(function (err) {
        toast('НЕ УДАЛОСЬ ЗАКРЫТЬ', 'check', String((err && err.message) || err));
      });
    });
  }

  var CHANGELOG = [
    ['3.1', 'Режим дизайнера: цвета теперь меняются кликом по самому интерфейсу. В настройках (⚙) → «Цвета» появилась кнопка «🖌 Режим дизайнера»: окно настроек закрывается, под курсором возникает рамка с названием цветов, которые формируют элемент, а клик открывает список «что именно перекрасить» и пипетку HSL. Карту «элемент → цвет» приложение строит разбором собственного CSS, поэтому она не разъезжается со стилями и покрывает все 72 элемента; при открытии пипетки все элементы, которые красит эта переменная, на полторы секунды обводятся золотом, а фон пипетки и окно настроек становятся полупрозрачными — изменение видно вживую, а не на затемнённом фоне; обычные действия (вкладки, кнопки, ходы) остаются доступны с зажатым левым Shift, выход — Esc в любом месте, а кнопка «↺ Сбросить элемент» убирает переопределения у элемента под курсором. Внизу окна настроек добавлена кнопка «⏻ Выход»: в версии для компьютера она закрывает приложение (в полноэкранном режиме у окна нет ни заголовка, ни крестика), гасит процесс движка и сохраняет партию; в браузере кнопка скрыта. Rodent IV: JS-обвязка Web Worker вшита в единый файл, поэтому WASM-сборку можно добавить и без интернета; исполняемый файл в десктопе теперь считается установленным (кнопки «Использовать», «Проверить», «Удалить» работают), путь запоминается и движок сам поднимается при следующем открытии приложения; список опций читается из рукопожатия UCI — настоящие имена, типы, пределы, галочки, списки «личностей» и кнопки; команды протокола идут в правильном порядке (setoption → ucinewgame → position → go, причём ucinewgame посылается один раз на партию), а при сбое запуска приложение честно возвращается к встроенному боту и пишет причину в журнал UCI. Заодно исправлено: выбранный движок и путь к его файлу терялись при перезапуске (настройки собирались по белому списку ключей), а смена уровня «Лёгкий/Средний/Сильный» не доходила до внешнего движка — теперь уровень применяется как пресет UCI и не затирает настроенные вручную параметры. Справка дополнена разделами о цветах и выходе; подготовлен задел под настройку цвета фигур (переменные --pc-* и сборочный флаг PIECE_THEME — включим в 3.2 после проверки в браузере).'],
    ['1.0', 'Первая версия: игра за обе стороны на одной доске, сброс, полные правила (рокировка, взятие на проходе, превращение), отдельные объявления шаха, мата, пата и всех ничьих, запись партии, компьютер-соперник.'],
    ['1.1', 'Взятые фигуры стали видны на тёмном фоне; подсветка шаха перемещена под фигуру короля без всплывающей плашки; стрелки и круги правой кнопкой мыши; громкость звука с ползунком.'],
    ['1.2', 'Разгрузка интерфейса: вкладки и панель иконок с подсказками; архив партий в PGN с названиями и именами; профили соперников со счётом и личными встречами; анонимы; импорт PGN с выбором учёта в статистике; выгрузка архива файлом.'],
    ['1.3', 'Меню открывается иконкой в правом верхнем углу, доска на всё окно; исправлено смещение фигур влево; выделено место под архив: шкала с процентами, резерв на 3 партии, пороги 80/90/95/100 %, автоудаление самых старых; кнопки «Скопировать и перейти на Lichess».'],
    ['2.0', 'Версия для компьютера: обёртки Electron и Tauri, иконки, PWA с офлайн-кэшем; слой платформ и движков; размечено место под Rodent IV (UCI, пресеты, установка сборки); ссылка Lichess исправлена с мёртвого /import на /paste.'],
    ['2.1', 'Полноэкранный запуск без нативной панели меню; меню приложения «⋮»; перевес материала считается по доске (корректно с превращениями); статус партии во вкладке «Ходы» с автооткрытием при итоге; чип состояния в шапке; версионирование и проверка обновлений.'],
    ['2.2', 'Панель управления переехала во вкладку «Ходы» двумя рядами; материал — колонка слева серыми силуэтами; меню-оверлей без сдвига доски; подсказки под кнопками без обрезания; автоповорот только для двух игроков; название окна Chess; приоритет Windows; конвейер релизов.'],
    ['2.3', 'Архив в десктопе хранится файлом на устройстве без ограничений (и отключаемый лимит в браузере); перевес материала отдельной строкой под именем; «Отмена» в диалоге превращения по центру; стрелки: правый клик и тяга в клетке рисуют круг, повтор удаляет пометку, короткий левый клик или ход стирают всё; убран подзаголовок под логотипом; убраны лишние полосы прокрутки в панели; «История изменений» в меню приложения; релизы и тесты только под Windows.'],
    ['2.3.1', 'Автообновление в десктопе заработало: electron-updater теперь попадает в сборку, источник обновлений — GitHub (naemnik6/Chess), все этапы проверки пишутся в лог и видны в DevTools, при запуске приложение само проверяет обновления в фоне; вместо «не настроено» показывается конкретная ошибка с диагностикой и кнопка «Скачать обновление вручную» (страница релизов GitHub). Исправлено: «О программе» не открывалась в десктопе (падала на проценте квоты безлимита), короткий левый клик по пустой клетке не стирал стрелки.'],
    ['2.4', 'Меню приложения «⋮» пересобрано в полноценное окно настроек с категориями: Вид, Архив, Движок, Журнал, Справка и О программе — переход кликом по категории или обычной прокруткой, ползунок окна стилизован под дизайн приложения. Вкладки «Журнал» и «Движок» переехали из бокового меню в настройки; «Перевернуть доску» осталось во вкладке «Ходы»; дубли кнопок (новая партия, вернуть ход, сохранение, выгрузка, стрелки, FEN/PGN, Lichess) убраны — они уже есть в основном меню. Подсказки кнопок переведены в один верхний слой с переносом текста: больше не появляются горизонтальные ползунки и описания не прячутся под вкладки. Напоминание о выгрузке архива можно отключить (настройки → «Архив»). Ошибка проверки обновлений больше не вываливает простыню HTTP-заголовков: короткое сообщение, полный текст — в раскрывающемся блоке «Технические подробности».'],
    ['3.0', 'Дизайнерское обновление: полная настройка цветов. В окне настроек (⚙) появилась категория «Цвета»: 72 элемента интерфейса и доски в пяти раскрывающихся группах — фон и панели, текст и акценты, кнопки и ползунки, доска (клетки, рамка, координаты, подсветки хода, шаха и взятия, тень фигур), а также подсказки, диалог превращения, кнопка Lichess, логотип, плашка просмотра истории и шкала квоты архива. У каждого элемента — HSL-пипетка с готовой палитрой из 36 образцов, HEX-полем, прозрачностью и двухцветными градиентами с настройкой угла; раздел доступен и с клавиатуры (Tab, Enter). Семь готовых палитр: Классика, Лёд, Изумруд, Сепия, Виолет, Багрянец, Графит. Точечная раскраска отдельных клеток a1…h8 с привязкой к полям доски — в расширенном режиме (по умолчанию выключен). Экспорт и импорт темы в JSON с отбрасыванием недопустимых значений, сброс отдельного элемента и всей темы; изменения применяются мгновенно с живым предпросмотром, «Отмена» и Esc возвращают прежний цвет. Обёртка Tauri доведена до собираемого состояния: Cargo.toml, build.rs, capabilities, мост window.Chesster, отдельная папка dist для фронтенда; оценка и план переноса — в TAURI.md.'],
    ['план', 'Цвет шахматных фигур в теме (задел сделан: переменные --pc-* и флаг PIECE_THEME в build.js — включим после проверки в настоящем браузере); лаунчер версий (выбор установленных версий, список изменений, новости) — оценён, ждёт своего часа; NNUE-движок в браузере/десктопе; перенос десктоп-обёртки на Tauri (оценка готовности — в TAURI.md).'],
  ];
  function showChangelog() { openSettings('help'); }
  function showAbout() { openSettings('about'); }
  /* страница релизов GitHub — резервный путь обновления: приложение без
     цифровой подписи, и Windows может блокировать автоустановку */
  var RELEASES_URL = 'https://github.com/naemnik6/Chess/releases/latest';
  function openReleases() { P.openExternal(RELEASES_URL); }
  function showUpdateResult(res) {
    res = res || {};
    var ok = !!res.ok;
    var head = ok ? (res.reason === 'up-to-date' ? 'Обновлений нет' : 'Обновление') : 'Проверить обновления не удалось';
    /* electron-updater при сетевых ошибках (в т.ч. 404) дописывает к сообщению
       дамп HTTP-заголовков с серверными куками — в окне показываем короткую
       суть, а простыню прячем в раскрывающийся блок «Технические подробности» */
    var full = String(res.message || 'Обёртка не вернула подробностей.');
    var shortMsg = full.split(/\s*Headers:/)[0].replace(/\s+/g, ' ').trim();
    if (shortMsg.length > 500) shortMsg = shortMsg.slice(0, 500) + '…';
    var hasMore = /Headers:/.test(full) || !!res.error;
    var tech = hasMore
      ? '<details class="upd-tech"><summary>Технические подробности</summary>' +
        '<div class="pgn-view" style="max-height:200px;margin-top:6px">' +
        esc(full + (res.error ? '\n\n' + res.error : '')) + '</div></details>'
      : '';
    var diagText = '';
    if (!ok && res.diag) {
      var d = res.diag;
      diagText = '<div class="hint" style="margin:8px 0;white-space:pre-wrap;font-size:12px">' +
        'Диагностика: приложение упаковано — ' + (d.packaged ? 'да' : 'нет (dev-запуск)') +
        ' · electron-updater — ' + (d.updaterLoaded ? 'подключён' : 'НЕ подключён' + (d.updaterLoadError ? ': ' + esc(d.updaterLoadError) : '')) +
        ' · app-update.yml — ' + (d.appUpdateYmlExists ? 'на месте' : 'НЕТ (' + esc(d.appUpdateYmlPath || '?') + ')') +
        (d.lastError ? '\nПоследняя ошибка: ' + esc(d.lastError) : '') + '</div>';
    }
    var box = openModal('<h2>' + esc(head) + '</h2>' +
      '<p>' + esc(shortMsg) + '</p>' + tech + diagText +
      '<div class="btns">' +
      (ok ? '' : '<button class="btn" data-a="manual">⬇ Скачать обновление вручную</button>') +
      '<button class="btn primary" data-a="close">' + (ok ? 'Понятно' : 'Закрыть') + '</button></div>');
    box.querySelector('[data-a=close]').onclick = function () { closeModal(); };
    var mb = box.querySelector('[data-a=manual]');
    if (mb) mb.onclick = function () { closeModal(); openReleases(); };
  }
  function checkUpdates() {
    var b = P.bridge();
    if (b && typeof b.checkUpdates === 'function') {
      toast('ПРОВЕРКА ОБНОВЛЕНИЙ', 'info', 'запрашиваем GitHub…');
      Promise.resolve(b.checkUpdates()).then(function (res) {
        if (res && typeof res === 'object' && res.message !== undefined) {
          if (res.ok) {
            /* успех — лёгкий тост: последняя версия / найдена / уже скачана */
            if (res.reason === 'up-to-date') toast('ОБНОВЛЕНИЙ НЕТ', 'info', res.message);
            else if (res.reason === 'available') toast('НАЙДЕНО ОБНОВЛЕНИЕ', 'info', res.message);
            else toast('ОБНОВЛЕНИЕ ГОТОВО', 'arch', res.message);
          } else {
            showUpdateResult(res);   /* конкретная ошибка + диагностика + ручное скачивание */
          }
        } else {
          showUpdateResult({ ok: false, reason: 'legacy', diag: null, message: 'Обёртка старой версии не вернула результат проверки. Скачайте обновление вручную со страницы релизов.' });
        }
      }).catch(function (err) {
        showUpdateResult({ ok: false, reason: 'ipc', diag: null, message: 'Обёртка не ответила на запрос: ' + (err && err.message || err) + '.' });
      });
      return;
    }
    openModal('<h2>Обновления</h2><p>Текущая версия: <b>' + esc(APP_VERSION) + '</b>' +
      (BUILD_STAMP ? ' (сборка ' + esc(BUILD_STAMP) + ')' : '') + '.</p>' +
      '<div class="hint" style="margin-bottom:10px">Браузер и PWA получают новую версию сами: сервис-воркер ' +
      'заменит кэш и предложит обновиться при следующем открытии. Приложение на компьютере проверяет ' +
      'обновления на GitHub при каждом запуске; если автоустановка блокируется системой — скачайте ' +
      'новый установщик вручную, данные (архив, профили, настройки) сохранятся.</div>' +
      '<div class="btns"><button class="btn" data-a="manual">⬇ Скачать обновление вручную</button>' +
      '<button class="btn primary" data-a="close">Понятно</button></div>')
      .querySelector('[data-a=close]').onclick = function () { closeModal(); };
    var mb2 = document.querySelector('.modal [data-a=manual]');
    if (mb2) mb2.onclick = function () { closeModal(); openReleases(); };
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
  var PANEL_TABS = ['moves', 'archive', 'players', 'game', 'position'];
  function switchTab(tab) {
    /* «Журнал» и «Движок» переехали в окно настроек: старое сохранённое
       значение вкладки из хранилища не должно оставлять панель пустой */
    if (PANEL_TABS.indexOf(tab) < 0) tab = 'moves';
    G.tab = tab;
    S.setSetting('activeTab', tab);
    document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    document.querySelectorAll('#tabBody > section').forEach(function (s) { s.classList.toggle('on', s.dataset.panel === tab); });
    renderTab();
  }
  function renderTab() {
    if (G.tab === 'archive') renderArchive();
    else if (G.tab === 'players') renderPlayers();
    else if (G.tab === 'game') renderGameTab();
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
    if (settingsOpen()) renderSettingsLive();
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
    var ca = $('chkAutoFlip');
    if (ca) {
      ca.checked = !!G.autoFlip;
      ca.disabled = !!botColor();
      ca.parentNode.title = botColor()
        ? 'В партиях с компьютером доска не переворачивается: вы всегда видите её со своей стороны'
        : '';
    }
    var cn = $('chkCountAnon');
    if (cn) cn.checked = S.settings().countAnon !== false;
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
    var s = cur();
    var pc = s.b[sq];
    var playable = canPlay();
    var willMove = playable && G.selected !== null && hasMove(G.selected, sq);
    var willDrag = playable && !willMove && pc && C.colorOf(pc) === s.turn;
    /* Короткий левый клик, который не ведёт к ходу и не подхватывает фигуру
       (пустая клетка, чужая фигура, просмотр истории, оконченная партия),
       стирает все стрелки и круги. Если фигура подхвачена — решение примет
       onDragUp на отпускании: перетаскивание = ход, короткое нажатие = стирание. */
    if (!willMove && !willDrag && G.marks.length) {
      clearMarks(true);
      if (!playable) return;   /* клик уже сделал дело — не «ругаемся» на блокировку */
    }
    if (!playable) { flashLocked(); return; }
    if (willMove) {
      if (e.preventDefault) e.preventDefault();
      var from = G.selected;
      var promo = isPromotion(from, sq);
      var chosen = promo ? null : pickMove(from, sq, null);
      G.selected = null; G.targets = [];
      if (promo) openPromo(from, sq); else doMove(chosen);
      render();
      return;
    }
    if (willDrag) {
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
    document.body.classList.remove('picker-open');
    clearFlash();
    /* если закрывается цветовая пипетка (Esc, программное закрытие) —
       откатываем живой предпросмотр темы к сохранённым значениям */
    if (G.pickerCancel) {
      var pf = G.pickerCancel;
      G.pickerCancel = null;
      try { pf(); } catch (e) { /* тема восстановится следующим применением */ }
    }
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

  function showHelp() { openSettings('help'); }

  var RULES_HTML =
    '<h3>Версия</h3><p>Шахматы ' + esc(APP_VERSION) + (BUILD_STAMP ? ' (сборка ' + esc(BUILD_STAMP) + ')' : '') +
    '. Проверить обновления на компьютере: настройки (⚙) → «О программе» → «Проверить обновления»; в браузере и PWA новая версия применяется сама.</p>' +
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
    '<h3>Стрелки и пометки</h3><p>Зажмите <b>правую кнопку мыши</b> и протяните от клетки к клетке — нарисуется стрелка. Пометок может быть несколько, цвета чередуются. Повторная стрелка между теми же клетками удаляется. Движение внутри одной клетки рисует круг, короткий правый клик ставит круг на клетке. <b>Короткий левый клик</b> по доске или сделанный ход стирают все пометки (то же делает кнопка ➶).</p>' +
    '<h3>Архив партий</h3><p>После завершения партии предлагается сохранить её в архив: можно задать название и имена игроков. Сохранённую партию можно воспроизвести на доске, посмотреть её PGN, переименовать или удалить. Имена складываются в профили: сыграно, победы, ничьи, поражения, процент очков, маты, сдачи, личные встречи.</p>' +
    '<h3>Пустое имя = аноним</h3><p>Если имя не указано, партия сохраняется как анонимная. Все анонимы попадают в один сводный профиль «Аноним» (в таблице он последний, с пометкой). Если без имени играли обе стороны, партия учитывается один раз, но победы и поражения не разделяются — их некому приписать. Галочка «Учитывать партии без имени (анонимные) в статистике» в настройках (⚙ → «Архив») разрешает или запрещает такой учёт, а кнопка «Очистить анонима» на вкладке «Профили» обнуляет сводный профиль, не трогая партии в архиве.</p>' +
    '<h3>Выгрузка архива</h3><p>Чтобы браузер не хранил лишнего, архив можно выгрузить одним PGN-файлом и очистить: кнопка «📦 Выгрузить всё и очистить архив». Статистика профилей при этом сохраняется (галочку можно снять). Напоминание о выгрузке приходит каждые N партий — число настраивается в настройках (⚙ → «Архив»), там же напоминания можно отключить.</p>' +
    '<h3>Импорт PGN</h3><p>Кнопка «⬆ Импорт» принимает текст или файл с партиями. При импорте предлагается выбрать, учитывать ли эти партии в статистике профилей.</p>' +
    '<h3>Цвета и режим дизайнера</h3><p>Настройки (⚙) → «Цвета»: 72 элемента интерфейса и доски в пяти группах, у каждого — пипетка HSL с палитрой, HEX-кодом, прозрачностью и градиентами. Если не знаете, как элемент называется, включите <b>«🖌 Режим дизайнера»</b>: окно настроек закроется, под курсором появится рамка с названием цветов, а клик откроет список «что именно перекрасить» и пипетку. Обычные действия элементов остаются доступны с зажатым <b>левым Shift</b>, выход — <span class="kbd">Esc</span> в любом месте. Кнопка «↺ Сбросить элемент» в плашке режима убирает переопределения у элемента под курсором.</p>' +
    '<h3>Выход из приложения</h3><p>В версии для компьютера внизу окна настроек есть кнопка <b>«⏻ Выход»</b>: она закрывает приложение (в полноэкранном режиме у окна нет ни заголовка, ни крестика). Партия, архив, статистика и тема сохраняются автоматически, а процесс внешнего движка (Rodent IV) завершается вместе с окном. В браузере кнопка скрыта: вкладку закрывают обычным способом (<span class="kbd">Ctrl+W</span>).</p>' +
    '<h3>Горячие клавиши</h3><p><span class="kbd">←</span> <span class="kbd">→</span> — разбор ходов, <span class="kbd">↑</span> <span class="kbd">↓</span> — в начало/конец, <span class="kbd">F</span> — перевернуть доску, <span class="kbd">Z</span> — вернуть ход, <span class="kbd">N</span> — новая партия, <span class="kbd">M</span> — боковое меню, <span class="kbd">F11</span> — полный экран, <span class="kbd">Esc</span> — снять выделение, закрыть окно или выйти из режима дизайнера.</p>' +
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
      E.newGame();          /* внешнему движку положен ucinewgame на новую партию */
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
    restoreEngineChoice();
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
    E.newGame();          /* новая позиция — внешнему движку нужен ucinewgame */
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

    /* окно настроек (⚙) */
    bindTooltips();
    $('btnSettings').onclick = function (e) { e.stopPropagation(); toggleSettings(); };
    $('btnSetClose').onclick = closeSettings;
    $('setBg').onclick = closeSettings;
    $('btnQuitApp').onclick = quitApp;
    $('setNav').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-sc]');
      if (!b) return;
      sfx('click');
      scrollToCat(b.dataset.sc);
    });
    /* прокрутка окна подсвечивает текущую категорию в боковине */
    $('setScroll').addEventListener('scroll', function () {
      var sc = $('setScroll');
      var secs = sc.querySelectorAll('section[data-set]');
      var cur0 = null;
      for (var i = 0; i < secs.length; i++) {
        if (secs[i].offsetTop - sc.scrollTop <= 30) cur0 = secs[i];
      }
      if (cur0) setNavActive(cur0.dataset.set);
    });
    $('btnSetFullscreen').onclick = toggleFullscreen;
    $('btnSetPanel').onclick = function () { closeSettings(); togglePanel(); };
    $('btnCheckUpdates').onclick = checkUpdates;
    $('btnManualUpdate').onclick = openReleases;
    $('chkFullStart').onchange = function () { S.setSetting('startFullscreen', $('chkFullStart').checked); };
    $('chkReminder').onchange = function () {
      var on = $('chkReminder').checked;
      S.setSetting('archiveReminderOn', on);
      $('reminderInput').disabled = !on;
      addLog(on
        ? 'Напоминание о выгрузке архива включено: каждые ' + (parseInt(S.settings().archiveReminder, 10) || 30) + ' партий.'
        : 'Напоминание о выгрузке архива отключено.', 'info');
      renderArchive();
    };

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
      /* для внешнего движка уровень — это пресет UCI (время, глубина, узлы) */
      if (E.activeId() !== 'builtin') {
        E.applyPreset(E.activeId(), G.level);
        pushEngineLog('уровень «' + (LEVEL_RU[G.level] || G.level) + '» → пресет ' +
          JSON.stringify(E.getOptions(E.activeId())));
      }
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
      if (settingsOpen()) renderSettingsLive();
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
          E.newGame();
          var n = E.detectedOptions('rodent4').length;
          if (n) pushEngineLog('опции движка получены: ' + E.detectedOptions('rodent4').map(function (o) { return o.name; }).join(', '));
          addLog('<b>Rodent IV запущен как процесс</b> (' + esc(res.path) + ')' +
            (n ? ' — движок объявил опций: ' + n : '') + '.', 'arch');
          toast('RODENT IV ЗАПУЩЕН', 'arch', n ? 'нативный процесс · опций получено: ' + n : 'нативный процесс, UCI-поток подключён');
          sfx('save');
          render();
        });
      }).catch(function (err) {
        pushEngineLog('ошибка запуска процесса: ' + err.message);
        toast('ДВИЖОК НЕ ЗАПУСТИЛСЯ', 'check', err.message);
        sfx('no');
        renderEngineTab();
      });
    };
    $('btnRodentSite').onclick = function () { openRodentUrl('site'); };
    $('btnRodentRepo').onclick = function () { openRodentUrl('repo'); };
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
      /* режим дизайнера: Esc выводит из режима, игровые хоткеи не работают,
         чтобы случайное нажатие не перевернуло доску посреди настройки цвета */
      if (designerActive()) {
        if (e.key === 'Escape') { e.preventDefault(); stopDesigner(); }
        return;
      }
      /* окно настроек модально по клавиатуре: игровые хоткеи не должны
         срабатывать за его спиной, Esc закрывает само окно */
      if (settingsOpen()) { if (e.key === 'Escape') closeSettings(); return; }
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
        if (settingsOpen()) { closeSettings(); return; }
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
    P.onMenu('offload', function () { openSettings('archive'); var b = $('btnOffload'); if (b) b.click(); });
    P.onMenu('flip', flipBoard);
    P.onMenu('panel', function () { togglePanel(); });
    P.onMenu('marks', function () { clearMarks(false); });
    P.onMenu('fen', function () { openPanel('position'); $('btnCopyFen').click(); });
    P.onMenu('pgn', function () { openPanel('position'); $('btnCopyPgn').click(); });
    P.onMenu('lichess', function () { openLichess(pgnFor({}), null); });
    P.onMenu('help', function () { openSettings('help'); });
  }

  /* События обновлений из обёртки: каждый этап (checking-for-update,
     update-available, update-not-available, download-progress, update-downloaded,
     error, …) пишется в консоль DevTools (Ctrl+Shift+I), а ключевые этапы
     дополнительно показываются тостом над доской. */
  function bindUpdaterEvents() {
    var b = P.bridge();
    if (!b || typeof b.onUpdaterEvent !== 'function') return;
    b.onUpdaterEvent(function (ev) {
      if (!ev || !ev.stage) return;
      console.log('[updater] ' + ev.stage + (ev.details ? ' — ' + ev.details : '') + ' (состояние: ' + ev.state + ')');
      if (ev.stage === 'update-available') toast('НАЙДЕНО ОБНОВЛЕНИЕ', 'info', ev.details || 'скачиваем в фоне');
      else if (ev.stage === 'update-downloaded') toast('ОБНОВЛЕНИЕ ГОТОВО', 'arch', 'установится при перезапуске приложения');
      else if (ev.stage === 'error') toast('ОБНОВЛЕНИЕ — ОШИБКА', 'check', ev.details || 'подробности в консоли DevTools');
    });
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
    E.restoreInstalled().then(function () {
      restoreEngineChoice();   /* хранилище движков прочитано — теперь выбор виден */
      render();
      /* exe-движок, выбранный в прошлый раз, запускается заново: процесс
         не переживает закрытие окна, а настройка остаётся */
      return restoreNativeEngine();
    }).catch(function () { });
    P.notifyReady();
    registerServiceWorker();
    try {
      P.isFullscreen().then(function (on) { G.isFull = !!on; }).catch(function () { });
      P.onFullscreenChange(function (on) { G.isFull = !!on; if (settingsOpen()) renderSettingsLive(); });
    } catch (e) { /* не все окружения отдают состояние полного экрана — не критично */ }
    bindDesktopMenu();
    bindUpdaterEvents();
    bind();
    applyThemeNow();      /* сохранённая цветовая тема — до первой отрисовки */
    bindThemeUI();
    bindDesigner();       /* режим дизайнера: перехват клика и рамка подсветки */
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
    showChangelog: showChangelog, CHANGELOG: CHANGELOG, showHelp: showHelp,
    openSettings: openSettings, closeSettings: closeSettings, settingsOpen: settingsOpen,
    toggleSettings: toggleSettings, scrollToCat: scrollToCat, SET_CATS: SET_CATS,
    applyThemeNow: applyThemeNow, openColorPicker: openColorPicker, applyPreset: applyPreset,
    renderColorsLive: renderColorsLive, buildThemeUI: buildThemeUI, exportTheme: exportTheme,
    importTheme: importTheme, themeStore: themeStore, flashThemeTargets: flashThemeTargets,
    /* режим дизайнера (3.1): красим интерфейс кликом по нему */
    startDesigner: startDesigner, stopDesigner: stopDesigner, designerActive: designerActive,
    restoreEngineChoice: restoreEngineChoice, RODENT_URLS: RODENT_URLS,
    designerFor: designerFor, resetDesignerElement: resetDesignerElement, quitApp: quitApp,
    restoreNativeEngine: restoreNativeEngine,
    maybeRemindOffload: maybeRemindOffload, showTip: showTip, hideTip: hideTip,
    toggleFullscreen: toggleFullscreen,
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
