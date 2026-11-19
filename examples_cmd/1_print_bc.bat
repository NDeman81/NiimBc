@echo off
chcp 65001 >nul
setlocal
set "EXE=%~dp0..\niimbc.exe"
if "%~1"=="" (
    echo Пример: 1_print_bc.bat "123412301000099999" "Инв. №" "Склад 1"
    exit /b 1
)
"%EXE%" --log-level error --on-demand --length 50 --bc-format auto --top-text "%~2" --bottom-text "%~3" --font-name "Arial" --font-size "35p" --bold barcode "%~1"
