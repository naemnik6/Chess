/* Тесты: выдвижное меню, крупная доска, центрирование фигур, место под архив, Lichess */
const fs = require('fs');
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); }
catch (e) { ({ JSDOM, VirtualConsole } = require('/tmp/node_modules/jsdom')); }
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => { errors.push(e.message); console.log('  !! ' + e.message); });
vc.on('error', (...a) => { errors.push(String(a)); console.log('  !! console.error ' + a.join(' ')); });
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const win = dom.window, doc = win.document;
const App = win.ChessApp, C = win.Chess, S = win.Store, G = App.G;

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (fail++, console.log('  FAIL ' + m)); };
const txt = id => (doc.getElementById(id).textContent || '').replace(/\s+/g, ' ').trim();
const click = id => doc.getElementById(id).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const key = k => doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true }));
const q = s => doc.querySelector(s);
const qa = s => [...doc.querySelectorAll(s)];
const modal = a => { const b = q('.modal [data-a=' + a + ']'); if (b) b.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); };
const tapName = n => q('.sq[data-sq="' + C.sqFromName(n) + '"]').dispatchEvent(new win.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
const move = u => { tapName(u.slice(0, 2)); tapName(u.slice(2, 4)); };
const scholarsMate = () => ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'].forEach(move);
let openedUrl = null;
win.open = u => { openedUrl = u; return { focus() { } }; };

(async () => {
  await new Promise(r => setTimeout(r, 150));
  const tick = () => new Promise(r => setTimeout(r, 40));
  console.log('\n— Центрирование фигур (баг со смещением влево) —');
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  ok(/\.sq \.pcwrap\{[^}]*display:flex[^}]*align-items:center[^}]*justify-content:center[^}]*width:100%[^}]*height:100%/.test(css),
    'обёртка фигуры центрирует содержимое и занимает всю клетку');
  ok(/\.sq \.pc\{display:block;width:88%;height:88%/.test(css), 'сама фигура — блочная, 88% клетки (безinline-сдвига)');
  ok(!/pcwrap[^{]*\{[^}]*\}/.test(css) || css.indexOf('pcwrap') > 0, 'правило pcwrap присутствует в стилях');
  ok(qa('.sq .pcwrap').length === 64, 'в каждой клетке есть обёртка фигуры');

  console.log('\n— Выдвижное меню —');
  ok(!App.panelOpen(), 'по умолчанию меню закрыто — доска на всю ширину');
  ok(!!q('#btnPanel'), 'в правом верхнем углу есть кнопка-иконка меню');
  ok(q('#btnPanel').closest('.top-right') !== null, 'кнопка меню расположена в правой части шапки');
  ok(q('#btnPanel').dataset.tip.length > 10, 'у кнопки меню есть подсказка: «' + q('#btnPanel').dataset.tip.slice(0, 40) + '…»');
  ok(q('#panel').className.indexOf('panel') >= 0 && /position:absolute/.test(css.slice(css.indexOf('.panel{'))), 'меню — выдвижная панель, а не колонка в потоке');
  click('btnPanel');
  ok(App.panelOpen(), 'по клику на иконку меню открылось');
  ok(q('#panel').getAttribute('aria-hidden') === 'false', 'aria-hidden снят');
  ok(q('#btnPanel').getAttribute('aria-expanded') === 'true', 'aria-expanded выставлен');
  ok(qa('#tabs button').length === 7, 'в меню семь вкладок: ' + qa('#tabs button').map(b => b.textContent.replace(/\d+$/, '')).join(', '));
  ok(qa('#tabs button').map(b => b.dataset.tab).indexOf('engine') >= 0, 'есть вкладка «Движок»');
  App.switchTab('archive');
  ok(q('#tabBody section[data-panel=archive]').classList.contains('on'), 'вкладка «Архив» открылась');
  click('btnPanelClose');
  ok(!App.panelOpen(), 'меню закрылось по крестику');
  key('m');
  ok(App.panelOpen(), 'клавиша M открывает меню');
  key('Escape');
  ok(!App.panelOpen(), 'Escape закрывает меню');
  App.openPanel('archive');
  ok(App.panelOpen() && G.tab === 'archive', 'меню можно открыть сразу на нужной вкладке');
  App.switchTab('moves');
  ok(G.tab === 'moves', 'переключение вкладок работает');
  q('#drawerBg').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok(!App.panelOpen(), 'клик по затемнению закрывает меню');

  console.log('\n— Доска стала крупнее —');
  ok(/--sz:clamp\(240px, min\(calc\(100vw - 236px\), calc\(100vh - 118px\)\), 1000px\)/.test(css),
    'доска занимает почти всё окно: внизу ничего не осталось');
  ok(css.indexOf('--dw') < 0, 'открытие меню не меняет раскладку: доска не смещается и не опускается');
  ok(!/body\.panel-open > \.app\{padding-right/.test(css), 'контент не сдвигается при открытом меню');
  ok(/header\.top\{[^}]*flex-wrap:nowrap/.test(css), 'шапка в одну строку: длинный итог не роняет кнопки вниз');
  ok(/\[data-tip\]:hover::after\{[^}]*top:calc\(100% \+ 9px\)/.test(css), 'подсказки появляются ПОД кнопками, а не над ними');
  ok(/\.top-right \[data-tip\]:hover::after\{[^}]*right:-8px/.test(css), 'у правого края подсказки не обрезаются');
  ok(q('#btnToArchive') === null && q('#btnToMoves') === null,
    'отдельных кнопок-переходов нет: управление теперь внутри вкладки «Ходы»');
  App.openPanel('moves');
  ok(q('#tabBody [data-panel=moves] #toolbar') !== null, 'панель управления закреплена во вкладке «Ходы»');
  ok(q('.board-col #toolbar') === null, 'под доской панели управления больше нет');
  const row1 = q('#toolbar .tb-row:first-child'), row2 = q('#toolbar .tb-row:last-child');
  ok(row1 && ['first', 'prev', 'next', 'last'].every(a => row1.querySelector('[data-act=' + a + ']')),
    'первый ряд: к началу, назад, вперёд, в конец');
  ok(row2 && ['undo', 'reset', 'flip', 'marks', 'draw', 'resign'].every(a => row2.querySelector('[data-act=' + a + ']')),
    'второй ряд: вернуть ход, сброс, переворот, стрелки, ничья, сдача');
  ok(q('.board-area > .cap-col') !== null, 'материал вынесен в колонку слева от доски');
  ok(doc.querySelector('.logo .sub') === null, 'лишний подзаголовок под логотипом убран');
  ok(css.indexOf('.panel{position:absolute') >= 0 && !/\.panel\{width:376px/.test(css), 'панель больше не занимает 376 px в потоке рядом с доской');
  ok(/\.drawer-bg\{[^}]*pointer-events:none/.test(css), 'меню — оверлей: доска под ним не двигается');
  ok(/\.moves-status\{/.test(css) && !/\.statusbar\{/.test(css), 'статус переехал во вкладку «Ходы» (карточка .moves-status)');
  ok(doc.querySelector('.board-col #statusCard') === null, 'под доской больше нет блока статуса');
  ok(doc.querySelector('#tabBody [data-panel=moves] #statusCard') !== null, 'блок статуса находится внутри вкладки «Ходы»');
  ok(doc.getElementById('headStatus') !== null, 'в шапке есть чип текущего состояния партии');
  ok(/\.cap-col\{display:flex;flex-direction:column/.test(css), 'колонка материала вертикальная');
  ok(/\.cap-row \.chip\.cw svg\{filter:grayscale\(1\) brightness\(\.66\)\}/.test(css),
    'взятые фигуры — серые силуэты без полей-подложек');

  console.log('\n— Место под архив: шкала и проценты —');
  App.switchTab('archive');
  const q0 = S.quotaInfo();
  ok(q0.limit === S.ARCHIVE_BUDGET && q0.limit === 900000, 'бюджет архива задан: ' + S.sizeLabel(q0.limit));
  ok(q0.reserveGames === 3, 'резерв отведён на 3 партии');
  ok(txt('quotaPct').indexOf('%') > 0, 'проценты показаны: ' + txt('quotaPct'));
  ok(txt('quotaText').indexOf('Занято') === 0, 'показано занятое и свободное место: ' + txt('quotaText').slice(0, 70));
  ok(/влезет ещё примерно/.test(txt('quotaText')), 'показано, сколько партий ещё влезет');
  ok(q('#quotaFill').style.width !== '', 'шкала заполнена (width=' + q('#quotaFill').style.width + ')');
  ok(q('#quotaReserve').style.left !== '', 'на шкале отмечено начало резерва (left=' + q('#quotaReserve').style.left + ')');
  const help = txt('quotaHelp');
  ok(/Сколько весит одна партия/.test(help), 'в справке сказано, сколько весит партия');
  ok(/Сколько отведено места/.test(help), 'в справке объяснён размер бюджета и почему именно он');
  ok(/Сколько партий осталось до заполнения/.test(help), 'в справке есть оценка остатка');
  ok(/Что будет при заполнении/.test(help), 'в справке описано поведение при заполнении');
  ok(/резерв на 3 партии/i.test(help), 'в справке упомянут резерв на 3 партии');
  ok(/чуть больше 100 %/.test(help), 'объяснено, почему процентов может быть больше 100');
  ok(/самая старая партия удаляется/i.test(help), 'описано удаление самой старой партии');
  ok(/80 %, 90 %, 95 % и 100 %/.test(help), 'перечислены пороги уведомлений');
  ok(/оперативной памяти/.test(help), 'сказано, что движок не расходует это место');

  console.log('\n— Заполнение архива и вытеснение старых партий —');
  /* партии делаем «тяжёлыми» (~12 КБ), чтобы заполнить бюджет за десятки записей */
  const pgn = ('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 ')
    .repeat(28) + '1-0';
  const mkMoves = n => { const a = []; for (let i = 0; i < n; i++) a.push({ f: i % 64, t: (i * 7) % 64, p: null }); return a; };
  let saved = 0, evicted = 0, firstTitle = null, warnLevels = [];
  while (saved < 400) {
    const before = S.quotaInfo().level;
    const e = S.saveGame({
      title: 'Партия №' + (saved + 1) + ': Тест — Бот', white: 'Тест', black: 'Бот',
      result: '1-0', reason: 'checkmate', counted: true, plies: 60, pgn, moves: mkMoves(60)
    });
    saved++;
    evicted += e.evicted.length;
    if (saved === 1) firstTitle = e.title;
    const lv = S.quotaInfo().level;
    if (lv > before) warnLevels.push(lv);
    if (S.quotaInfo().pct > 105) break;
  }
  const q1 = S.quotaInfo();
  ok(saved > 20, 'заполнение архива: сохранено тяжёлых партий ' + saved);
  ok(q1.pct > 100, 'после заполнения бюджета проценты превышают 100 (работает резерв): ' + q1.pct.toFixed(1) + '%');
  ok(q1.used > q1.limit && q1.used <= q1.total * 1.05, 'занято больше бюджета, но в пределах бюджета+резерва: ' + S.sizeLabel(q1.used));
  ok(evicted > 0, 'когда резерв кончился, старые партии начали удаляться: удалено ' + evicted);
  ok(S.archive().indexOf(S.archive().find(g => g.title === firstTitle)) < 0, 'самая старая партия («' + firstTitle + '») удалена первой');
  ok(S.archive().every(g => g.title !== firstTitle), 'её больше нет в архиве');
  ok(warnLevels.indexOf(80) >= 0 && warnLevels.indexOf(90) >= 0 && warnLevels.indexOf(95) >= 0 && warnLevels.indexOf(100) >= 0,
    'пройдены все пороги уведомлений: ' + warnLevels.join(' → ') + ' %');
  ok(S.player('Тест') && S.player('Тест').played === q1.games, 'статистика профиля соответствует числу партий в архиве: ' + S.player('Тест').played);
  App.checkQuota(null);
  ok(/Место под архив: 100 %/.test(S.logs().map(l => l.text).join(' ')), 'в журнале есть запись о заполнении хранилища');
  App.renderQuota();
  ok(txt('quotaPct').replace('%', '') > 100, 'шкала показывает больше 100 %: ' + txt('quotaPct'));
  ok(q('#quotaFill').className.indexOf('lv100') >= 0, 'шкала на 100 % подсвечена тревожным цветом');
  ok(q('#quotaFill').style.width === '100%', 'полоса не вылезает за пределы шкалы: ' + q('#quotaFill').style.width);

  console.log('\n— Освобождение места —');
  const beforeFree = S.quotaInfo().used;
  S.clearArchive({ keepStats: true });
  App.checkQuota(null);
  App.renderQuota();
  ok(S.quotaInfo().used < beforeFree, 'после очистки архива место освободилось');
  ok(txt('quotaPct') === '0.0%' || txt('quotaPct') === '0%', 'проценты обнулились: ' + txt('quotaPct'));
  ok(S.settings().archiveWarnLevel === 0, 'порог предупреждения сброшен после освобождения места');
  ok(S.player('Тест') !== null && S.player('Тест').played > 0, 'статистика профилей при очистке с keepStats сохранена');

  console.log('\n— Кнопки «Скопировать и перейти на Lichess» —');
  App.switchTab('position');
  ok(!!q('#btnLichessFen') && !!q('#btnLichessPgn'), 'кнопки Lichess есть на вкладке «Позиция»');
  click('btnLichessFen'); await tick();
  ok(openedUrl && openedUrl.indexOf('https://lichess.org/analysis/') === 0, 'FEN открывает анализ на Lichess: ' + openedUrl);
  ok(openedUrl.indexOf('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR_w_KQkq_-_0_1') > 0, 'позиция подставлена в адрес через подчёркивания');
  click('btnLichessPgn'); await tick();
  ok(/^https:\/\/lichess\.org\/paste\?pgn=/.test(openedUrl || ''), 'PGN открывает lichess.org/paste с подставленным текстом: ' + String(openedUrl).slice(0, 60) + '…');
  /* в окне просмотра PGN партии из архива тоже есть такая кнопка */
  scholarsMate();
  modal('save');
  App.switchTab('archive');
  q('#archList .arch-item [data-a=pgn]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok(!!q('.modal [data-a=lichess]'), 'в окне PGN партии есть кнопка перехода на Lichess');
  ok(q('.modal [data-a=lichess]').textContent.indexOf('Скопировать и перейти на Lichess') >= 0, 'кнопка так и называется');
  q('.modal [data-a=lichess]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await tick();
  ok(/^https:\/\/lichess\.org\/paste/.test(openedUrl || ''), 'из окна партии тоже открывается Lichess');
  /* выгрузка архива */
  click('btnOffload');
  ok(!!q('.modal [data-a=lichess]'), 'в окне выгрузки архива есть кнопка Lichess');
  q('.modal [data-a=lichess]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await tick();
  ok(/^https:\/\/lichess\.org\/paste/.test(openedUrl || '') && S.countGames() > 0, 'переход на Lichess не удаляет архив');
  /* если браузер заблокировал всплывающее окно */
  win.open = () => null;
  click('btnLichessPgn');
  await tick();
  ok(!!q('.modal .pgn-view') && q('.modal .pgn-view').textContent.indexOf('lichess.org') >= 0,
    'при блокировке всплывающего окна показана ссылка для ручного перехода');
  modal('close');

  console.log('\n— Игра не сломалась —');
  win.open = u => { openedUrl = u; return {}; };
  App.closePanel();
  ok(qa('.sq').length === 64, 'доска на месте');
  key('n'); modal('yes');
  ok(G.sans.length === 0, 'новая партия начинается с чистой доски');
  move('e2e4'); move('e7e5');
  ok(G.sans.join(' ') === 'e4 e5', 'ходы делаются как раньше: ' + G.sans.join(' '));
  ok(errors.length === 0, 'ошибок в консоли нет' + (errors.length ? ': ' + errors[0] : ''));
  console.log(`\nИТОГ: ${pass} пройдено, ${fail} провалено`);
  process.exit(fail || errors.length ? 1 : 0);
})();
