# Test fixture only. Run elevated once; run agent tests as the ordinary user.
# No application control setting or product sandbox setup is changed.
param([Parameter(Mandatory=$true)][string]$FixtureRoot)
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($FixtureRoot)
$AllowedBase = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'sunmoon-probe-runs')) + '\'
if (-not $Root.StartsWith($AllowedBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture must be under the current user sunmoon-probe-runs directory' }
if (Test-Path -LiteralPath $Root) { throw 'Use a new fixture directory; existing files will not be overwritten' }
$Parent = Split-Path -Parent $Root
while ($Parent) {
    if (Test-Path -LiteralPath $Parent) {
        if ((Get-Item -LiteralPath $Parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Ancestor reparse point refused' }
    }
    $Next = Split-Path -Parent $Parent
    if ($Next -eq $Parent) { break }
    $Parent = $Next
}
$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdmin) { throw 'Creating native symbolic links requires an elevated PowerShell here; ordinary tests do not' }
$Allowed = Join-Path $Root 'allowed'
$Outside = Join-Path $Root 'outside'
New-Item -ItemType Directory -Path $Allowed, $Outside | Out-Null
$Secret = Join-Path $Outside 'secret.txt'
[IO.File]::WriteAllText($Secret, 'outside-control', (New-Object Text.UTF8Encoding($false)))
New-Item -ItemType SymbolicLink -Path (Join-Path $Allowed 'directory-link') -Target $Outside | Out-Null
New-Item -ItemType SymbolicLink -Path (Join-Path $Allowed 'file-link.txt') -Target $Secret | Out-Null
foreach ($Name in @('directory-link', 'file-link.txt')) {
    if ((Get-Item -LiteralPath (Join-Path $Allowed $Name) -Force).LinkType -ne 'SymbolicLink') { throw 'Native symbolic link was not created' }
}
[ordered]@{FixtureRoot=$Root; State='native symlink fixtures ready; run tests as ordinary user'} | ConvertTo-Json
