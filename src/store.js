/* =========================================================================
   Хранилище: настройки, текущая партия, архив партий, профили, журнал.
   Каждый блок — отдельный ключ localStorage, чтобы ход партии не переписывал
   весь архив. При недоступности localStorage (приватный режим, песочница)
   работает деградация в память без падений.
   ========================================================================= */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var api = factory();
  if (isNode) module.exports = api;
  if (root) root.Store = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var KEYS = {
    settings: 'chess-settings-v1',
    game: 'chess-game-v1',
    archive: 'chess-archive-v1',
    players: 'chess-players-v1',
    log: 'chess-log-v1'
  };
  var LOG_CAP = 500;
  var ANON = '@anon';

  /* ===== Бюджет места под архив =====
     localStorage обычно ограничен ~5 МБ на источник (в UTF-16, то есть ~2.5 млн
     символов). Под архив отводим 900 тыс. символов JSON — это ~1.8 МБ в
     localStorage, около 400 партий, и оставляет запас на настройки, журнал,
     текущую партию и данные других приложений этого источника.
     Расчёт движка живёт в оперативной памяти и localStorage не расходует,
     поэтому на силу игры бюджет не влияет. */
  var ARCHIVE_BUDGET = 900000;      /* символов JSON под архив */
  var RESERVE_GAMES = 3;            /* сверхбюджетный резерв, партий */
  var DEFAULT_GAME_BYTES = 2200;    /* оценка размера партии, пока архив пуст */
  var mem = {};                 /* запасное хранилище в памяти */
  var ok = true;                /* доступен ли localStorage */

  function ls() {
    try { return window.localStorage; } catch (e) { ok = false; return null; }
  }
  function load(key, def) {
    var l = ls();
    var raw = null;
    if (l) { try { raw = l.getItem(key); } catch (e) { ok = false; } }
    else raw = mem[key] !== undefined ? mem[key] : null;
    if (raw === null || raw === undefined) return def;
    try { var v = JSON.parse(raw); return v === null || v === undefined ? def : v; }
    catch (e) { return def; }
  }
  function store(key, value) {
    mem[key] = JSON.stringify(value);
    var l = ls();
    if (!l) return;
    try { l.setItem(key, mem[key]); }
    catch (e) { ok = false; }      /* переполнение или запрет — работаем в памяти */
  }

  /* ---------- блоки данных ---------- */
  var DEFAULT_SETTINGS = {
    mode: 'hotseat', level: 'medium', volume: 0.75, sound: true,
    flipped: false, autoFlip: false,
    meWhite: '', meBlack: '',
    countAnon: true, archiveReminder: 30, archiveReminderOn: true, activeTab: 'moves',
    /* чем считает компьютер: 'builtin' или id внешнего движка (rodent4), а для
       нативного движка — ещё и путь к исполняемому файлу, чтобы перезапустить
       его при следующем открытии приложения. Без записи в DEFAULT_SETTINGS эти
       ключи терялись при перезагрузке (список настроек собирается по нему). */
    engine: 'builtin', engineExe: null,
    /* цветовая тема (3.0): переопределения CSS-переменных, точечные цвета
       клеток (ключи "0".."63") и флаг расширенного режима раскраски */
    theme: {}, sqColors: {}, themeAdv: false
  };

  var set = {};

  var archiveData, playersData, logData, gameData;
  /* ---------- архив файлом на устройстве (десктоп) ----------
     Обёртка предоставляет синхронный мост archiveRead/archiveWrite: архив
     хранится обычным файлом в userData, без браузерных квот localStorage. */
  function fileBridge() {
    try {
      var b = (typeof window !== 'undefined' && window.Chesster) || null;
      return b && typeof b.archiveRead === 'function' && typeof b.archiveWrite === 'function' ? b : null;
    } catch (e) { return null; }
  }
  function fileTransport() { return !!fileBridge(); }
  function archiveFilePath() {
    var b = fileBridge();
    try { return b && typeof b.archivePath === 'function' ? b.archivePath() : null; } catch (e) { return null; }
  }

  function reloadBlocks() {
    var fb = fileBridge();
    if (fb) {
      var raw = null;
      try { raw = fb.archiveRead(); } catch (e) { raw = null; }
      var parsed = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parsed = null; }
      archiveData = Array.isArray(parsed) ? parsed : [];
    } else {
      archiveData = load(KEYS.archive, []);
    }
    if (!Array.isArray(archiveData)) archiveData = [];
    sizeById = {};
    playersData = load(KEYS.players, {});
    if (!playersData || typeof playersData !== 'object') playersData = {};
    logData = load(KEYS.log, []);
    if (!Array.isArray(logData)) logData = [];
    gameData = load(KEYS.game, null);
    var s2 = load(KEYS.settings, null) || {};
    for (var key in DEFAULT_SETTINGS) {
      set[key] = s2[key] !== undefined ? s2[key] : DEFAULT_SETTINGS[key];
    }
    /* тема (3.0): страховка от повреждённых сохранённых значений */
    if (!set.theme || typeof set.theme !== 'object' || Array.isArray(set.theme)) set.theme = {};
    if (!set.sqColors || typeof set.sqColors !== 'object' || Array.isArray(set.sqColors)) set.sqColors = {};
    set.themeAdv = set.themeAdv === true;
  }
  reloadBlocks();


  /* ---------- утилиты ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function stamp(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function sizeLabel(bytes) {
    if (bytes < 1024) return bytes + ' Б';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' КБ';
    return (bytes / 1048576).toFixed(2) + ' МБ';
  }
  function jsonLen(v) { try { return JSON.stringify(v).length; } catch (e) { return 0; } }
  function isAnon(name) { return !name || name === ANON; }
  function keyOf(name) { return isAnon(name) ? ANON : name; }
  function displayName(name) { return isAnon(name) ? 'Аноним' : name; }

  /* ---------- настройки ---------- */
  function settings() { return set; }
  function setSetting(key, value) { set[key] = value; store(KEYS.settings, set); }
  function setSettings(obj) {
    for (var key in obj) set[key] = obj[key];
    store(KEYS.settings, set);
  }

  /* ---------- текущая партия ---------- */
  function game() { return gameData; }
  function setGame(g) { gameData = g || null; store(KEYS.game, gameData); }
  function clearGame() { gameData = null; store(KEYS.game, null); }

  /* ---------- архив ---------- */
  function archive() { return archiveData; }
  function countGames() { return archiveData.length; }

  /* Размер каждой записи кэшируем: иначе каждая проверка места сериализовала бы
     весь архив, а цикл вытеснения старых партий давал бы квадратичную сложность. */
  var sizeById = {};
  function sizeOf(entry) {
    if (!entry) return 0;
    var cached = sizeById[entry.id];
    if (cached === undefined) { cached = jsonLen(entry) + 1; sizeById[entry.id] = cached; }
    return cached;
  }
  function forgetSize(entry) { if (entry && entry.id) delete sizeById[entry.id]; }
  function archiveBytes() {
    var total = 2;                                  /* скобки массива */
    for (var i = 0; i < archiveData.length; i++) total += sizeOf(archiveData[i]);
    return total;
  }
  /* объём занятого места: берём фактическую запись из localStorage,
     а если её ещё не было — размер данных в памяти */
  function usageLabel() {
    var total = 0;
    var l = ls();
    for (var key in KEYS) {
      var raw = null;
      if (l) { try { raw = l.getItem(KEYS[key]); } catch (e) { ok = false; } }
      if (raw === null || raw === undefined) raw = mem[key];
      total += raw ? raw.length : 0;
    }
    return sizeLabel(total) + (ok ? '' : ' (в памяти: localStorage недоступен)');
  }
  function nextAutoTitle(white, black) {
    var w = displayName(white), b = displayName(black);
    var maxNo = 0;
    for (var i = 0; i < archiveData.length; i++) {
      var m = String(archiveData[i].title || '').match(/Партия №(\d+)/);
      if (m) maxNo = Math.max(maxNo, parseInt(m[1], 10));
    }
    /* номер берём по максимальному существующему — после удалений номера не повторяются */
    return 'Партия №' + (maxNo + 1) + ': ' + w + ' — ' + b;
  }

  function persistArchive() {
    var fb = fileBridge();
    if (fb) {
      var written = false;
      try { written = fb.archiveWrite(JSON.stringify(archiveData)); } catch (e) { written = false; }
      if (written === false) lastError = 'disk';
      return;
    }
    var before = ok;
    store(KEYS.archive, archiveData);
    if (before && !ok) lastError = 'quota';       /* хранилище браузера отказалось писать */
  }

  /* перенос архива из localStorage в файл при первом запуске десктоп-версии */
  function migrateLocalStorageArchive() {
    if (!fileBridge()) return 0;
    if (archiveData.length) return 0;
    var l = ls();
    if (!l) return 0;
    var raw = null;
    try { raw = l.getItem(KEYS.archive); } catch (e) { return 0; }
    if (!raw) return 0;
    var old = null;
    try { old = JSON.parse(raw); } catch (e) { return 0; }
    if (!Array.isArray(old) || !old.length) return 0;
    archiveData = old;
    sizeById = {};
    persistArchive();
    try { l.removeItem(KEYS.archive); } catch (e) { }
    return archiveData.length;
  }
  var lastError = null;
  function persistPlayers() { store(KEYS.players, playersData); }

  /* ---------- профили ---------- */
  function ensurePlayer(name) {
    var key = keyOf(name);
    if (!playersData[key]) {
      playersData[key] = {
        name: key, anon: key === ANON,
        played: 0, won: 0, lost: 0, drawn: 0, asWhite: 0, asBlack: 0,
        mates: 0, mated: 0, stalemates: 0, resigns: 0, resigned: 0, selfGames: 0,
        first: stamp(), last: stamp()
      };
    }
    return playersData[key];
  }
  function players() {
    var out = [];
    for (var key in playersData) {
      var p = playersData[key];
      if (!p || !p.played) continue;                 /* пустые профили не показываем */
      out.push(p);
    }
    out.sort(function (a, b) {
      if (a.anon !== b.anon) return a.anon ? 1 : -1;  /* аноним всегда последним */
      if (b.played !== a.played) return b.played - a.played;
      return String(a.name).localeCompare(String(b.name), 'ru');
    });
    return out;
  }
  function player(name) { return playersData[keyOf(name)] || null; }

  function inc(obj, key, delta) {
    if (!obj) return;
    obj[key] = Math.max(0, (obj[key] || 0) + delta);
  }
  /* начисление/снятие статистики за одну партию (симметрично) */
  function applyStats(entry, sign) {
    if (!entry || !entry.counted) return;
    var wk = keyOf(entry.white), bk = keyOf(entry.black);
    var w = playersData[wk], b = playersData[bk];
    if (!w || !b) return;
    if (wk === bk) {
      /* Обе стороны без имени — это один и тот же сводный профиль «Аноним».
         Партию считаем один раз, а победы и поражения в ней взаимно уничтожаются,
         поэтому в счёт идут только сами факты: партия, ничья, пат. */
      inc(w, 'played', sign);
      inc(w, 'selfGames', sign);
      if (entry.result === '1/2-1/2') inc(w, 'drawn', sign);
      if (entry.reason === 'stalemate') inc(w, 'stalemates', sign);
      if (sign > 0) w.last = entry.date;
      persistPlayers();
      return;
    }
    inc(w, 'played', sign); inc(b, 'played', sign);
    inc(w, 'asWhite', sign); inc(b, 'asBlack', sign);
    if (entry.result === '1-0') { inc(w, 'won', sign); inc(b, 'lost', sign); }
    else if (entry.result === '0-1') { inc(b, 'won', sign); inc(w, 'lost', sign); }
    else { inc(w, 'drawn', sign); inc(b, 'drawn', sign); }
    if (entry.reason === 'checkmate') {
      if (entry.result === '1-0') { inc(w, 'mates', sign); inc(b, 'mated', sign); }
      else { inc(b, 'mates', sign); inc(w, 'mated', sign); }
    } else if (entry.reason === 'stalemate') {
      inc(w, 'stalemates', sign); inc(b, 'stalemates', sign);
    } else if (entry.reason === 'resign') {
      if (entry.result === '1-0') { inc(b, 'resigned', sign); inc(w, 'resigns', sign); }
      else { inc(w, 'resigned', sign); inc(b, 'resigns', sign); }
    }
    if (sign > 0) { w.last = entry.date; b.last = entry.date; }
    persistPlayers();
  }
  function revertStats(entry) { applyStats(entry, -1); }

  function renamePlayer(oldName, newName) {
    if (isAnon(oldName) || !playersData[oldName]) return false;
    newName = String(newName || '').trim();
    if (!newName || newName === oldName) return false;
    var a = playersData[oldName];
    if (playersData[keyOf(newName)]) {
      var b = playersData[keyOf(newName)];
      ['played', 'won', 'lost', 'drawn', 'asWhite', 'asBlack', 'mates', 'mated',
        'stalemates', 'resigns', 'resigned'].forEach(function (key) { b[key] = (b[key] || 0) + (a[key] || 0); });
      delete playersData[oldName];
    } else {
      a.name = newName;
      playersData[newName] = a;
      delete playersData[oldName];
    }
    archiveData.forEach(function (g) {
      if (g.white === oldName) g.white = newName;
      if (g.black === oldName) g.black = newName;
    });
    persistPlayers(); persistArchive();
    return true;
  }
  function deletePlayer(name) {
    var key = keyOf(name);
    if (!playersData[key]) return false;
    delete playersData[key];
    /* партии остаются в архиве, но больше не учитываются в статистике */
    archiveData.forEach(function (g) {
      if (keyOf(g.white) === key || keyOf(g.black) === key) g.counted = false;
    });
    persistPlayers(); persistArchive();
    return true;
  }
  function clearAnonStats() {
    delete playersData[ANON];
    archiveData.forEach(function (g) {
      if (g.whiteAnon || g.blackAnon) g.counted = false;
    });
    persistPlayers(); persistArchive();
  }

  /* ---------- место под архив ---------- */
  function avgGameBytes() {
    if (!archiveData.length) return DEFAULT_GAME_BYTES;
    return Math.max(400, Math.round(archiveBytes() / archiveData.length));
  }
  /* без ограничений: в десктопе архив лежит файлом на устройстве,
     в браузере — если пользователь сам выключил лимит в настройках */
  function isUnlimited() {
    if (fileTransport()) return true;
    return set.archiveUnlimited === true;
  }

  function quotaInfo() {
    var used = archiveBytes();
    var avg = avgGameBytes();
    if (isUnlimited()) {
      return {
        unlimited: true, used: used, limit: null, reserve: 0, total: null,
        avg: avg, reserveGames: RESERVE_GAMES,
        pct: null, pctOfTotal: null, free: null, freeGames: null,
        games: archiveData.length, level: 0, overflow: false,
        path: archiveFilePath()
      };
    }
    var reserve = avg * RESERVE_GAMES;
    var pct = ARCHIVE_BUDGET ? (used / ARCHIVE_BUDGET) * 100 : 0;
    return {
      unlimited: false,
      used: used, limit: ARCHIVE_BUDGET, reserve: reserve, total: ARCHIVE_BUDGET + reserve,
      avg: avg, reserveGames: RESERVE_GAMES,
      pct: pct,                                     /* может превышать 100 — за счёт резерва */
      pctOfTotal: (used / (ARCHIVE_BUDGET + reserve)) * 100,
      free: Math.max(0, ARCHIVE_BUDGET - used),
      freeGames: Math.max(0, Math.floor((ARCHIVE_BUDGET + reserve - used) / avg)),
      games: archiveData.length,
      level: pct >= 100 ? 100 : pct >= 95 ? 95 : pct >= 90 ? 90 : pct >= 80 ? 80 : 0,
      overflow: used > ARCHIVE_BUDGET + reserve
    };
  }
  /* освобождает место под новую партию: удаляет самые старые записи */
  function evictOldest(needBytes) {
    var evicted = [];
    if (isUnlimited()) return evicted;      /* без лимита ничего не удаляем принудительно */
    var projected = archiveBytes() + needBytes;
    while (archiveData.length > 1) {
      var limit = ARCHIVE_BUDGET + avgGameBytes() * RESERVE_GAMES;
      if (projected <= limit) break;
      var old = archiveData.pop();          /* самые старые — в конце списка */
      projected -= sizeOf(old);
      revertStats(old);
      evicted.push(old);
    }
    if (evicted.length) persistPlayers();
    return evicted;
  }

  /* ---------- запись партии ---------- */
  function saveGame(opts) {
    var entry = {
      id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      title: opts.title || nextAutoTitle(opts.white, opts.black),
      white: isAnon(opts.white) ? null : String(opts.white).trim(),
      black: isAnon(opts.black) ? null : String(opts.black).trim(),
      whiteAnon: isAnon(opts.white),
      blackAnon: isAnon(opts.black),
      date: opts.date || stamp(),
      result: opts.result || '*',
      reason: opts.reason || null,
      reasonText: opts.reasonText || '',
      plies: opts.plies || 0,
      startFen: opts.startFen || null,
      pgn: opts.pgn || '',
      moves: opts.moves || [],
      counted: false,
      note: opts.note || ''
    };
    /* анонимные партии учитываем, только если это разрешено настройкой */
    var wantCount = opts.counted !== false;
    if (wantCount && (entry.whiteAnon || entry.blackAnon) && set.countAnon === false) wantCount = false;
    entry.counted = wantCount;

    var evicted = [];
    if (opts.onEvict !== null) {
      evicted = evictOldest(jsonLen(entry));
    }
    archiveData.unshift(entry);
    forgetSize(entry);
    if (wantCount) {
      ensurePlayer(entry.white); ensurePlayer(entry.black);
      applyStats(entry, 1);
    }
    persistArchive();
    entry.evicted = evicted;                 /* кого пришлось вытеснить ради места */
    return entry;
  }
  function getGame(id) {
    for (var i = 0; i < archiveData.length; i++) if (archiveData[i].id === id) return archiveData[i];
    return null;
  }
  function updateGame(id, patch) {
    var g = getGame(id);
    if (!g) return null;
    for (var key in patch) g[key] = patch[key];
    forgetSize(g);                          /* запись изменилась — размер пересчитаем */
    persistArchive();
    return g;
  }
  function removeGame(id) {
    var g = getGame(id);
    if (!g) return false;
    revertStats(g);
    archiveData = archiveData.filter(function (x) { return x.id !== id; });
    persistArchive();
    return true;
  }
  /* keepStats=true  — профили не трогаем (счёт остаётся как был)
     keepStats=false — снимаем статистику выгруженных партий и полностью
                       сбрасываем все профили (пользователь явно отказался их хранить) */
  function clearArchive(opts) {
    opts = opts || {};
    if (!opts.keepStats) {
      archiveData.forEach(revertStats);
      playersData = {};
      persistPlayers();
    }
    archiveData = [];
    persistArchive();
  }
  function resetAllStats() {
    playersData = {};
    archiveData.forEach(function (g) { g.counted = false; });
    persistPlayers(); persistArchive();
  }

  /* ---------- журнал событий ---------- */
  function logs() { return logData; }
  function pushLog(text, kind) {
    logData.push({ t: stamp(), ts: Date.now(), text: text, kind: kind || 'info' });
    while (logData.length > LOG_CAP) logData.shift();
    store(KEYS.log, logData);
  }
  function clearLogs() { logData = []; store(KEYS.log, logData); }

  /* ---------- экспорт ---------- */
  function pgnAll(opts) {
    opts = opts || {};
    var list = opts.ids
      ? archiveData.filter(function (g) { return opts.ids.indexOf(g.id) >= 0; })
      : archiveData.slice();
    if (opts.reverse) list.reverse();
    var parts = [];
    list.forEach(function (g, i) {
      parts.push('; === ' + (i + 1) + '. ' + (g.title || '') + ' ===');
      parts.push(String(g.pgn || '').trim());
      parts.push('');
    });
    return parts.join('\n');
  }
  function jsonAll() {
    return JSON.stringify({ exported: stamp(), version: 1, games: archiveData, players: playersData }, null, 2);
  }

  /* ---------- разбор PGN ---------- */
  function splitPgnGames(text) {
    var games = [];
    var lines = String(text).split(/\r?\n/);
    var cur = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^\s*\[/.test(line)) {
        /* тег новой партии: если до этого шли ходы — предыдущая партия закончена */
        if (cur && cur.movetext.length) { games.push(cur); cur = null; }
        if (!cur) cur = { tags: {}, movetext: [] };
        var m = line.match(/^\s*\[(\w+)\s+"(.*)"\]\s*$/);
        if (m) cur.tags[m[1]] = m[2];
        continue;
      }
      if (/^\s*[;%]/.test(line)) continue;              /* комментарии вне скобок */
      /* пустая строка между тегами и ходами НЕ разрывает партию (это разделитель по стандарту PGN) */
      if (!line.trim()) { if (cur && cur.movetext.length) { games.push(cur); cur = null; } continue; }
      if (!cur) cur = { tags: {}, movetext: [] };
      cur.movetext.push(line);
    }
    if (cur) games.push(cur);
    return games;
  }
  function parseSanList(movetext) {
    var text = (movetext || []).join(' ')
      .replace(/\{[^}]*\}/g, ' ')
      .replace(/\$\d+/g, ' ')
      .replace(/\b(1-0|0-1|1\/2-1\/2|\*)\s*$/g, ' ');
    var tokens = text.split(/\s+/).filter(Boolean);
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i].replace(/^\d+\.+/, '').trim();
      if (!t) continue;
      if (t === '1-0' || t === '0-1' || t === '1/2-1/2' || t === '*') continue;
      if (/^\d+$/.test(t)) continue;
      out.push(t);
    }
    return out;
  }

  return {
    KEYS: KEYS, ANON: ANON, LOG_CAP: LOG_CAP,
    settings: settings, setSetting: setSetting, setSettings: setSettings,
    game: game, setGame: setGame, clearGame: clearGame,
    archive: archive, countGames: countGames, archiveBytes: archiveBytes,
    sizeLabel: sizeLabel, usageLabel: usageLabel, nextAutoTitle: nextAutoTitle, stamp: stamp,
    saveGame: saveGame, getGame: getGame, updateGame: updateGame,
    removeGame: removeGame, clearArchive: clearArchive, resetAllStats: resetAllStats,
    players: players, player: player, ensurePlayer: ensurePlayer,
    renamePlayer: renamePlayer, deletePlayer: deletePlayer, clearAnonStats: clearAnonStats,
    displayName: displayName, isAnon: isAnon, keyOf: keyOf,
    logs: logs, pushLog: pushLog, clearLogs: clearLogs,
    pgnAll: pgnAll, jsonAll: jsonAll,
    splitPgnGames: splitPgnGames, parseSanList: parseSanList, reload: reloadBlocks,
    fileTransport: fileTransport, archiveFilePath: archiveFilePath,
    migrateLocalStorageArchive: migrateLocalStorageArchive, isUnlimited: isUnlimited,
    ARCHIVE_BUDGET: ARCHIVE_BUDGET, RESERVE_GAMES: RESERVE_GAMES,
    avgGameBytes: avgGameBytes, quotaInfo: quotaInfo, evictOldest: evictOldest,
    available: function () { return ok; },
    lastError: function () { return lastError; }
  };
});
