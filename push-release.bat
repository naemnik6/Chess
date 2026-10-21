@echo off
rem Release 3.0: commit, push and tag for GitHub Actions.
rem This file is updated for every new version.
rem Keep commit and tag messages in English (ASCII only): cmd.exe mangles
rem non-ASCII text, so GitHub would show unreadable commit messages.
git add .
git commit -m "Release 3.0: color theme designer (72 elements, HSL picker, gradients, presets, per-square paint), buildable Tauri scaffold"
git push
git tag v3.0.0 && git push origin v3.0.0
