@echo off
rem Release 3.1: commit, push and tag for GitHub Actions.
rem This file is updated for every new version.
rem Keep commit and tag messages in English (ASCII only): cmd.exe mangles
rem non-ASCII text, so GitHub would show unreadable commit messages.
git add .
git commit -m "Release 3.1: designer mode (click any element to recolor it, left Shift for normal action, Esc to exit), app quit button, Rodent IV wiring (embedded worker, native exe, real UCI options)"
git push
git tag v3.1.0 && git push origin v3.1.0
