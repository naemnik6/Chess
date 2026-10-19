#!/usr/bin/env bash
# Прогон всех проверок. Для UI-тестов нужен jsdom: npm install jsdom
set -e
cd "$(dirname "$0")"
echo "== Сборка =="           && node build.js
echo "== Правила (perft) =="  && node test.js | tail -3
echo "== Perft 5 =="          && node deep.js | tail -1
echo "== Интерфейс 1/9 =="    && node uitest.js  | tail -2
echo "== Интерфейс 2/9 =="    && node uitest2.js | tail -2
echo "== Интерфейс 3/9 =="    && node uitest3.js | tail -2
echo "== Интерфейс 4/9 =="    && node uitest4.js | tail -2
echo "== Интерфейс 5/9 =="    && node uitest5.js | tail -2
echo "== Интерфейс 6/9 =="    && node uitest6.js | tail -2
echo "== Интерфейс 7/9 =="    && node uitest7.js | tail -2
echo "== Интерфейс 8/9 =="    && node uitest8.js | tail -2
echo "== Интерфейс 9/9 =="    && node uitest9.js | tail -2
