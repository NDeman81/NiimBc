@echo off
chcp 65001 >nul
setlocal

set "EXE=%~dp0niimbc.exe"
set "CFG=%~dp0config.json"

set "CODE=%~1"
set "TOP=%~2"
set "BOT=%~3"

if "%CODE%"=="" (
    echo [ОШИБКА] Не указан штрихкод.
    echo Пример: print_bc.bat "109660401000099999" "Инв. №" "Склад 1"
    exit /b 1
)

:: Запуск печати со всеми основными параметрами разметки
"%EXE%" ^
  --config "%CFG%" ^
  --log-level error ^
  --print-mode fast ^
  --on-demand ^
  --length 50 ^
  --height 14 ^
  --density 2 ^
  --bc-format auto ^
  --top-text "%TOP%" ^
  --bottom-text "%BOT%" ^
  --font-name "Arial" ^
  --font-size "35p" ^
  --bold ^
  --margin 4 ^
  --side-margin 8 ^
  --gap 4 ^
  --text-gap 4 ^
  --offset 0 ^
  barcode "%CODE%"

if errorlevel 1 (
    echo [СБОЙ] Принтер вернул ошибку при печати "%CODE%".
    exit /b %errorlevel%
)

echo [OK] Этикетка "%CODE%" напечатана.
exit /b 0
