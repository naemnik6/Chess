#!/usr/bin/env node
/* pack.js — упаковка текстовых файлов проекта в ОДИН бандл (удобно пересылать
   в чат вместо десятка файлов) и распаковка обратно. В сборку игры не входит.

   Упаковать:  node tools/pack.js src/app.js src/theme.js > bundle.txt
               node tools/pack.js --all > bundle.txt      (список ключевых файлов)
   Распаковать: node tools/pack.js --unpack bundle.txt [папка]   (по умолчанию — текущая)

   Формат: перед каждым файлом строка-маркер ===CHESSTER-FILE: <путь>===,
   далее содержимое файла как есть (переводы строк сохраняются). */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const MARK = '===CHESSTER-FILE: ';

const DEFAULT_ALL = [
  'version.json', 'build.js', 'push-release.bat', 'run-tests.sh', 'README.md', '.gitignore',
  '.github/workflows/release.yml',
  'src/app.js', 'src/theme.js', 'src/store.js', 'src/engines.js', 'src/platform.js',
  'src/engine.js', 'src/bot.js', 'src/style.css', 'src/template.html', 'src/sw.template.js',
  'desktop/main.js', 'desktop/preload.js', 'desktop/package.json',
  'desktop/rodent4-worker.js', 'desktop/smoketest.js', 'desktop/README.md',
  'test.js', 'deep.js',
  'uitest.js', 'uitest2.js', 'uitest3.js', 'uitest4.js', 'uitest5.js', 'uitest6.js',
  'uitest7.js', 'uitest8.js', 'uitest9.js', 'uitest10.js', 'uitest11.js', 'uitest12.js',
  'uitest13.js', 'uitest14.js', 'uitest15.js', 'uitest16.js',
  'tools/pack.js', 'tools/ensure-engine-dir.js'
];

function pack(files) {
  let out = '';
  const missing = [];
  for (const rel of files) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { missing.push(rel); continue; }
    out += MARK + rel.replace(/\\/g, '/') + '===\n' + fs.readFileSync(p, 'utf8');
    if (!out.endsWith('\n')) out += '\n';
  }
  if (missing.length) console.error('Не найдены (пропущены): ' + missing.join(', '));
  process.stdout.write(out);
}

function unpack(bundlePath, outDir) {
  const text = fs.readFileSync(bundlePath, 'utf8');
  const parts = text.split(/\n?===CHESSTER-FILE: /);
  let n = 0;
  for (const part of parts) {
    if (!part.trim()) continue;
    const nl = part.indexOf('===\n');
    if (nl < 0) continue;
    const rel = part.slice(0, nl).trim();
    const body = part.slice(nl + 4);
    if (!rel || rel.split('/').includes('..') || /^[a-zA-Z]:/.test(rel)) continue;
    const dest = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body);
    n++;
  }
  console.error('Распаковано файлов: ' + n + ' → ' + path.resolve(outDir));
}

const args = process.argv.slice(2);
if (args[0] === '--unpack') {
  if (!args[1]) { console.error('Использование: node tools/pack.js --unpack bundle.txt [папка]'); process.exit(1); }
  unpack(args[1], args[2] || '.');
} else {
  pack(args[0] === '--all' || !args.length ? DEFAULT_ALL : args);
}
