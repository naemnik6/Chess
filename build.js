/* Сборка единого самодостаточного файла index.html:
   стили + SVG-фигуры + движок + бот + интерфейс. */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

function pieceSprite() {
  let out = '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" ' +
    'style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false">';
  for (const c of ['w', 'b']) {
    for (const p of ['K', 'Q', 'R', 'B', 'N', 'P']) {
      const raw = read(`pieces/${c}${p}.svg`);
      const inner = raw.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
      out += `<symbol id="pc-${c}${p}" viewBox="0 0 45 45">${themeablePiece(inner, c)}</symbol>`;
    }
  }
  /* встроенные наборы (3.3): свои группы символов pc-<set>-<фигура> */
  for (const [sid] of SET_LIST) {
    for (const c of ['w', 'b']) {
      for (const p of ['K', 'Q', 'R', 'B', 'N', 'P']) {
        out += `<symbol id="pc-${sid}-${c}${p}" viewBox="0 0 45 45">${genSet(sid, c, p)}</symbol>`;
      }
    }
  }
  return out + '</svg>';
}

/* ---------- настройка цвета фигур (3.2) ----------
   Фигуры рисуются через <use href="#pc-wK">, а обычные CSS-селекторы внутрь
   теневого дерева <use> не проникают. Рабочий способ перекрасить их —
   подставить var() прямо в спрайт: custom properties наследуются в <use>,
   поэтому значение можно менять из темы. Явные fill/stroke заменяются здесь,
   а неявная заливка (у чёрных ферзя, ладьи и пешки fill не задан — он
   наследуется) приходит от самого <use>: app.js ставит ему
   style="fill:var(--pc-b-fill,#000)". Переменные --pc-* объявлены в :root и
   в реестре темы, значения по умолчанию равны цветам спрайта Cburnett,
   поэтому включение флага классический вид не меняет. */
const PIECE_THEME = true;
/* карта «атрибут:цвет → переменная» раздельно для fill и stroke:
   у белых фигур #000 — это контур и тёмные детали (грива коня),
   у чёрных #000 в fill — тело, а #000 в stroke — контур; #ececec — светлые детали. */
const PIECE_MAP = {
  w: {
    'fill:#fff': '--pc-w-fill', 'fill:#ffffff': '--pc-w-fill',
    'stroke:#000': '--pc-w-line', 'stroke:#000000': '--pc-w-line',
    'fill:#000': '--pc-w-line', 'fill:#000000': '--pc-w-line'
  },
  b: {
    'fill:#000': '--pc-b-fill', 'fill:#000000': '--pc-b-fill',
    'stroke:#000': '--pc-b-line', 'stroke:#000000': '--pc-b-line',
    'fill:#ececec': '--pc-b-hi', 'stroke:#ececec': '--pc-b-hi'
  }
};
function themeablePiece(inner, color) {
  if (!PIECE_THEME) return inner;
  const map = PIECE_MAP[color] || PIECE_MAP.w;
  return inner.replace(/<(path|g|circle|rect|ellipse|polygon)([^>]*)>/g, (m0, tag, attrs) => {
    const styles = [];
    const rest = attrs.replace(/(fill|stroke)="(#[0-9a-fA-F]{3,6})"/g, (mm, kind, hex) => {
      const vr = map[kind + ':' + hex.toLowerCase()];
      if (!vr) return mm;
      styles.push(`${kind}:var(${vr},${hex})`);
      return '';
    });
    if (!styles.length) return m0;
    /* тег может быть само закрывающимся (<path … />): «/» попадает в attrs,
       его нужно вернуть после добавленного style, а не внутрь списка атрибутов */
    const selfClose = /\s*\/\s*$/.test(rest);
    const clean = rest.replace(/\s*\/\s*$/, '').replace(/\s{2,}/g, ' ');
    return `<${tag}${clean} style="${styles.join(';')}"${selfClose ? '/>' : '>'}`;
  });
}

/* ---------- 3.3: встроенные наборы фигур (процедурные) ----------
   Наборы генерируются кодом вместо десятка папок SVG: компактно и легко
   поддерживать. Цвета — те же переменные темы (--pc-*), что у Cburnett,
   поэтому группа «Фигуры» в настройках перекрашивает ВСЕ встроенные наборы.
   id набора совпадает с listом PIECE_SETS в src/app.js (синхронность
   проверяет uitest16). */
const SET_LIST = [
  ['dots', 'Точки (одинаковые у чёрных и белых)'],
  ['rings', 'Кольца'],
  ['ghost', 'Прозрачные (контур)'],
  ['glass', 'Полупрозрачные'],
  ['unicode', 'Символы Unicode'],
  ['unicodeo', 'Символы Unicode, контур'],
  ['letters', 'Буквы'],
  ['geo', 'Геометрия'],
  ['geoo', 'Геометрия, контур'],
  ['mini', 'Мини-точки'],
  ['bars', 'Планки'],
];
function setColors(c) {
  return c === 'w'
    ? { fill: 'var(--pc-w-fill,#fff)', line: 'var(--pc-w-line,#000)', hi: 'var(--pc-w-line,#000)' }
    : { fill: 'var(--pc-b-fill,#000)', line: 'var(--pc-b-line,#000)', hi: 'var(--pc-b-hi,#ececec)' };
}
const GLYPH = { K: '\u265A', Q: '\u265B', R: '\u265C', B: '\u265D', N: '\u265E', P: '\u265F' };
function polyPts(cx, cy, r, n, rot, rIn) {
  const total = rIn ? n * 2 : n;
  const out = [];
  for (let i = 0; i < total; i++) {
    const rad = (rIn && i % 2 === 1) ? rIn : r;
    const a = rot + i * 2 * Math.PI / total;
    out.push((cx + rad * Math.cos(a)).toFixed(2) + ',' + (cy + rad * Math.sin(a)).toFixed(2));
  }
  return out.join(' ');
}
function ghostShape(p, col) {
  const L = 'stroke:' + col.line;
  const shapes = {
    K: '<path d="M22.5 8v6M19 11h7" style="fill:none;' + L + ';stroke-width:2"/><path d="M13 34h19l-2.5-14a7 7 0 0 0-14 0z" style="fill:none;' + L + ';stroke-width:1.8"/>',
    Q: '<circle cx="22.5" cy="10" r="2.6" style="fill:none;' + L + ';stroke-width:1.6"/><path d="M12 34h21l-2-15-5 6-3.5-8-3.5 8-5-6z" style="fill:none;' + L + ';stroke-width:1.8"/>',
    R: '<path d="M13 34h19V16h-4v4h-3.5v-4h-4v4H17v-4h-4z" style="fill:none;' + L + ';stroke-width:1.8"/>',
    B: '<path d="M22.5 8c5 4 7 8 7 12 0 5-3 8-7 8s-7-3-7-8c0-4 2-8 7-12z" style="fill:none;' + L + ';stroke-width:1.8"/><path d="M19.5 17l6 5" style="fill:none;' + L + ';stroke-width:1.4"/>',
    N: '<path d="M14 34c0-9 3-14 8-17l-2-4 8 3c4 3 6 8 6 18z" style="fill:none;' + L + ';stroke-width:1.8"/>',
    P: '<circle cx="22.5" cy="16" r="6" style="fill:none;' + L + ';stroke-width:1.8"/><path d="M14 34c0-5 4-8 8.5-8s8.5 3 8.5 8z" style="fill:none;' + L + ';stroke-width:1.8"/>'
  };
  return shapes[p] || shapes.P;
}
function geoShape(p, col, filled) {
  const st = 'fill:' + (filled ? col.fill : 'none') + ';stroke:' + col.line + ';stroke-width:1.6';
  switch (p) {
    case 'K': return '<polygon points="' + polyPts(22.5, 22.5, 14, 6, -Math.PI / 2) + '" style="' + st + '"/>';
    case 'Q': return '<polygon points="' + polyPts(22.5, 22.5, 15, 5, -Math.PI / 2, 7) + '" style="' + st + '"/>';
    case 'R': return '<rect x="9.5" y="9.5" width="26" height="26" rx="2" style="' + st + '"/>';
    case 'B': return '<polygon points="' + polyPts(22.5, 22.5, 15, 4, -Math.PI / 2) + '" style="' + st + '"/>';
    case 'N': return '<polygon points="' + polyPts(22.5, 23.5, 14, 3, -Math.PI / 2) + '" style="' + st + '"/>';
    default: return '<circle cx="22.5" cy="22.5" r="13" style="' + st + '"/>';
  }
}
function genSet(id, c, p) {
  const col = setColors(c);
  const F = 'fill:' + col.fill, L = 'stroke:' + col.line;
  switch (id) {
    case 'dots': return '<circle cx="22.5" cy="22.5" r="13" style="' + F + ';' + L + ';stroke-width:1.6"/>';
    case 'rings': return '<circle cx="22.5" cy="22.5" r="12.5" style="fill:none;' + L + ';stroke-width:3.4"/><circle cx="22.5" cy="22.5" r="3.6" style="' + F + '"/>';
    case 'ghost': return ghostShape(p, col);
    case 'glass': return '<circle cx="22.5" cy="22.5" r="14" style="' + F + ';fill-opacity:.32;' + L + ';stroke-width:1.4"/><text x="22.5" y="29.5" font-size="17" text-anchor="middle" font-family="Georgia,serif" font-weight="700" style="fill:' + col.hi + '">' + p + '</text>';
    case 'unicode': return '<text x="22.5" y="34" font-size="30" text-anchor="middle" style="' + F + ';' + L + ';stroke-width:.7">' + GLYPH[p] + '</text>';
    case 'unicodeo': return '<text x="22.5" y="34" font-size="30" text-anchor="middle" style="fill:none;' + L + ';stroke-width:1.1">' + GLYPH[p] + '</text>';
    case 'letters': return '<circle cx="22.5" cy="22.5" r="15" style="' + F + ';' + L + ';stroke-width:1.5"/><text x="22.5" y="29.5" font-size="17" text-anchor="middle" font-family="Georgia,serif" font-weight="700" style="fill:' + col.hi + '">' + p + '</text>';
    case 'geo': return geoShape(p, col, true);
    case 'geoo': return geoShape(p, col, false);
    case 'mini': return '<circle cx="22.5" cy="22.5" r="6" style="' + F + ';' + L + ';stroke-width:1.2"/>';
    case 'bars': {
      const h = { K: 30, Q: 26, R: 22, B: 18, N: 14, P: 10 }[p] || 10;
      return '<rect x="15.5" y="' + (38 - h) + '" width="14" height="' + h + '" rx="2" style="' + F + ';' + L + ';stroke-width:1.4"/>';
    }
    default: return '';
  }
}

/* версия — из единого version.json в корне проекта */
let appVersion = 'dev';
try { appVersion = String(JSON.parse(read('../version.json')).version || 'dev'); }
catch (e) { try { appVersion = String(JSON.parse(read('version.json')).version || 'dev'); } catch (e2) { } }
const buildStamp = new Date().toISOString().slice(0, 10);

let html = read('src/template.html');
const parts = {
  '/*@STYLE@*/': read('src/style.css'),
  '<!--@PIECES@-->': pieceSprite(),
  '/*@ENGINE@*/': read('src/engine.js'),
  '/*@STORE@*/': read('src/store.js'),
  '/*@THEME@*/': read('src/theme.js'),
  '/*@BOT@*/': read('src/bot.js'),
  '/*@PLATFORM@*/': read('src/platform.js'),
  '/*@ENGINES@*/': read('src/engines.js'),
  '/*@APP@*/': read('src/app.js')
};

/* версия прошивается в код приложения */
/* токены версий стоят внутри строковых литералов исходника */
/* Обвязка Web Worker для внешних UCI-движков (Rodent IV) вшивается строкой:
   приложение обязано оставаться одним файлом и работать без интернета, поэтому
   подгружать отдельный .js рядом с index.html ему нельзя. Токен здесь заменяется
   вместе с кавычками — JSON.stringify сам выдаёт готовый строковый литерал. */
const workerSource = read('desktop/rodent4-worker.js');
parts['/*@APP@*/'] = parts['/*@APP@*/']
  .replace('/*@APPVERSION@*/', () => appVersion)
  .replace('/*@BUILD@*/', () => buildStamp)
  .replace("'/*@ENGINEWORKER@*/'", () => JSON.stringify(workerSource));
if (parts['/*@APP@*/'].includes("'/*@ENGINEWORKER@*/'")) throw new Error('Обвязка движка не вшилась в app.js');

for (const [ph, code] of Object.entries(parts)) {
  if (!html.includes(ph)) throw new Error('Плейсхолдер не найден: ' + ph);
  if (code.includes(ph)) throw new Error('Код содержит плейсхолдер: ' + ph);
  html = html.replace(ph, () => code);
}

/* сервис-воркер получает имя кэша с версией: новая версия = новый кэш */
const sw = read('src/sw.template.js').replace('/*@SWV@*/', () => appVersion + '-' + buildStamp);
fs.writeFileSync(path.join(root, 'sw.js'), sw);

const left = html.match(/@(STYLE|PIECES|ENGINEWORKER|ENGINE|STORE|THEME|PLATFORM|ENGINES|BOT|APPVERSION|BUILD|APP)@/);
if (left) throw new Error('Остался незаменённый плейсхолдер: ' + left[0]);

fs.writeFileSync(path.join(root, 'index.html'), html);
console.log(`index.html собран: ${(Buffer.byteLength(html) / 1024).toFixed(1)} КБ · версия ${appVersion} · сборка ${buildStamp}`);
console.log(`обвязка движка вшита: ${(Buffer.byteLength(workerSource) / 1024).toFixed(1)} КБ · фигуры в теме: ${PIECE_THEME ? 'да' : 'нет (задел 3.2)'}`);
console.log(`sw.js обновлён: кэш chesster-${appVersion}-${buildStamp}`);
console.log(`наборов фигур в спрайте: ${SET_LIST.length + 1} (Cburnett + ${SET_LIST.length} процедурных)`);

/* Обёртка Tauri удалена из проекта (решение от 2026-10): копия фронтенда не нужна. */
