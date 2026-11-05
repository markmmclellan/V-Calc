@echo off
rem Runs V-Calc locally and opens it in your browser. Close this window to stop it.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies, first run only...
  call npm install || (pause & exit /b 1)
)
call npm run dev -- --open
pause
