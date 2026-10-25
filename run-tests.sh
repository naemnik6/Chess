#!/usr/bin/env bash
# Прогон всех проверок. Для UI-тестов нужен jsdom: npm install jsdom
set -e
cd "$(dirname "$0")"
echo "== Сборка =="           && node build.js
echo "== Правила (perft) =="  && node test.js | tail -3
echo "== Perft 5 =="          && node deep.js | tail -1
echo "== Интерфейс 1/14 =="   && node uitest.js  | tail -2
echo "== Интерфейс 2/14 =="   && node uitest2.js | tail -2
echo "== Интерфейс 3/14 =="   && node uitest3.js | tail -2
echo "== Интерфейс 4/14 =="   && node uitest4.js | tail -2
echo "== Интерфейс 5/14 =="   && node uitest5.js | tail -2
echo "== Интерфейс 6/14 =="   && node uitest6.js | tail -2
echo "== Интерфейс 7/14 =="   && node uitest7.js | tail -2
echo "== Интерфейс 8/14 =="   && node uitest8.js | tail -2
echo "== Интерфейс 9/14 =="   && node uitest9.js | tail -2
echo "== Интерфейс 10/14 =="  && node uitest10.js | tail -2
echo "== Интерфейс 11/14 =="  && node uitest11.js | tail -2
echo "== Интерфейс 12/14 =="  && node uitest12.js | tail -2
echo "== Интерфейс 13/14 =="  && node uitest13.js | tail -2
echo "== Интерфейс 14/14 =="   && node uitest14.js | tail -2
echo "== Обёртка (смоук) =="    && node desktop/smoketest.js | tail -2
