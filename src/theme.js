/* =========================================================================
   Модуль цветовой темы (Theme) — версия 3.2.
   Даёт пользователю полный контроль над палитрой приложения:
     • реестр THEME-переменных (81 элемент интерфейса и доски), каждая —
       CSS-переменная из :root; значения по умолчанию точно совпадают
       с классическим оформлением, поэтому «из коробки» вид не меняется;
     • HSL-пипетка с палитрой, HEX-полем, прозрачностью и градиентами
       (градиент разрешён только тем переменным, где он безопасен —
       фон панелей, кнопок, клеток доски);
     • точечная раскраска отдельных клеток доски (расширенный режим,
       по умолчанию выключен);
     • готовые палитры-пресеты, экспорт/импорт темы в JSON;
     • карта «элемент → переменные» для режима дизайнера: она строится
       разбором самого CSS приложения, поэтому клик по любому элементу
       точно знает, какие цвета его формируют.
   Модуль «чистый»: он не знает про Store и настройки — приложение само
   передаёт сюда карты переопределений, а Theme собирает <style id="themeCss">
   в конце <head>, который перекрывает базовые переменные :root.
   Все значения проходят строгую санитизацию (импорт из JSON не должен
   иметь возможности протащить в CSS произвольный текст).
   ========================================================================= */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var api = factory(isNode ? null : root);
  if (isNode) module.exports = api;
  if (root) root.Theme = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
  'use strict';

  var doc = root && root.document ? root.document : null;

  /* ---------- значения по умолчанию (= классическое оформление) ---------- */
  var DEFAULTS = {
    /* страница и панели */
    '--bg1': '#131a33', '--bg2': '#0b0e1c',
    '--glow1': '#22305e', '--glow2': '#33245a',
    '--panel': '#171c31', '--panel2': '#1f2540', '--panel3': '#151a2e',
    '--panel-grad': 'linear-gradient(180deg,#171c31,#141a2e)',
    '--drawer-bg': 'linear-gradient(180deg,#1b2138,#11162a)',
    '--win-bg': 'linear-gradient(180deg,#1e2440,#171c31)',
    '--win-line': '#39416b',
    '--card-bg': '#131829', '--card2-bg': '#1a2036',
    '--line': '#2c3355', '--line-hi': '#4a568c',
    /* текст и акценты */
    '--text': '#e9ecfa', '--text-soft': '#c6cde6',
    '--muted': '#98a1c4', '--muted2': '#6c769c',
    '--accent': '#7aa2ff', '--accent2': '#5b83f0', '--gold': '#f2c14e',
    '--good': '#5ee08a', '--bad': '#ff6b6b', '--draw': '#79c7ff',
    /* кнопки и элементы управления */
    '--btn-bg': 'linear-gradient(180deg,#252c4a,#1c2340)',
    '--btn-bg-hi': 'linear-gradient(180deg,#2d3557,#222a4b)',
    '--btn-primary': 'linear-gradient(180deg,#8fb4ff,#5b83f0)',
    '--ctl-bg': '#1b2138', '--ctl-bg-hi': '#263055',
    '--recess': '#151a2e',
    '--sel-bg': 'linear-gradient(180deg,#3a4573,#2c3560)',
    '--toast-bg': 'rgba(10,13,26,.93)',
    '--scroll-thumb': '#414e85', '--scroll-thumb-hi': '#5563a5', '--scroll-track': '#10152a',
    /* доска */
    '--light': '#f0d9b5', '--dark': '#b58863',
    '--frame1': '#3d2f24', '--frame2': '#241b14',
    '--crd-l': '#a07a52', '--crd-d': '#f0d9b5',
    '--hl-last': 'rgba(255,224,102,.42)',
    '--hl-sel': 'rgba(120,200,255,.5)',
    '--hl-move': 'rgba(20,30,20,.3)', '--hl-move-d': 'rgba(10,15,10,.34)',
    '--hl-cap': 'rgba(220,40,40,.55)',
    '--hl-check1': 'rgba(232,45,45,.55)', '--hl-check2': 'rgba(196,12,12,.92)',
    '--pc-shadow': 'rgba(0,0,0,.35)',
    /* стрелки и круги правой кнопки (3.2): четыре чередующихся цвета */
    '--mark-1': '#3aa0ff', '--mark-2': '#ffb02e', '--mark-3': '#ff5f5f', '--mark-4': '#57d97a',
    /* фигуры (3.2): значения в точности равны цветам спрайта Cburnett */
    '--pc-w-fill': '#ffffff', '--pc-w-line': '#000000',
    '--pc-b-fill': '#000000', '--pc-b-line': '#000000', '--pc-b-hi': '#ececec',
    /* подсказки, текст поверх акцентов, «опасные» действия и особые элементы */
    '--tip-bg': '#0a0d1a', '--tip-line': '#454f80', '--tip-text': '#e9ecfa',
    '--on-primary': '#0a1024', '--on-sel': '#ffffff',
    '--danger-text': '#ffb3b3', '--danger-line': '#6d3040', '--danger-line-hi': '#8f3a4d',
    '--danger-bg': 'linear-gradient(180deg,#4a2130,#38192a)',
    '--promo-bg': 'linear-gradient(180deg,#f0d9b5,#d9bd93)', '--promo-line': '#6b5842', '--promo-ink': '#4a3b28',
    '--lichess-bg': 'linear-gradient(180deg,#1e3227,#182721)', '--lichess-line': '#3f6b52', '--lichess-text': '#b7f0cd',
    '--logo-grad': 'linear-gradient(145deg,#2b3560,#1a2038)',
    '--playback-bg': 'linear-gradient(180deg,#2a2140,#1d1730)', '--playback-line': '#4b3d75', '--playback-text': '#dccfff',
    '--qbar-bg': '#0e1322', '--qbar-line': '#26304f',
    '--arch-text': '#c0aef5'
  };

  /* ---------- реестр: что можно перекрасить ----------
     g:1 — элемент поддерживает градиент (используется как фон целиком);
     остальные — только сплошной цвет (текст, границы, цветовые стоп-сигналы). */
  var GROUPS = [
    {
      id: 'ui', name: 'Страница и панели', items: [
        { v: '--bg1', n: 'Фон страницы (верх)' },
        { v: '--bg2', n: 'Фон страницы (низ)' },
        { v: '--glow1', n: 'Свечение фона (слева)' },
        { v: '--glow2', n: 'Свечение фона (справа)' },
        { v: '--panel', n: 'Панели' },
        { v: '--panel-grad', n: 'Панели — градиент', g: 1 },
        { v: '--panel2', n: 'Панели — светлее' },
        { v: '--panel3', n: 'Панели — темнее' },
        { v: '--card-bg', n: 'Карточки и врезки (архив, FEN, квота)' },
        { v: '--card2-bg', n: 'Карточки элементов (журнал, движки, партии)' },
        { v: '--drawer-bg', n: 'Боковое меню — градиент', g: 1 },
        { v: '--win-bg', n: 'Окна и диалоги — градиент', g: 1 },
        { v: '--win-line', n: 'Граница окон' },
        { v: '--line', n: 'Границы элементов' },
        { v: '--line-hi', n: 'Границы — при наведении' }
      ]
    },
    {
      id: 'text', name: 'Текст и акценты', items: [
        { v: '--text', n: 'Основной текст' },
        { v: '--text-soft', n: 'Текст — мягкий' },
        { v: '--muted', n: 'Второстепенный текст' },
        { v: '--muted2', n: 'Приглушённый текст' },
        { v: '--accent', n: 'Акцент' },
        { v: '--accent2', n: 'Акцент — темнее' },
        { v: '--gold', n: 'Золото (победы, мат)' },
        { v: '--good', n: 'Цвет побед' },
        { v: '--bad', n: 'Цвет поражений' },
        { v: '--draw', n: 'Цвет ничьих' }
      ]
    },
    {
      id: 'ctl', name: 'Кнопки и элементы управления', items: [
        { v: '--btn-bg', n: 'Кнопки — градиент', g: 1 },
        { v: '--btn-bg-hi', n: 'Кнопки при наведении — градиент', g: 1 },
        { v: '--btn-primary', n: 'Главная кнопка — градиент', g: 1 },
        { v: '--ctl-bg', n: 'Кнопки-иконки и чипы' },
        { v: '--ctl-bg-hi', n: 'Кнопки-иконки при наведении' },
        { v: '--recess', n: 'Поля ввода, вкладки, сегменты' },
        { v: '--sel-bg', n: 'Активная вкладка или сегмент — градиент', g: 1 },
        { v: '--toast-bg', n: 'Фон всплывающих объявлений' },
        { v: '--scroll-thumb', n: 'Ползунок прокрутки' },
        { v: '--scroll-thumb-hi', n: 'Ползунок прокрутки при наведении' },
        { v: '--scroll-track', n: 'Дорожка прокрутки' }
      ]
    },
    {
      id: 'board', name: 'Доска и клетки', items: [
        { v: '--light', n: 'Светлые клетки', g: 1 },
        { v: '--dark', n: 'Тёмные клетки', g: 1 },
        { v: '--frame1', n: 'Рамка доски — светлая' },
        { v: '--frame2', n: 'Рамка доски — тёмная' },
        { v: '--crd-l', n: 'Координаты на светлых клетках' },
        { v: '--crd-d', n: 'Координаты на тёмных клетках' },
        { v: '--hl-last', n: 'Подсветка последнего хода' },
        { v: '--hl-sel', n: 'Подсветка выбранной клетки' },
        { v: '--hl-move', n: 'Точка возможного хода' },
        { v: '--hl-move-d', n: 'Точка хода на тёмной клетке' },
        { v: '--hl-cap', n: 'Кольцо взятия' },
        { v: '--hl-check1', n: 'Шах — серединное кольцо' },
        { v: '--hl-check2', n: 'Шах — край кольца' },
        { v: '--pc-shadow', n: 'Тень фигур' },
        { v: '--mark-1', n: 'Стрелки и метки — цвет 1' },
        { v: '--mark-2', n: 'Стрелки и метки — цвет 2' },
        { v: '--mark-3', n: 'Стрелки и метки — цвет 3' },
        { v: '--mark-4', n: 'Стрелки и метки — цвет 4' }
      ]
    },
    {
      id: 'pieces', name: 'Фигуры', items: [
        { v: '--pc-w-fill', n: 'Белые фигуры — заливка' },
        { v: '--pc-w-line', n: 'Белые фигуры — контур и детали' },
        { v: '--pc-b-fill', n: 'Чёрные фигуры — заливка' },
        { v: '--pc-b-line', n: 'Чёрные фигуры — контур' },
        { v: '--pc-b-hi', n: 'Чёрные фигуры — светлые детали' }
      ]
    },
    {
      id: 'extra', name: 'Подсказки, кнопки и особые элементы', items: [
        { v: '--tip-bg', n: 'Подсказки — фон' },
        { v: '--tip-line', n: 'Подсказки — граница и стрелка' },
        { v: '--tip-text', n: 'Подсказки — текст' },
        { v: '--on-primary', n: 'Текст на главных кнопках и текущем ходе' },
        { v: '--on-sel', n: 'Текст на активных вкладках и заголовках' },
        { v: '--danger-text', n: 'Опасные действия — текст' },
        { v: '--danger-line', n: 'Опасные действия — граница' },
        { v: '--danger-line-hi', n: 'Опасные действия — граница при наведении' },
        { v: '--danger-bg', n: 'Опасные действия — фон при наведении', g: 1 },
        { v: '--promo-bg', n: 'Диалог превращения — фон кнопок', g: 1 },
        { v: '--promo-line', n: 'Диалог превращения — граница кнопок' },
        { v: '--promo-ink', n: 'Диалог превращения — подписи фигур' },
        { v: '--lichess-bg', n: 'Кнопка Lichess — фон', g: 1 },
        { v: '--lichess-line', n: 'Кнопка Lichess — граница' },
        { v: '--lichess-text', n: 'Кнопка Lichess — текст' },
        { v: '--logo-grad', n: 'Логотип — подложка', g: 1 },
        { v: '--playback-bg', n: 'Плашка просмотра истории — фон', g: 1 },
        { v: '--playback-line', n: 'Плашка просмотра истории — граница' },
        { v: '--playback-text', n: 'Плашка просмотра истории — текст' },
        { v: '--qbar-bg', n: 'Шкала квоты архива — дорожка' },
        { v: '--qbar-line', n: 'Шкала квоты архива — граница' },
        { v: '--arch-text', n: 'Метка «архив» в состоянии партии' }
      ]
    }
  ];

  /* быстрый доступ к элементу реестра по переменной */
  var BY_VAR = {};
  GROUPS.forEach(function (g) { g.items.forEach(function (it) { BY_VAR[it.v] = it; }); });

  /* ---------- палитра пипетки (36 образцов) ---------- */
  var PALETTE = [
    '#ffffff', '#e6e6e6', '#c2c2c2', '#9a9a9a', '#737373', '#525252', '#383838', '#222222', '#000000',
    '#f6d7c5', '#eeb08a', '#e2854a', '#c25e2a', '#a3441f', '#f0d9b5', '#d9bd93', '#b58863', '#8a6244',
    '#f2b8b8', '#e06a6a', '#c23c3c', '#96282f', '#e8d26a', '#cbb23c', '#a5b84c', '#6fae5e', '#3f8f4f',
    '#b8d8f2', '#7ab8e8', '#4a90d9', '#2f6ab0', '#7a6bf0', '#a86bf0', '#d06ae8', '#e86ab0', '#1f7a72'
  ];

  /* ---------- готовые палитры-пресеты ----------
     Пресет заменяет всю тему целиком (это не «настройка поверх»). */
  var PRESETS = [
    { id: 'classic', name: 'Классика', vars: null },   /* null = сброс к значениям по умолчанию */
    {
      id: 'ice', name: 'Лёд', vars: {
        '--bg1': '#101a24', '--bg2': '#0a1017', '--glow1': '#1d3a52', '--glow2': '#16324a',
        '--panel': '#14202c', '--panel2': '#1a2a38', '--panel3': '#101a24',
        '--panel-grad': 'linear-gradient(180deg,#14202c,#101822)',
        '--drawer-bg': 'linear-gradient(180deg,#15222e,#0d151d)',
        '--win-bg': 'linear-gradient(180deg,#1a2836,#14202c)', '--win-line': '#33475c',
        '--card-bg': '#0f1822', '--card2-bg': '#16222e',
        '--line': '#28384a', '--line-hi': '#41617f',
        '--text': '#e8f0f6', '--text-soft': '#c4d2de', '--muted': '#93a5b5', '--muted2': '#66788a',
        '--accent': '#7fb6e8', '--accent2': '#5a92c4', '--gold': '#e8c66a',
        '--btn-bg': 'linear-gradient(180deg,#20323f,#182530)',
        '--btn-bg-hi': 'linear-gradient(180deg,#2a4152,#20323f)',
        '--btn-primary': 'linear-gradient(180deg,#9cc6ec,#5a92c4)',
        '--ctl-bg': '#16222e', '--ctl-bg-hi': '#20323f', '--recess': '#101a24',
        '--sel-bg': 'linear-gradient(180deg,#31536e,#274159)',
        '--scroll-thumb': '#31536e', '--scroll-thumb-hi': '#41617f', '--scroll-track': '#0c141c',
        '--light': '#dee3e6', '--dark': '#8ca2ad', '--frame1': '#33434f', '--frame2': '#1d2831',
        '--crd-l': '#5d7280', '--crd-d': '#dee3e6',
        '--tip-bg': '#0a1017', '--tip-line': '#41617f', '--tip-text': '#e8f0f6',
        '--on-primary': '#0a1017',
        '--qbar-bg': '#0c141c', '--qbar-line': '#28384a',
        '--playback-bg': 'linear-gradient(180deg,#1d3346,#14222e)',
        '--playback-line': '#35566e', '--playback-text': '#cfe6f5',
        '--logo-grad': 'linear-gradient(145deg,#24384a,#101a24)',
        '--promo-bg': 'linear-gradient(180deg,#dee3e6,#b9c3c9)',
        '--promo-line': '#33434f', '--promo-ink': '#1d2831',
        '--arch-text': '#a6cbe8'
      }
    },
    {
      id: 'emerald', name: 'Изумруд', vars: {
        '--bg1': '#0f1a14', '--bg2': '#081009', '--glow1': '#1e3c2a', '--glow2': '#17351f',
        '--panel': '#14231a', '--panel2': '#1a2e21', '--panel3': '#101c14',
        '--panel-grad': 'linear-gradient(180deg,#14231a,#101a13)',
        '--drawer-bg': 'linear-gradient(180deg,#15241b,#0d150f)',
        '--win-bg': 'linear-gradient(180deg,#1a2e21,#14231a)', '--win-line': '#33523f',
        '--card-bg': '#0f1a12', '--card2-bg': '#16261b',
        '--line': '#284a33', '--line-hi': '#417f57',
        '--text': '#e8f6ec', '--text-soft': '#c4dec9', '--muted': '#95b59f', '--muted2': '#688a72',
        '--accent': '#7fe8a6', '--accent2': '#4fc47d', '--gold': '#e8d06a',
        '--btn-bg': 'linear-gradient(180deg,#203f2c,#182a1e)',
        '--btn-bg-hi': 'linear-gradient(180deg,#2a5238,#203f2c)',
        '--btn-primary': 'linear-gradient(180deg,#9cecc0,#4fc47d)',
        '--ctl-bg': '#16261b', '--ctl-bg-hi': '#203f2c', '--recess': '#101c14',
        '--sel-bg': 'linear-gradient(180deg,#316e4a,#27593c)',
        '--scroll-thumb': '#316e4a', '--scroll-thumb-hi': '#417f57', '--scroll-track': '#0a130d',
        '--light': '#eeeed2', '--dark': '#769656', '--frame1': '#2f3d24', '--frame2': '#1b2414',
        '--crd-l': '#5d7a44', '--crd-d': '#eeeed2',
        '--tip-bg': '#081009', '--tip-line': '#417f57', '--tip-text': '#e8f6ec',
        '--on-primary': '#081009',
        '--qbar-bg': '#0a130d', '--qbar-line': '#284a33',
        '--playback-bg': 'linear-gradient(180deg,#1c3a28,#13241a)',
        '--playback-line': '#356e4a', '--playback-text': '#cff5dc',
        '--logo-grad': 'linear-gradient(145deg,#204630,#101c14)',
        '--promo-bg': 'linear-gradient(180deg,#eeeed2,#c8c8ae)',
        '--promo-line': '#2f3d24', '--promo-ink': '#1b2414',
        '--arch-text': '#a6e8c0'
      }
    },
    {
      id: 'sepia', name: 'Сепия', vars: {
        '--bg1': '#1d1610', '--bg2': '#120d09', '--glow1': '#3a2c1a', '--glow2': '#33240f',
        '--panel': '#241b13', '--panel2': '#2e2318', '--panel3': '#1c150f',
        '--panel-grad': 'linear-gradient(180deg,#241b13,#1e1710)',
        '--drawer-bg': 'linear-gradient(180deg,#251c14,#171009)',
        '--win-bg': 'linear-gradient(180deg,#2e2318,#241b13)', '--win-line': '#524232',
        '--card-bg': '#1a130d', '--card2-bg': '#261d14',
        '--line': '#4a3c2c', '--line-hi': '#7f6a4a',
        '--text': '#f6eee2', '--text-soft': '#deccb0', '--muted': '#b5a184', '--muted2': '#8a7a62',
        '--accent': '#e8b96a', '--accent2': '#c4944a', '--gold': '#f2c14e',
        '--btn-bg': 'linear-gradient(180deg,#3f3222,#2a2116)',
        '--btn-bg-hi': 'linear-gradient(180deg,#52422c,#3f3222)',
        '--btn-primary': 'linear-gradient(180deg,#ecc88f,#c4944a)',
        '--ctl-bg': '#261d14', '--ctl-bg-hi': '#3f2f20', '--recess': '#1c150f',
        '--sel-bg': 'linear-gradient(180deg,#6e5531,#594427)',
        '--scroll-thumb': '#6e5531', '--scroll-thumb-hi': '#7f6a4a', '--scroll-track': '#140e09',
        '--light': '#f0d9b5', '--dark': '#b58863', '--frame1': '#4a3524', '--frame2': '#2a1d12',
        '--crd-l': '#8a6244', '--crd-d': '#f0d9b5',
        '--tip-bg': '#120d09', '--tip-line': '#7f6a4a', '--tip-text': '#f6eee2',
        '--on-primary': '#120d09',
        '--qbar-bg': '#140e09', '--qbar-line': '#4a3c2c',
        '--playback-bg': 'linear-gradient(180deg,#3a2f1d,#241d12)',
        '--playback-line': '#6e5c35', '--playback-text': '#f0e6cf',
        '--logo-grad': 'linear-gradient(145deg,#4a3a24,#1c150f)',
        '--promo-bg': 'linear-gradient(180deg,#f0d9b5,#d9bd93)',
        '--promo-line': '#4a3524', '--promo-ink': '#2a1d12',
        '--arch-text': '#e0c79a'
      }
    },
    {
      id: 'violet', name: 'Виолет', vars: {
        '--bg1': '#151024', '--bg2': '#0d0a17', '--glow1': '#2e2350', '--glow2': '#261a44',
        '--panel': '#1d1730', '--panel2': '#272040', '--panel3': '#181228',
        '--panel-grad': 'linear-gradient(180deg,#1d1730,#171126)',
        '--drawer-bg': 'linear-gradient(180deg,#1e1832,#120d1e)',
        '--win-bg': 'linear-gradient(180deg,#272040,#1d1730)', '--win-line': '#443a6e',
        '--card-bg': '#150f24', '--card2-bg': '#201938',
        '--line': '#332b55', '--line-hi': '#584a8c',
        '--text': '#ece8fa', '--text-soft': '#cdc4e8', '--muted': '#a298c4', '--muted2': '#776c9c',
        '--accent': '#b79cff', '--accent2': '#8f6ff0', '--gold': '#f2c14e',
        '--btn-bg': 'linear-gradient(180deg,#2b2450,#201a3c)',
        '--btn-bg-hi': 'linear-gradient(180deg,#38305f,#2b2450)',
        '--btn-primary': 'linear-gradient(180deg,#c4a8ff,#8f6ff0)',
        '--ctl-bg': '#201938', '--ctl-bg-hi': '#2c2450', '--recess': '#181228',
        '--sel-bg': 'linear-gradient(180deg,#4d3a85,#3c2d6b)',
        '--scroll-thumb': '#4d3a85', '--scroll-thumb-hi': '#584a8c', '--scroll-track': '#100b1c',
        '--light': '#e3dcf5', '--dark': '#8d7bb8', '--frame1': '#35294d', '--frame2': '#201830',
        '--crd-l': '#6f5f96', '--crd-d': '#e3dcf5',
        '--tip-bg': '#0d0a17', '--tip-line': '#584a8c', '--tip-text': '#ece8fa',
        '--on-primary': '#0d0a17',
        '--qbar-bg': '#100b1c', '--qbar-line': '#332b55',
        '--playback-bg': 'linear-gradient(180deg,#2a2140,#1d1730)',
        '--playback-line': '#4b3d75', '--playback-text': '#dccfff',
        '--logo-grad': 'linear-gradient(145deg,#3a2f63,#181228)',
        '--promo-bg': 'linear-gradient(180deg,#e3dcf5,#c2b8dd)',
        '--promo-line': '#35294d', '--promo-ink': '#201830',
        '--arch-text': '#c0aef5'
      }
    },
    {
      id: 'crimson', name: 'Багрянец', vars: {
        '--bg1': '#1c1014', '--bg2': '#120a0d', '--glow1': '#4a1d28', '--glow2': '#3d1420',
        '--panel': '#251419', '--panel2': '#311b22', '--panel3': '#1f1014',
        '--panel-grad': 'linear-gradient(180deg,#251419,#1e1014)',
        '--drawer-bg': 'linear-gradient(180deg,#26151a,#170d10)',
        '--win-bg': 'linear-gradient(180deg,#311b22,#251419)', '--win-line': '#5c3340',
        '--card-bg': '#1c0f13', '--card2-bg': '#291519',
        '--line': '#4a2c33', '--line-hi': '#8c4a56',
        '--text': '#fae8ec', '--text-soft': '#e8c4cc', '--muted': '#b598a0', '--muted2': '#8a6c74',
        '--accent': '#ff9d9d', '--accent2': '#f06b6b', '--gold': '#f2c14e',
        '--btn-bg': 'linear-gradient(180deg,#402028,#2e161c)',
        '--btn-bg-hi': 'linear-gradient(180deg,#542a34,#402028)',
        '--btn-primary': 'linear-gradient(180deg,#ffb0b0,#f06b6b)',
        '--ctl-bg': '#291519', '--ctl-bg-hi': '#402028', '--recess': '#1f1014',
        '--sel-bg': 'linear-gradient(180deg,#85313a,#6b2730)',
        '--scroll-thumb': '#85313a', '--scroll-thumb-hi': '#8c4a56', '--scroll-track': '#150c0f',
        '--light': '#efd7d2', '--dark': '#a35d5d', '--frame1': '#4d2424', '--frame2': '#2c1414',
        '--crd-l': '#7a4a44', '--crd-d': '#efd7d2',
        '--tip-bg': '#120a0d', '--tip-line': '#8c4a56', '--tip-text': '#fae8ec',
        '--on-primary': '#120a0d',
        '--qbar-bg': '#150c0f', '--qbar-line': '#4a2c33',
        '--playback-bg': 'linear-gradient(180deg,#40202a,#2a151c)',
        '--playback-line': '#75404d', '--playback-text': '#f5cfd6',
        '--logo-grad': 'linear-gradient(145deg,#5c2733,#1f1014)',
        '--promo-bg': 'linear-gradient(180deg,#efd7d2,#d3b4ae)',
        '--promo-line': '#4d2424', '--promo-ink': '#2c1414',
        '--arch-text': '#e8a6b4'
      }
    },
    {
      id: 'graphite', name: 'Графит', vars: {
        '--bg1': '#17181a', '--bg2': '#0e0f10', '--glow1': '#2a2c30', '--glow2': '#232529',
        '--panel': '#1e2023', '--panel2': '#26282c', '--panel3': '#191a1d',
        '--panel-grad': 'linear-gradient(180deg,#1e2023,#181a1c)',
        '--drawer-bg': 'linear-gradient(180deg,#1f2124,#121315)',
        '--win-bg': 'linear-gradient(180deg,#26282c,#1e2023)', '--win-line': '#43464c',
        '--card-bg': '#141517', '--card2-bg': '#212327',
        '--line': '#33363c', '--line-hi': '#5a5e68',
        '--text': '#eeeef0', '--text-soft': '#ccccce', '--muted': '#a4a6ac', '--muted2': '#7a7c84',
        '--accent': '#cfd3da', '--accent2': '#a7adb8', '--gold': '#d9c38a',
        '--btn-bg': 'linear-gradient(180deg,#2c2f34,#222428)',
        '--btn-bg-hi': 'linear-gradient(180deg,#3a3e44,#2c2f34)',
        '--btn-primary': 'linear-gradient(180deg,#e2e5ea,#a7adb8)',
        '--ctl-bg': '#212327', '--ctl-bg-hi': '#2e3136', '--recess': '#191a1d',
        '--sel-bg': 'linear-gradient(180deg,#4c5058,#3c4046)',
        '--scroll-thumb': '#4c5058', '--scroll-thumb-hi': '#5a5e68', '--scroll-track': '#101113',
        '--light': '#f2f2f2', '--dark': '#77787c', '--frame1': '#3a3c40', '--frame2': '#222426',
        '--crd-l': '#8a8a8e', '--crd-d': '#f2f2f2',
        '--tip-bg': '#0e0f10', '--tip-line': '#5a5e68', '--tip-text': '#eeeef0',
        '--on-primary': '#0e0f10',
        '--qbar-bg': '#101113', '--qbar-line': '#33363c',
        '--playback-bg': 'linear-gradient(180deg,#2c2f34,#1e2023)',
        '--playback-line': '#4c5058', '--playback-text': '#e2e5ea',
        '--logo-grad': 'linear-gradient(145deg,#3a3e45,#191a1d)',
        '--promo-bg': 'linear-gradient(180deg,#f2f2f2,#cdced0)',
        '--promo-line': '#3a3c40', '--promo-ink': '#222426',
        '--arch-text': '#c3c7ce'
      }
    }
  ];

  /* ======================= цветовые утилиты ======================= */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function r2(v) { return Math.round(v * 100) / 100; }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = l - c / 2;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    var d = max - min;
    if (d > 1e-9) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  function hexToRgb(hex) {
    hex = String(hex).trim().replace(/^#/, '');
    var m = /^([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex);
    if (!m) return null;
    var h = m[1];
    if (h.length === 3 || h.length === 4) {
      h = h.split('').map(function (c) { return c + c; }).join('');
    }
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? r2(parseInt(h.slice(6, 8), 16) / 255) : 1
    };
  }

  function rgbToHex(r, g, b) {
    function p(v) { var s = clamp(Math.round(v), 0, 255).toString(16); return s.length < 2 ? '0' + s : s; }
    return '#' + p(r) + p(g) + p(b);
  }

  /* разбор любого поддерживаемого цвета в {h,s,l,a}; null если не цвет */
  function parseColor(str) {
    if (typeof str !== 'string') return null;
    str = str.trim().toLowerCase();
    if (str.charAt(0) === '#') {
      var rgb = hexToRgb(str);
      if (!rgb) return null;
      var hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      return { h: hsl.h, s: hsl.s, l: hsl.l, a: rgb.a === undefined ? 1 : rgb.a };
    }
    var m = /^rgba?\(\s*([^)]+?)\s*\)$/.exec(str);
    if (m) {
      var body = m[1].replace(/\//g, ' ');
      var parts = body.split(/[\s,]+/).filter(function (x) { return x !== ''; });
      if (parts.length < 3) return null;
      var vals = parts.slice(0, 3).map(function (p, i) {
        var v = parseFloat(p);
        if (isNaN(v)) return null;
        if (p.indexOf('%') >= 0) v = i === 0 ? v * 255 / 100 : v * 255 / 100;
        return v;
      });
      if (vals.some(function (v) { return v === null; })) return null;
      var a = parts.length > 3 ? parseFloat(parts[3]) : 1;
      if (parts.length > 3 && parts[3].indexOf('%') >= 0) a = a / 100;
      if (isNaN(a)) a = 1;
      var h2 = rgbToHsl(clamp(vals[0], 0, 255), clamp(vals[1], 0, 255), clamp(vals[2], 0, 255));
      return { h: h2.h, s: h2.s, l: h2.l, a: clamp(r2(a), 0, 1) };
    }
    m = /^hsla?\(\s*([^)]+?)\s*\)$/.exec(str);
    if (m) {
      var b2 = m[1].replace(/\//g, ' ');
      var pp = b2.split(/[\s,]+/).filter(function (x) { return x !== ''; });
      if (pp.length < 3) return null;
      var h3 = parseFloat(pp[0]);
      var s3 = parseFloat(pp[1]);
      var l3 = parseFloat(pp[2]);
      if (isNaN(h3) || isNaN(s3) || isNaN(l3)) return null;
      var a3 = pp.length > 3 ? parseFloat(pp[3]) : 1;
      if (pp.length > 3 && pp[3].indexOf('%') >= 0) a3 = a3 / 100;
      if (isNaN(a3)) a3 = 1;
      return { h: Math.round(((h3 % 360) + 360) % 360), s: Math.round(clamp(s3, 0, 100)), l: Math.round(clamp(l3, 0, 100)), a: clamp(r2(a3), 0, 1) };
    }
    return null;
  }

  /* сборка CSS-значения из {h,s,l,a}: непрозрачное — в #hex, иначе rgba() */
  function fmtColor(c) {
    var rgb = hslToRgb(c.h, c.s, c.l);
    if (c.a === undefined || c.a >= 0.999) return rgbToHex(rgb.r, rgb.g, rgb.b);
    return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + r2(c.a) + ')';
  }

  /* разбивка строки по запятым верхнего уровня (скобки не учитываются как разделители) */
  function splitTop(str) {
    var out = [], depth = 0, cur = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; });
  }

  function isGradient(str) {
    return typeof str === 'string' && /^linear-gradient\(/i.test(str.trim());
  }

  /* разбор линейного градиента в {angle,c1,c2}; null если формат не наш */
  function parseGradient(str) {
    if (!isGradient(str)) return null;
    var m = /^linear-gradient\(\s*([\s\S]+)\s*\)$/i.exec(str.trim());
    if (!m) return null;
    var parts = splitTop(m[1]);
    if (parts.length !== 3) return null;
    var am = /^(-?[\d.]+)deg$/i.exec(parts[0]);
    if (!am) return null;
    var c1 = parseColor(parts[1]);
    var c2 = parseColor(parts[2]);
    if (!c1 || !c2) return null;
    return { angle: Math.round(parseFloat(am[1])), c1: c1, c2: c2 };
  }

  function fmtGradient(angle, c1, c2) {
    return 'linear-gradient(' + Math.round(((angle % 360) + 360) % 360) + 'deg,' + fmtColor(c1) + ',' + fmtColor(c2) + ')';
  }

  /* ---------- санитизация значений (защита от мусора из импорта) ---------- */
  function sanitize(v) {
    if (typeof v !== 'string' || v.length === 0 || v.length > 240) return false;
    if (!/^[-a-z0-9#%(),.\s]+$/i.test(v)) return false;
    if (/url|expression|javascript|;/i.test(v)) return false;
    return true;
  }
  function validValue(v) {
    if (!sanitize(v)) return false;
    return !!(parseColor(v) || parseGradient(v));
  }
  function validVar(k) { return Object.prototype.hasOwnProperty.call(DEFAULTS, k); }
  function validSquareKey(k) {
    var n = Number(k);
    return String(n) === String(k) && Number.isInteger(n) && n >= 0 && n <= 63;
  }

  /* ======================= сборка и применение CSS ======================= */
  function buildCss(vars, squares, adv) {
    vars = vars || {}; squares = squares || {};
    var out = [];
    var root = [];
    for (var k in vars) {
      if (!validVar(k)) continue;
      var v = vars[k];
      if (!validValue(v)) continue;
      if (v === DEFAULTS[k]) continue;             /* совпало с базой — не дублируем */
      root.push(k + ':' + v);
    }
    if (root.length) out.push(':root{' + root.join(';') + '}');
    if (adv) {
      for (var i = 0; i < 64; i++) {
        var sv = squares[String(i)];
        if (sv === undefined || !validValue(sv)) continue;
        out.push('#board .sq[data-sq="' + i + '"]{background:' + sv + '}');
      }
    }
    return out.join('\n');
  }

  var styleEl = null;
  function apply(vars, squares, adv) {
    if (!doc) return '';
    if (!styleEl || !doc.documentElement.contains(styleEl)) {
      styleEl = doc.getElementById('themeCss');
      if (!styleEl) {
        styleEl = doc.createElement('style');
        styleEl.id = 'themeCss';
        (doc.head || doc.documentElement).appendChild(styleEl);
      }
    }
    var css = buildCss(vars, squares, adv);
    styleEl.textContent = css;
    return css;
  }

  function effective(vars, key) {
    if (vars && typeof vars[key] === 'string' && validValue(vars[key])) return vars[key];
    return DEFAULTS[key];
  }

  /* цвет клетки без точечного переопределения: светлая/тёмная по шахматному порядку */
  function squareIsDark(sq) {
    var r = sq >> 3, f = sq & 7;
    return (r + f) % 2 === 0;
  }

  /* =============== КАРТА «ЭЛЕМЕНТ → ПЕРЕМЕННЫЕ» (режим дизайнера, 3.1) ===============
     Режим дизайнера обязан точно знать, какие переменные темы формируют вид
     конкретного элемента — иначе пользователь будет гадать, что именно он
     перекрашивает. Карту не пишем руками: она собирается из самого CSS
     приложения. Сканируются все <style>-блоки страницы, и для каждого правила
     запоминается, какие var(--…) в каком свойстве используются.
     Карта поэтому никогда не разъезжается со стилями: добавили переменную в
     style.css — она сразу становится доступна кликом в режиме дизайнера.

     Разбор идёт по тексту, а не через CSSOM: результат одинаков в браузере и
     в jsdom (тесты) и не зависит от того, знает ли парсер новые свойства
     (inset, gap, color-mix). Псевдоклассы (:hover, :focus) при сопоставлении
     отбрасываются — они лишь уточняют состояние того же элемента, а вот
     псевдоэлемент (::after) сохраняется: подсветки клеток живут именно там. */

  /* чем важнее свойство для восприятия элемента, тем выше кандидат в списке:
     фон кнопки пользователь хочет перекрасить раньше, чем её тень */
  var PROP_RANK = {
    'background': 0, 'background-image': 1, 'background-color': 2,
    'border': 3, 'border-color': 3, 'border-top': 3, 'border-bottom': 3,
    'border-left': 3, 'border-right': 3, 'border-top-color': 3, 'border-bottom-color': 3,
    'border-left-color': 3, 'border-right-color': 3,
    'box-shadow': 5, 'outline': 5, 'outline-color': 5,
    'color': 4, 'fill': 4, 'stroke': 4, 'scrollbar-color': 6, 'caret-color': 6
  };
  var PROP_LABEL = {
    'background': 'фон', 'background-image': 'фон', 'background-color': 'фон',
    'color': 'текст', 'fill': 'заливка', 'stroke': 'обводка',
    'box-shadow': 'тень', 'outline': 'обводка', 'outline-color': 'обводка',
    'filter': 'тень и фильтры', 'text-shadow': 'тень текста',
    'scrollbar-color': 'ползунок', 'caret-color': 'курсор'
  };
  function propRank(p) {
    if (Object.prototype.hasOwnProperty.call(PROP_RANK, p)) return PROP_RANK[p];
    if (/^border/.test(p)) return 3;
    if (/^background/.test(p)) return 1;
    if (p === 'filter' || p === 'text-shadow') return 6;
    return 7;
  }
  function propLabel(p, pseudo) {
    var base = Object.prototype.hasOwnProperty.call(PROP_LABEL, p) ? PROP_LABEL[p]
      : (/^border/.test(p) ? 'граница' : p);
    if (!pseudo) return base;
    if (/scrollbar-thumb/.test(pseudo)) return 'ползунок прокрутки';
    if (/scrollbar-track/.test(pseudo)) return 'дорожка прокрутки';
    if (/scrollbar/.test(pseudo)) return 'прокрутка';
    if (/^(before|after)$/.test(pseudo)) return base + ' · подложка';
    return base + ' · ' + pseudo;
  }

  function stripCssComments(css) {
    return String(css || '').replace(/\/\*[\s\S]*?\*\//g, ' ');
  }

  /* разбивка CSS-текста на правила {селектор, тело}; блоки @media/@supports
     раскрываются (их правила попадают в общий список), @keyframes пропускается */
  function scanRules(css) {
    var text = stripCssComments(css);
    var out = [], stack = [], buf = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === '{') {
        var sel = buf.trim();
        buf = '';
        var inSkip = stack.some(function (f) { return !!f.skip; });
        if (inSkip || /^@(keyframes|-webkit-keyframes|font-face|property)/i.test(sel)) {
          stack.push({ skip: 1 });                     /* содержимое не разбираем */
        } else if (sel.charAt(0) === '@') {
          stack.push({ at: 1 });                       /* @media/@supports: уровень вложенности */
        } else {
          stack.push({ sel: sel, start: i + 1 });
        }
        continue;
      }
      if (ch === '}') {
        var top = stack.pop();
        if (top && top.sel) out.push({ sel: top.sel, body: text.slice(top.start, i) });
        buf = '';
        continue;
      }
      buf += ch;
    }
    return out;
  }

  /* одна запись карты: переменная, где она используется и как её назвать */
  function splitSelector(sel) {
    var out = [];
    splitTop(sel).forEach(function (raw) {
      var s = String(raw).trim();
      if (!s || s.charAt(0) === '@') return;
      var pm = /::([a-zA-Z-]+)/.exec(s);
      var pseudo = pm ? pm[1] : null;
      /* убираем псевдоэлементы и псевдоклассы — остаётся «кто это» */
      var base = s.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '').replace(/\s+/g, ' ').trim();
      if (!base || base === 'root' || /%/.test(base) || /^(from|to)$/i.test(base)) return;
      out.push({ base: base, pseudo: pseudo });
    });
    return out;
  }

  var varIndex = null;
  function buildVarIndex(force) {
    if (varIndex && !force) return varIndex;
    varIndex = [];
    if (!doc || !doc.querySelectorAll) return varIndex;
    var styles = doc.querySelectorAll('style');
    var seen = {};
    for (var s = 0; s < styles.length; s++) {
      if (styles[s].id === 'themeCss') continue;      /* переопределения темы: там только :root */
      scanRules(styles[s].textContent).forEach(function (rule) {
        var sels = splitSelector(rule.sel);
        if (!sels.length) return;
        String(rule.body).split(';').forEach(function (decl) {
          var ci = decl.indexOf(':');
          if (ci < 1) return;
          var prop = decl.slice(0, ci).trim().toLowerCase();
          var val = decl.slice(ci + 1);
          if (!prop || prop.charAt(0) === '-') return;   /* объявления самих переменных не считаются */
          var re = /var\(\s*(--[a-z0-9-]+)\s*(?:,[^)]*)?\)/gi, m;
          while ((m = re.exec(val)) !== null) {
            var v = m[1];
            if (!Object.prototype.hasOwnProperty.call(DEFAULTS, v)) continue;
            sels.forEach(function (sl) {
              var key = sl.base + '|' + (sl.pseudo || '') + '|' + prop + '|' + v;
              if (seen[key]) return;
              seen[key] = 1;
              varIndex.push({
                base: sl.base, pseudo: sl.pseudo, prop: prop, v: v,
                rank: propRank(prop), label: propLabel(prop, sl.pseudo),
                item: BY_VAR[v] || null, order: Object.keys(DEFAULTS).indexOf(v)
              });
            });
          }
        });
      });
    }
    return varIndex;
  }
  function resetVarIndex() { varIndex = null; }

  function matches(el, sel) {
    if (!el || typeof el.matches !== 'function') return false;
    try { return el.matches(sel); } catch (e) { return false; }
  }

  /* переменные в инлайн-стиле элемента: их ставит сам app.js (метка «архив»
     в статусе партии, образцы цвета, мини-доска), поэтому в CSS-карте их нет */
  function inlineVars(el) {
    var out = [];
    var st = el && el.getAttribute ? el.getAttribute('style') : null;
    if (!st) return out;
    var re = /var\(\s*(--[a-z0-9-]+)\s*(?:,[^)]*)?\)/gi, m;
    while ((m = re.exec(st)) !== null) {
      var v = m[1];
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, v)) continue;
      var it = BY_VAR[v] || null;
      out.push({
        v: v, n: it ? it.n : v, label: 'инлайн-стиль', pseudo: null,
        group: it ? groupName(v) : '', rank: -1, order: -1, g: it ? !!it.g : false
      });
    }
    return out;
  }

  /**
   * Какие переменные темы формируют вид элемента.
   * Возвращает { el, vars:[{v,n,label,group,pseudo,rank,order}] } для ближайшего
   * предка (включая сам элемент), у которого нашлись соответствия; если ничего
   * не найдено за maxUp уровней — { el:null, vars:[] }.
   */
  function varsFor(el, maxUp) {
    var idx = buildVarIndex();
    var node = el, up = 0;
    maxUp = (maxUp === undefined) ? 6 : maxUp;
    while (node && node.nodeType === 1 && up <= maxUp) {
      var found = {}, list = [];
      inlineVars(node).forEach(function (iv) {
        if (found[iv.v]) return;
        found[iv.v] = 1;
        list.push(iv);
      });
      for (var i = 0; i < idx.length; i++) {
        var e = idx[i];
        if (found[e.v]) continue;
        if (!matches(node, e.base)) continue;
        found[e.v] = 1;
        list.push({
          v: e.v, n: e.item ? e.item.n : e.v, label: e.label, pseudo: e.pseudo,
          group: e.item ? groupName(e.item.v) : '', rank: e.rank, order: e.order,
          g: e.item ? !!e.item.g : false
        });
      }
      if (list.length) {
        list.sort(function (a, b) { return (a.rank - b.rank) || (a.order - b.order); });
        return { el: node, up: up, vars: list };
      }
      node = node.parentNode;
      up++;
    }
    return { el: null, up: -1, vars: [] };
  }

  var GROUP_OF = null;
  function groupName(v) {
    if (!GROUP_OF) {
      GROUP_OF = {};
      GROUPS.forEach(function (g) { g.items.forEach(function (it) { GROUP_OF[it.v] = g.name; }); });
    }
    return GROUP_OF[v] || '';
  }

  /* Селекторы, к которым применяется переменная: по ним приложение подсвечивает
     элементы при открытии пипетки — пользователь сразу видит, что именно красит.
     Псевдоэлементы (::after) отбрасываются: подсветить можно только сам элемент. */
  function selectorsFor(v) {
    var idx = buildVarIndex();
    var out = [], seen = {};
    for (var i = 0; i < idx.length; i++) {
      var e = idx[i];
      if (e.v !== v || seen[e.base]) continue;
      seen[e.base] = 1;
      out.push(e.base);
    }
    return out;
  }

  /* сколько переменных темы реально встречается в стилях (диагностика и тесты) */
  function indexStats() {
    var idx = buildVarIndex();
    var vars = {};
    idx.forEach(function (e) { vars[e.v] = 1; });
    return { rules: idx.length, vars: Object.keys(vars).length, total: Object.keys(DEFAULTS).length };
  }

  return {
    DEFAULTS: DEFAULTS, GROUPS: GROUPS, PRESETS: PRESETS, PALETTE: PALETTE, BY_VAR: BY_VAR,
    parseColor: parseColor, parseGradient: parseGradient, isGradient: isGradient,
    fmtColor: fmtColor, fmtGradient: fmtGradient,
    hslToRgb: hslToRgb, rgbToHsl: rgbToHsl, rgbToHex: rgbToHex, hexToRgb: hexToRgb,
    sanitize: sanitize, validValue: validValue, validVar: validVar, validSquareKey: validSquareKey,
    buildCss: buildCss, apply: apply, effective: effective, squareIsDark: squareIsDark,
    /* карта «элемент → переменные» для режима дизайнера (3.1) */
    varIndex: buildVarIndex, resetVarIndex: resetVarIndex, varsFor: varsFor, selectorsFor: selectorsFor,
    groupName: groupName, indexStats: indexStats, propLabel: propLabel
  };
});
