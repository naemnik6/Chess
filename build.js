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
      out += `<symbol id="pc-${c}${p}" viewBox="0 0 45 45">${inner}</symbol>`;
    }
  }
  return out + '</svg>';
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
  '/*@BOT@*/': read('src/bot.js'),
  '/*@PLATFORM@*/': read('src/platform.js'),
  '/*@ENGINES@*/': read('src/engines.js'),
  '/*@APP@*/': read('src/app.js')
};

/* версия прошивается в код приложения */
/* токены версий стоят внутри строковых литералов исходника */
parts['/*@APP@*/'] = parts['/*@APP@*/']
  .replace('/*@APPVERSION@*/', () => appVersion)
  .replace('/*@BUILD@*/', () => buildStamp);

for (const [ph, code] of Object.entries(parts)) {
  if (!html.includes(ph)) throw new Error('Плейсхолдер не найден: ' + ph);
  if (code.includes(ph)) throw new Error('Код содержит плейсхолдер: ' + ph);
  html = html.replace(ph, () => code);
}

/* сервис-воркер получает имя кэша с версией: новая версия = новый кэш */
const sw = read('src/sw.template.js').replace('/*@SWV@*/', () => appVersion + '-' + buildStamp);
fs.writeFileSync(path.join(root, 'sw.js'), sw);

const left = html.match(/@(STYLE|PIECES|ENGINE|STORE|PLATFORM|ENGINES|BOT|APP)@/);
if (left) throw new Error('Остался незаменённый плейсхолдер: ' + left[0]);

fs.writeFileSync(path.join(root, 'index.html'), html);
console.log(`index.html собран: ${(Buffer.byteLength(html) / 1024).toFixed(1)} КБ · версия ${appVersion} · сборка ${buildStamp}`);
console.log(`sw.js обновлён: кэш chesster-${appVersion}-${buildStamp}`);
