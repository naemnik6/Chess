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
  return out + '</svg>';
}

/* ---------- задел под настройку цвета фигур (план 3.2) ----------
   Фигуры рисуются через <use href="#pc-wK">, а обычные CSS-селекторы внутрь
   теневого дерева <use> не проникают. Единственный рабочий способ перекрасить
   их — подставить var() прямо в спрайт: custom properties наследуются в <use>,
   поэтому значение можно менять из темы (и даже для каждой доски отдельно).
   Флаг намеренно выключен: подстановку нужно проверить в настоящем браузере
   (в песочнице и jsdom фигуры не рисуются), иначе есть риск получить чёрные
   белые фигуры. Переменные --pc-* уже объявлены в :root и равны текущим
   цветам спрайта, поэтому включение флага вид не изменит. */
const PIECE_THEME = false;
const PIECE_VARS = {
  w: { fill: '--pc-w-fill', line: '--pc-w-line', hi: '--pc-w-fill' },
  b: { fill: '--pc-b-fill', line: '--pc-b-line', hi: '--pc-b-hi' }
};
function themeablePiece(inner, color) {
  if (!PIECE_THEME) return inner;
  const v = PIECE_VARS[color] || PIECE_VARS.w;
  const map = { '#fff': v.fill, '#ffffff': v.fill, '#000': color === 'w' ? v.line : v.fill, '#000000': color === 'w' ? v.line : v.fill, '#ececec': v.hi };
  return inner.replace(/<(path|g|circle|rect|ellipse|polygon)([^>]*)>/g, (m0, tag, attrs) => {
    const styles = [];
    const rest = attrs.replace(/(fill|stroke)="(#[0-9a-fA-F]{3,6})"/g, (mm, kind, hex) => {
      const vr = map[hex.toLowerCase()];
      if (!vr) return mm;
      styles.push(`${kind}:var(${vr},${hex})`);
      return '';
    });
    if (!styles.length) return m0;
    return `<${tag}${rest.replace(/\s{2,}/g, ' ')} style="${styles.join(';')}">`;
  });
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

/* ---------- копия фронтенда для обёртки Tauri ----------
   tauri.conf.json указывает frontendDist на desktop/tauri/dist, а не на корень
   проекта: иначе в бинарник попал бы весь репозиторий (тесты, исходники,
   desktop/node_modules на сотни мегабайт). Сервис-воркер сюда намеренно не
   копируется — в обёртке офлайн-кэш не нужен (регистрация sw.js тихо
   отменяется), а манифест и иконка копируются, чтобы не было ошибок 404. */
const tauriRoot = path.join(root, 'desktop', 'tauri');
if (fs.existsSync(tauriRoot)) {
  const dist = path.join(tauriRoot, 'dist');
  fs.mkdirSync(path.join(dist, 'desktop', 'icons'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), html);
  for (const rel of ['manifest.webmanifest', 'desktop/icons/icon-192.png']) {
    const src = path.join(root, rel);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dist, rel));
  }
  console.log('desktop/tauri/dist обновлён: index.html + манифест + иконка (фронтенд для Tauri)');
}
