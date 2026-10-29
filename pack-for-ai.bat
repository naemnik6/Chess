@echo off
rem Packs key project files into bundle.txt (ONE file to attach in chat).
rem Double-click this file, or run:  pack-for-ai.bat
rem Unpack on the other side:  node tools\pack.js --unpack bundle.txt folder
cd /d "%~dp0"
node tools\pack.js --all > bundle.txt
if errorlevel 1 (
  echo FAILED. Install Node.js first: https://nodejs.org
  pause
  exit /b 1
)
echo Done. Attach bundle.txt from the project root to the chat.
pause
