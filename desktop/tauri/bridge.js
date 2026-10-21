/* =========================================================================
   bridge.js — мост window.Chesster для обёртки Tauri v2.
   Внедряется главным процессом как initialization_script ДО загрузки
   страницы, поэтому src/platform.js видит window.Chesster так же, как
   в Electron (preload.js), и весь код приложения работает без изменений.

   Повторяет API preload.js Electron один в один по форме ответов:
     • saveFile   → { saved, path } / { saved:false, canceled:true } / { saved:false, error }
                    (файл сохраняется текстом UTF-8: PGN и JSON — единственное,
                    что приложение пишет на диск)
     • pickEngine → { canceled, path }
     • spawnEngine→ Promise<pid>, engineWrite/engineKill — fire-and-forget
     • onEngineLine/Exit/Error — подписка на события Rust-стороны
   Осознанно НЕ реализовано (см. TAURI.md, этап 2):
     • archiveRead/archiveWrite/archivePath — в Electron они синхронные
       (sendSync), а IPC Tauri асинхронный; без переделки store.js на
       асинхронный транспорт включать их нельзя (риск потери архива).
       Без них архив живёт в localStorage WebView — он тоже сохраняется
       между запусками (профиль WebView2/WKWebView), но ограничен квотой.
     • checkUpdates — автообновление Tauri требует отдельной подписи
       артефактов (tauri-plugin-updater); пока возвращаем честную заглушку.
     • onMenu — нативного меню пока нет, пункты просто не срабатывают.
   ========================================================================= */
(function () {
  if (window.Chesster) return;

  function T() { return window.__TAURI__ || null; }
  function invoke(cmd, args) {
    var t = T();
    if (!t || !t.core || !t.core.invoke) return Promise.reject(new Error('Tauri IPC ещё недоступен'));
    return t.core.invoke(cmd, args || {});
  }
  function listen(event, cb) {
    var t = T();
    if (!t || !t.event || !t.event.listen) return;
    t.event.listen(event, function (e) { try { cb(e && e.payload); } catch (err) { /* слушаем дальше */ } });
  }
  function curWin() {
    var t = T();
    try { return (t && t.window && t.window.getCurrentWindow) ? t.window.getCurrentWindow() : null; }
    catch (e) { return null; }
  }
  function textOf(arg) {
    if (arg && typeof arg === 'object') return String(arg.text || '');
    return String(arg === undefined || arg === null ? '' : arg);
  }
  /* Данные файла приводим к строке UTF-8: приложение сохраняет только текст
     (PGN, JSON), а вложенные Uint8Array JSON-транспорт Tauri не переносит —
     raw-режим доступен, лишь когда ArrayBuffer является всем аргументом. */
  function toText(data) {
    if (typeof data === 'string') return data;
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      try { return new TextDecoder('utf-8').decode(data); } catch (e) { return String(data); }
    }
    return textOf(data);
  }

  window.Chesster = {
    /* __CT_VER__ подставляется из Cargo.toml при сборке (main.rs) */
    appVersion: '__CT_VER__',
    platform: 'tauri',
    tauri: true,

    /* ---------- внешние ссылки и файлы ---------- */
    openExternal: function (url) {
      return invoke('open_external', { url: String(url || '') });
    },
    saveFile: function (payload) {
      var data = payload && payload.data;
      return invoke('save_file', {
        name: (payload && payload.name) || 'partiya.pgn',
        data: toText(data)
      })
        .then(function (path) { return { saved: true, path: String(path || '') }; })
        .catch(function (err) {
          var msg = String((err && err.message) || err || '');
          if (msg.indexOf('отменено') >= 0) return { saved: false, canceled: true };
          return { saved: false, error: msg };
        });
    },

    /* ---------- окно ---------- */
    setTitle: function (arg) {
      var w = curWin();
      if (w) { try { w.setTitle(textOf(arg)); } catch (e) { /* не критично */ } }
      return Promise.resolve(true);
    },
    setBadge: function () { return Promise.resolve(true); },
    setFullscreen: function (on) {
      var w = curWin();
      if (w) { try { w.setFullscreen(!!on); } catch (e) { /* браузерный fallback сработает */ } }
      return true;
    },
    isFullscreen: function () {
      var w = curWin();
      if (w && w.isFullscreen) return Promise.resolve(w.isFullscreen()).catch(function () { return false; });
      return Promise.resolve(false);
    },

    /* ---------- внешний UCI-движок (Rodent IV отдельным процессом) ---------- */
    pickEngine: function () {
      return invoke('pick_engine')
        .then(function (r) { return r || { canceled: true }; })
        .catch(function () { return { canceled: true }; });
    },
    spawnEngine: function (exePath) {
      return invoke('engine_spawn', { exe: String(exePath || '') });
    },
    engineWrite: function (line) {
      invoke('engine_write', { line: String(line) }).catch(function () { });
      return true;
    },
    engineKill: function () {
      invoke('engine_kill').catch(function () { });
    },
    onEngineLine: function (cb) { listen('engine:line', cb); },
    onEngineExit: function (cb) { listen('engine:exit', cb); },
    onEngineError: function (cb) { listen('engine:error', cb); },

    /* ---------- меню, обновления, жизненный цикл ---------- */
    onMenu: function (name, cb) { listen('menu:' + name, function () { try { cb({}); } catch (e) { } }); },
    checkUpdates: function () {
      return Promise.resolve({
        ok: false, reason: 'tauri-not-wired', diag: null,
        message: 'Автообновление в сборке Tauri пока не настроено: скачайте новую версию вручную со страницы релизов GitHub.',
        releasesUrl: 'https://github.com/naemnik6/Chess/releases'
      });
    },
    updateInfo: function () { return Promise.resolve(null); },
    onUpdaterEvent: function () { /* событий автообновления в Tauri-сборке пока нет */ },
    appReady: function () { return Promise.resolve(true); },
    onQuitRequested: function () { /* Tauri закрывает окно напрямую */ }
  };
})();
