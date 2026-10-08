@echo off
setlocal
if exist "%~dp0.install-incomplete" (
  echo Installation is incomplete. Agent was not started. 1>&2
  exit /b 1
)
"%~dp0node\node.exe" "%~dp0app\dist\cli.js" %*
exit /b %errorlevel%
