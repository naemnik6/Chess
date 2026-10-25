@echo off
rem Release 3.2: commit, push and tag for GitHub Actions.
rem This file is updated for every new version.
rem Keep commit and tag messages in English (ASCII only): cmd.exe mangles
rem non-ASCII text, so GitHub would show unreadable commit messages.
git add .
git commit -m "Release 3.2: themeable piece and arrow colors (81 theme items), right-button hold on a square opens mark color picker, HEX field width fix, Rodent V verified (id name/author, real UCI options), engine card renamed Rodent IV / V"
git push
git tag v3.2.0 && git push origin v3.2.0
