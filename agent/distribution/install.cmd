@echo off
setlocal
"%~dp0node\node.exe" "%~dp0installer\install.mjs" %*
exit /b %errorlevel%
