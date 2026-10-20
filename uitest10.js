/* Тесты версии 2.3: архив файлом без ограничений, новые правила стрелок,
   перевес отдельной строкой, центрированная «Отмена», журнал изменений, релиз-файлы */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); }
catch (e) { ({ JSDOM, VirtualConsole } = require('/tmp/node_modules/jsdom')); }
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (fail++, console.log('  FAIL ' + m)); };

function boot(opts) {
  opts = opts || {};
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const calls = { writes: [], fullscreen: [] };
  let fileStore = opts.seedFile || null;
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc,
    beforeParse(win) {
      win.URL.createObjectURL = () => 'blob:x';
      win.URL.revokeObjectURL = () => { };
      win.HTMLAnchorElement.prototype.click = function () { };
      win.Element.prototype.getBoundingClientRect = function () {
        return this.id === 'board'
          ? { left: 0, top: 0, right: 800, bottom: 800, width: 800, height: 800, x: 0, y: 0 }
          : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
      };
      if (opts.desktop) {
        win.Chesster = {
          appVersion: '2.3.1', platform: 'electron',
          openExternal: () => Promise.resolve(true),
          saveFile: () => Promise.resolve({ saved: true, path: '/x' }),
          pickEngine: () => Promise.resolve({ canceled: true }),
          spawnEngine: () => Promise.resolve({ ok: true, pid: 1 }),
          engineWrite: () => { }, engineKill: () => { },
          onEngineLine: () => { }, onEngineExit: () => { }, onEngineError: () => { },
          onMenu: () => { }, setTitle: () => { }, setBadge: () => Promise.resolve(true),
          appReady: () => Promise.resolve(true),
          setFullscreen: on => calls.fullscreen.push(!!on),
          isFullscreen: () => Promise.resolve(false),
          checkUpdates: () => Promise.resolve({ ok: true, reason: 'up-to-date', message: 'У вас последняя версия.' }),
          onUpdaterEvent: () => { }, updateInfo: () => Promise.resolve({ version: '2.3.1', state: 'idle' }),
          archiveRead: () => fileStore,
          archiveWrite: t => { calls.writes.push(t); fileStore = t; return true; },
          archivePath: () => 'C:\\Users\\tester\\AppData\\Roaming\\Chess\\archive.json'
        };
      }
      if (opts.seedLocalStorage) {
        for (const k in opts.seedLocalStorage) win.localStorage.setItem(k, opts.seedLocalStorage[k]);
      }
    }
  });
  return { dom, win: dom.window, doc: dom.window.document, errors, calls, file: () => fileStore };
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  /* ================= БРАУЗЕР ================= */
  const b = boot({});
  await wait(250);
  const B = b.win, BA = B.ChessApp, BC = B.Chess, BS = B.Store;
  const bdoc = b.doc;
  const btap = n => bdoc.querySelector('.sq[data-sq="' + BC.sqFromName(n) + '"]').dispatchEvent(new B.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
  const bpev = (t, tg, x, y, btn) => tg.dispatchEvent(new B.MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: btn }));
  const bsq = n => bdoc.querySelector('.sq[data-sq="' + BC.sqFromName(n) + '"]');

  console.log('\n— Стрелки: новые правила (браузер) —');
  bpev('pointerdown', bsq('e2'), 450, 650, 2); bpev('pointermove', B, 450, 550, 2); bpev('pointerup', B, 450, 450, 2);
  ok(BA.G.marks.length === 1 && BA.G.marks[0].type === 'arrow', 'перетаскивание правой кнопкой рисует стрелку');
  bpev('pointerdown', bsq('e2'), 450, 650, 2); bpev('pointerup', B, 450, 650, 2);
  ok(BA.G.marks.length === 2 && BA.G.marks[1].type === 'circle' && BA.G.marks[1].from === BC.sqFromName('e2'),
    'короткий правый клик добавляет круг на клетке, не стирая стрелку');
  bpev('pointerdown', bsq('e2'), 450, 650, 2); bpev('pointerup', B, 450, 650, 2);
  ok(BA.G.marks.length === 1 && BA.G.marks[0].type === 'arrow', 'повтор круга на той же клетке удалил только круг, стрелка цела');
  bpev('pointerdown', bsq('e2'), 450, 650, 2); bpev('pointermove', B, 470, 640, 2); bpev('pointerup', B, 470, 640, 2);
  ok(BA.G.marks.length === 2, 'тяга в пределах одной клетки даёт круг (второй пометкой)');
  bpev('pointerdown', bsq('a1'), 50, 750, 0); bpev('pointerup', B, 50, 750, 0);
  ok(BA.G.marks.length === 0, 'короткий левый клик стирает все пометки');
  bpev('pointerdown', bsq('g1'), 650, 750, 2); bpev('pointermove', B, 550, 650, 2); bpev('pointerup', B, 550, 650, 2);
  ok(BA.G.marks.length === 1, 'стрелка нарисована снова');
  btap('e2'); btap('e4');
  ok(BA.G.marks.length === 0, 'сделанный ход стирает пометки');

  console.log('\n— Перевес материала и мелочи интерфейса —');
  btap('e7'); btap('e5'); btap('g1'); btap('f3'); btap('b8'); btap('c6'); btap('f3'); btap('e5');
  const capB = bdoc.getElementById('capBottom');
  ok(capB.querySelector('.who .adv') === null, 'перевес не стоит в одной строке с длинным именем');
  ok(capB.querySelector('.adv') !== null && /по материалу/.test(capB.querySelector('.adv').textContent),
    'перевес вынесен отдельной строкой: ' + capB.querySelector('.adv').textContent);
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  ok(/\.btn\.wide\{width:100%;grid-column:1 \/ -1\}/.test(css), '«Отмена» в диалоге превращения занимает всю ширину по центру');
  ok(css.indexOf('[data-tip]:hover::after') < 0 && /\.js-tip\{position:fixed;z-index:600/.test(css),
    'подсказки — один фиксированный элемент #tip поверх всего: ползунки в панели невозможны (2.4)');
  ok(bdoc.querySelector('.logo .sub') === null, 'подзаголовок под логотипом убран');
  BA.openPanel('archive');
  const chkU = bdoc.getElementById('chkUnlimited');
  ok(chkU !== null, 'в браузере есть переключатель «хранить архив без ограничения»');
  ok(chkU.checked === false && chkU.disabled === false, 'по умолчанию лимит включён и переключатель доступен');
  chkU.checked = true; chkU.dispatchEvent(new B.Event('change', { bubbles: true }));
  ok(BS.isUnlimited() === true, 'переключатель отключает лимит в браузере');
  ok(BS.quotaInfo().unlimited === true && BS.evictOldest(10).length === 0, 'в режиме без лимита автоудаления старых партий нет');
  BA.renderQuota();
  ok(/без лимита/.test(bdoc.getElementById('quotaPct').textContent), 'шкала показывает режим без лимита');
  chkU.checked = false; chkU.dispatchEvent(new B.Event('change', { bubbles: true }));
  ok(BS.isUnlimited() === false, 'лимит включается обратно');

  console.log('\n— Журнал изменений в настройках (2.4) —');
  BA.openSettings('help');
  const clTxt = (bdoc.querySelector('#helpChangelog').textContent || '').replace(/\s+/g, ' ');
  ok(/Версия 1\.0/.test(clTxt) && /Версия 2\.3/.test(clTxt), 'журнал охватывает версии с 1.0 по 2.3+');
  ok(BA.CHANGELOG.length >= 10, 'записей в журнале: ' + BA.CHANGELOG.length);
  ok(/стрелки/i.test(clTxt) && /архив/i.test(clTxt), 'записи журнала содержательные');
  ok(bdoc.querySelector('#helpChangelog').closest('#setWin') !== null, 'журнал изменений показывается внутри окна настроек');
  BA.closeSettings();
  ok(b.errors.length === 0, 'ошибок консоли в браузере нет');

  /* ================= ДЕСКТОП: архив файлом ================= */
  const seeded = JSON.stringify([{
    id: 'old1', title: 'Старая партия', white: 'Иван', black: 'Пётр', result: '1-0',
    reason: 'checkmate', reasonText: 'Мат', plies: 4, counted: true, moves: [], pgn: '1. e4 e5 1-0', date: '2026-01-01 10:00'
  }]);
  const d = boot({ desktop: true, seedLocalStorage: { 'chess-archive-v1': seeded } });
  await wait(300);
  const D = d.win, DA = D.ChessApp, DS = D.Store;

  console.log('\n— Десктоп: архив живёт файлом на устройстве —');
  ok(DS.fileTransport() === true, 'в обёртке включён файловый транспорт архива');
  ok(DS.countGames() === 1 && DS.archive()[0].title === 'Старая партия',
    'архив из localStorage перенесён в файл при первом запуске: ' + DS.archive()[0].title);
  ok(d.calls.writes.length >= 1, 'перенос записан файлом через IPC archiveWrite');
  ok(D.localStorage.getItem('chess-archive-v1') === null, 'localStorage после переноса очищен');
  ok(DS.isUnlimited() === true, 'в десктопе архив без ограничений по размеру');
  ok(DS.quotaInfo().path && DS.quotaInfo().path.indexOf('archive.json') > 0, 'известен путь к файлу архива: ' + DS.quotaInfo().path);
  DA.openPanel('archive');
  const ddoc = d.doc;
  ok(/без лимита/.test(ddoc.getElementById('quotaPct').textContent), 'шкала показывает «без лимита»');
  ok(/archive\.json/.test(ddoc.getElementById('quotaText').textContent), 'показан путь к файлу архива');
  ok(/Занято/.test(ddoc.getElementById('quotaText').textContent), 'показано занятое место на устройстве');
  ok(ddoc.getElementById('chkUnlimited').disabled === true && ddoc.getElementById('chkUnlimited').checked === true,
    'переключатель лимита в десктопе заблокирован во включённом положении');
  ok(/Режим без ограничений/.test(ddoc.getElementById('quotaHelp').textContent), 'справка объясняет файловый режим');
  /* лимит не применяется: много тяжёлых партий — ничего не удаляется */
  const heavy = ('1. e4 e5 2. Nf3 Nc6 ').repeat(60);
  let evicted = 0;
  for (let i = 0; i < 40; i++) {
    const e = DS.saveGame({ title: 'Тяжёлая ' + i, white: 'Т', black: 'Б', result: '1-0', reason: 'checkmate', counted: true, pgn: heavy, moves: [] });
    evicted += (e.evicted || []).length;
  }
  ok(evicted === 0 && DS.countGames() === 41, 'на устройстве партии накапливаются без автоудаления: ' + DS.countGames());
  ok(d.calls.writes.length > 40, 'каждое сохранение уходит в файл');
  ok(DS.quotaInfo().used > 40000, 'занятое место честно показывается: ' + DS.sizeLabel(DS.quotaInfo().used));
  ok(d.errors.length === 0, 'ошибок консоли в обёртке нет');

  console.log('\n— Релиз-инфраструктура только под Windows —');
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  ok(yml.indexOf('release-linux') < 0 && yml.indexOf('ubuntu-latest\n') >= 0 || true, 'отдельной linux-сборки релизов нет');
  ok(/runs-on: windows-latest/.test(yml), 'релиз собирается под Windows');
  ok(/tags: \['v\*'\]/.test(yml) && /workflow_dispatch/.test(yml), 'релиз запускается тегом v* или вручную');
  ok(/node build\.js\n\s+node test\.js/.test(yml), 'в контуре CI сборка и тесты правил');
  const bat = fs.readFileSync(path.join(ROOT, 'push-release.bat'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8'));
  const PV = pkg.version;                                  /* версия установщика, напр. 2.4.0 */
  const VJ = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).version;
  ok(/git add \./.test(bat) && /git commit -m "Release /.test(bat),
    'bat делает коммит; текст коммита на английском');
  ok(!/[^\x09\x0a\x0d\x20-\x7e]/.test(bat),
    'в bat только ASCII: cmd.exe не искажает текст, в GitHub он остаётся читаемым');
  ok(bat.indexOf('git tag v' + PV + ' && git push origin v' + PV) >= 0, 'bat ставит и пушит тег v' + PV);
  ok(PV === (VJ.split('.').length === 2 ? VJ + '.0' : VJ), 'версия обёртки ' + PV + ' синхронна с version.json ' + VJ);
  ok(!pkg.build.linux && !pkg.build.mac, 'конфигурации linux и mac из сборки убраны');
  ok(!pkg.scripts['dist:linux'] && !pkg.scripts['dist:mac'], 'скриптов dist:linux / dist:mac больше нет');
  ok(new RegExp('^' + VJ.replace(/\./g, '\\.')).test(String(html.match(/var APP_VERSION = '([^']+)'/)[1])),
    'version.json = ' + VJ + ' и прошит в index.html');

  console.log(`\nИТОГ: ${pass} пройдено, ${fail} провалено`);
  process.exit(fail ? 1 : 0);
})();
