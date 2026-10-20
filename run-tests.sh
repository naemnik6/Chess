#!/usr/bin/env bash
# Прогон всех проверок. Для UI-тестов нужен jsdom: npm install jsdom
set -e
cd "$(dirname "$0")"
echo "== Сборка =="           && node build.js
echo "== Правила (perft) =="  && node test.js | tail -3
echo "== Perft 5 =="          && node deep.js | tail -1
echo "== Интерфейс 1/11 =="   && node uitest.js  | tail -2
echo "== Интерфейс 2/11 =="   && node uitest2.js | tail -2
echo "== Интерфейс 3/11 =="   && node uitest3.js | tail -2
echo "== Интерфейс 4/11 =="   && node uitest4.js | tail -2
echo "== Интерфейс 5/11 =="   && node uitest5.js | tail -2
echo "== Интерфейс 6/11 =="   && node uitest6.js | tail -2
echo "== Интерфейс 7/11 =="   && node uitest7.js | tail -2
echo "== Интерфейс 8/11 =="   && node uitest8.js | tail -2
echo "== Интерфейс 9/11 =="   && node uitest9.js | tail -2
echo "== Интерфейс 10/11 =="  && node uitest10.js | tail -2
echo "== Интерфейс 11/11 =="  && node uitest11.js | tail -2
echo "== Обёртка (смоук) =="    && node desktop/smoketest.js | tail -2
