/* =========================================================================
   Слой подключаемых движков.

   Сегодня: встроенный JS-бот (негамакс + альфа-бета) — работает везде,
   ничего не скачивает.

   Задел на будущее: внешние UCI-движки, в первую очередь Rodent IV и Rodent V.
   Для них уже prepared всё, кроме самого бинарника:
     • каталог движков в хранилище (IndexedDB, а не localStorage — архив
       партий и движки не должны бороться за одно место);
     • описание движка, его статуса и того, что нужно пользователю;
     • транспорт (Web Worker + WASM/asm.js + polyfill Node для UCI-сборок);
     • протокол UCI поверх postMessage: uci/isready/ucinewgame/position/go/stop;
     • настройка уровня через ограниченные глубину/узлы/время и MultiPV,
       а для Rodent — ещё и через его собственные personality-параметры
       (у Rodent V это PersonalityFile, UCI_LimitStrength и UCI_Elo).

   Rodent распространяется как исполняемый файл (GPL), поэтому в веб-сборку
   он не вкладывается: пользователь добавляет свою копию, а приложение хранит
   её локально. Rodent V (2026, на Go, NNUE, ~3400 CCRL) проверялся живым
   рукопожатием: id name / 9 опций / info / bestmove — формат строк тот же,
   что у Rodent IV, разбор протокола общий. Рабочая папка процесса — папка
   exe, поэтому соседние подпапки personalities/nets/books движок находит сам.
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
      name: 'Rodent IV / V',
      kind: 'uci',
      available: false,          /* появится, когда пользователь добавит свою сборку */
      bundled: false,
      strength: 'IV: ~2600-3000 Elo · V: ~3400-3470 Elo (CCRL, зависит от «личности»)',
      about: 'Открытые движки Павла Козёля (GPL): Rodent IV и его продолжение Rodent V (на Go, ' +
        'с нейросетевой оценкой NNUE, ~3400 Elo). Оба говорят по протоколу UCI, поэтому ' +
        'подключаются одинаково: в десктопе — исполняемый файл (процесс поднимает обёртка, ' +
        'рабочая папка — папка движка, поэтому соседние personalities/nets/books он находит сам); ' +
        'в браузере — сборка, скомпилированная в WebAssembly/asm.js. Rodent V выходит только ' +
        'исполняемым файлом — веб-сборки у него нет. В приложение движок не вложен: вы добавляете ' +
        'свою копию, она остаётся на вашем устройстве (IndexedDB или путь к exe) и никуда не отправляется.',
      homepage: 'https://github.com/nescitus/Rodent-V',
      /* что именно ждём от пользователя */
      accepts: [
        { ext: '.wasm', label: 'сборка движка в WebAssembly (браузер)' },
        { ext: '.js', label: 'asm.js-сборка с UCI-интерфейсом (браузер)' },
        { ext: '.exe', label: 'исполняемый файл Rodent IV или V (десктоп)' }
      ],
      /* UCI-опции, которыми настраиваются сила и стиль. Список — запасной:
         настоящие опции читаются из рукопожатия uciok. Здесь типовые имена
         обоих поколений: PersonalityFile есть и у IV, и у V; UCI_LimitStrength
         и UCI_Elo (800…3000) появились в Rodent V 1.1+. */
      uciOptions: [
        { name: 'DepthLimit', type: 'spin', min: 1, max: 40, label: 'Ограничение глубины' },
        { name: 'NodeLimit', type: 'spin', min: 0, max: 100000000, label: 'Ограничение по узлам' },
        { name: 'MoveTime', type: 'spin', min: 0, max: 60000, label: 'Время на ход, мс' },
        { name: 'MultiPV', type: 'spin', min: 1, max: 8, label: 'Число вариантов (MultiPV)' },
        { name: 'Personality', type: 'combo', label: 'Стиль игры (личность)' },
        { name: 'PersonalityFile', type: 'string', label: 'Файл «личности» (Rodent V)' },
        { name: 'UCI_LimitStrength', type: 'check', label: 'Ограничить силу (Rodent V)' },
        { name: 'UCI_Elo', type: 'spin', min: 800, max: 3000, label: 'Уровень Elo (Rodent V)' },
        { name: 'Threads', type: 'spin', min: 1, max: 16, label: 'Потоки' },
        { name: 'Hash', type: 'spin', min: 1, max: 1024, label: 'Хэш, МБ' }
      ],
      /* готовые пресеты под наши уровни, чтобы переключение было привычным.
         Это параметры команды go — их понимает любой UCI-движок, и IV, и V */
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
    installed: {},        /* id -> {size, added, name, note, native?, path?} */
    options: {},          /* id -> {опция: значение} */
    detected: {},         /* id -> опции, которые движок сам назвал при рукопожатии */
    idInfo: {},           /* id -> {name, author}: как движок представился (id name / id author) */
    worker: null,
    native: false,
    ready: false,
    busy: false,
    needNewGame: true,    /* ucinewgame шлём один раз на партию, а не на каждый ход */
    optsDirty: true       /* параметры UCI нужно (пере)послать движку */
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
    var wasActive = state.active === id;
    state.installed[id] = null;
    delete state.installed[id];
    delete state.detected[id];
    var def = byId(id);
    if (def) def.available = false;
    if (wasActive) state.active = 'builtin';
    /* запущенный процесс или поток нужно погасить: иначе Rodent IV останется
       висеть в памяти устройства после удаления из интерфейса */
    return (wasActive ? stop() : Promise.resolve(true)).then(function () {
      return Promise.all([P.delFile(keyFile(id)), P.delFile(keyMeta(id))]);
    }).then(function () { return true; });
  }

  /* восстановить список установленных движков при старте */
  function restoreInstalled() {
    var jobs = CATALOG.filter(function (d) { return d.kind === 'uci'; }).map(function (d) {
      return P.getFile(keyMeta(d.id)).then(function (raw) {
        if (!raw) return;
        try {
          var meta = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (!meta || !meta.id) return;
          /* запись о нативном движке имеет смысл только там, где обёртка умеет
             запускать процессы: в браузере такой движок не восстановить */
          if (meta.native && !P.nativeEngineAvailable()) return;
          state.installed[meta.id] = meta;
          d.available = true;
        } catch (e) { /* повреждённая запись — просто игнорируем */ }
      });
    });
    return Promise.all(jobs).then(function () { return installedIds(); });
  }
  function installedIds() {
    return Object.keys(state.installed).filter(function (k) { return !!state.installed[k]; });
  }
  function isNative(id) { return !!(state.installed[id] && state.installed[id].native); }
  function nativePath(id) { return (state.installed[id] && state.installed[id].path) || null; }

  /* Нативный движок (исполняемый файл, запущенный обёрткой) тоже считается
     установленным: у него нет бинарника в хранилище, но карточка, кнопки
     «Использовать/Проверить/Удалить» и выбор активного движка должны работать
     так же, как с WASM-сборкой. Запись помечается native:true и хранит путь. */
  function baseName(p) {
    var s = String(p || '').replace(/\\/g, '/');
    return s.slice(s.lastIndexOf('/') + 1) || String(p || '');
  }
  function registerNative(id, exePath) {
    var def = byId(id);
    var meta = {
      id: id, name: baseName(exePath), size: 0, added: new Date().toISOString(),
      storage: 'файл на устройстве', native: true, path: String(exePath || ''),
      note: 'запускается отдельным процессом обёрткой'
    };
    state.installed[id] = meta;
    if (def) def.available = true;
    return P.putFile(keyMeta(id), JSON.stringify(meta)).then(function () { return meta; }, function () { return meta; });
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
    state.optsDirty = true;
    if (state.active === id && (state.worker || state.native)) send('setoption name ' + name + ' value ' + value);
    return o;
  }
  function applyPreset(id, level) {
    var def = byId(id);
    if (!def || !def.presets || !def.presets[level]) return getOptions(id);
    /* пресет силы дополняет опции, а не затирает их: Hash, Threads и «личность»
       пользователь мог выставить сам, и смена уровня не должна их терять */
    state.options[id] = Object.assign({}, state.options[id] || {}, def.presets[level]);
    state.optsDirty = true;
    if (state.active === id && (state.worker || state.native)) {
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
  /* option name Hash type spin default 16 min 1 max 33554432
     option name Ponder type check default false
     option name Personality type combo default balanced var calm var balanced
     Настоящие опции движка узнаются из рукопожатия: список из каталога — это
     лишь запасной вариант, пока движок не ответил uciok. */
  function parseUciOption(line) {
    var m = /^option\s+name\s+(.+?)\s+type\s+(button|check|combo|string|spin)\b([\s\S]*)$/i.exec(line);
    if (!m) return null;
    var name = m[1].trim();
    var rest = m[3] || '';
    var op = { name: name, type: m[2].toLowerCase(), label: name };
    var dm = /\bdefault\s+([\s\S]*?)(?=\s+(?:min|max|var)\s|$)/i.exec(rest);
    if (dm && dm[1] !== '') op['default'] = dm[1].trim();
    var mn = /\bmin\s+(-?\d+)/i.exec(rest);
    if (mn) op.min = parseInt(mn[1], 10);
    var mx = /\bmax\s+(-?\d+)/i.exec(rest);
    if (mx) op.max = parseInt(mx[1], 10);
    var vs = rest.match(/\bvar\s+[^\s]+/gi);
    if (vs && vs.length) op['var'] = vs.map(function (x) { return x.replace(/^var\s+/i, ''); });
    return op;
  }

  function handleUciLine(line) {
    line = String(line || '').trim();
    if (!line) return;
    /* движок представляется сам: «id name Rodent V 1.2 AVX2», «id author …».
       Имя показываем в карточке — сразу видно, какое поколение подключено (3.2) */
    var idm = /^id\s+(name|author)\s+(.+)$/i.exec(line);
    if (idm) {
      var slot = state.idInfo[state.active] || (state.idInfo[state.active] = {});
      slot[idm[1].toLowerCase()] = idm[2].trim();
      emit('status', { log: line });
      return;
    }
    if (/^option\s+name\s+/i.test(line)) {
      var op = parseUciOption(line);
      if (op) {
        var list = state.detected[state.active] || (state.detected[state.active] = []);
        for (var i = 0; i < list.length; i++) if (list[i].name === op.name) return;
        list.push(op);
      }
      return;
    }
    if (line === 'uciok') {
      emit('status', { uciok: true, log: line, id: state.active, options: (state.detected[state.active] || []).slice() });
      return;
    }
    if (line === 'readyok') { state.ready = true; emit('status', { ready: true, id: state.active }); return; }
    if (line.indexOf('bestmove') === 0) {
      var parts = line.split(/\s+/);
      state.busy = false;
      var bi = state.lastInfo || {};
      var mv = (parts[1] && parts[1] !== '(none)' && /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(parts[1])) ? parts[1] : null;
      emit('bestmove', {
        move: mv, ponder: parts[3] || null, line: line,
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

  /* опции, которые движок назвал сам (пусто, если рукопожатия ещё не было) */
  function detectedOptions(id) { return (state.detected[id || state.active] || []).slice(); }

  /* как движок представился при рукопожатии: {name, author} или null */
  function engineIdentity(id) { return state.idInfo[id || state.active] || null; }

  /* (пере)послать параметры UCI: делается перед первым поиском и после смены
     пресета, а не на каждом ходу — движки этого не любят */
  function pushOptions(id) {
    var opt = getOptions(id);
    Object.keys(opt).forEach(function (k) {
      if (k === 'MoveTime' || k === 'DepthLimit' || k === 'NodeLimit') return;  /* это параметры go */
      send('setoption name ' + k + ' value ' + opt[k]);
    });
    state.optsDirty = false;
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
    /* сборка добавлена как исполняемый файл (десктоп) — запускаем процессом */
    if (isNative(id)) return startNative(nativePath(id));
    if (!opts.workerSource) {
      return Promise.reject(new Error('нет JS-обвязки потока (workerSource) для запуска WASM-сборки'));
    }
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
      state.needNewGame = true;
      state.optsDirty = true;
      state.detected[id] = [];
      state.idInfo[id] = null;
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
    if (!exePath) return Promise.reject(new Error('не указан путь к исполняемому файлу движка'));
    return stop().then(function () {
      return P.spawnEngine(exePath);
    }).then(function (res) {
      /* обёртка отвечает {ok,pid}; на всякий случай нормализуем и голый pid */
      var pid = (typeof res === 'number') ? res : (res && res.pid);
      if (res && res.ok === false) throw new Error(res.error || 'не удалось запустить движок');
      if (res === null || res === undefined || res === false) throw new Error('обёртка не ответила на запуск движка');
      state.native = true;
      state.active = 'rodent4';
      state.needNewGame = true;
      state.optsDirty = true;
      state.detected.rodent4 = [];
      state.idInfo.rodent4 = null;
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
      /* движок помечается установленным: карточка, кнопки и выбор активного
         работают так же, как с WASM-сборкой, а путь запоминается для перезапуска */
      return registerNative('rodent4', exePath).then(function (meta) {
        return new Promise(function (resolve, reject) {
          var t = setTimeout(function () {
            if (!state.ready) reject(new Error('движок не ответил на uci/isready за 15 секунд'));
          }, 15000);
          var un = function (d) {
            if (d && d.ready) {
              clearTimeout(t); off('status', un);
              resolve({ ok: true, kind: 'native', pid: pid, name: meta.name, options: detectedOptions('rodent4') });
            }
          };
          on('status', un);
          send('uci');
          send('isready');
        });
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
      state.optsDirty = true;      /* после перезапуска параметры нужно послать заново */
      resolve(true);
    });
  }

  /* новая партия: движку положен ucinewgame (сброс хэша и истории), но слать
     его на каждый ход нельзя — флаг обрабатывается следующим поиском */
  function newGame() {
    state.needNewGame = true;
    return true;
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

      /* порядок команд по протоколу UCI: сначала параметры и ucinewgame,
         затем позиция и поиск. Раньше setoption уходил после position,
         а ucinewgame — на каждом ходу: движки сбрасывали хэш и ругались. */
      if (state.optsDirty) pushOptions(id);
      if (state.needNewGame) { send('ucinewgame'); state.needNewGame = false; }
      send('isready');
      send('position fen ' + fen);
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
      native: !!state.native, path: nativePath(state.active),
      options: detectedOptions(state.active).length,
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
    /* нативный движок (исполняемый файл обёртки) и опции из рукопожатия UCI */
    isNative: isNative, nativePath: nativePath, registerNative: registerNative,
    detectedOptions: detectedOptions, parseUciOption: parseUciOption, newGame: newGame,
    engineIdentity: engineIdentity, handleUciLine: handleUciLine,
    searchMove: searchMove, stopSearch: stopSearch,
    activeId: activeId, setActive: setActive, status: status
  };
});
