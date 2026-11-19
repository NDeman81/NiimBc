@echo off
chcp 65001 >nul
setlocal

set "EXE=C:\dev\NiimbotBcGo\niimbc.exe"
set "SERVER_URL=http://localhost:8765"

:: 1. Проверяем, запущен ли уже сервер; если нет — запускаем в фоне
tasklist /fi "imagename eq niimbc.exe" | find /i "niimbc.exe" >nul
if errorlevel 1 (
    echo Запускаю фоновый сервер NIIMBOT...
    start "" /b "%EXE%" gui --no-browser
    timeout /t 2 /nobreak >nul
)

:: 2. Отправляем штрихкод в очередь печати (принтер остаётся на связи в Keep-Alive)
curl.exe -s -X POST "%SERVER_URL%/api/print" ^
  -H "Content-Type: application/json; charset=utf-8" ^
  -d "{\"mode\":\"barcode\",\"bcFormat\":\"auto\",\"topText\":\"Инв. №\",\"bottomText\":\"Склад 1\",\"bold\":true,\"length\":50,\"items\":[\"109660401000099999\",\"109660401000088888\"]}"

echo.
echo Задание отправлено в очередь!
