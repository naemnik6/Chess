/* Тесты версии 3.0: цветовая тема — реестр элементов, HSL-пипетка с палитрой,
   HEX, прозрачностью и градиентами, готовые палитры, точечная раскраска
   клеток (расширенный режим), экспорт/импорт, sanация значений, persist в
   localStorage, релиз-файлы 3.0 и собираемый каркас Tauri. */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); }
catch (e) { ({ JSDOM, VirtualConsole } = require('/tmp/node_modules/jsdom')); }
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const V = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).version;
const PV = V.split('.').length === 2 ? V + '.0' : V;

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (fail++, console.log('  FAIL ' + m)) };

function boot() {
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
    }
  });
  return { dom, win: dom.window, doc: dom.window.document, errors };
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = boot();
  await wait(250);
  const win = b.win, doc = b.doc;
  const App = win.ChessApp, S = win.Store, T = win.Theme;
  const q = s => doc.querySelector(s);
  const qa = s => [...doc.querySelectorAll(s)];
  const clickEl = el => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const inp = (el, v) => { el.value = v; el.dispatchEvent(new win.Event('input', { bubbles: true })); };
  const chg = (el, v) => { el.value = v; el.dispatchEvent(new win.Event('change', { bubbles: true })); };
  const themeCss = () => (doc.getElementById('themeCss') || { textContent: '' }).textContent;
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

  console.log('\n— 3.0: модуль темы (реестр, утилиты, санитизация) —');
  ok(!!T, 'модуль Theme доступен глобально');
  ok(T && T.GROUPS.length === 5, 'пять групп элементов: ' + (T ? T.GROUPS.map(g => g.name).join(' / ') : ''));
  const totalItems = T ? T.GROUPS.reduce((n, g) => n + g.items.length, 0) : 0;
  ok(totalItems === 72, 'в реестре 72 настраиваемых элемента (факт: ' + totalItems + ')');
  ok(T && Object.keys(T.DEFAULTS).length === totalItems &&
    T.GROUPS.every(g => g.items.every(it => T.BY_VAR[it.v] === it)),
    'реестр, DEFAULTS и индекс BY_VAR согласованы (без дублей и сирот)');
  ok(T && T.GROUPS.every(g => g.items.every(it => it.v in T.DEFAULTS && typeof T.DEFAULTS[it.v] === 'string')),
    'у каждого элемента есть значение по умолчанию');
  ok(T && T.GROUPS.every(g => g.items.every(it => typeof it.n === 'string' && it.n.length > 2)),
    'у каждого элемента есть понятное имя');
  ok(T && T.BY_VAR['--light'] && T.BY_VAR['--light'].g === 1 && !T.BY_VAR['--text'].g,
    'градиент разрешён клеткам доски и запрещён цвету текста');
  ok(T && T.DEFAULTS['--light'] === '#f0d9b5' && T.DEFAULTS['--dark'] === '#b58863',
    'значения по умолчанию совпадают с классической доской');

  console.log('\n— 3.0: цветовые утилиты —');
  const c1 = T.parseColor('#f0d9b5');
  ok(c1 && c1.h === 37 && c1.s === 66 && c1.l === 83 && c1.a === 1, 'HEX → HSL: ' + JSON.stringify(c1));
  const c2 = T.parseColor('rgba(10,20,30,.5)');
  ok(c2 && c2.a === 0.5, 'rgba с прозрачностью разбирается');
  const c3 = T.parseColor('hsla(220,40%,50%,0.42)');
  ok(c3 && c3.h === 220 && c3.a === 0.42, 'hsla разбирается');
  ok(T.fmtColor({ h: 220, s: 40, l: 50, a: 1 }) === '#4d6fb3', 'непрозрачный цвет собирается в HEX');
  ok(T.fmtColor({ h: 220, s: 40, l: 50, a: 0.42 }) === 'rgba(77,111,179,0.42)', 'полупрозрачный — в rgba()');
  const g1 = T.parseGradient('linear-gradient(145deg,rgba(10,20,30,.5),#ffffff)');
  ok(g1 && g1.angle === 145 && g1.c1.a === 0.5 && g1.c2.h === 0 && g1.c2.l === 100,
    'градиент с rgba-стопом разбирается (запятые внутри скобок не мешают)');
  ok(T.isGradient('linear-gradient(90deg,#000,#fff)') && !T.isGradient('#000'), 'isGradient различает градиент и цвет');
  ok(T.sanitize('#fff') && T.sanitize('linear-gradient(90deg,#123456,#654321)'), 'валидные значения проходят санитизацию');
  ok(!T.sanitize('red;} body{display:none') && !T.sanitize('url(javascript:x)') && !T.sanitize('"quoted"'),
    'инъекции и мусор отбрасываются санитизацией');
  ok(!T.validValue('expression(alert(1))') && T.validValue('rgba(1,2,3,.4)'), 'validValue отсеивает опасные значения');
  ok(!T.validVar('--evil') && T.validVar('--panel-grad'), 'validVar знает только реестр');
  ok(T.validSquareKey('0') && T.validSquareKey('63') && !T.validSquareKey('64') && !T.validSquareKey('x'),
    'ключи клеток — только 0..63');
  const builtCss = T.buildCss({ '--light': '#123456', '--nope': '#000', '--dark': 'url(evil)' }, { '0': '#010101', '99': '#fff', '3': 'bad;' }, true);
  ok(builtCss.includes('--light:#123456') && !builtCss.includes('--nope') && !builtCss.includes('url(evil)'),
    'buildCss пропускает только валидные переменные и значения');
  ok(builtCss.includes('#board .sq[data-sq="0"]{background:#010101}') && !builtCss.includes('data-sq="99"') && !builtCss.includes('data-sq="3"'),
    'buildCss собирает точечные клетки и отбрасывает мусор');
  ok(!T.buildCss({ '--light': '#123456' }, { '0': '#010101' }, false).includes('data-sq'),
    'без расширенного режима точечные правила не применяются');
  ok(!T.buildCss({ '--light': T.DEFAULTS['--light'] }, {}, false).includes('--light'),
    'значение, равное базовому, не дублируется в CSS');
  ok(T.PRESETS.length === 7 && T.PRESETS[0].id === 'classic' && T.PRESETS[0].vars === null,
    'семь палитр, первая — «Классика» (сброс)');
  ok(T.PRESETS.every(p => !p.vars || Object.keys(p.vars).every(k => T.validVar(k) && T.validValue(p.vars[k]))),
    'во всех палитрах только валидные переменные и значения');
  ok(T.PALETTE.length === 36 && T.PALETTE.every(c => T.parseColor(c)), 'палитра пипетки: 36 образцов, все читаются');
  ok(T.squareIsDark(0) === true && T.squareIsDark(1) === false && T.squareIsDark(9) === true,
    'a1 — тёмная, b1 — светлая, b2 — тёмная (шахматный порядок)');

  console.log('\n— 3.0: defaults хранилища —');
  const st0 = S.settings();
  ok(st0.theme && typeof st0.theme === 'object' && Object.keys(st0.theme).length === 0, 'настройка theme пустая по умолчанию');
  ok(st0.sqColors && Object.keys(st0.sqColors).length === 0, 'настройка sqColors пустая по умолчанию');
  ok(st0.themeAdv === false, 'точечный режим по умолчанию выключен');
  ok(themeCss() === '', 'без переопределений style#themeCss пуст — вид классический');

  console.log('\n— 3.0: раздел «Цвета» в настройках —');
  ok(App.SET_CATS.indexOf('colors') === 1, 'категория «Цвета» — вторая в списке: ' + App.SET_CATS.join(','));
  ok(qa('#setNav button').length === 7, 'в боковине настроек семь категорий');
  ok(q('#setNav button[data-sc=colors]') !== null, 'кнопка «🌈 Цвета» есть в навигации');
  ok(q('#setScroll section[data-set=colors]') !== null, 'раздел data-set="colors" существует');
  App.openSettings('colors');
  ok(App.settingsOpen() && q('#setNav button.on').dataset.sc === 'colors', 'открытие настроек на категории «Цвета»');
  ok(qa('#themePresets [data-preset]').length === 7, 'ряд готовых палитр: 7 кнопок');
  ok(qa('#themeGroups .tgroup').length === 5 && qa('#themeGroups .titem').length === 72,
    'раскрывающихся групп 5, элементов 72');
  ok(qa('#themeGroups .titem .tsw').every(b => b.getAttribute('tabindex') !== '-1' && b.tagName === 'BUTTON'),
    'образцы цвета — настоящие кнопки: раздел доступен с клавиатуры');
  ok(qa('#themeGroups details.tgroup').every(d => d.tagName === 'DETAILS'), 'группы свёрнуты (details) — раздел компактный');
  ok(['btnThemeReset', 'btnThemeExport', 'btnThemeImport', 'chkThemeAdv', 'sqEditor', 'miniBoard']
    .every(id => q('#' + id) !== null && q('#' + id).closest('section[data-set=colors]') !== null),
    'сброс, экспорт, импорт, чекбокс точечного режима и мини-доска — внутри раздела');
  ok(q('#sqEditor').hidden === true, 'мини-доска скрыта, пока точечный режим выключен');
  const lightRow = q('#themeGroups .titem[data-var="--light"]');
  ok(lightRow !== null, 'строка «Светлые клетки» найдена в группе «Доска и клетки»');
  const lightSw = lightRow.querySelector('.tsw i');
  ok(lightSw && /#f0d9b5|rgb\(240, ?217, ?181\)/.test(lightSw.style.background), 'образец строки показывает текущий цвет: ' + (lightSw && lightSw.style.background));
  ok(lightRow.querySelector('.trst').hidden === true, 'кнопка сброса скрыта, пока цвет не меняли');
  ok(qa('#themeGroups .tg-count').every(x => x.hidden), 'счётчики «изменено» пусты у всех групп');

  console.log('\n— 3.0: HSL-пипетка (цвет, HEX, прозрачность) —');
  clickEl(lightRow);
  let modal = q('.modal');
  ok(modal !== null, 'клик по строке открыл пипетку');
  ok(modal && modal.querySelector('h2').textContent.includes('Светлые клетки'), 'заголовок пипетки — имя элемента');
  ok(qa('.cp-pal').length === 36, 'в пипетке 36 образцов палитры');
  ok(q('#cpH') && q('#cpS') && q('#cpL') && q('#cpA') && q('#cpHex'), 'ползунки H/S/L/A и HEX-поле на месте');
  ok(q('#cpH').value === '37' && q('#cpS').value === '66' && q('#cpL').value === '83',
    'ползунки отражают текущий цвет #f0d9b5 (H37 S66 L83)');
  inp(q('#cpH'), '120');
  ok(themeCss().includes('--light:#b7f0b7'), 'движение ползунка сразу красит приложение: ' + themeCss());
  ok(q('#cpVal').textContent === '#b7f0b7', 'строка значения в пипетке совпадает с применённым');
  clickEl(q('.modal [data-a=cancel]'));
  ok(!q('.modal') && themeCss() === '', '«Отмена» откатывает предпросмотр и закрывает окно');
  /* Esc-путь */
  clickEl(lightRow);
  inp(q('#cpL'), '20');
  ok(themeCss() !== '', 'предпросмотр снова живой');
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok(!q('.modal') && themeCss() === '' && App.settingsOpen(), 'Esc откатывает предпросмотр, настройки остаются открытыми');
  /* HEX-поле */
  clickEl(lightRow);
  chg(q('#cpHex'), '#00ff00');
  ok(q('#cpH').value === '120' && q('#cpS').value === '100', 'HEX #00ff00 → H120 S100');
  clickEl(q('.modal [data-a=ok]'));
  ok(S.settings().theme['--light'] === '#00ff00', '«Применить» сохраняет цвет в настройках');
  ok(themeCss() === ':root{--light:#00ff00}', 'сохранённое значение в style#themeCss');
  ok(!q('.modal'), 'пипетка закрылась после применения');
  ok(lightRow.querySelector('.trst').hidden === false, 'у изменённого элемента появилась кнопка сброса');
  const boardCount = qa('#themeGroups .tgroup')[3].querySelectorAll('.trst:not([hidden])').length;
  ok(boardCount === 1 && !qa('#themeGroups .tgroup')[3].querySelector('.tg-count').hidden,
    'счётчик группы «Доска и клетки»: изменено 1');
  /* прозрачность у подсветок */
  clickEl(q('#themeGroups .titem[data-var="--hl-last"]'));
  ok(q('#cpA').value === '42', 'подсветка последнего хода открылась с прозрачностью 42 %');
  inp(q('#cpA'), '80');
  ok(/rgba\(\d+,\d+,\d+,0\.8\)/.test(themeCss()), 'прозрачность применяется: ' + themeCss());
  clickEl(q('.modal [data-a=def]'));
  ok(!q('.modal') && !('--hl-last' in S.settings().theme), '«По умолчанию» сбрасывает элемент и закрывает окно');
  /* сброс крестиком */
  clickEl(lightRow.querySelector('.trst'));
  ok(!('--light' in S.settings().theme) && themeCss() === '', 'крестик ✕ сбрасывает элемент к базовому цвету');
  /* клавиатура: Tab доходит до образца цвета, Enter открывает пипетку */
  const swBtn = q('#themeGroups .titem[data-var="--dark"] .tsw');
  swBtn.focus();
  ok(doc.activeElement === swBtn, 'образец цвета принимает фокус с клавиатуры');
  swBtn.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  ok(q('.modal') !== null && q('.modal h2').textContent.includes('Тёмные клетки'),
    'Enter на образце открывает пипетку: ' + (q('.modal h2') || {}).textContent);
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok(!q('.modal'), 'Esc закрыл пипетку');
  /* клик по самому образцу (не только по строке) */
  clickEl(swBtn);
  ok(q('.modal') !== null, 'клик по образцу цвета тоже открывает пипетку');
  clickEl(q('.modal [data-a=cancel]'));

  console.log('\n— 3.0: градиенты —');
  clickEl(lightRow);
  ok(q('#cpGrad') !== null, 'для клеток доски доступен режим градиента');
  const gradChk = q('#cpGrad');
  gradChk.checked = true;
  gradChk.dispatchEvent(new win.Event('change', { bubbles: true }));
  ok(q('#cpGradBox').hidden === false, 'блок градиента раскрылся');
  ok(themeCss().includes('--light:linear-gradient('), 'градиент применяется вживую: ' + themeCss());
  inp(q('#cpAngle'), '90');
  ok(themeCss().includes('linear-gradient(90deg,'), 'угол градиента меняется');
  clickEl(q('#cpStop2'));
  ok(q('#cpStop2').classList.contains('on') && !q('#cpStop1').classList.contains('on'), 'выбран стоп «Конец»');
  inp(q('#cpH'), '240');
  ok(/linear-gradient\(90deg,#[0-9a-f]{6},#[0-9a-f]{6}\)/.test(themeCss()), 'второй стоп градиента перекрашен: ' + themeCss());
  clickEl(q('.modal [data-a=ok]'));
  const savedGrad = S.settings().theme['--light'];
  ok(typeof savedGrad === 'string' && savedGrad.startsWith('linear-gradient(90deg,'), 'градиент сохранён: ' + savedGrad);
  clickEl(lightRow);
  ok(q('#cpGrad').checked && q('#cpAngle').value === '90', 'повторное открытие восстановило градиент и угол');
  clickEl(q('.modal [data-a=cancel]'));
  /* элемент без градиента — текст */
  clickEl(q('#themeGroups .titem[data-var="--text"]'));
  ok(q('#cpGrad') === null, 'для цвета текста переключатель градиента не показан');
  ok(q('.modal').textContent.includes('градиент недоступен'), 'честная подсказка, почему градиента нет');
  clickEl(q('.modal [data-a=cancel]'));
  clickEl(lightRow.querySelector('.trst'));
  ok(themeCss() === '', 'градиент сброшен крестиком');

  console.log('\n— 3.0: готовые палитры —');
  clickEl(q('#themePresets [data-preset=emerald]'));
  const em = S.settings().theme;
  ok(em['--light'] === '#eeeed2' && em['--dark'] === '#769656', 'палитра «Изумруд» перекрасила доску');
  ok(Object.keys(em).length >= 30 && themeCss().includes('--panel:#14231a'), 'палитра применилась ко всему интерфейсу');
  clickEl(q('#themePresets [data-preset=classic]'));
  ok(Object.keys(S.settings().theme).length === 0 && themeCss() === '', '«Классика» возвращает оформление по умолчанию');

  console.log('\n— 3.0: точечная раскраска клеток (расширенный режим) —');
  const adv = q('#chkThemeAdv');
  adv.checked = true;
  adv.dispatchEvent(new win.Event('change', { bubbles: true }));
  ok(S.settings().themeAdv === true, 'чекбокс включает расширенный режим в настройках');
  ok(q('#sqEditor').hidden === false, 'мини-доска появилась');
  ok(qa('#miniBoard button').length === 64, 'на мини-доске 64 клетки');
  ok(qa('#miniRanks span').map(x => x.textContent).join('') === '87654321', 'подписи горизонталей 8…1');
  ok(qa('#miniFiles span').map(x => x.textContent).join('') === 'abcdefgh', 'подписи вертикалей a…h');
  const cellD4 = q('#miniBoard button[data-msq="27"]');   /* d4: r=3,f=3 → 3*8+3=27, поле тёмное */
  ok(cellD4 !== null && /#b58863|rgb\(181, ?136, ?99\)/.test(cellD4.querySelector('i').style.background),
    'клетка d4 показывает общий цвет тёмных клеток');
  clickEl(cellD4);
  ok(q('.modal h2').textContent.includes('Клетка d4'), 'пипетка клетки подписана: ' + q('.modal h2').textContent);
  inp(q('#cpH'), '0'); inp(q('#cpS'), '100'); inp(q('#cpL'), '50');
  clickEl(q('.modal [data-a=ok]'));
  ok(S.settings().sqColors['27'] === '#ff0000', 'цвет клетки d4 сохранён');
  ok(themeCss().includes('#board .sq[data-sq="27"]{background:#ff0000}'), 'точечное правило в CSS: ' + themeCss());
  ok(cellD4.classList.contains('own'), 'клетка с собственным цветом помечена точкой');
  ok(cellD4.hasAttribute('data-tip') && !cellD4.hasAttribute('title'),
    'у клеток мини-доски общая подсказка приложения (data-tip), а не нативная title');
  ok(q('#sqEditorInfo').textContent.includes('1'), 'счётчик «Раскрашено клеток: 1 из 64»');
  /* выключение режима прячет правила, но не данные */
  adv.checked = false;
  adv.dispatchEvent(new win.Event('change', { bubbles: true }));
  ok(!themeCss().includes('data-sq') && S.settings().sqColors['27'] === '#ff0000',
    'при выключении режима точечные цвета не применяются, но хранятся');
  adv.checked = true;
  adv.dispatchEvent(new win.Event('change', { bubbles: true }));
  ok(themeCss().includes('data-sq="27"'), 'при включении — снова применяются');
  /* очистка клеток через подтверждение */
  clickEl(q('#btnSqClear'));
  ok(q('.modal') !== null, 'очистка клеток спрашивает подтверждение');
  clickEl(q('.modal [data-a=yes]'));
  ok(Object.keys(S.settings().sqColors).length === 0 && !themeCss().includes('data-sq'),
    'после подтверждения клетки очищены');
  /* точечный градиент клетки */
  clickEl(cellD4);
  const gc = q('#cpGrad');
  gc.checked = true; gc.dispatchEvent(new win.Event('change', { bubbles: true }));
  clickEl(q('.modal [data-a=ok]'));
  ok(String(S.settings().sqColors['27']).startsWith('linear-gradient('), 'клетке можно задать градиент');
  clickEl(cellD4);
  clickEl(q('.modal [data-a=def]'));
  ok(!('27' in S.settings().sqColors), '«По умолчанию» убирает точечный цвет клетки');

  console.log('\n— 3.0: экспорт и импорт темы —');
  App.applyPreset('ice');
  clickEl(q('#btnThemeExport'));
  const exTa = q('#themeJsonOut');
  ok(exTa !== null, 'окно экспорта показывает JSON темы');
  const exported = exTa.value;
  const exData = JSON.parse(exported);
  ok(exData.format === 'chesster-theme' && exData.v === 3 && exData.theme['--light'] === '#dee3e6',
    'JSON экспорта: формат, версия, значения палитры «Лёд»');
  clickEl(q('.modal [data-a=close]'));
  ok(!q('.modal'), 'окно экспорта закрывается');
  /* испорченная тема → импорт */
  S.setSetting('theme', {});
  App.applyThemeNow();
  clickEl(q('#btnThemeImport'));
  const inTa = q('#themeJsonIn');
  inTa.value = 'это не json{';
  clickEl(q('.modal [data-a=ok]'));
  ok(q('#themeImpHint').textContent.includes('не похоже на JSON'), 'импорт ругается на не-JSON');
  inTa.value = JSON.stringify({
    format: 'chesster-theme', v: 3, adv: true,
    theme: { '--light': '#112233', '--evil': '#fff', '--dark': 'url(javascript:alert(1))', '--panel': 'red;} body{display:none' },
    squares: { '5': '#445566', '99': '#fff', 'x': '#000' }
  });
  clickEl(q('.modal [data-a=ok]'));
  const imp = S.settings();
  ok(imp.theme['--light'] === '#112233' && !('--evil' in imp.theme) && !('--dark' in imp.theme) && !('--panel' in imp.theme),
    'импорт принял валидное и отбросил неизвестное/опасное');
  ok(imp.sqColors['5'] === '#445566' && !('99' in imp.sqColors) && !('x' in imp.sqColors),
    'ключи клеток вне 0..63 отброшены');
  ok(imp.themeAdv === true, 'флаг расширенного режима импортирован');
  ok(themeCss().includes('--light:#112233') && themeCss().includes('data-sq="5"'), 'импортированная тема применена');
  ok(!q('.modal'), 'окно импорта закрылось после применения');
  /* roundtrip: экспорт → сброс → импорт */
  const rt = JSON.stringify({ format: 'chesster-theme', v: 3, theme: JSON.parse(exported).theme, squares: {}, adv: false });
  clickEl(q('#btnThemeImport'));
  q('#themeJsonIn').value = rt;
  clickEl(q('.modal [data-a=ok]'));
  ok(S.settings().theme['--light'] === '#dee3e6', 'roundtrip экспорта/импорта восстановил палитру «Лёд»');
  ok(b.errors.length === 0, 'ни одной jsdom-ошибки за весь сценарий: ' + b.errors.join(' | '));

  console.log('\n— 3.0: игра и сохранение не сломаны темой —');
  App.applyThemeNow();
  S.setSetting('theme', {}); S.setSetting('sqColors', {}); S.setSetting('themeAdv', false);
  App.applyThemeNow();
  ok(qa('#board .sq').length === 64, 'доска по-прежнему из 64 клеток');
  App.select(12);
  ok(qa('#board .sq.sel').length === 1, 'выбор клетки работает');
  App.select(12);
  App.doMove({ from: 12, to: 28 });
  ok(App.G.sans.length === 1, 'ход e2-e4 сделался: ' + App.G.sans.join());
  ok(JSON.parse(win.localStorage.getItem('chess-settings-v1')).theme !== undefined,
    'настройки с темой сохраняются в localStorage');
  App.closeSettings();

  console.log('\n— 3.0: CSS переведён на переменные темы —');
  ok(css.includes('--glow1:#22305e') && css.includes('--panel-grad:linear-gradient(180deg,#171c31,#141a2e)') &&
    css.includes('--win-bg:') && css.includes('--btn-bg:') && css.includes('--hl-check1:'),
    'в :root объявлены все новые переменные темы');
  ok(css.includes('.sq.light{background:var(--light)}') && css.includes('.sq.dark{background:var(--dark)}'),
    'клетки доски — через переменные');
  ok(css.includes('background:var(--hl-last)') && css.includes('border:calc(var(--sz)/76) solid var(--hl-cap)'),
    'подсветки хода и взятия — через переменные');
  ok(css.includes('radial-gradient(circle at 50% 50%, transparent 30%, var(--hl-check1) 62%, var(--hl-check2) 100%)'),
    'подсветка шаха — через переменные');
  ok(css.includes('.btn{appearance:none;border:1px solid var(--line)') && css.includes('background:var(--btn-bg)'),
    'кнопки — через переменные');
  ok(!css.includes('linear-gradient(180deg,#252c4a,#1c2340);color') && !css.includes('background:#1b2138;border'),
    'хардкод фонов кнопок и чипов из CSS исчез');
  ok(css.includes('.tgroup') && css.includes('.cp-palette') && css.includes('.mini-board'),
    'стили раздела «Цвета», пипетки и мини-доски добавлены');
  /* инвариант: реестр темы и базовый :root не должны разъезжаться */
  const appSrc = fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8');
  const rootStart = css.indexOf(':root{') + ':root{'.length;
  const rootBlock = css.slice(rootStart, css.indexOf('\n}', rootStart)).replace(/\/\*[\s\S]*?\*\//g, '');
  const declared = {};
  rootBlock.split(';').forEach(d => { const i = d.indexOf(':'); if (i > 0) declared[d.slice(0, i).trim()] = d.slice(i + 1).trim(); });
  const norm = v => String(v).replace(/\s+/g, '').toLowerCase();
  const drift = Object.keys(T.DEFAULTS).filter(k => !(k in declared) || norm(declared[k]) !== norm(T.DEFAULTS[k]));
  ok(drift.length === 0, 'значения по умолчанию в theme.js совпадают с :root (' + Object.keys(T.DEFAULTS).length +
    ' переменных)' + (drift.length ? ': ' + drift.join(', ') : ''));
  /* переменная может применяться и в стилях, и в разметке, которую собирает app.js */
  const scope = css.replace(rootBlock, '') + '\n' + appSrc;
  const unusedVars = Object.keys(T.DEFAULTS).filter(k => !scope.includes('var(' + k));
  ok(unusedVars.length === 0, 'каждая переменная темы действительно применяется в стилях' +
    (unusedVars.length ? ' (не используются: ' + unusedVars.join(', ') + ')' : ''));
  ok(css.includes('background:var(--tip-bg);color:var(--tip-text);border:1px solid var(--tip-line)'),
    'подсказки кнопок перекрашиваются темой');
  ok(css.includes('.btn.primary{background:var(--btn-primary);border-color:var(--accent);color:var(--on-primary)'),
    'текст главных кнопок — переменная --on-primary');
  ok(css.includes('.promo-picks button{background:var(--promo-bg);border:1px solid var(--promo-line)') &&
    css.includes('.promo-picks span{font-size:11px;font-weight:700;color:var(--promo-ink)}'),
    'диалог превращения — через переменные темы');
  ok(css.includes('background:var(--lichess-bg)') && css.includes('background:var(--logo-grad)') &&
    css.includes('background:var(--playback-bg)') && css.includes('background:var(--qbar-bg)'),
    'кнопка Lichess, логотип, плашка истории и шкала квоты — через переменные');
  ok(css.includes('.toolbar button.danger{color:var(--danger-text)') && css.includes('background:var(--danger-bg)'),
    '«опасные» кнопки (сдаться, очистить) — через переменные');
  ok(!/style="[^"]*color:#[0-9a-f]/i.test(appSrc), 'в разметке из app.js не осталось инлайновых HEX-цветов — только var()');

  console.log('\n— 3.0: релиз-файлы —');
  ok(App.version().app === V && V === '3.0', 'версия приложения ' + V);
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  ok(sw.includes("chesster-" + V), 'кэш сервис-воркера содержит версию ' + V);
  const bat = fs.readFileSync(path.join(ROOT, 'push-release.bat'), 'utf8');
  ok(/^[\x00-\x7F]*$/.test(bat), 'push-release.bat — только ASCII');
  ok(bat.includes('Release 3.0') && bat.includes('v3.0.0'), 'bat обновлён до v3.0.0');
  ok(JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop/package.json'), 'utf8')).version === PV,
    'desktop/package.json: ' + PV);
  const cl = App.CHANGELOG.map(r => r[0]);
  ok(cl.includes('3.0'), 'в истории изменений есть версия 3.0');
  const cl30 = App.CHANGELOG.find(r => r[0] === '3.0')[1];
  ok(/Цвета/.test(cl30) && /пипетк/i.test(cl30) && /градиент/i.test(cl30) && /Tauri/.test(cl30),
    'запись 3.0 описывает цвета, пипетку, градиенты и Tauri');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  ok(readme.includes('3.0'), 'README упоминает версию 3.0');
  ok(fs.existsSync(path.join(ROOT, 'TAURI.md')), 'TAURI.md на месте');

  console.log('\n— 3.0: каркас Tauri собираемый —');
  const tdir = path.join(ROOT, 'desktop/tauri');
  const cargo = fs.readFileSync(path.join(tdir, 'Cargo.toml'), 'utf8');
  ok(cargo.includes('tauri = { version = "2"') && cargo.includes('tauri-plugin-dialog') && cargo.includes('tauri-build'),
    'Cargo.toml: tauri 2, плагин диалогов, tauri-build');
  ok(cargo.includes('version = "' + PV + '"'), 'версия крейта синхронна: ' + PV);
  ok(fs.readFileSync(path.join(tdir, 'build.rs'), 'utf8').includes('tauri_build::build()'), 'build.rs на месте');
  const caps = JSON.parse(fs.readFileSync(path.join(tdir, 'capabilities/default.json'), 'utf8'));
  ok(caps.permissions.includes('core:default') && caps.windows.includes('main'), 'capabilities: core:default для окна main');
  const conf = JSON.parse(fs.readFileSync(path.join(tdir, 'tauri.conf.json'), 'utf8'));
  ok(conf.version === PV, 'tauri.conf.json: версия ' + PV);
  ok(/^node \.\.\/\.\.\/build\.js/.test(conf.build.beforeBuildCommand),
    'beforeBuildCommand запускает корневой build.js: ' + conf.build.beforeBuildCommand);
  ok(conf.build.frontendDist === './dist', 'frontendDist — отдельная папка dist (в бинарник не попадает весь репозиторий)');
  const distHtml = path.join(tdir, 'dist/index.html');
  ok(fs.existsSync(distHtml) && fs.readFileSync(distHtml, 'utf8') === html,
    'build.js кладёт свежий index.html в desktop/tauri/dist');
  ok(!fs.existsSync(path.join(tdir, 'dist/sw.js')), 'сервис-воркер в dist не копируется: в обёртке офлайн-кэш не нужен');
  const tgi = fs.readFileSync(path.join(tdir, '.gitignore'), 'utf8');
  ok(tgi.includes('/target/'), '.gitignore Tauri не пускает в git папку target (гигабайты артефактов)');
  ok(conf.build.devUrl === undefined, 'devUrl убран — dev грузит собранный фронтенд');
  ok(conf.app.security.csp.includes('ipc: http://ipc.localhost'), 'в CSP разрешён IPC WebView2');
  ok(conf.app.withGlobalTauri === true, 'withGlobalTauri включён (мосту нужен window.__TAURI__)');
  const bridge = fs.readFileSync(path.join(tdir, 'bridge.js'), 'utf8');
  ok(bridge.includes('window.Chesster') && bridge.includes("platform: 'tauri'"), 'bridge.js определяет window.Chesster как tauri');
  ok(['openExternal', 'saveFile', 'pickEngine', 'spawnEngine', 'engineWrite', 'engineKill',
    'onEngineLine', 'setFullscreen', 'isFullscreen', 'checkUpdates', 'onMenu'].every(k => bridge.includes(k + ':')),
    'мост повторяет API preload.js Electron');
  ok(!/archiveRead\s*:/.test(bridge), 'архив-файл в мосту осознанно не включён (синхронного IPC в Tauri нет)');
  const mainrs = fs.readFileSync(path.join(tdir, 'src/main.rs'), 'utf8');
  ok(mainrs.includes('initialization_script') && mainrs.includes('include_str!("../bridge.js")'),
    'main.rs внедряет мост до загрузки страницы');
  ok(mainrs.includes('pick_engine') && mainrs.includes('save_file, open_external, pick_engine, engine_spawn, engine_write, engine_kill'),
    'команда pick_engine зарегистрирована в invoke_handler');
  ok(mainrs.includes('CREATE_NO_WINDOW'), 'движок под Windows запускается без консольного окна');
  ok((mainrs.match(/#\[tauri::command\(async\)\]/g) || []).length === 6,
    'все шесть команд помечены (async): диалоги не блокируют главный поток окна');
  ok(mainrs.includes('fn save_file(app: AppHandle, name: String, data: String)'),
    'save_file принимает текст: вложенные Uint8Array JSON-транспорт Tauri не переносит');
  ok(mainrs.includes('RunEvent::Exit') && mainrs.includes('kill_engine'),
    'при выходе приложение глушит процесс движка (как Electron)');
  ok(mainrs.includes('rundll32') && !mainrs.includes('Command::new("cmd")'),
    'ссылки открываются через rundll32, а не через cmd (адрес не разбивается по &)');
  ok(!cargo.includes('tauri-plugin-shell'), 'неиспользуемый плагин shell убран из зависимостей');
  ok(!caps.permissions.includes('dialog:default'), 'разрешение dialog не выдаётся JS: диалоги вызываются из Rust');
  ok(bridge.includes('function toText(') && !/data:\s*bytes/.test(bridge), 'мост приводит данные файла к тексту UTF-8');
  const tauriMd = fs.readFileSync(path.join(ROOT, 'TAURI.md'), 'utf8');
  ok(/Этап 1/.test(tauriMd) && /Этап 2/.test(tauriMd) && /Этап 3/.test(tauriMd), 'в TAURI.md план по этапам');
  const twf = fs.readFileSync(path.join(ROOT, '.github/workflows/tauri.yml'), 'utf8');
  ok(twf.includes('workflow_dispatch') && !/^\s*tags:/m.test(twf) && !/^push:/m.test(twf), 'workflow Tauri — только ручной запуск (релизы не трогает)');
  ok(twf.includes('tauri-apps/tauri-action') && twf.includes('projectPath: desktop/tauri'), 'workflow собирает через tauri-action');

  console.log('\nИТОГ: ' + pass + ' проверок, ' + fail + ' провалов');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('КРАХ ТЕСТА:', e); process.exit(1); });
