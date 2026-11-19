@echo off
chcp 65001 >nul
setlocal
set "EXE=%~dp0..\niimbc.exe"
set "CODE=%~1"
if "%CODE%"=="" set "CODE=INV-2026-000145"
set "TOP=%~2"
if "%TOP%"=="" set "TOP=Сервер Dell R740"
set "BOT=%~3"
if "%BOT%"=="" set "BOT=Инв. 1096604010"
"%EXE%" --log-level error --on-demand --length 50 --bc-format qrl --top-text "%TOP%" --bottom-text "%BOT%" --font-name "Arial" --font-size "42p" --bold barcode "%CODE%"
