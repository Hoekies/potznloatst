@echo off
cd /d "%~dp0"
echo Pot z'n Loatst starten op http://localhost:8765 ...
start /b python -m http.server 8765
timeout /t 2 /nobreak >nul
start "" "http://localhost:8765"
echo Server draait. Sluit dit venster om te stoppen.
pause
