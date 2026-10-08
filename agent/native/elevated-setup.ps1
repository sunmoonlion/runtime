param([Parameter(Mandatory=$true)][string]$Codex,[Parameter(Mandatory=$true)][string]$CodexHome,[Parameter(Mandatory=$true)][string]$ExpectedSid)
$ErrorActionPreference='Stop'
$Identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if($Identity.User.Value -ne $ExpectedSid){throw 'Use elevation for the same Windows user; a different administrator account is refused'}
if(-not ([Security.Principal.WindowsPrincipal]$Identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Elevation is required for this optional setup'}
foreach($Value in @($Codex,$CodexHome)){if($Value -notmatch '^[A-Za-z]:\\' -or $Value -match '["\r\n]'){throw 'Unsupported setup path'}}
if(-not (Test-Path -LiteralPath $Codex -PathType Leaf) -or -not (Test-Path -LiteralPath $CodexHome -PathType Container)){throw 'Setup inputs unavailable'}
$env:CODEX_HOME=$CodexHome
& $Codex sandbox setup --elevated --current-user
exit $LASTEXITCODE
