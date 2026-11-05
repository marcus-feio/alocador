@echo off
rem Abre o Alocador neste computador. So serve os arquivos da pasta static (nao ha backend).
rem Precisa do Python 3: https://www.python.org/downloads/
cd /d "%~dp0static"
title Alocador
set "PORTA=8000"
where py >nul 2>nul
if %errorlevel%==0 (set "PY=py -3") else (set "PY=python")
echo.
echo   Alocador em http://localhost:%PORTA%
echo   Para parar, feche esta janela.
echo.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:%PORTA%"
%PY% -m http.server %PORTA% --bind 127.0.0.1
if errorlevel 1 (
  echo.
  echo Nao consegui iniciar. Confira se o Python 3 esta instalado ou se a porta %PORTA% ja esta em uso.
  pause
)
