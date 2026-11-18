@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo ============================================
echo   Cortes Live - instalacao
echo ============================================
echo.

rem --- uv (gerencia o Python e as bibliotecas) ---
where uv >nul 2>nul
if errorlevel 1 (
  echo [1/4] Instalando o uv...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
  set "PATH=%USERPROFILE%\.local\bin;%PATH%"
) else (
  echo [1/4] uv ja instalado.
)
where uv >nul 2>nul
if errorlevel 1 (
  echo ERRO: o uv nao foi encontrado. Feche esta janela, abra de novo e rode o instalar.bat outra vez.
  pause
  exit /b 1
)

rem --- FFmpeg ---
where ffmpeg >nul 2>nul
if errorlevel 1 (
  if exist "ferramentas\ffmpeg\bin\ffmpeg.exe" (
    echo [2/4] FFmpeg embutido encontrado.
  ) else (
    echo [2/4] Instalando o FFmpeg pelo winget...
    winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
  )
) else (
  echo [2/4] FFmpeg ja instalado.
)

rem --- Deno (necessario para links do YouTube) ---
where deno >nul 2>nul
if errorlevel 1 (
  where node >nul 2>nul
  if errorlevel 1 (
    echo [3/4] Instalando o Deno pelo winget - necessario para baixar links do YouTube...
    winget install -e --id DenoLand.Deno --accept-source-agreements --accept-package-agreements
  ) else (
    echo [3/4] Node encontrado - sera usado para links do YouTube.
  )
) else (
  echo [3/4] Deno ja instalado.
)

rem --- Python + bibliotecas ---
echo [4/4] Instalando Python e bibliotecas (pode demorar na primeira vez)...
pushd backend
set "EXTRA="
where nvidia-smi >nul 2>nul
if not errorlevel 1 set "EXTRA=--extra gpu"
if exist "%SystemRoot%\System32\nvidia-smi.exe" set "EXTRA=--extra gpu"
if defined EXTRA (
  echo Placa NVIDIA encontrada: instalando tambem as bibliotecas CUDA para a transcricao, cerca de 1,5 GB...
)
uv sync %EXTRA%
if errorlevel 1 (
  popd
  echo ERRO ao instalar as bibliotecas.
  pause
  exit /b 1
)
popd

if not exist "frontend\dist\index.html" (
  echo AVISO: a pasta frontend\dist nao existe. Copie o projeto completo, com a pasta dist ja gerada.
)

echo.
echo Instalacao concluida! Se o FFmpeg ou o Deno acabaram de ser instalados,
echo feche esta janela antes de abrir o iniciar.bat.
pause
