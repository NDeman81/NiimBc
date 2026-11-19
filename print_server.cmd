@echo off
chcp 65001 >nul

set "SERVER_URL=http://localhost:8765"
:: 1. Запуск фонового веб-сервера без окна браузера
start "" /b "%~dp0niimbc.exe" gui --no-browser

:: Небольшая пауза 2 секунды на старт сервера
timeout /t 2 /nobreak >nul

:: 2. Отправка задания печати по сохранённому шаблону из Конструктора
curl.exe -s -X POST "%SERVER_URL%/api/print-template" ^
-H "Content-Type: application/json; charset=utf-8" ^
-d "{\"templateName\":\"Инвентарный штрихкод\",\"items\":[\"109660401000099999;Насос;Склад 1\"]}"
