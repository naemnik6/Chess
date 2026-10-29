/* 3.3: создаёт папку engine/rodent, если её нет — electron-builder (extraResources)
   требует существования каталога. В CI папку наполняет настоящим движком шаг
   «Скачать Rodent V» в release.yml; для локальной сборки хватает пустой папки:
   приложение полностью работоспособно без предустановленного движка. */
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'engine', 'rodent');
fs.mkdirSync(dir, { recursive: true });
const note = path.join(dir, 'PUT-ENGINE-HERE.txt');
if (!fs.existsSync(note)) {
  fs.writeFileSync(note,
    'Положите сюда файлы Rodent V 1.2 (rodent_v_1.2.exe + папки personalities/, nets/,\n' +
    'books/ + LICENSE-GPL.txt) — тогда локальный установщик соберётся с движком.\n' +
    'Пустая папка тоже годится: приложение работает без предустановленного движка.\n' +
    'В CI (release.yml) папка наполняется автоматически.\n');
}
console.log('engine/rodent готов:', dir);
