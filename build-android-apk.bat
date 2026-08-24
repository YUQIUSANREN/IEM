@echo off
cd /d "%~dp0"
rem Default: aarch64 only. For all ABIs: build-android-apk.bat -Universal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-android-apk.ps1" %*
if errorlevel 1 (
  echo.
  echo Build failed.
  pause
  exit /b 1
)
echo.
pause
