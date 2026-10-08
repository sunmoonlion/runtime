@echo off
setlocal
"%~dp0node\node.exe" "%~dp0installer\uninstall.mjs" %*
exit /b %errorlevel%
