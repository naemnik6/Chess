/* Тесты версии 2.1: материал с превращениями, разгрузка зоны под доской, меню приложения, полный экран */
const fs = require('fs');
const path = require('path');
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); }
catch (e) { ({ JSDOM, VirtualConsole } = require('/tmp/node_modules/jsdom')); }
const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (fail++, console.log('  FAIL ' + m)); };

function boot(withBridge) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const calls = { fullscreen: [], updates: 0 };
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc,
    beforeParse(win) {
      if (withBridge) {
        win.Chesster = {
          appVersion: '9.9', platform: 'electron',
          openExternal: () => Promise.resolve(true),
          saveFile: () => Promise.resolve({ saved: true, path: '/x' }),
          pickEngine: () => Promise.resolve({ canceled: true }),
          spawnEngine: () => Promise.resolve({ ok: true, pid: 1 }),
          engineWrite: () => { }, engineKill: () => { },
          onEngineLine: () => { }, onEngineExit: () => { }, onEngineError: () => { },
          onMenu: () => { }, setTitle: () => { }, setBadge: () => Promise.resolve(true),
          appReady: () => Promise.resolve(true),
          setFullscreen: on => { calls.fullscreen.push(!!on); },
          isFullscreen: () => Promise.resolve(calls.fullscreen[calls.fullscreen.length - 1] === true),
          checkUpdates: () => { calls.updates++; return Promise.resolve(true); }
        };
      }
      win.URL.createObjectURL = () => 'blob:x';
      win.URL.revokeObjectURL = () => { };
      win.HTMLAnchorElement.prototype.click = function () { };
    }
  });
  return { dom, win: dom.window, doc: dom.window.document, errors, calls };
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const { win, doc, errors, calls } = boot(true);
  await wait(250);
  const App = win.ChessApp, C = win.Chess, S = win.Store, G = App.G;
  const txt = id => (doc.getElementById(id).textContent || '').replace(/\s+/g, ' ').trim();
  const click = id => doc.getElementById(id).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const tap = n => doc.querySelector('.sq[data-sq="' + C.sqFromName(n) + '"]').dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
  const move = u => { tap(u.slice(0, 2)); tap(u.slice(2, 4)); };
  const am = a => { App.toggleAppMenu(true); doc.querySelector('#appMenu [data-am=' + a + ']').dispatchEvent(new win.MouseEvent('click', { bubbles: true })); };
  const adv = side => {
    const el = doc.getElementById(side === 'w' ? 'capBottom' : 'capTop');
    const a = el.querySelector('.adv');
    return a ? (a.textContent.match(/\+\d+/) || [null])[0] : null;
  };

  const V = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).version;
  console.log('\n— Версия ' + V + ' —');
  ok(App.version().app === V, 'приложение отражает версию ' + V + ': ' + App.version().app);
  ok(JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8')).version === V + '.0', 'обёртка синхронна: ' + V + '.0');
  App.openPanel('game');
  ok(new RegExp('Версия приложения: ' + V.replace('.', '\\.')).test(txt('versionLine')), 'версия видна на вкладке «Игра»: ' + txt('versionLine').slice(0, 40));

  console.log('\n— Полный экран и отсутствие нативной панели меню —');
  ok(calls.fullscreen.indexOf(true) >= 0, 'при запуске на компьютере окно переведено в полный экран');
  const main = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8');
  ok(/Menu\.setApplicationMenu\(null\)/.test(main), 'нативная панель меню отключена (не висит полосой сверху)');
  ok(!/buildFromTemplate\(template\)/.test(main) && !/label: 'Партия'/.test(main), 'русское нативное меню больше не собирается');
  ok(/win:setFullscreen/.test(main) && /win:isFullscreen/.test(main), 'полный экран управляется через IPC');
  const pre = fs.readFileSync(path.join(ROOT, 'desktop', 'preload.js'), 'utf8');
  ok(/setFullscreen/.test(pre) && /checkUpdates/.test(pre), 'preload отдаёт странице полный экран и проверку обновлений');
  ok(/data-am="fullscreen"/.test(html), 'пункт «Полный экран» есть в меню приложения');
  App.toggleAppMenu(true);
  doc.querySelector('#appMenu [data-am=fullscreen]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(30);
  ok(calls.fullscreen.length >= 2, 'пункт меню переключает полный экран через обёртку');
  App.closePanel();

  console.log('\n— Меню приложения (⋮) вместо нативной панели —');
  ok(doc.getElementById('btnAppMenu') !== null, 'в шапке есть кнопка меню приложения рядом со звуком и справкой');
  ok(doc.getElementById('btnAppMenu').closest('.top-right') !== null, 'кнопка расположена в правой группе шапки');
  App.toggleAppMenu(true);
  ok(App.appMenuOpen(), 'меню открывается');
  const groups = [...doc.querySelectorAll('#appMenu .pop-title')].map(e => e.textContent);
  ok(groups.join(',') === 'Партия,Вид,Инструменты,Справка', 'группы меню повторяют бывшую нативную панель: ' + groups.join(' / '));
  ok(doc.querySelectorAll('#appMenu button[data-am]').length === 16, 'в меню 16 действий, включая историю изменений');
  doc.dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true }));
  ok(!App.appMenuOpen(), 'клик мимо закрывает меню');
  am('flip');
  ok(G.flipped === true, 'действие «Перевернуть доску» работает из меню приложения');
  am('flip');
  am('help');
  ok(!!doc.querySelector('.modal .rules-body'), '«Правила и объявления» открываются из меню');
  doc.querySelector('.modal [data-a=close]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  am('about');
  ok(new RegExp('версия ' + V.replace('.', '\\.')).test((doc.querySelector('.modal p').textContent || '')), '«О программе» показывает версию и данные хранилища');
  doc.querySelector('.modal [data-a=updates]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(20);
  ok(calls.updates >= 1, 'из «О программе» можно запустить проверку обновлений обёртки');
  ok(!doc.querySelector('.modal'), 'окна закрыты');

  console.log('\n— Перевес материала с учётом превращений —');
  App.loadFen('1r5k/4P3/8/8/8/8/7K/8 w - - 0 1');
  if (doc.querySelector('.modal [data-a=later]')) doc.querySelector('.modal [data-a=later]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok(adv('b') === '+4', 'до превращения перевес чёрных = ладья против пешки: ' + adv('b'));
  move('e7e8');
  doc.querySelector('.promo-picks button[data-p=q]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok(/^e8=Q/.test(G.sans.slice(-1)[0]), 'превращение состоялось: ' + G.sans.slice(-1)[0]);
  ok(adv('w') === '+4', 'превращение сразу добавило материал белым (ферзь 9 против ладьи 5): ' + adv('w'));
  move('b8e8');
  ok(G.sans.slice(-1)[0] === 'Rxe8', 'чёрные съели превращённого ферзя: ' + G.sans.slice(-1)[0]);
  ok(adv('b') === '+5', 'после взятия у чёрных +5 (ладья против ничего), а не +9: ' + adv('b'));
  ok(adv('w') === null, 'у белых перевес не показан');
  ok(doc.querySelectorAll('#capTop .chip').length === 1, 'взятый ферзь по-прежнему виден фигуркой у чёрных (факт взятия)');
  /* сценарий из жалобы: провёл ферзя — материал должен добавиться проводящей стороне */
  App.loadFen('7k/P7/8/8/8/8/7K/8 w - - 0 1');
  if (doc.querySelector('.modal [data-a=later]')) doc.querySelector('.modal [data-a=later]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  move('a7a8');
  doc.querySelector('.promo-picks button[data-p=q]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok(adv('w') === '+9', 'пешка стала ферзём на пустой доске: у белых +9: ' + adv('w'));

  console.log('\n— Зона под доской разгружена —');
  ok(doc.querySelector('.board-col .statusline') === null && doc.querySelector('.board-col #statusSmall') === null,
    'под доской нет текстового блока статуса');
  const underBoard = [...doc.querySelector('.board-col').children].map(e => e.className || e.tagName);
  ok(underBoard.join('|').indexOf('toolbar') < 0 && underBoard.length <= 2,
    'под доской не осталось ничего лишнего: ' + underBoard.join(', '));
  ok(doc.querySelector('.board-area .cap-col + .board-col') !== null, 'доска идёт сразу за колонкой материала');
  ok(doc.getElementById('headStatus') !== null && txt('headStatus').length > 3, 'текущее состояние видно в чипе шапки: ' + txt('headStatus'));
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  ok(/body\.desktop\{font-size:15px;overflow:hidden\}/.test(css), 'в приложении нет страничной прокрутки (нет бокового ползунка)');
  ok(/body\.desktop \.app\{height:100vh;overflow:hidden/.test(css), 'колонка с доской укладывается в высоту окна');
  ok(/100vh - 118px/.test(css), 'бюджет высоты доски учитывает только шапку: внизу ничего нет');

  console.log('\n— Итог партии во вкладке «Ходы» + автооткрытие —');
  App.closePanel();
  ok(!App.panelOpen(), 'меню закрыто перед матом');
  App.loadFen('6k1/5ppp/8/8/8/8/5PPP/R6K w - - 0 1');
  if (doc.querySelector('.modal [data-a=later]')) doc.querySelector('.modal [data-a=later]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  move('a1a8');
  ok(/МАТ/.test(txt('statusBig')), 'во вкладке «Ходы» показан мат: ' + txt('statusBig'));
  ok(App.panelOpen() && G.tab === 'moves', 'при мате меню открылось само именно на вкладке «Ходы»');
  ok(/МАТ/.test(txt('headStatus')), 'чип в шапке тоже показывает мат: ' + txt('headStatus'));
  /* если меню уже открыто — ничего не делаем */
  App.switchTab('archive');
  App.loadFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  if (doc.querySelector('.modal [data-a=later]')) doc.querySelector('.modal [data-a=later]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok(G.tab === 'archive' && App.panelOpen(), 'если меню уже открыто, при итоге партии вкладку не переключают');
  App.switchTab('moves');
  ok(/ПАТ/.test(txt('statusBig')), 'пат тоже показан в карточке статуса: ' + txt('statusBig'));

  console.log('\n— Регресс —');
  App.closePanel();
  doc.querySelector('#toolbar button[data-act=reset]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const yesBtn = doc.querySelector('.modal [data-a=yes]');
  if (yesBtn) yesBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  move('e2e4'); move('e7e5'); move('f1c4'); move('b8c6'); move('d1h5'); move('g8f6'); move('h5f7');
  ok(/МАТ/.test(txt('headStatus')), 'детский мат объявлен в чипе: ' + txt('headStatus'));
  ok(G.sans.length === 7, 'партия сыграна целиком: ' + G.sans.length + ' полуходов');
  ok(errors.length === 0, 'ошибок консоли нет' + (errors.length ? ': ' + errors[0] : ''));

  console.log(`\nИТОГ: ${pass} пройдено, ${fail} провалено`);
  process.exit(fail || errors.length ? 1 : 0);
})();
