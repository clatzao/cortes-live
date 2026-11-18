@echo off
chcp 65001 >nul
cd /d "%~dp0backend"
echo Cortes Live rodando em http://127.0.0.1:8765
echo Para encerrar, feche esta janela.
echo.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 5; Start-Process 'http://127.0.0.1:8765'"
uv run uvicorn app.main:app --host 127.0.0.1 --port 8765
pause
