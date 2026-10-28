@echo off
setlocal
title Central Operacional - Atualizacao da Captura de Sites
cd /d "%~dp0"
echo ============================================================
echo CENTRAL OPERACIONAL - ATUALIZACAO DA CAPTURA DE SITES 0.5.1
echo ============================================================
echo.
echo Este atualizador preserva o token protegido ja instalado.
echo Ele encerra a versao anterior e mantem apenas uma instancia.
echo.
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERRO] Este arquivo precisa ser executado como Administrador.
  echo Clique com o botao direito em ATUALIZAR-CAPTURA-DE-SITES.cmd
  echo e selecione "Executar como administrador".
  echo.
  pause
  exit /b 5
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Atualizar-Captura-De-Sites.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo [ERRO] A atualizacao terminou com codigo %RC%.
  echo Consulte:
  echo C:\ProgramData\CentralOperacional\RealtimeHoursAgent\logs\domain-capture-update.log
)
echo.
pause
exit /b %RC%
