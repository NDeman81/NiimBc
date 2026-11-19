@echo off
chcp 65001 >nul

"C:\dev\NiimbotBcGo\niimbc.exe" ^
  --address "21:03:11:2F:39:1F" ^
  --length 50 ^
  --height 14 ^
  --density 2 ^
  --bc-format qrl ^
  --top-text "Сервер Dell R740" ^
  --bottom-text "Инв. 1096604010" ^
  --font-name "Arial" ^
  --font-size "42p" ^
  --bold ^
  --margin 4 ^
  --side-margin 6 ^
  --gap 8 ^
  --text-gap 4 ^
  barcode "INV-2026-000145"
