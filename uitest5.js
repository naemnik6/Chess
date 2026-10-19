/* Тесты архива партий, профилей соперников, импорта/экспорта PGN и воспроизведения */
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

/* скачивание файлов в jsdom не реализовано — заменяем заглушками,
   чтобы проверить саму логику выгрузки (в браузере работает настоящий Blob) */
win.URL.createObjectURL = () => 'blob:fake';
win.URL.revokeObjectURL = () => { };
win.HTMLAnchorElement.prototype.click = function () { };

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  OK   ' + m)) : (fail++, console.log('  FAIL ' + m)); };
const txt = id => (doc.getElementById(id).textContent || '').replace(/\s+/g, ' ').trim();
const big = () => txt('statusBig');
const click = id => doc.getElementById(id).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const tab = t => App.switchTab(t);
const tb = act => doc.querySelector('#toolbar button[data-act="' + act + '"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const tapName = n => {
  const el = doc.querySelector('.sq[data-sq="' + C.sqFromName(n) + '"]');
  const T = win.PointerEvent ? 'pointerdown' : 'mousedown';
  const E = (T === 'pointerdown' && win.PointerEvent) ? win.PointerEvent : win.MouseEvent;
  el.dispatchEvent(new E(T, { bubbles: true, cancelable: true, button: 0, clientX: 1, clientY: 1 }));
};
function move(uci, promo) {
  tapName(uci.slice(0, 2)); tapName(uci.slice(2, 4));
  if (promo) doc.querySelector('.promo-picks button[data-p="' + promo + '"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
}
const q = sel => doc.querySelector(sel);
const qa = sel => [...doc.querySelectorAll(sel)];
const modalBtn = (a) => { const b = q('.modal [data-a=' + a + ']'); if (b) b.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); return !!b; };
const setInput = (id, v, ev) => { const e = doc.getElementById(id); e.value = v; e.dispatchEvent(new win.Event(ev || 'change', { bubbles: true })); };
const setCheck = (id, v) => { const e = doc.getElementById(id); e.checked = v; e.dispatchEvent(new win.Event('change', { bubbles: true })); };
/* сыграть детский мат: 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6 4.Qxf7# */
const scholarsMate = () => ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'].forEach(u => move(u));

setTimeout(() => {
  console.log('\n— Завершённая партия предлагается сохранить в архив —');
  tab('moves');
  scholarsMate();
  ok(/МАТ/.test(big()), 'мат объявлен: «' + big() + '»');
  ok(!!q('.modal'), 'открыто окно итога партии');
  ok(!!q('.modal #svTitle'), 'в окне есть поле названия партии');
  ok(!!q('.modal #svWhite') && !!q('.modal #svBlack'), 'в окне есть поля имён белых и чёрных');
  ok(!!q('.modal #svCounted'), 'есть галочка «учитывать в статистике»');
  ok(q('.modal #svCounted').checked === true, 'по умолчанию статистика включена');
  ok(/Партия №1/.test(q('.modal #svTitle').value), 'название предложено автоматически: ' + q('.modal #svTitle').value);

  q('.modal #svWhite').value = 'Иван';
  q('.modal #svBlack').value = 'Пётр';
  q('.modal #svTitle').value = 'Первая партия';
  modalBtn('save');
  ok(!q('.modal'), 'окно закрылось после сохранения');
  ok(S.countGames() === 1, 'партия добавлена в архив: ' + S.countGames());
  const g1 = S.archive()[0];
  ok(g1.title === 'Первая партия', 'название сохранено: ' + g1.title);
  ok(g1.white === 'Иван' && g1.black === 'Пётр', 'имена сохранены: ' + g1.white + ' — ' + g1.black);
  ok(g1.result === '1-0' && g1.reason === 'checkmate', 'результат и причина: ' + g1.result + ' / ' + g1.reason);
  ok(g1.plies === 7 && g1.moves.length === 7, 'сохранено 7 полуходов');
  ok(/4\. Qxf7# 1-0/.test(g1.pgn), 'PGN партии сохранён: ' + JSON.stringify(g1.pgn.trim().split('\n').pop()));
  ok(G.savedId === g1.id, 'текущая партия помечена как сохранённая');
  ok(qa('#logAll .log-item').length === 0, 'журнал ещё не отрисован (вкладка не активна)');

  console.log('\n— Профили и счёт —');
  tab('players');
  ok(txt('playersCount').indexOf('Профилей: 2') === 0, 'создано два профиля: ' + txt('playersCount'));
  const rows = qa('#playersBody tr');
  ok(rows.length === 2, 'в таблице две строки');
  ok(rows[0].textContent.indexOf('Иван') >= 0, 'первым идёт Иван: ' + rows[0].textContent.trim());
  ok(rows[0].cells[1].textContent === '1' && rows[0].cells[2].textContent === '1' && rows[0].cells[4].textContent === '0',
    'у Ивана 1 партия, 1 победа, 0 поражений');
  ok(rows[0].cells[5].textContent === '100', 'процент очков Ивана: 100');
  ok(rows[1].cells[3].textContent === '0' && rows[1].cells[4].textContent === '1', 'у Петра 0 ничьих и 1 поражение');
  rows[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok(/Матов/.test(txt('playerDetail')), 'в профиле Ивана есть статистика матов');
  ok(/Личные встречи/.test(txt('playerDetail')), 'показаны личные встречи');
  ok(/против\s*Пётр|против <b>Пётр/.test(q('#playerDetail').innerHTML) || txt('playerDetail').indexOf('Пётр') >= 0,
    'в личных встречах указан соперник');
  ok(qa('#playerDetail .g').length === 1, 'в профиле перечислены партии из архива');
  ok(!!q('#playerDetail [data-pa=rename]'), 'профиль можно переименовать');

  console.log('\n— Счёт растёт при одинаковых именах —');
  tb('reset'); modalBtn('yes');
  ok(G.sans.length === 0, 'доска сброшена');
  setInput('nameWhite', 'Иван'); setInput('nameBlack', 'Пётр');
  scholarsMate();
  modalBtn('save');
  ok(S.countGames() === 2, 'в архиве две партии');
  tab('players');
  const ivan = S.player('Иван');
  ok(ivan.played === 2 && ivan.won === 2 && ivan.mates === 2, 'счёт Ивана накопился: ' + ivan.played + ' игр, ' + ivan.won + ' побед, ' + ivan.mates + ' матов');
  ok(S.player('Пётр').lost === 2 && S.player('Пётр').mated === 2, 'счёт Петра тоже: ' + S.player('Пётр').lost + ' поражения');
  ok(txt('playersCount').indexOf('учтённых партий: 2') > 0, 'в подписи видно число учтённых партий: ' + txt('playersCount'));

  console.log('\n— Партия проигравшей стороной и ничья —');
  tb('reset'); modalBtn('yes');
  move('e2e4');
  tb('resign'); modalBtn('yes');
  ok(G.result.reason === 'resign', 'сдача зафиксирована');
  modalBtn('save');
  /* после 1.e4 ход чёрных, поэтому сдались чёрные (Пётр) */
  ok(S.player('Пётр').lost === 3 && S.player('Пётр').resigned === 1, 'Пётр сдался: поражений ' + S.player('Пётр').lost + ', сдач ' + S.player('Пётр').resigned);
  ok(S.player('Иван').won === 3 && S.player('Иван').resigns === 1, 'Иван победил: ' + S.player('Иван').won + ' побед, чужих сдач ' + S.player('Иван').resigns);
  tb('reset'); modalBtn('yes');
  move('e2e4'); move('e7e5');
  tb('draw'); modalBtn('yes');
  ok(G.result.reason === 'agreement', 'ничья по соглашению');
  modalBtn('save');
  ok(S.player('Иван').drawn === 1 && S.player('Пётр').drawn === 1, 'ничья учтена у обоих');
  ok(S.countGames() === 4, 'в архиве четыре партии');

  console.log('\n— Вкладка «Архив» —');
  tab('archive');
  ok(qa('#archList .arch-item').length === 4, 'показаны все четыре партии');
  ok(txt('archInfo').indexOf('4') >= 0, 'в сводке видно число партий: ' + txt('archInfo').slice(0, 44));
  ok(txt('arBadge') === '4', 'на вкладке «Архив» виден счётчик');
  const first = q('#archList .arch-item');
  ok(/ai-res/.test(first.innerHTML), 'у партии показан бейдж результата');
  ok(qa('#archList .ai-btns button').length === 20, 'у каждой партии пять кнопок действий');
  setInput('archSearch', 'Первая', 'input');
  ok(qa('#archList .arch-item').length === 1, 'поиск по названию работает: найдена ' + qa('#archList .arch-item').length);
  setInput('archSearch', 'нет-такого', 'input');
  ok(/Ничего не найдено/.test(txt('archList')), 'при пустом результате показана подсказка');
  setInput('archSearch', '', 'input');
  ok(qa('#archList .arch-item').length === 4, 'сброс поиска вернул весь список');

  console.log('\n— Переименование и удаление партии —');
  const target = S.archive()[0];
  q('#archList .arch-item [data-a=rename]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok(!!q('.modal #rnTitle'), 'открылось окно переименования');
  q('.modal #rnTitle').value = 'Партия с новым именем';
  modalBtn('yes');
  ok(S.getGame(target.id).title === 'Партия с новым именем', 'партия переименована: ' + S.getGame(target.id).title);
  ok(txt('archList').indexOf('Партия с новым именем') >= 0, 'новое имя видно в списке');
  const before = { played: S.player('Иван').played, cnt: S.countGames() };
  q('#archList .arch-item [data-a=del]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  modalBtn('yes');
  ok(S.countGames() === before.cnt - 1, 'партия удалена из архива');
  ok(S.player('Иван').played === before.played - 1, 'статистика профиля уменьшена на удалённую партию');

  console.log('\n— Воспроизведение партии из архива —');
  const mate = S.archive().find(g => g.reason === 'checkmate');
  ok(!!mate, 'в архиве есть партия с матом');
  const liveBefore = { sans: G.sans.slice(), view: G.view, result: G.result };
  App.openPlayback(mate.id);
  ok(!!G.playback && G.playback.id === mate.id, 'режим просмотра архивной партии включён');
  ok(doc.getElementById('playbackBar').hidden === false, 'показана плашка просмотра');
  ok(txt('playbackTitle').indexOf(mate.title) >= 0, 'в плашке видно название партии');
  ok(G.sans.length === mate.plies, 'ходов загружено столько же, сколько в архиве: ' + G.sans.length);
  ok(/МАТ/.test(big()), 'показан итог архивной партии: «' + big() + '»');
  ok(/Партия из архива/.test(txt('statusSmall')), 'в статусе отмечено, что это архив');
  ok(App.canPlay() === false, 'доска заблокирована для ходов');
  ok(q('#toolbar button[data-act=undo]').disabled, 'кнопка «вернуть ход» недоступна при просмотре');
  ok(q('#toolbar button[data-act=reset]').disabled, 'кнопка «сбросить доску» недоступна при просмотре');
  tapName('e2');
  ok(G.selected === null, 'фигуры при просмотре не выбираются');
  tb('first');
  ok(G.view === 0 && big() === 'Ход белых', 'в начале архивной партии виден статус той позиции: «' + big() + '»');
  ok(/Просмотр партии из архива/.test(txt('statusSmall')), 'в статусе отмечен просмотр архива: «' + txt('statusSmall').slice(0, 44) + '»');
  tb('next'); tb('next');
  ok(G.view === 2 && G.sans[1] === 'e5', 'листание ходов архивной партии работает');
  tb('last');
  ok(/МАТ/.test(big()), 'в конце снова виден мат');
  click('btnClosePlayback');
  ok(!G.playback && doc.getElementById('playbackBar').hidden === true, 'просмотр закрыт');
  ok(G.sans.join() === liveBefore.sans.join(), 'живая партия восстановлена: ' + G.sans.join(' '));

  console.log('\n— Импорт PGN —');
  tab('archive');
  const beforeImport = S.countGames();
  click('btnImportPgn');
  ok(!!q('.modal #impText'), 'открылось окно импорта');
  ok(!!q('.modal #impCounted') && q('.modal #impCounted').checked, 'есть галочка «учитывать в статистике» (включена)');
  ok(!!q('.modal #impFile'), 'можно выбрать файл');
  q('.modal #impText').value = [
    '[Event "Турнир"]', '[Site "Парк"]', '[Date "2024.05.01"]', '[White "Гагарин"]', '[Black "Королёв"]', '[Result "1-0"]',
    '', '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 1-0',
    '',
    '[Event "Дружеская"]', '[White "Королёв"]', '[Black "Гагарин"]', '[Result "1/2-1/2"]',
    '', '1. d4 d5 2. c4 e6 3. Nc3 Nf6 1/2-1/2',
    '',
    'это не партия, а просто текст без ходов'
  ].join('\n');
  q('.modal [data-a=do]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok(S.countGames() === beforeImport + 2, 'импортированы две партии из трёх блоков: ' + (S.countGames() - beforeImport));
  const imp = S.archive().find(g => g.white === 'Гагарин' && g.result === '1-0');
  ok(!!imp, 'найдена импортированная партия Гагарин — Королёв');
  ok(imp.plies === 20, 'ходов распознано: ' + imp.plies);
  ok(imp.title === 'Турнир', 'название взято из тега Event: ' + imp.title);
  ok(imp.date.indexOf('2024.05.01') === 0, 'дата взята из PGN: ' + imp.date);
  ok(imp.startFen === null, 'стартовая позиция обычная');
  ok(S.player('Гагарин') && S.player('Гагарин').won === 1, 'статистика импортированного игрока учтена');
  ok(S.player('Королёв') && S.player('Королёв').drawn === 1 && S.player('Королёв').lost === 1, 'у Королёва ничья и поражение');
  ok(G.tab === 'archive', 'после импорта открыта вкладка «Архив»');
  ok(txt('archList').indexOf('Гагарин') >= 0, 'импортированные партии видны в списке');

  console.log('\n— Воспроизведение импортированной партии —');
  App.openPlayback(imp.id);
  ok(G.sans.length === 20, 'партия восстановлена по сохранённым ходам: ' + G.sans.length + ' полуходов');
  ok(G.sans[8] === 'O-O' && G.sans[15] === 'O-O', 'обе рокировки в импорте распознаны: ' + G.sans.slice(8, 16).join(' '));
  ok(C.toFen(App.cur()).indexOf('r1bq1rk1') === 0 || G.sans.length === 19, 'финальная позиция собрана');
  tb('first');
  ok(G.view === 0, 'можно листать импортированную партию с начала');
  click('btnClosePlayback');

  console.log('\n— Импорт без учёта в статистике —');
  tab('archive');
  const pBefore = S.player('Гагарин').played;
  App.importPgn('[White "Гагарин"]\n[Black "Тестов"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0', false);
  ok(S.countGames() > 0, 'партия добавлена в архив');
  const noStats = S.archive().find(g => g.black === 'Тестов');
  ok(noStats.counted === false, 'в записи отмечено, что статистика не учитывалась');
  ok(S.player('Гагарин').played === pBefore, 'счёт Гагарина не изменился: ' + S.player('Гагарин').played);
  ok(S.player('Тестов') === null, 'профиль второго игрока не создан');
  ok(txt('archList').indexOf('без статистики') >= 0, 'в списке партия помечена «без статистики»');

  console.log('\n— Анонимные партии —');
  tab('players');
  ok(q('#chkCountAnon').checked === true, 'учёт анонимных партий включён по умолчанию');
  const anonBefore = S.player(null) ? S.player(null).played : 0;
  tb('reset'); modalBtn('yes');
  setInput('nameWhite', ''); setInput('nameBlack', '');
  scholarsMate();
  modalBtn('save');
  const anonGame = S.archive()[0];
  ok(anonGame.white === null && anonGame.whiteAnon === true, 'партия без имени помечена как анонимная');
  ok(!!S.player(null) && S.player(null).anon === true, 'создан сводный профиль «Аноним»');
  ok(S.player(null).played === anonBefore + 1, 'анонимный счёт ведётся: было ' + anonBefore + ', стало ' + S.player(null).played);
  ok(S.player(null).selfGames === 1, 'партия «аноним против анонима» учтена один раз: ' + S.player(null).selfGames);
  ok(S.player(null).won === 0 && S.player(null).lost === 0, 'победы и поражения в ней не разделяются (обе стороны без имени)');
  tab('players');
  const lastRow = qa('#playersBody tr').pop();
  ok(lastRow.textContent.indexOf('Аноним') >= 0, '«Аноним» показан в таблице');
  ok(qa('#playersBody tr').pop() === lastRow && qa('#playersBody .anon').length === 1, 'у анонима есть пометка «сводный»');
  ok(qa('#playersBody tr')[qa('#playersBody tr').length - 1].textContent.indexOf('Аноним') >= 0, 'аноним стоит последним в списке');

  setCheck('chkCountAnon', false);
  ok(S.settings().countAnon === false, 'учёт анонимных партий выключен');
  tb('reset'); modalBtn('yes');
  scholarsMate();
  modalBtn('save');
  ok(S.archive()[0].counted === false, 'новая анонимная партия сохранена без статистики');
  ok(S.player(null).played === anonBefore + 1, 'сводный профиль анонима не изменился: ' + S.player(null).played);
  setCheck('chkCountAnon', true);
  click('btnClearAnon');
  modalBtn('yes');
  ok(S.player(null) === null, 'профиль «Аноним» обнулён');
  ok(S.countGames() > 0, 'сами партии остались в архиве: ' + S.countGames());

  console.log('\n— Выгрузка архива и очистка —');
  tab('archive');
  setInput('reminderInput', '5');
  ok(S.settings().archiveReminder === 5, 'порог напоминания настраивается: ' + S.settings().archiveReminder);
  const cnt = S.countGames();
  ok(/выгрузите/i.test(txt('archInfo')) || cnt < 5, 'при большом архиве показывается предупреждение о выгрузке');
  click('btnOffload');
  ok(!!q('.modal #keepStats') && q('.modal #keepStats').checked, 'в окне выгрузки есть галочка «сохранить статистику»');
  ok(!!q('.modal .pgn-view'), 'в окне показан текст всех партий — можно скопировать вручную');
  ok(q('.modal .pgn-view').textContent.indexOf('[White') >= 0, 'текст выгрузки похож на PGN');
  q('.modal [data-a=down]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok(!!q('.modal'), 'после скачивания окно остаётся открытым — очистка только вручную');
  ok(S.countGames() === cnt, 'архив ещё не очищен: ' + S.countGames());
  const statsBefore = S.player('Иван') ? S.player('Иван').played : 0;
  q('.modal [data-a=wipe]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok(S.countGames() === 0, 'архив очищен после явного подтверждения');
  ok(statsBefore === 0 || (S.player('Иван') && S.player('Иван').played === statsBefore), 'статистика профилей сохранена');
  ok(!q('.modal'), 'окно выгрузки закрылось');
  ok(txt('archList').indexOf('Архив пуст') >= 0, 'показано, что архив пуст');
  ok(q('#toolbar button[data-act=reset]') !== null, 'панель управления на месте');

  console.log('\n— Очистка архива вместе со статистикой —');
  App.importPgn('[White "Иван"]\n[Black "Пётр"]\n[Result "1-0"]\n\n1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0', true);
  ok(S.countGames() === 1, 'партия импортирована в пустой архив');
  const playedAfterImport = S.player('Иван').played;
  ok(playedAfterImport > 0, 'статистика Ивана учтена при импорте: ' + playedAfterImport);
  App.offloadArchive(false);
  ok(!!q('.modal #keepStats'), 'открылось окно выгрузки');
  q('.modal #keepStats').checked = false;               /* статистику не сохраняем */
  q('.modal [data-a=wipe]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  ok(S.countGames() === 0, 'архив очищен');
  ok(S.players().length === 0, 'без сохранения статистики все профили сброшены: ' + S.players().length);
  ok(/сброшена/.test(S.logs().map(l => l.text).join(' ')), 'в журнале отмечено, что статистика сброшена');

  console.log('\n— Незавершённая партия в архиве —');
  tb('reset'); modalBtn('yes');
  move('e2e4'); move('e7e5'); move('g1f3');
  tab('archive');
  click('btnSaveGame');
  ok(!!q('.modal #svTitle'), 'незавершённую партию тоже можно сохранить');
  q('.modal #svWhite').value = 'Аня'; q('.modal #svBlack').value = 'Боря';
  modalBtn('yes');
  const live = S.archive()[0];
  ok(live.result === '*', 'в архиве результат незавершённой партии — «*»: ' + live.result);
  App.openPlayback(live.id);
  ok(G.result === null, 'при просмотре незавершённой партии итог не показывается');
  ok(big() === 'Ход чёрных', 'статус показывает обычную позицию: «' + big() + '»');
  ok(txt('playbackTitle').indexOf('не завершена') >= 0, 'в плашке отмечено, что партия не завершена: ' + txt('playbackTitle'));
  ok(G.sans.length === 3, 'ходы незавершённой партии воспроизведены: ' + G.sans.join(' '));
  click('btnClosePlayback');
  ok(G.sans.length === 3 && !G.playback, 'вернулись к живой партии');

  console.log('\n— Журнал за всё время и раздельные ключи хранилища —');
  tab('events');
  const logs = S.logs();
  ok(logs.length > 10, 'в журнале накопилось записей: ' + logs.length);
  ok(logs.some(l => l.kind === 'mate'), 'в журнале есть запись о мате');
  ok(logs.some(l => l.kind === 'arch'), 'в журнале есть записи об архиве');
  ok(qa('#logAll .log-item .tm').length === logs.length, 'у каждой записи журнала видна дата и время');
  ok(logs[0].t.length === 16, 'формат времени: ' + logs[0].t);
  click('btnClearLog'); modalBtn('yes');
  ok(S.logs().length === 1, 'журнал очищен (осталась служебная запись): ' + S.logs().length);
  const keys = [];
  for (let i = 0; i < win.localStorage.length; i++) keys.push(win.localStorage.key(i));
  ok(['chess-settings-v1', 'chess-archive-v1', 'chess-log-v1'].every(k => keys.indexOf(k) >= 0),
    'блоки данных лежат в отдельных ключах: ' + keys.sort().join(', '));
  ok(!keys.some(k => k === 'chess-store-v1'), 'единого «тяжёлого» ключа со всем содержимым нет');
  ok(S.usageLabel().length > 3, 'показан объём хранилища: ' + S.usageLabel());

  console.log('\n— Ошибки консоли —');
  ok(errors.length === 0, 'ошибок нет' + (errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''));
  console.log(`\nИТОГ: ${pass} пройдено, ${fail} провалено`);
  process.exit(fail || errors.length ? 1 : 0);
}, 250);
