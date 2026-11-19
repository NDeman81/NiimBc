@echo off
chcp 65001 >nul
setlocal

set "EXE=%~dp0niimbc.exe"
set "CODE=%~1"
set "TOP=%~2"
set "BOT=%~3"

if "%CODE%"=="" (
    echo Ошибка: не передан код для печати.
    echo Пример: print_label.bat "123498756000099999" "Инв. номер" "Склад 1"
    exit /b 1
)

"%EXE%" --log-level error --top-text "%TOP%" --bottom-text "%BOT%" --bold barcode "%CODE%"
if errorlevel 1 (
    echo Ошибка печати этикетки!
    exit /b %errorlevel%
)

echo Этикетка "%CODE%" успешно отправлена на печать.
exit /b 0
