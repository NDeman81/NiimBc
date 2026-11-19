@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "EXE=C:\dev\NiimbotBcGo\niimbc.exe"
set "CSV=C:\dev\NiimbotBcGo\codes.csv"
set "OUT_DIR=C:\dev\NiimbotBcGo\check_png"

if not exist "%CSV%" (
    echo Файл %CSV% не найден!
    exit /b 1
)

if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

set /a COUNT=0
for /f "usebackq skip=1 tokens=1,2,3 delims=;" %%A in ("%CSV%") do (
    set /a COUNT+=1
    echo [!COUNT!] Печатаю код: %%A ^| %%B ^| %%C

    :: 1. Сохраняем проверочный PNG с автоименем (без расхода ленты)
    "%EXE%" --log-level error --save-dir "%OUT_DIR%" --auto-name --top-text "%%B" --bottom-text "%%C" --bold --bc preview "%%A"

    :: 2. Отправляем на реальную печать
    "%EXE%" --log-level error --top-text "%%B" --bottom-text "%%C" --bold barcode "%%A"
    if errorlevel 1 (
        echo [ОСТАНОВКА] Ошибка печати на строке !COUNT! (код: %%A).
        pause
        exit /b 1
    )
)

echo.
echo Готово! Напечатано этикеток: %COUNT%.
pause
