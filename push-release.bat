@echo off
rem Release 2.4: commit, push and tag for GitHub Actions.
rem This file is updated for every new version.
rem Keep commit and tag messages in English (ASCII only): cmd.exe mangles
rem non-ASCII text, so GitHub would show unreadable commit messages.
git add .
git commit -m "Release 2.4: settings window with categories, unified tooltips, offload reminder toggle"
git push
git tag v2.4.0 && git push origin v2.4.0
