#!/usr/bin/env bash
# Прогон всех проверок. Для UI-тестов нужен jsdom: npm install jsdom
set -e
cd "$(dirname "$0")"
echo "== Сборка =="           && node build.js
echo "== Правила (perft) =="  && node test.js | tail -3
echo "== Perft 5 =="          && node deep.js | tail -1
echo "== Интерфейс 1/13 =="   && node uitest.js  | tail -2
echo "== Интерфейс 2/13 =="   && node uitest2.js | tail -2
echo "== Интерфейс 3/13 =="   && node uitest3.js | tail -2
echo "== Интерфейс 4/13 =="   && node uitest4.js | tail -2
echo "== Интерфейс 5/13 =="   && node uitest5.js | tail -2
echo "== Интерфейс 6/13 =="   && node uitest6.js | tail -2
echo "== Интерфейс 7/13 =="   && node uitest7.js | tail -2
echo "== Интерфейс 8/13 =="   && node uitest8.js | tail -2
echo "== Интерфейс 9/13 =="   && node uitest9.js | tail -2
echo "== Интерфейс 10/13 =="  && node uitest10.js | tail -2
echo "== Интерфейс 11/13 =="  && node uitest11.js | tail -2
echo "== Интерфейс 12/13 =="  && node uitest12.js | tail -2
echo "== Интерфейс 13/13 =="  && node uitest13.js | tail -2
echo "== Обёртка (смоук) =="    && node desktop/smoketest.js | tail -2
