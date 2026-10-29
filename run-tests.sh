#!/usr/bin/env bash
# Прогон всех проверок. Для UI-тестов нужен jsdom: npm install jsdom
set -e
cd "$(dirname "$0")"
echo "== Сборка =="           && node build.js
echo "== Правила (perft) =="  && node test.js | tail -3
echo "== Perft 5 =="          && node deep.js | tail -1
echo "== Интерфейс 1/16 =="   && node uitest.js  | tail -2
echo "== Интерфейс 2/16 =="   && node uitest2.js | tail -2
echo "== Интерфейс 3/16 =="   && node uitest3.js | tail -2
echo "== Интерфейс 4/16 =="   && node uitest4.js | tail -2
echo "== Интерфейс 5/16 =="   && node uitest5.js | tail -2
echo "== Интерфейс 6/16 =="   && node uitest6.js | tail -2
echo "== Интерфейс 7/16 =="   && node uitest7.js | tail -2
echo "== Интерфейс 8/16 =="   && node uitest8.js | tail -2
echo "== Интерфейс 9/16 =="   && node uitest9.js | tail -2
echo "== Интерфейс 10/16 =="  && node uitest10.js | tail -2
echo "== Интерфейс 11/16 =="  && node uitest11.js | tail -2
echo "== Интерфейс 12/16 =="  && node uitest12.js | tail -2
echo "== Интерфейс 13/16 =="  && node uitest13.js | tail -2
echo "== Интерфейс 14/16 =="   && node uitest14.js | tail -2
echo "== Интерфейс 15/16 =="   && node uitest15.js | tail -2
echo "== Интерфейс 16/16 =="   && node uitest16.js | tail -2
echo "== Обёртка (смоук) =="    && node desktop/smoketest.js | tail -2
