SunMoonAI Windows agent — stage 3a candidate, not the final desktop installer

This directory includes official Node 24.19.0 and Codex 0.155.1 executables.
No separately installed Node/npm/pnpm/Python is required to run it.
The agent and its exec-server use the required Windows inner sandbox.
Node and Codex license/notice files are in licenses/; other library licenses
remain beside their packages in app/node_modules/.

Obtain this candidate only from the owner-approved delivery, and verify the
delivery checksum BEFORE executing anything. bundle-manifest.json checks file
integrity; an unsigned manifest is NOT proof of who published the package.
This package is unsigned. Do not disable Windows application control to run it.
If Windows blocks it, record the program name and policy and stop for review.

In PowerShell, from this directory:
  .\sunmoon-agent.cmd --version
  .\sunmoon-agent.cmd --help
  .\install.cmd --manifest-sha256 <SHA256 from the delivery record>
The last command is a preview only. Add --apply for first installation into
%LOCALAPPDATA%\Programs\sunmoon-agent. Existing installations are refused.
An interrupted installation is kept for inspection, never deleted silently.

Installation does not start the agent, create a logon task, request elevation,
change PATH, initialize an account or touch existing ~/.sunmoon-agent data.
After installation, use the installed sunmoon-agent.cmd for current CLI actions.
Get the init command/token from your own workbench, never from another user's
configuration or from a shared package. Do not send tokens in bug reports.

Tray, background lifecycle, optional logon task, optional elevated setup,
upgrade/uninstall, and clean-Windows owner acceptance are still pending.
Keep using the agreed stage-2 test workflow until those pieces are accepted.
