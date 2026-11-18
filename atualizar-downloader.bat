@echo off
chcp 65001 >nul
cd /d "%~dp0backend"
echo Atualizando o yt-dlp (use quando links da Twitch/YouTube/Kick pararem de funcionar)...
uv sync --upgrade-package yt-dlp --upgrade-package yt-dlp-ejs
echo.
echo Pronto. Reinicie o Cortes Live.
pause
