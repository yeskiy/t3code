<#
.SYNOPSIS
Starts the personal T3 Code fork beside the installed Nightly, with its own profile, home, port, and taskbar identity.
.PARAMETER Mode
packaged (default) starts the newest unpacked build. dev starts "vp run dev:desktop" from this clone.
.PARAMETER AppDir
Folder that holds the unpacked fork executable. Default: the newest E:\t3fork\release\*\win-unpacked.
.PARAMETER Port
Backend port for packaged mode. Default 3873. Port 3773 belongs to the Nightly and is refused.
.PARAMETER Hidden
Passes --fork-start-hidden to the app, for start with Windows.
#>
[CmdletBinding()]
param(
  [ValidateSet('packaged', 'dev')] [string] $Mode = 'packaged',
  [string] $AppDir,
  [ValidateRange(1024, 65535)] [int] $Port = 3873,
  [switch] $Hidden
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$isDev = $Mode -eq 'dev'
$userHome = [Environment]::GetFolderPath('UserProfile')
$forkHome = Join-Path $userHome $(if ($isDev) { '.t3-fork-dev' } else { '.t3-fork' })
$nightlyInstall = Join-Path $env:LOCALAPPDATA 'Programs\t3code'

if ($Port -eq 3773) { throw 'Port 3773 belongs to the Nightly. Use another port.' }
if ($forkHome -in @($userHome, (Join-Path $userHome '.t3'))) { throw "Refusing fork home $forkHome." }

# An agent shell from the Nightly carries the Nightly's T3, Vite, and Electron variables.
Get-ChildItem Env: |
  Where-Object { $_.Name -match '^(T3CODE_|T3_(?!FORK_)|VITE_|ELECTRON_RUN_AS_NODE$)' } |
  ForEach-Object { Remove-Item -LiteralPath "Env:$($_.Name)" }

$env:T3CODE_DESKTOP_USER_DATA_NAME = $(if ($isDev) { 't3code-fork-dev' } else { 't3code-fork' })
$env:T3CODE_DESKTOP_APP_USER_MODEL_ID = $(if ($isDev) { 'com.t3tools.t3code.fork.dev' } else { 'com.t3tools.t3code.fork' })
$env:T3CODE_DISABLE_AUTO_UPDATE = '1'
$env:T3_FORK_LAUNCHER_PATH = $PSCommandPath

if ($isDev) {
  $env:T3CODE_DEV_SEED = '0'
  Push-Location -LiteralPath $repo
  try { & vp run dev:desktop --home-dir $forkHome --no-seed }
  finally { Pop-Location }
  return
}

if (-not $AppDir) {
  $AppDir = Get-ChildItem -LiteralPath 'E:\t3fork\release' -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName 'win-unpacked' } |
    Where-Object { Test-Path -LiteralPath $_ } |
    Sort-Object { (Get-Item -LiteralPath $_).LastWriteTime } -Descending |
    Select-Object -First 1
}
if (-not $AppDir -or -not (Test-Path -LiteralPath $AppDir)) { throw 'No unpacked fork build found. Build one first (Wave 0 Task 5).' }
$AppDir = (Resolve-Path -LiteralPath $AppDir).Path
if ($AppDir -like "$nightlyInstall*") { throw "Refusing to start the Nightly install at $AppDir." }
$exe = Get-ChildItem -LiteralPath $AppDir -Filter '*.exe' -File |
  Where-Object { $_.Name -notmatch '^(Uninstall|elevate)' } |
  Select-Object -First 1
if (-not $exe) { throw "No executable in $AppDir." }

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) { throw "Port $Port is in use by PID $($listener.OwningProcess)." }

$env:T3CODE_HOME = $forkHome
$env:T3CODE_PORT = "$Port"
$arguments = @('--enable-lcd-text', '--disable-prefer-compositing-to-lcd-text')
if ($Hidden) { $arguments += '--fork-start-hidden' }
Start-Process -FilePath $exe.FullName -ArgumentList $arguments -WorkingDirectory $AppDir
