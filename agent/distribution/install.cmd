@echo off
setlocal
set "NODE_OPTIONS="
set "NODE_EXTRA_CA_CERTS="
set "EXTRA="
if exist "%~dp0site\site.json" (
  findstr /C:"bundled-ca" "%~dp0site\site.json" >nul
  if not errorlevel 1 if exist "%~dp0site\ca.pem" set "NODE_EXTRA_CA_CERTS=%~dp0site\ca.pem"
  set "EXTRA=--use-system-ca"
)
"%~dp0node\node.exe" %EXTRA% "%~dp0installer\install.mjs" %*
exit /b %errorlevel%
