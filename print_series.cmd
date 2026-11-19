@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "EXE=%~dp0niimbc.exe"
set "CSV=%~dp0labels.csv"

if not exist "%CSV%" (
    echo Файл %CSV% не найден!
    exit /b 1
)

for /f "usebackq tokens=1,2,3 delims=;" %%A in ("%CSV%") do (
    echo Печатаю: %%A [%%B / %%C]...
    "%EXE%" --log-level error --top-text "%%B" --bottom-text "%%C" --bold barcode "%%A"
    if errorlevel 1 (
        echo Сбой печати на коде %%A. Остановка серии.
        exit /b 1
    )
)

echo Вся серия успешно напечатана!
pause
