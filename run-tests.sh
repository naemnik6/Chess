#!/usr/bin/env bash
# Прогон всех проверок. Для UI-тестов нужен jsdom: npm install jsdom
set -e
cd "$(dirname "$0")"
echo "== Сборка =="           && node build.js
echo "== Правила (perft) =="  && node test.js | tail -3
echo "== Perft 5 =="          && node deep.js | tail -1
echo "== Интерфейс 1/15 =="   && node uitest.js  | tail -2
echo "== Интерфейс 2/15 =="   && node uitest2.js | tail -2
echo "== Интерфейс 3/15 =="   && node uitest3.js | tail -2
echo "== Интерфейс 4/15 =="   && node uitest4.js | tail -2
echo "== Интерфейс 5/15 =="   && node uitest5.js | tail -2
echo "== Интерфейс 6/15 =="   && node uitest6.js | tail -2
echo "== Интерфейс 7/15 =="   && node uitest7.js | tail -2
echo "== Интерфейс 8/15 =="   && node uitest8.js | tail -2
echo "== Интерфейс 9/15 =="   && node uitest9.js | tail -2
echo "== Интерфейс 10/15 =="  && node uitest10.js | tail -2
echo "== Интерфейс 11/15 =="  && node uitest11.js | tail -2
echo "== Интерфейс 12/15 =="  && node uitest12.js | tail -2
echo "== Интерфейс 13/15 =="  && node uitest13.js | tail -2
echo "== Интерфейс 14/15 =="   && node uitest14.js | tail -2
echo "== Интерфейс 15/15 =="   && node uitest15.js | tail -2
echo "== Обёртка (смоук) =="    && node desktop/smoketest.js | tail -2
