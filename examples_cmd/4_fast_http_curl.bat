@echo off
chcp 65001 >nul
setlocal
set "EXE=%~dp0..\niimbc.exe"
set "SERVER_URL=http://localhost:8765"
tasklist /fi "imagename eq niimbc.exe" | find /i "niimbc.exe" >nul
if errorlevel 1 (
    start "" /b "%EXE%" gui --no-browser
    timeout /t 2 /nobreak >nul
)
curl.exe -s -X POST "%SERVER_URL%/api/print" -H "Content-Type: application/json; charset=utf-8" -d "{\"mode\":\"barcode\",\"bcFormat\":\"auto\",\"topText\":\"Инв. №\",\"bottomText\":\"Склад 1\",\"bold\":true,\"length\":50,\"items\":[\"123412301000099999\",\"123412301000088888\"]}"
echo.
