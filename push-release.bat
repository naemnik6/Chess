@echo off
rem Публикация версии 2.3.0: коммит, пуш и тег для GitHub Actions.
rem Файл обновляется при каждом выпуске новой версии.
git add .
git commit -m "Обновление до версии 2.3.0"
git push
git tag v2.3.0 && git push origin v2.3.0
