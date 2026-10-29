/* Тесты версии 3.3: новые возможности релиза.
   Сейчас: сохранённые стили темы (задача 2) — API хранилища chess-styles-v1,
   UI в настройках «Цвета» (сохранить с именем, применить, удалить с
   подтверждением), переживание «перезагрузки» и фильтрация битых записей.
   Стрелки 3.3 покрыты в uitest15; наборы фигур и движок добавятся сюда позже. */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); }
catch (e) { ({ JSDOM, VirtualConsole } = require('/tmp/node_modules/jsdom')); }
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (fail++, console.log('  FAIL ' + m)) };

function boot(pre) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc,
    beforeParse(win) {
      win.URL.createObjectURL = () => 'blob:x';
      win.URL.revokeObjectURL = () => { };
      win.HTMLAnchorElement.prototype.click = function () { };
      win.open = function () { return null; };
      win.Element.prototype.getBoundingClientRect = function () {
        return this.id === 'board'
          ? { left: 0, top: 0, right: 800, bottom: 800, width: 800, height: 800, x: 0, y: 0 }
          : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
      };
      if (pre) pre(win);
    }
  });
  return { dom, win: dom.window, doc: dom.window.document, errors };
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = boot();
  await wait(250);
  const win = b.win, doc = b.doc;
  const App = win.ChessApp, S = win.Store;
  const q = sel => doc.querySelector(sel);
  const click = el => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

  console.log('\n— 3.3: Store — API сохранённых стилей —');
  ok(typeof S.styles === 'function' && typeof S.saveStyle === 'function' && typeof S.deleteStyle === 'function',
    'Store отдаёт styles/saveStyle/deleteStyle');
  ok(S.KEYS.styles === 'chess-styles-v1', 'ключ хранилища стилей: chess-styles-v1');
  ok(Array.isArray(S.styles()) && S.styles().length === 0, 'список стилей изначально пуст');
  const r1 = S.saveStyle({ name: 'Мой стиль', theme: { '--accent': '#123456' }, squares: { '0': '#00ff00' }, adv: true });
  ok(r1.ok && typeof r1.item.id === 'string' && r1.item.name === 'Мой стиль',
    'saveStyle сохраняет снимок с именем и id');
  ok(r1.item.theme['--accent'] === '#123456' && r1.item.squares['0'] === '#00ff00' && r1.item.adv === true,
    'состав стиля: цвета, клетки, флаг adv');
  const r2 = S.saveStyle({ name: '   ', theme: {} });
  ok(r2.ok && r2.item.name === 'Стиль 2', 'пустое имя заменяется «Стиль N»: ' + r2.item.name);
  const r3 = S.saveStyle({ name: 'A'.repeat(60), theme: {} });
  ok(r3.ok && r3.item.name.length === 40, 'имя обрезается до 40 символов');
  ok(S.saveStyle(null).ok === false && S.saveStyle('x').ok === false, 'мусор на входе отклоняется');
  const cp = S.styles(); cp.pop();
  ok(S.styles().length === 3, 'styles() отдаёт копию — внешнее изменение не портит список');
  const raw = JSON.parse(win.localStorage.getItem('chess-styles-v1'));
  ok(Array.isArray(raw) && raw.length === 3 && raw[0].name === 'Мой стиль',
    'стили лежат в localStorage под chess-styles-v1');
  ok(S.deleteStyle(r1.item.id) === true && S.deleteStyle(r1.item.id) === false,
    'deleteStyle удаляет ровно один раз');
  ok(S.styles().length === 2 && JSON.parse(win.localStorage.getItem('chess-styles-v1')).length === 2,
    'после удаления обновлены и список, и localStorage');
  ok(S.deleteStyle('несуществующий') === false, 'неизвестный id — false без ошибок');
  for (let i = 0; i < 98; i++) S.saveStyle({ name: 'С' + i, theme: {} });
  ok(S.styles().length === 100, 'лимит: ровно 100 стилей');
  const over = S.saveStyle({ name: 'Сверх', theme: {} });
  ok(over.ok === false && over.why === 'cap', '101-й стиль отклоняется с причиной cap');
  S.styles().forEach(it => S.deleteStyle(it.id));
  ok(S.styles().length === 0, 'очистка после лимит-теста');

  console.log('\n— 3.3: настройки «Цвета» — UI стилей —');
  App.openSettings('colors');
  await wait(60);
  ok(q('#btnStyleSave') !== null, 'в «Цветах» есть кнопка «💾 Сохранить стиль»');
  ok(q('#stylesList') !== null, 'в «Цветах» есть список сохранённых стилей');
  ok(/Сохранённых стилей пока нет/.test(q('#stylesList').textContent), 'пустой список сопровождается подсказкой');
  click(q('#btnStyleSave'));
  await wait(30);
  ok(App.G.modal === null && /Сохранять пока нечего/i.test(q('#toastWrap').textContent),
    'пустая тема не сохраняется: окна нет, понятный тост');
  S.setSetting('theme', { '--accent': '#123456' });
  App.applyThemeNow();
  click(q('#btnStyleSave'));
  await wait(30);
  ok(App.G.modal !== null && q('#styleNameIn') !== null, 'открылось окно сохранения с полем имени');
  ok(/снимок текущей темы/i.test(q('.modal .hint').textContent), 'окно объясняет, что такое стиль');
  q('#styleNameIn').value = 'Тёмный акцент';
  click(q('.modal [data-a=save]'));
  await wait(30);
  ok(App.G.modal === null, 'после сохранения окно закрылось');
  ok(S.styles().length === 1 && S.styles()[0].name === 'Тёмный акцент', 'стиль «Тёмный акцент» сохранён');
  const row = q('#stylesList .style-row');
  ok(row !== null && /Тёмный акцент/.test(row.textContent), 'стиль виден в списке');
  ok(row.querySelector('[data-a=apply]') !== null && row.querySelector('[data-a=del]') !== null,
    'в строке стиля кнопки «Применить» и «🗑»');
  S.setSetting('theme', { '--accent': '#ff0000' });
  App.applyThemeNow();
  ok(doc.getElementById('themeCss').textContent.indexOf('--accent:#ff0000') >= 0, 'тема изменена — стиль сейчас вернёт обратно');
  click(row.querySelector('[data-a=apply]'));
  await wait(30);
  ok(S.settings().theme['--accent'] === '#123456', '«Применить» вернуло цвет из стиля');
  ok(/СТИЛЬ ПРИМЕНЁН/i.test(q('#toastWrap').textContent), 'применение сопровождается тостом');
  ok(doc.getElementById('themeCss').textContent.indexOf('--accent:#123456') >= 0,
    'цвета стиля действуют в themeCss');
  const rowDel = q('#stylesList .style-row');
  ok(rowDel !== null && /Тёмный акцент/.test(rowDel.textContent),
    'после применения строка стиля перерисована (список живой)');
  click(rowDel.querySelector('[data-a=del]'));
  await wait(30);
  ok(App.G.modal !== null && /Удалить стиль/i.test(q('.modal h2').textContent), 'удаление спрашивает подтверждение');
  click(q('.modal [data-a=yes]'));
  await wait(30);
  ok(S.styles().length === 0 && q('#stylesList .style-row') === null,
    'после подтверждения стиль удалён из хранилища и из списка');
  App.closeSettings();
  await wait(30);

  console.log('\n— 3.3: стили переживают «перезагрузку» —');
  const saved = [{ id: 'x1', name: 'После перезагрузки', theme: { '--accent': '#00ff00' }, squares: {}, adv: false, ts: 1 }];
  const b2 = boot(w => w.localStorage.setItem('chess-styles-v1', JSON.stringify(saved)));
  await wait(250);
  const S2 = b2.win.Store;
  ok(Array.isArray(S2.styles()) && S2.styles().length === 1 && S2.styles()[0].name === 'После перезагрузки',
    'при старте стили читаются из хранилища');
  const b3 = boot(w => w.localStorage.setItem('chess-styles-v1', '[{"id":"a","name":"годный"},42,null,{"noname":1}]'));
  await wait(200);
  const S3 = b3.win.Store;
  ok(S3.styles().length === 1 && S3.styles()[0].name === 'годный',
    'битые записи отфильтровываются при загрузке');
  ok(b.errors.length === 0 && b2.errors.length === 0 && b3.errors.length === 0,
    'ошибок консоли нет' + [b, b2, b3].map(x => x.errors.join('|')).join(''));


  console.log('\n— 3.3: мини-панель — элемент раскладки справа от доски —');
  const qa = sel => Array.from(doc.querySelectorAll(sel));
  const cssText = fs.readFileSync(path.join(ROOT, 'src/style.css'), 'utf8');
  ok(/\.mark-panel\{flex:0 0 auto/.test(cssText),
    'панель — элемент раскладки (flex), а не оверлей поверх доски');
  ok(/@media \(max-width:1100px\)\{[\s\S]{0,140}\.mark-panel\{position:absolute/.test(cssText),
    'оверлей — только запасной вариант на узких экранах (z-index ниже меню и настроек)');

  console.log('\n— 3.3: наборы фигур —');
  ok(Array.isArray(App.PIECE_SETS) && App.PIECE_SETS.length >= 10,
    'встроенных наборов не меньше 10: ' + App.PIECE_SETS.length);
  for (const st of App.PIECE_SETS) {
    if (st.id === 'cburnett') {
      ok(doc.getElementById('pc-wK') !== null, 'Cburnett: символ pc-wK в спрайте');
    } else {
      ok(doc.getElementById('pc-' + st.id + '-wK') !== null && doc.getElementById('pc-' + st.id + '-bP') !== null,
        'набор «' + st.n + '»: символы в спрайте');
    }
  }
  ok(S.settings().pieceSet === 'cburnett', 'набор по умолчанию — cburnett');
  const useEl = () => doc.querySelector('#board .sq[data-sq="4"] use');
  ok(useEl() && useEl().getAttribute('href') === '#pc-wK', 'доска рисуется классическим спрайтом');
  App.applyPieceSet('dots');
  await wait(40);
  ok(S.settings().pieceSet === 'dots' && useEl().getAttribute('href') === '#pc-dots-wK',
    'переключение на «Точки»: use указывает pc-dots-wK');
  S.setSetting('pieceSet', 'нет-такого');
  ok(App.pieceSetId() === 'cburnett', 'неизвестный набор откатывается на cburnett');
  App.applyPieceSet('cburnett');
  await wait(30);

  console.log('\n— 3.3: дизайн в настройках и загрузка своего набора —');
  App.openSettings('colors');
  await wait(60);
  ok(q('#pieceSetGrid') !== null && qa('#pieceSetGrid .set-card').length === App.PIECE_SETS.length,
    'подкатегория «Дизайн»: сетка из ' + App.PIECE_SETS.length + ' наборов');
  ok(q('#btnPieceUpload') !== null && q('#pieceFiles') !== null,
    'кнопка и скрытый input загрузки своего набора');
  const svgOf = n => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><circle cx="22.5" cy="22.5" r="10" fill="#123456"/><!--' + n + '--></svg>';
  const goodFiles = App.PIECE_FILE_KEYS.map(k => new win.File([svgOf(k)], k + '.svg', { type: 'image/svg+xml' }));
  const vGood = await App.validatePieceFiles(goodFiles);
  ok(vGood.ok === true && Object.keys(vGood.files).length === 12,
    'валидатор принимает полный набор из 12 SVG');
  const vBad = await App.validatePieceFiles([new win.File(['<svg/>'], 'wK.svg'), new win.File(['x'], 'q.txt')]);
  ok(vBad.ok === false && vBad.errors.some(e => /не хватает/.test(e)) && vBad.errors.some(e => /\.svg/.test(e)),
    'валидатор отвергает неполный набор и не-SVG: ' + vBad.errors.slice(0, 2).join('; '));
  const fi = q('#pieceFiles');
  Object.defineProperty(fi, 'files', { value: goodFiles, configurable: true });
  fi.dispatchEvent(new win.Event('change', { bubbles: true }));
  await wait(150);
  const users = App.userSets();
  ok(users.length === 1 && /^user-/.test(users[0].id),
    'набор сохранён через Platform.putFile (IndexedDB, в jsdom — память)');
  ok(doc.getElementById('pc-' + users[0].id + '-wK') !== null,
    'символы загруженного набора внедрены в DOM-спрайт');
  ok(S.settings().pieceSet === users[0].id, 'загруженный набор стал активным');
  ok(useEl().getAttribute('href') === '#pc-' + users[0].id + '-wK',
    'доска перерисована загруженным набором');
  ok(qa('#userSetsList .style-row').length === 1, 'набор виден в списке загруженных');
  click(q('#userSetsList [data-a=del]'));
  await wait(30);
  ok(App.G.modal !== null && /Удалить набор/i.test(q('.modal h2').textContent),
    'удаление набора спрашивает подтверждение');
  click(q('.modal [data-a=yes]'));
  await wait(100);
  ok(App.userSets().length === 0 && S.settings().pieceSet === 'cburnett' &&
    doc.getElementById('pc-' + users[0].id + '-wK') === null,
    'набор удалён: символы сняты, активен снова Cburnett');
  App.closeSettings();
  await wait(30);

  console.log('\n— 3.3: предустановленный Rodent V —');
  const mainJs = fs.readFileSync(path.join(ROOT, 'desktop/main.js'), 'utf8');
  ok(/ipcMain\.handle\('engine:bundled'/.test(mainJs) && /process\.resourcesPath/.test(mainJs) &&
    /rodent_v_1\.2\.exe/.test(mainJs), 'main.js: IPC engine:bundled ищет exe в ресурсах');
  const pre = fs.readFileSync(path.join(ROOT, 'desktop/preload.js'), 'utf8');
  ok(/bundledEnginePath: \(\) => ipcRenderer\.invoke\('engine:bundled'\)/.test(pre),
    'preload.js отдаёт странице bundledEnginePath');
  const pkgJ = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop/package.json'), 'utf8'));
  ok(pkgJ.build.extraResources.some(e => e.to === 'engine' && /engine\/rodent/.test(e.from)),
    'extraResources пакует engine/rodent в ресурсы установщика');
  ok(pkgJ.scripts.predist && /ensure-engine-dir/.test(pkgJ.scripts.predist),
    'predist создаёт папку движка для локальной сборки');
  const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');
  ok(/nescitus\/Rodent-V\/releases/.test(yml) && /Expand-Archive/.test(yml) && /LICENSE-GPL/.test(yml),
    'release.yml: CI скачивает релиз Rodent V, распаковывает, кладёт GPL-текст');
  ok(/btnRodentBundled/.test(html) && /Использовать предустановленный/.test(html),
    'в карточке движка кнопка «Использовать предустановленный»');
  ok(/Предустановленный движок/.test(html), 'справка описывает предустановленный движок');

  console.log('\n— 3.3: tools/pack.js —');
  const cproc = require('child_process'), os = require('os');
  const packed = cproc.execFileSync(process.execPath, [path.join(ROOT, 'tools', 'pack.js'), 'version.json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  ok(packed.indexOf('===CHESSTER-FILE: version.json===') === 0 && /"version"/.test(packed),
    'pack: файл упакован с маркером');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-'));
  const bundleP = path.join(tmp, 'bundle.txt');
  fs.writeFileSync(bundleP, packed);
  cproc.execFileSync(process.execPath, [path.join(ROOT, 'tools', 'pack.js'), '--unpack', bundleP, path.join(tmp, 'out')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const orig = fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8');
  const back = fs.readFileSync(path.join(tmp, 'out', 'version.json'), 'utf8');
  ok(back.replace(/\n+$/, '') === orig.replace(/\n+$/, ''), 'unpack: содержимое восстановлено');
  const packedAll = cproc.execFileSync(process.execPath, [path.join(ROOT, 'tools', 'pack.js'), '--all'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const nAll = (packedAll.match(/===CHESSTER-FILE: /g) || []).length;
  ok(nAll >= 40, 'pack --all: ключевые файлы проекта в одном бандле (' + nAll + ')');

  console.log('\n============================');
  console.log('3.3 (uitest16): пройдено ' + pass + ', провалено ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('КРАХ ТЕСТА:', e); process.exit(2); });
