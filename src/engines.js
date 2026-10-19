/* =========================================================================
   Слой подключаемых движков.

   Сегодня: встроенный JS-бот (негамакс + альфа-бета) — работает везде,
   ничего не скачивает.

   Задел на будущее: внешние UCI-движки, в первую очередь Rodent IV.
   Для них уже prepared всё, кроме самого бинарника:
     • каталог движков в хранилище (IndexedDB, а не localStorage — архив
       партий и движки не должны бороться за одно место);
     • описание движка, его статуса и того, что нужно пользователю;
     • транспорт (Web Worker + WASM/asm.js + polyfill Node для UCI-сборок);
     • протокол UCI поверх postMessage: uci/isready/ucinewgame/position/go/stop;
     • настройка уровня через ограниченные глубину/узлы/время и MultiPV,
       а для Rodent IV — ещё и через его собственные personality-параметры.

   Rodent IV распространяется как Windows-исполняемый файл с собственным
   лицензионным соглашением, поэтому в веб-сборку он не вкладывается:
   пользователь добавляет свою копию, а приложение хранит её локально.
   ========================================================================= */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var P = isNode ? require('./platform.js') : root.Platform;
  var api = factory(P, isNode ? require('./bot.js') : root.ChessBot);
  if (isNode) module.exports = api;
  if (root) root.Engines = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (P, Bot) {
  'use strict';

  /* ---------- каталог движков ---------- */
  var CATALOG = [
    {
      id: 'builtin',
      name: 'Встроенный бот',
      kind: 'js',
      available: true,
      bundled: true,
      strength: '~1600-2000 Elo (3 уровня)',
      about: 'Негамакс с альфа-бетой, квивесценция и таблицы позиционной оценки. Работает сразу, ' +
        'ничего не скачивает и не требует установки. Считает в основном потоке с ограничением по ' +
        'времени и числу узлов, поэтому интерфейс не блокируется надолго.',
      levels: [
        { id: 'easy', label: 'Лёгкий', depth: 2, timeMs: 700 },
        { id: 'medium', label: 'Средний', depth: 3, timeMs: 1800 },
        { id: 'hard', label: 'Сильный', depth: 4, timeMs: 3200 }
      ]
    },
    {
      id: 'rodent4',
      name: 'Rodent IV',
      kind: 'uci',
      available: false,          /* появится, когда пользователь добавит свою сборку */
      bundled: false,
      strength: '~2600-3000 Elo (зависит от сборки и «личности»)',
      about: 'Сильный открытый движок Pawła Koziol. Для запуска в браузере нужна сборка, ' +
        'скомпилированная в WebAssembly или asm.js и работающая в Web Worker. В веб-версию ' +
        'движок не вкладывается: добавьте свой файл — он сохранится локально в этом устройстве ' +
        '(IndexedDB), никуда не отправляется и не занимает место архива партий.',
      homepage: 'http://rodentchess.blogspot.com/',
      /* что именно ждём от пользователя */
      accepts: [
        { ext: '.wasm', label: 'сборка Rodent IV в WebAssembly' },
        { ext: '.js', label: 'asm.js-сборка с UCI-интерфейсом' },
        { ext: '.zip', label: 'архив со сборкой и файлом движка' }
      ],
      /* UCI-опции, которыми настраивается сила и стиль Rodent IV */
      uciOptions: [
        { name: 'DepthLimit', type: 'spin', min: 1, max: 40, label: 'Ограничение глубины' },
        { name: 'NodeLimit', type: 'spin', min: 0, max: 100000000, label: 'Ограничение по узлам' },
        { name: 'MoveTime', type: 'spin', min: 0, max: 60000, label: 'Время на ход, мс' },
        { name: 'MultiPV', type: 'spin', min: 1, max: 8, label: 'Число вариантов (MultiPV)' },
        { name: 'Personality', type: 'combo', label: 'Стиль игры (личность)' },
        { name: 'Threads', type: 'spin', min: 1, max: 16, label: 'Потоки' },
        { name: 'Hash', type: 'spin', min: 1, max: 1024, label: 'Хэш, МБ' }
      ],
      /* готовые пресеты под наши уровни, чтобы переключение было привычным */
      presets: {
        easy: { DepthLimit: 3, MoveTime: 400, MultiPV: 1 },
        medium: { DepthLimit: 8, MoveTime: 1500, MultiPV: 1 },
        hard: { DepthLimit: 0, MoveTime: 5000, MultiPV: 1 }
      }
    }
  ];

  function byId(id) {
    for (var i = 0; i < CATALOG.length; i++) if (CATALOG[i].id === id) return CATALOG[i];
    return null;
  }
  function list() { return CATALOG.slice(); }

  /* ---------- состояние выбранного движка ---------- */
  var state = {
    active: 'builtin',
    installed: {},        /* id -> {size, added, name, note} */
    options: {},          /* id -> {опция: значение} */
    worker: null,
    ready: false,
    busy: false
  };

  function keyFile(id) { return 'engine:' + id; }
  function keyMeta(id) { return 'engine-meta:' + id; }

  function isInstalled(id) { return !!state.installed[id]; }
  function installedInfo(id) { return state.installed[id] || null; }

  /* ---------- установка внешнего движка ---------- */
  /**
   * file — {name, size, arrayBuffer} (из <input type=file> или из обёртки).
   * Файл кладётся в IndexedDB; localStorage не расходуется.
   */
  function install(id, file) {
    var def = byId(id);
    if (!def) return Promise.reject(new Error('неизвестный движок: ' + id));
    if (def.kind !== 'uci') return Promise.reject(new Error('этот движок встроенный, устанавливать нечего'));
    if (!file || !file.data) return Promise.reject(new Error('не передан файл движка'));
    var bytes = file.data.byteLength !== undefined ? file.data.byteLength : String(file.data).length;
    return P.putFile(keyFile(id), file.data).then(function (where) {
      var meta = {
        id: id, name: file.name || (def.name + '.wasm'), size: bytes,
        added: new Date().toISOString(), storage: where,
        note: file.note || ''
      };
      state.installed[id] = meta;
      def.available = true;
      return P.putFile(keyMeta(id), JSON.stringify(meta)).then(function () { return meta; });
    });
  }

  function uninstall(id) {
    state.installed[id] = null;
    delete state.installed[id];
    var def = byId(id);
    if (def) def.available = false;
    if (state.active === id) state.active = 'builtin';
    return Promise.all([P.delFile(keyFile(id)), P.delFile(keyMeta(id))]).then(function () { return true; });
  }

  /* восстановить список установленных движков при старте */
  function restoreInstalled() {
    var jobs = CATALOG.filter(function (d) { return d.kind === 'uci'; }).map(function (d) {
      return P.getFile(keyMeta(d.id)).then(function (raw) {
        if (!raw) return;
        try {
          var meta = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (meta && meta.id) {
            state.installed[meta.id] = meta;
            d.available = true;
          }
        } catch (e) { /* повреждённая запись — просто игнорируем */ }
      });
    });
    return Promise.all(jobs).then(function () { return installedIds(); });
  }
  function installedIds() {
    return Object.keys(state.installed).filter(function (k) { return !!state.installed[k]; });
  }

  /* ---------- опции движка ---------- */
  function getOptions(id) {
    if (!state.options[id]) {
      var def = byId(id);
      state.options[id] = def && def.presets ? Object.assign({}, def.presets.medium) : {};
    }
    return state.options[id];
  }
  function setOption(id, name, value) {
    var o = getOptions(id);
    o[name] = value;
    if (state.active === id && state.worker) send('setoption name ' + name + ' value ' + value);
    return o;
  }
  function applyPreset(id, level) {
    var def = byId(id);
    if (!def || !def.presets || !def.presets[level]) return getOptions(id);
    state.options[id] = Object.assign({}, def.presets[level]);
    if (state.active === id && state.worker) {
      Object.keys(state.options[id]).forEach(function (k) {
        send('setoption name ' + k + ' value ' + state.options[id][k]);
      });
    }
    return state.options[id];
  }

  /* ---------- UCI-транспорт ---------- */
  var listeners = { info: [], bestmove: [], status: [], error: [] };
  function on(evt, fn) { if (listeners[evt]) listeners[evt].push(fn); }
  function off(evt, fn) {
    if (!listeners[evt]) return;
    listeners[evt] = listeners[evt].filter(function (f) { return f !== fn; });
  }
  function emit(evt, data) {
    (listeners[evt] || []).forEach(function (fn) {
      try { fn(data); } catch (e) { /* подписчик не должен ронять движок */ }
    });
  }

  function send(line) {
    if (state.native) return P.engineWrite(line);
    if (state.worker && state.worker.postMessage) {
      try { state.worker.postMessage({ type: 'uci', line: line }); return true; } catch (e) { return false; }
    }
    return false;
  }

  /* ---------- разбор строки, пришедшей от движка (общий для worker и процесса) ---------- */
  function handleUciLine(line) {
    line = String(line || '').trim();
    if (!line) return;
    if (line === 'uciok') { emit('status', { log: line }); return; }
    if (line === 'readyok') { state.ready = true; emit('status', { ready: true, id: state.active }); return; }
    if (line.indexOf('bestmove') === 0) {
      var parts = line.split(/\s+/);
      state.busy = false;
      var bi = state.lastInfo || {};
      emit('bestmove', {
        move: parts[1] || null, ponder: parts[3] || null, line: line,
        depth: bi.depth, score: bi.score, nodes: bi.nodes
      });
      state.lastInfo = null;
      return;
    }
    if (line.indexOf('info') === 0) {
      var d = { line: line };
      state.lastInfo = state.lastInfo || {};
      var depth = line.match(/ depth (\d+)/);
      var score = line.match(/ score (cp|mate) (-?\d+)/);
      var nodes = line.match(/ nodes (\d+)/);
      if (depth) { d.depth = parseInt(depth[1], 10); state.lastInfo.depth = d.depth; }
      if (nodes) { d.nodes = parseInt(nodes[1], 10); state.lastInfo.nodes = d.nodes; }
      if (score) { d.score = (score[1] === 'mate' ? 'mate ' : '') + score[2]; state.lastInfo.score = d.score; }
      emit('info', d);
      return;
    }
    emit('status', { log: line });
  }

  /**
   * Запуск внешнего движка в Web Worker.
   * workerSource — текст JS-обвязки, которая грузит WASM/asm.js и гоняет UCI.
   * Если обвязки или файла нет — честно возвращаем причину, а не падаем.
   */
  function start(id, opts) {
    opts = opts || {};
    var def = byId(id);
    if (!def) return Promise.reject(new Error('неизвестный движок'));
    if (def.kind === 'js') { state.active = id; state.ready = true; return Promise.resolve({ ok: true, kind: 'js' }); }
    if (!isInstalled(id)) return Promise.reject(new Error('движок не установлен — добавьте свой файл сборки'));
    if (typeof win === 'undefined' || !win.Worker || !win.URL || !win.URL.createObjectURL) {
      return Promise.reject(new Error('этот браузер не поддерживает Web Worker'));
    }
    return stop().then(function () {
      return P.getFile(keyFile(id));
    }).then(function (bin) {
      if (!bin) throw new Error('файл движка не найден в хранилище — установите его заново');
      var blobUrl = null;
      var source = opts.workerSource;
      if (!source) throw new Error('не передана JS-обвязка движка (workerSource)');
      var blob = new Blob([source], { type: 'text/javascript' });
      blobUrl = win.URL.createObjectURL(blob);
      var w = new Worker(blobUrl);
      state.worker = w;
      state.active = id;
      state.ready = false;
      w.onmessage = function (e) {
        var d = e.data || {};
        if (d.type === 'ready') { state.ready = true; emit('status', { ready: true, id: id }); }
        else if (d.type === 'info') emit('info', d);
        else if (d.type === 'bestmove') { state.busy = false; emit('bestmove', d); }
        else if (d.type === 'log') { handleUciLine(d.line); }
        else if (d.type === 'error') { state.busy = false; emit('error', { message: d.message }); }
      };
      w.onerror = function (e) {
        state.busy = false;
        emit('error', { message: (e && e.message) || 'сбой в потоке движка' });
      };
      /* передаём бинарник в поток: копируем, чтобы не держать ссылку на весь буфер */
      var payload = bin instanceof ArrayBuffer ? bin.slice(0) : bin;
      w.postMessage({ type: 'init', engine: payload, id: id }, payload instanceof ArrayBuffer ? [payload] : undefined);
      return new Promise(function (resolve, reject) {
        var t = setTimeout(function () {
          if (!state.ready) { stop(); reject(new Error('движок не ответил на uci/isready за 15 секунд')); }
        }, 15000);
        var un = function (d) {
          if (d && d.ready) { clearTimeout(t); off('status', un); resolve({ ok: true, kind: 'uci', id: id }); }
        };
        on('status', un);
        send('uci');
        send('isready');
      });
    });
  }

  /**
   * Запуск внешнего движка как нативного процесса (десктоп-обёртка).
   * В браузере недоступен: там остаётся путь WASM + Web Worker.
   */
  function startNative(exePath) {
    if (!P.nativeEngineAvailable()) {
      return Promise.reject(new Error('нативный запуск движка доступен только в десктоп-версии'));
    }
    return stop().then(function () {
      return P.spawnEngine(exePath);
    }).then(function (res) {
      if (!res || res.ok === false) throw new Error((res && res.error) || 'не удалось запустить движок');
      state.native = true;
      state.active = 'rodent4';
      var def = byId('rodent4');
      if (def) def.available = true;
      if (!state.nativeWired) {
        state.nativeWired = true;
        P.onEngineLine(handleUciLine);
        P.onEngineExit(function () {
          state.native = false; state.ready = false; state.busy = false;
          emit('error', { message: 'процесс движка завершился' });
        });
        P.onEngineError(function (msg) {
          state.busy = false;
          emit('error', { message: msg });
        });
      }
      return new Promise(function (resolve, reject) {
        var t = setTimeout(function () {
          if (!state.ready) reject(new Error('движок не ответил на uci/isready за 15 секунд'));
        }, 15000);
        var un = function (d) {
          if (d && d.ready) { clearTimeout(t); off('status', un); resolve({ ok: true, kind: 'native', pid: res.pid }); }
        };
        on('status', un);
        send('uci');
        send('isready');
      });
    });
  }

  function stop() {
    return new Promise(function (resolve) {
      if (state.native) { P.engineKill(); state.native = false; }
      if (state.worker) {
        try { send('quit'); } catch (e) { }
        try { state.worker.terminate(); } catch (e) { }
        state.worker = null;
      }
      state.ready = false;
      state.busy = false;
      resolve(true);
    });
  }

  /* ---------- ход ---------- */
  /**
   * Универсальная точка входа для приложения.
   * position — объект состояния из Chess-engine, fen — строка FEN, level — id уровня.
   * Возвращает Promise<{move: {from,to,promo}|null, engine, depth, score, timeMs}>.
   */
  function searchMove(position, fen, level, onProgress) {
    var id = state.active;
    var def = byId(id);
    var t0 = Date.now();
    var external = (state.worker || state.native) && state.ready;
    if (!def || def.kind === 'js' || !external) {
      /* встроенный бот: считаем синхронно, как и раньше */
      var m = Bot.search(position, level);
      return Promise.resolve({
        engine: 'builtin', move: m, depth: (Bot.LEVELS[level] || {}).depth || 0,
        score: null, timeMs: Date.now() - t0
      });
    }
    var opt = getOptions(id);
    var goParts = [];
    if (opt.MoveTime) goParts.push('movetime ' + opt.MoveTime);
    else if (opt.DepthLimit) goParts.push('depth ' + opt.DepthLimit);
    if (opt.NodeLimit) goParts.push('nodes ' + opt.NodeLimit);
    if (!goParts.length) goParts.push('movetime 2000');

    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        off('bestmove', onBest); off('info', onInfo); off('error', onErr);
        send('stop');
        reject(new Error('движок не вернул ход за отведённое время'));
      }, (opt.MoveTime || 2000) + 12000);

      function onInfo(d) { if (onProgress) onProgress(d); }
      function onErr(d) {
        if (done) return;
        done = true; clearTimeout(timer);
        off('bestmove', onBest); off('info', onInfo); off('error', onErr);
        reject(new Error(d.message || 'ошибка движка'));
      }
      function onBest(d) {
        if (done) return;
        done = true; clearTimeout(timer);
        off('bestmove', onBest); off('info', onInfo); off('error', onErr);
        resolve({
          engine: id, uci: d.move || null, move: null,
          depth: d.depth || opt.DepthLimit || 0, score: d.score, timeMs: Date.now() - t0,
          ponder: d.ponder || null
        });
      }
      on('bestmove', onBest); on('info', onInfo); on('error', onErr);

      send('ucinewgame');
      send('position fen ' + fen);
      Object.keys(opt).forEach(function (k) {
        if (k === 'MoveTime' || k === 'DepthLimit' || k === 'NodeLimit') return;
        send('setoption name ' + k + ' value ' + opt[k]);
      });
      send('isready');
      state.busy = true;
      send('go ' + goParts.join(' '));
    });
  }

  function stopSearch() {
    if (state.busy) send('stop');
    return Bot ? true : true;
  }

  function activeId() { return state.active; }
  function setActive(id) {
    if (!byId(id)) return false;
    if (byId(id).kind === 'uci' && !isInstalled(id)) return false;
    state.active = id;
    return true;
  }
  function status() {
    var def = byId(state.active) || CATALOG[0];
    return {
      active: state.active, name: def.name, kind: def.kind,
      ready: def.kind === 'js' ? true : state.ready,
      busy: state.busy, installed: installedIds(),
      desktop: P.isDesktop(), env: P.env
    };
  }

  var win = (typeof window !== 'undefined') ? window : null;

  return {
    CATALOG: CATALOG, list: list, byId: byId,
    install: install, uninstall: uninstall, restoreInstalled: restoreInstalled,
    isInstalled: isInstalled, installedInfo: installedInfo, installedIds: installedIds,
    getOptions: getOptions, setOption: setOption, applyPreset: applyPreset,
    start: start, startNative: startNative, stop: stop, send: send, on: on, off: off,
    nativeAvailable: function () { return P.nativeEngineAvailable(); },
    searchMove: searchMove, stopSearch: stopSearch,
    activeId: activeId, setActive: setActive, status: status
  };
});
