#!/usr/bin/env bash
# Прогон всех проверок. Для UI-тестов нужен jsdom: npm install jsdom
set -e
cd "$(dirname "$0")"
echo "== Сборка =="           && node build.js
echo "== Правила (perft) =="  && node test.js | tail -3
echo "== Perft 5 =="          && node deep.js | tail -1
echo "== Интерфейс 1/10 =="    && node uitest.js  | tail -2
echo "== Интерфейс 2/10 =="    && node uitest2.js | tail -2
echo "== Интерфейс 3/10 =="    && node uitest3.js | tail -2
echo "== Интерфейс 4/10 =="    && node uitest4.js | tail -2
echo "== Интерфейс 5/10 =="    && node uitest5.js | tail -2
echo "== Интерфейс 6/10 =="    && node uitest6.js | tail -2
echo "== Интерфейс 7/10 =="    && node uitest7.js | tail -2
echo "== Интерфейс 8/10 =="    && node uitest8.js | tail -2
echo "== Интерфейс 9/10 =="   && node uitest9.js | tail -2
echo "== Интерфейс 10/10 =="  && node uitest10.js | tail -2
