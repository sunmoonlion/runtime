SunMoonAI Windows agent — stage 3 candidate

Official Node 24.19.0 + Codex 0.155.1 + JavaScript. No separately installed
Node, npm, pnpm, Python or custom compiled executable is needed.
Licenses are included. Windows 10/11 x64, current user's interactive session.

Obtain the directory and manifest SHA256 through the owner-approved channel.
An unsigned manifest checks integrity, not publisher identity. Do not disable
application control or bypass PowerShell execution policy if blocked.

From the delivery directory, PowerShell:
  .\install.cmd --manifest-sha256 <delivery SHA256>
  .\install.cmd --manifest-sha256 <delivery SHA256> --apply
First command previews; second installs into
%LOCALAPPDATA%\Programs\sunmoon-agent. Existing targets are never overwritten.
Installation does not start, enable autostart, change PATH or elevate.

Use sunmoon-agent.cmd in the INSTALLED directory:
  init ...                 Paste your own workbench-issued init arguments.
                           Never share the token. Select specific project roots.
  start --background       One background agent; local approvals use a GUI.
  tray                     Status, start/stop, roots and permissions settings.
  tray stop                Close tray only; background stays running.
  status                   Running state, connectivity and refusal reason.
  stop                     Gracefully stop this agent and its executor tree.
  autostart enable          Current-user logon task, Limited privileges.
  autostart disable         Remove this configuration's matching task.
  autostart status          Inspect task without changes.
  sandbox-setup --elevated  Optional UAC after init, while stopped. Same user only.
                           Skip it to use the unelevated sandbox.
  mcp import               Foreground confirmation; no credentials imported.
                           HTTP runs locally and requires network ceiling on.

Settings take effect after stop/start. Local approval requires the displayed
fresh code and Allow button. Close, timeout or disconnect refuses. It cannot
remove sandboxing or add roots; a durable server audit receipt is also required.

Uninstall from the EXTERNAL delivery directory (keep it until uninstall):
  .\uninstall.cmd --manifest-sha256 <delivery SHA256>
  .\uninstall.cmd --manifest-sha256 <delivery SHA256> --apply
Removes matching task, closes tray, stops agent, removes verified program files.
Configuration/token and logs remain by default. Add --remove-config explicitly
only to delete the dedicated DEFAULT %USERPROFILE%\.sunmoon-agent and the five
owned rotating logs. Custom SUNMOON_AGENT_HOME deletion is refused. Unknown or
modified installed files stop removal. For a different installed version add
--installed-manifest-sha256 with that version's trusted delivery checksum.
Manual upgrade: uninstall preserving config, install the verified new package,
start and re-enable autostart if desired. Automatic update is out of scope.
Your separate %USERPROFILE%\.codex is untouched.

Candidate for owner/Fable review. Clean Windows 10/11, actual reboot, optional
UAC setup and live GUI approval are separate acceptance items. Local tests alone
do not mean full production acceptance.
