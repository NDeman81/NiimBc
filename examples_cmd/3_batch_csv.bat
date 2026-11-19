@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
set "EXE=%~dp0..\niimbc.exe"
set "CSV=%~dp0sample_codes.csv"
set "OUT=%~dp0check_png"
if not exist "%OUT%" mkdir "%OUT%"
for /f "usebackq skip=1 tokens=1,2,3 delims=;" %%A in ("%CSV%") do (
    "%EXE%" --log-level error --save-dir "%OUT%" --auto-name --top-text "%%B" --bottom-text "%%C" --bold --bc preview "%%A"
    "%EXE%" --log-level error --on-demand --top-text "%%B" --bottom-text "%%C" --bold barcode "%%A"
    if errorlevel 1 exit /b 1
)
echo Серия из CSV выполнена!
