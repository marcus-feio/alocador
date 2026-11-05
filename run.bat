@echo off
setlocal
cd /d "%~dp0"
title Alocador

rem O ambiente virtual fica fora do OneDrive para nao sincronizar milhares de arquivos.
set "VENV=%LOCALAPPDATA%\Alocador\venv"

where py >nul 2>nul
if %errorlevel%==0 (set "PY=py -3") else (set "PY=python")

if not exist "%VENV%\Scripts\python.exe" (
  echo Criando ambiente virtual em %VENV% ...
  %PY% -m venv "%VENV%"
  if errorlevel 1 goto erro
)

echo Conferindo dependencias...
"%VENV%\Scripts\python.exe" -m pip install -q --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto erro

if not exist ".env" copy ".env.example" ".env" >nul

"%VENV%\Scripts\python.exe" -m app
goto fim

:erro
echo.
echo Algo deu errado. Confira se o Python 3.10 ou mais novo esta instalado:
echo https://www.python.org/downloads/
pause

:fim
endlocal
