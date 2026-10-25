/* =========================================================================
   Шаблон JS-обвязки для запуска Rodent IV (или любого UCI-движка,
   собранного в WASM/asm.js) внутри Web Worker браузера.
   Rodent V (2026, язык Go) официальной веб-сборки не имеет — этот путь
   остаётся для самосборных WASM-версий; в десктопе оба поколения
   подключаются исполняемым файлом (см. справку в разделе «Движок»).

   С версии 3.1 этот файл вшивается в index.html сборщиком: build.js подставляет
   его текст вместо служебного токена ENGINEWORKER в src/app.js (поле
   G.workerSource), поэтому приложение остаётся одним файлом и запускает
   движок без интернета и без соседних файлов.

   Это НЕ готовый движок, а контракт соединения. Родные сборки Rodent IV —
   это исполняемые файлы Windows/Linux; чтобы они работали в браузере, их
   компилируют в WebAssembly/asm.js (Emscripten) с подменой stdio. Данная
   обвязка ожидает от такой сборки минимальный контракт:

     модуль экспортирует:
       init()                 — подготовка движка;
       command(strPtr)        или  commandLine(str)  — подать строку UCI;
     модуль импортирует:
       send_line(ptr, len)    — отдать строку ответа UCI наружу.

   Если ваша сборка использует WASI-stdio, замените подменю ввода-вывода
   на pipes: обвязка ниже показывает, где именно.

   Поток сообщений с приложением (Engines.start передаёт workerSource):
     <- { type: 'init', engine: ArrayBuffer }   бинарник движка
     <- { type: 'uci',  line: 'position fen …' } строка UCI от приложения
     -> { type: 'ready' }                       движок ответил uciok + isready
     -> { type: 'info', depth, score, nodes }   строки info depth …
     -> { type: 'bestmove', move: 'e2e4' }      ход
     -> { type: 'log', line }                   прочий вывод для журнала
     -> { type: 'error', message }              сбой
   ========================================================================= */
'use strict';

let postLine = null;          // функция модуля для отправки строки наружу
let engineReady = false;
let commandLine = null;       // функция модуля для подачи строки UCI

function decode(bytes) {
  try { return new TextDecoder('utf-8').decode(bytes); } catch (e) { return ''; }
}
function encode(str) {
  return new TextEncoder().encode(str + '\n');
}

/* разбор строки UCI, пришедшей от движка */
function handleEngineLine(line) {
  line = String(line).trim();
  if (!line) return;
  if (line === 'uciok') { post({ type: 'log', line }); return; }
  if (line === 'readyok') { engineReady = true; post({ type: 'ready' }); return; }
  if (line.indexOf('bestmove') === 0) {
    const parts = line.split(/\s+/);
    post({ type: 'bestmove', move: parts[1] || null, ponder: parts[3] || null });
    return;
  }
  if (line.indexOf('info') === 0) {
    const d = { type: 'info', line };
    const depth = line.match(/ depth (\d+)/);
    const score = line.match(/ score (cp|mate) (-?\d+)/);
    const nodes = line.match(/ nodes (\d+)/);
    if (depth) d.depth = parseInt(depth[1], 10);
    if (nodes) d.nodes = parseInt(nodes[1], 10);
    if (score) d.score = (score[1] === 'mate' ? 'mate ' : '') + score[2];
    post(d);
    return;
  }
  post({ type: 'log', line });
}

function post(msg) { self.postMessage(msg); }

async function instantiate(wasmBytes) {
  /* Импорты: контракт send_line + минимальный env-заглушки.
     Для WASI-сборки добавьте сюда wasi_snapshot_preview1 с fd_write,
     пишущим в handleEngineLine. */
  const memory = { mem: null };
  const imports = {
    env: {
      send_line: (ptr, len) => {
        if (!memory.mem) return;
        const bytes = new Uint8Array(memory.mem.buffer, ptr, len);
        handleEngineLine(decode(bytes));
      },
      abort: () => { post({ type: 'error', message: 'abort из модуля' }); },
      emscripten_get_now: () => performance.now()
    },
    /* WASI-заглушка, если сборка с ней: вывод в stdout перехватываем */
    wasi_snapshot_preview1: {
      fd_write: (fd, iovs, iovsLen, nwritten) => {
        if (!memory.mem || fd !== 1) return 0;
        const view = new DataView(memory.mem.buffer);
        let out = '';
        for (let i = 0; i < iovsLen; i++) {
          const ptr = view.getUint32(iovs + i * 8, true);
          const len = view.getUint32(iovs + i * 8 + 4, true);
          out += decode(new Uint8Array(memory.mem.buffer, ptr, len));
        }
        if (nwritten) view.setUint32(nwritten, out.length, true);
        out.split('\n').forEach(handleEngineLine);
        return 0;
      },
      fd_read: () => 0, fd_seek: () => 0, fd_close: () => 0,
      proc_exit: () => 0, environ_sizes_get: () => 0, environ_get: () => 0,
      args_sizes_get: () => 0, args_get: () => 0, clock_time_get: () => 0,
      sched_yield: () => 0, random_get: () => 0
    }
  };
  const module = await WebAssembly.instantiate(wasmBytes, imports);
  const inst = module.instance;
  memory.mem = inst.exports.memory || inst.exports.mem || null;
  commandLine = inst.exports.commandLine || inst.exports.command_line ||
    (inst.exports.command && ((str) => {
      /* строка передаётся указателем: кладём её в память модуля */
      const bytes = encode(str);
      const ptr = (inst.exports.malloc || inst.exports._malloc)(bytes.length);
      new Uint8Array(memory.mem.buffer).set(bytes, ptr);
      inst.exports.command(ptr, bytes.length);
    }));
  if (inst.exports.init) inst.exports.init();
  return inst;
}

self.onmessage = async (event) => {
  const d = event.data || {};
  if (d.type === 'init') {
    try {
      postLine = null;
      await instantiate(d.engine);
      post({ type: 'log', line: 'модуль загружен, жду uci/isready' });
    } catch (err) {
      post({ type: 'error', message: 'не удалось загрузить WASM: ' + (err && err.message || err) });
    }
    return;
  }
  if (d.type === 'uci') {
    if (!commandLine) { post({ type: 'error', message: 'модуль не готов (нет init)' }); return; }
    try { commandLine(d.line); }
    catch (err) { post({ type: 'error', message: 'сбой на строке UCI: ' + (err && err.message || err) }); }
  }
};
