@echo off
rem Release 3.3: commit, push and tag for GitHub Actions.
rem This file is updated for every new version.
rem Keep commit and tag messages in English (ASCII only): cmd.exe mangles
rem non-ASCII text, so GitHub would show unreadable commit messages.
git add .
git commit -m "Release 3.3: arrow color menu on right-button hold (single color, alternation toggle, advanced mini panel beside the board), saved theme styles with names, 12 built-in piece sets plus user SVG set upload, bundled Rodent V in the installer (GPL, separate program), Tauri scaffold removed, new test suite uitest16 and tools/pack.js"
git push
git tag v3.3.0 && git push origin v3.3.0
