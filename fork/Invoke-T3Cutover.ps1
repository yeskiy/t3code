<#
.SYNOPSIS
Downloads the latest T3 Code fork release, closes T3 Code Nightly, installs the fork in place, and starts it.

.DESCRIPTION
Runs the Wave 4 cutover workflow from a normal PowerShell window that T3 Code did not start:
1. Refuses to run inside T3 Code or an inherited T3CODE_* shell.
2. Downloads latest.yml and the fork installer from https://github.com/yeskiy/t3code/releases/latest/download (or uses -Installer), verifies the version is *-fork.* and newer than the installed DisplayVersion by semver core, and verifies SHA-512.
3. Inspects live state, prints the plan, and asks once to type CUTOVER before changing anything.
4. Checks for T3 scheduled tasks that could start T3 Code or hold files during cutover.
5. Gracefully closes the Nightly main window(s) and waits up to 90 s for processes under the install dir and port 3773 to clear.
6. Only with -Backup: checks 2x free space and backs up %APPDATA%\t3code-v2, ~/.t3, %LOCALAPPDATA%\Programs\t3code, shortcuts, and registry keys with file/byte count verification and manifest.json.
7. Installs the fork silently (/S) and verifies the uninstall key DisplayVersion and resources\app-update.yml.
8. Audits and applies required fork user environment variables (Task 4).
9. Starts T3 Code (Beta).exe and waits up to 120 s for port 3773.
10. Prints a short summary and rollback instructions.

.PARAMETER Installer
Optional path to a local fork NSIS installer executable. When omitted, downloads the latest release from GitHub into %TEMP%\t3-cutover\<version>\.

.PARAMETER LatestYmlPath
Optional path to a local latest.yml (only valid together with -Installer). Defaults to latest.yml next to -Installer.

.PARAMETER Backup
Opt-in switch to create a full verified backup (robocopy, shortcuts, registry exports, and manifest.json) before installing. Disabled by default.

.PARAMETER BackupRoot
Backup destination directory when -Backup is set. Defaults to E:\t3fork\backup\<yyyyMMdd-HHmmss>.

.PARAMETER SkipWorktrees
Sub-option for -Backup. Excludes ~/.t3/worktrees from the ~/.t3 backup (recommended if worktrees exceed 20 GiB).

.PARAMETER DryRun
Print every planned action, running processes, and flag audit without stopping processes or changing installed files or settings. Downloads into %TEMP%\t3-cutover\<version>\ when -Installer is omitted.

.PARAMETER Force
Opt-in switch that allows prompting to force-stop exact remaining PIDs under the install directory if graceful close times out after 90 s. Never skips the CUTOVER confirmation.

.PARAMETER AllowInT3DryRun
Only valid together with -DryRun. Allows printing the read-only dry-run plan from a shell started by T3 Code while noting that the live guard would refuse.

.PARAMETER InstallDir
Desktop app install directory. Defaults to %LOCALAPPDATA%\Programs\t3code.

.PARAMETER ProfileName
Electron userData profile folder under %APPDATA%. Defaults to t3code-v2.

.PARAMETER T3Home
T3 home directory. Defaults to ~/.t3.

.PARAMETER Port
Backend port to verify after shutdown and startup. Defaults to 3773.

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File E:\Projects\Opened\t3code\fork\Invoke-T3Cutover.ps1

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File E:\Projects\Opened\t3code\fork\Invoke-T3Cutover.ps1 -DryRun

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File E:\Projects\Opened\t3code\fork\Invoke-T3Cutover.ps1 -Backup -SkipWorktrees
#>
[CmdletBinding()]
param(
  [string] $Installer,
  [string] $LatestYmlPath,
  [switch] $Backup,
  [string] $BackupRoot,
  [switch] $SkipWorktrees,
  [switch] $DryRun,
  [switch] $Force,
  [switch] $AllowInT3DryRun,
  [string] $InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\t3code'),
  [string] $ProfileName = 't3code-v2',
  [string] $T3Home = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.t3'),
  [ValidateRange(1024, 65535)] [int] $Port = 3773
)

$ErrorActionPreference = 'Stop'

if ($AllowInT3DryRun -and -not $DryRun) {
  throw '-AllowInT3DryRun can only be used together with -DryRun.'
}
if (-not [string]::IsNullOrWhiteSpace($LatestYmlPath) -and [string]::IsNullOrWhiteSpace($Installer)) {
  throw '-LatestYmlPath can only be used together with -Installer.'
}

$AppId = 'com.t3tools.t3code'
$UninstallGuid = 'e9197887-efb3-55e0-985e-d6d3b5dd594a'
$UninstallRegPath = "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\$UninstallGuid"
$UninstallPsPath = "Registry::$UninstallRegPath"
$InstallRegPath = "HKCU\Software\$UninstallGuid"
$ProtocolRegPath = 'HKCU\Software\Classes\t3code'
$ReleaseDownloadBaseUrl = 'https://github.com/yeskiy/t3code/releases/latest/download'
$NightlyReleasesUrl = 'https://github.com/pingdotgg/t3code/releases'
$AppDataProfileDir = Join-Path $env:APPDATA $ProfileName
$StartMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$TaskbarDir = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if ($Backup -and [string]::IsNullOrWhiteSpace($BackupRoot)) {
  $BackupRoot = Join-Path 'E:\t3fork\backup' $Timestamp
}

# Current fork/main features (tray, LCD text, web localStorage, MCP scope, stop scope) default on without user env vars.
$ForkKnownEnvFlags = @(
  [PSCustomObject]@{ Name = 'T3_FORK_CLOSE_TO_TRAY'; DefaultBehavior = 'on (fork-tray.json closeToTray: true; 0 disables)' }
  [PSCustomObject]@{ Name = 'T3_FORK_LCD_TEXT'; DefaultBehavior = 'on on Windows (0 disables)' }
)
$ForkRequiredUserEnvVars = [ordered]@{}

function Format-ByteSize {
  param([Parameter(Mandatory)] [long] $Bytes)
  $inv = [Globalization.CultureInfo]::InvariantCulture
  if ($Bytes -ge 1GB) { return [string]::Format($inv, '{0:N2} GiB', ($Bytes / 1GB)) }
  if ($Bytes -ge 1MB) { return [string]::Format($inv, '{0:N1} MiB', ($Bytes / 1MB)) }
  if ($Bytes -ge 1KB) { return [string]::Format($inv, '{0:N1} KiB', ($Bytes / 1KB)) }
  return "$Bytes B"
}

function Normalize-DirectoryPrefix {
  param([Parameter(Mandatory)] [string] $Directory)
  $full = [IO.Path]::GetFullPath($Directory).TrimEnd('\', '/')
  return "$full\"
}

function Test-PathUnderDirectory {
  param(
    [string] $CandidatePath,
    [Parameter(Mandatory)] [string] $Directory
  )
  if ([string]::IsNullOrWhiteSpace($CandidatePath)) { return $false }
  $prefix = Normalize-DirectoryPrefix -Directory $Directory
  $fullCandidate = [IO.Path]::GetFullPath($CandidatePath)
  return $fullCandidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or
    $fullCandidate.Equals($prefix.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
}

function Get-FileSha512Base64 {
  param([Parameter(Mandatory)] [string] $FilePath)
  $sha = [Security.Cryptography.SHA512]::Create()
  $stream = [IO.File]::OpenRead($FilePath)
  try {
    return [Convert]::ToBase64String($sha.ComputeHash($stream))
  } finally {
    $stream.Dispose()
    $sha.Dispose()
  }
}

function Get-DirectoryStats {
  param(
    [Parameter(Mandatory)] [string] $Path,
    [switch] $SkipJunctions,
    [string[]] $ExcludeDirs = @()
  )
  if (-not (Test-Path -LiteralPath $Path)) {
    return [PSCustomObject]@{ Exists = $false; FileCount = 0L; ByteCount = 0L; SkippedJunctions = 0L }
  }

  $normalizedExcludes = @($ExcludeDirs | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object {
    [IO.Path]::GetFullPath($_).TrimEnd('\', '/')
  })
  $fileCount = 0L
  $byteCount = 0L
  $skippedJunctions = 0L
  $stack = New-Object 'System.Collections.Generic.Stack[string]'
  $stack.Push([IO.Path]::GetFullPath($Path))

  while ($stack.Count -gt 0) {
    $current = $stack.Pop()
    try {
      $dirInfo = New-Object IO.DirectoryInfo($current)
      foreach ($file in $dirInfo.EnumerateFiles()) {
        $fileCount++
        $byteCount += $file.Length
      }
      foreach ($sub in $dirInfo.EnumerateDirectories()) {
        $subFull = $sub.FullName.TrimEnd('\', '/')
        $excluded = $false
        foreach ($ex in $normalizedExcludes) {
          if ($subFull.Equals($ex, [StringComparison]::OrdinalIgnoreCase)) {
            $excluded = $true
            break
          }
        }
        if ($excluded) { continue }
        if ($SkipJunctions -and (($sub.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
          $skippedJunctions++
          continue
        }
        $stack.Push($sub.FullName)
      }
    } catch {
      Write-Warning "Could not enumerate '$current': $($_.Exception.Message)"
    }
  }

  return [PSCustomObject]@{
    Exists           = $true
    FileCount        = $fileCount
    ByteCount        = $byteCount
    SkippedJunctions = $skippedJunctions
  }
}

function Get-InstallDirProcesses {
  param([Parameter(Mandatory)] [string] $TargetInstallDir)
  $all = Get-CimInstance -ClassName Win32_Process
  return @($all | Where-Object {
    $_.ExecutablePath -and (Test-PathUnderDirectory -CandidatePath $_.ExecutablePath -Directory $TargetInstallDir)
  } | Sort-Object ProcessId)
}

function Get-PortListeners {
  param([Parameter(Mandatory)] [int] $TargetPort)
  return @(Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue)
}

function Assert-NotRunningInsideT3Code {
  param(
    [Parameter(Mandatory)] [string] $TargetInstallDir,
    [switch] $IsDryRun,
    [switch] $AllowDryRunBypass
  )
  Write-Host '[Step 1/10] Checking shell origin (must not run inside T3 Code)...'
  $reasons = New-Object 'System.Collections.Generic.List[string]'

  $procMap = @{}
  foreach ($proc in (Get-CimInstance -ClassName Win32_Process)) {
    $procMap[[int]$proc.ProcessId] = $proc
  }

  $visited = New-Object 'System.Collections.Generic.HashSet[int]'
  $cursorPid = [int]$PID
  while ($cursorPid -gt 0 -and $visited.Add($cursorPid) -and $procMap.ContainsKey($cursorPid)) {
    $entry = $procMap[$cursorPid]
    if ($entry.ExecutablePath -and (Test-PathUnderDirectory -CandidatePath $entry.ExecutablePath -Directory $TargetInstallDir)) {
      $reasons.Add("Ancestor PID $($entry.ProcessId) ($($entry.Name)) runs from $TargetInstallDir")
    } elseif ($entry.Name -like 'T3 Code*.exe') {
      $reasons.Add("Ancestor PID $($entry.ProcessId) matches T3 Code*.exe ($($entry.Name))")
    }
    $cursorPid = [int]$entry.ParentProcessId
  }

  $t3CodeVars = @(Get-ChildItem Env: | Where-Object { $_.Name -match '^T3CODE_' } | Select-Object -ExpandProperty Name | Sort-Object)
  if ($t3CodeVars.Count -gt 0) {
    $reasons.Add("Inherited T3CODE_* environment variable(s): $($t3CodeVars -join ', ')")
  }

  if ($reasons.Count -gt 0) {
    $detail = $reasons -join '; '
    if ($IsDryRun -and $AllowDryRunBypass) {
      Write-Host "  [DRY RUN NOTE] Guard would refuse in a normal run: $detail" -ForegroundColor Yellow
      return
    }
    throw "Run this from a terminal that T3 Code did not start. ($detail)"
  }

  Write-Host '  OK: shell is outside T3 Code and has no T3CODE_* environment variables.'
}

function Get-InstalledDisplayVersion {
  if (-not (Test-Path -LiteralPath $UninstallPsPath)) {
    return $null
  }
  $props = Get-ItemProperty -LiteralPath $UninstallPsPath -ErrorAction SilentlyContinue
  if ($props -and ($props.PSObject.Properties.Name -contains 'DisplayVersion')) {
    return [string]$props.DisplayVersion
  }
  return $null
}

function Read-LatestYmlMetadata {
  param([Parameter(Mandatory)] [string] $YmlPath)
  $ymlLines = Get-Content -LiteralPath $YmlPath

  $version = $null
  $topSha512 = $null
  $topPath = $null
  $firstFileUrl = $null
  $firstFileSha512 = $null
  $inFiles = $false
  $seenFirstFile = $false
  $firstFileDone = $false

  foreach ($rawLine in $ymlLines) {
    $line = $rawLine.TrimEnd("`r", "`n")
    if ($line -match '^files:\s*$') {
      $inFiles = $true
      continue
    }
    if ($inFiles -and $line -match '^\S') {
      $inFiles = $false
    }

    if ($inFiles -and -not $firstFileDone) {
      if ($line -match '^\s*-\s+') {
        if ($seenFirstFile) {
          $firstFileDone = $true
          continue
        }
        $seenFirstFile = $true
      }
      if ($seenFirstFile) {
        if (-not $firstFileUrl -and $line -match '^\s*(?:-\s+)?url:\s*["'']?([^"'']+)["'']?\s*$') {
          $firstFileUrl = $Matches[1].Trim()
        }
        if (-not $firstFileSha512 -and $line -match '^\s*(?:-\s+)?sha512:\s*["'']?([^"'']+)["'']?\s*$') {
          $firstFileSha512 = $Matches[1].Trim()
        }
      }
      continue
    }

    if (-not $version -and $line -match '^version:\s*["'']?([^"'']+)["'']?\s*$') {
      $version = $Matches[1].Trim()
    }
    if (-not $topSha512 -and $line -match '^sha512:\s*["'']?([^"'']+)["'']?\s*$') {
      $topSha512 = $Matches[1].Trim()
    }
    if (-not $topPath -and $line -match '^path:\s*["'']?([^"'']+)["'']?\s*$') {
      $topPath = $Matches[1].Trim()
    }
  }

  $resolvedFileName = if (-not [string]::IsNullOrWhiteSpace($topPath)) { $topPath } else { $firstFileUrl }
  $resolvedSha512 = if (-not [string]::IsNullOrWhiteSpace($topSha512)) { $topSha512 } else { $firstFileSha512 }

  if ([string]::IsNullOrWhiteSpace($version)) {
    throw "Could not read 'version' from $YmlPath."
  }
  if ([string]::IsNullOrWhiteSpace($resolvedSha512)) {
    throw "Could not read 'sha512' from $YmlPath."
  }

  return [PSCustomObject]@{
    Version  = $version
    FileName = $resolvedFileName
    Sha512   = $resolvedSha512
  }
}

function Assert-SafeReleaseFileName {
  param(
    [string] $FileName,
    [Parameter(Mandatory)] [string] $SourceLabel
  )
  if ([string]::IsNullOrWhiteSpace($FileName)) {
    throw "Could not read installer filename ('path' or 'files[0].url') from $SourceLabel."
  }
  if ($FileName -match '[/\\:?#*<>|"]' -or $FileName -match '\.\.' -or ([IO.Path]::GetFileName($FileName) -ne $FileName)) {
    throw "Refusing unsafe installer filename '$FileName' from $SourceLabel."
  }
  if ($FileName -notmatch '\.exe$') {
    throw "Refusing non-.exe installer filename '$FileName' from $SourceLabel."
  }
}

function Assert-ForkReleaseVersion {
  param([Parameter(Mandatory)] [string] $ReleaseVersion)
  if ($ReleaseVersion -match '\.\.' -or $ReleaseVersion -notmatch '^(\d+)\.(\d+)\.(\d+)-fork\.([0-9A-Za-z][0-9A-Za-z.\-]*)$') {
    throw "Refusing release version '$ReleaseVersion': expected a fork version matching '*-fork.*' (for example 0.1.13-fork.1). No changes were made."
  }
  $releaseCore = New-Object System.Version([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])

  $installedVersion = Get-InstalledDisplayVersion
  $installedCore = $null
  if (-not [string]::IsNullOrWhiteSpace($installedVersion)) {
    if ($installedVersion -notmatch '^(\d+)\.(\d+)\.(\d+)') {
      throw "Could not parse semver core from installed DisplayVersion '$installedVersion'. No changes were made."
    }
    $installedCore = New-Object System.Version([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
    if ($releaseCore -le $installedCore) {
      throw "Refusing release version '$ReleaseVersion' (core $releaseCore): it is not newer than installed DisplayVersion '$installedVersion' (core $installedCore). No changes were made."
    }
  }

  return [PSCustomObject]@{
    ReleaseVersion   = $ReleaseVersion
    ReleaseCore      = $releaseCore
    InstalledVersion = $installedVersion
    InstalledCore    = $installedCore
  }
}

function Invoke-DownloadFile {
  param(
    [Parameter(Mandatory)] [string] $Uri,
    [Parameter(Mandatory)] [string] $OutFile,
    [Parameter(Mandatory)] [string] $Label
  )
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $oldProgress = $ProgressPreference
  $ProgressPreference = 'SilentlyContinue'
  try {
    Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing -ErrorAction Stop
  } catch {
    if (Test-Path -LiteralPath $OutFile) {
      Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
    }
    $statusNote = ''
    if ($_.Exception -and $_.Exception.Response) {
      try {
        $code = [int]$_.Exception.Response.StatusCode
        $desc = [string]$_.Exception.Response.StatusDescription
        $statusNote = " (HTTP $code $desc)"
      } catch { }
    }
    throw "Failed to download $Label from $Uri$statusNote`: $($_.Exception.Message) No changes were made."
  } finally {
    $ProgressPreference = $oldProgress
  }
}

function Resolve-CutoverInstaller {
  param(
    [string] $InstallerPath,
    [string] $YmlPath
  )
  Write-Host '[Step 2/10] Resolving and verifying fork installer and latest.yml SHA-512...'

  if ([string]::IsNullOrWhiteSpace($InstallerPath)) {
    $latestYmlUrl = "$ReleaseDownloadBaseUrl/latest.yml"
    $stagingYml = Join-Path $env:TEMP ("t3-cutover-latest-" + [Guid]::NewGuid().ToString('N') + '.yml')
    Write-Host "  Downloading $latestYmlUrl..."
    try {
      Invoke-DownloadFile -Uri $latestYmlUrl -OutFile $stagingYml -Label 'latest.yml'
      $meta = Read-LatestYmlMetadata -YmlPath $stagingYml
      Assert-SafeReleaseFileName -FileName $meta.FileName -SourceLabel $latestYmlUrl
      $verCheck = Assert-ForkReleaseVersion -ReleaseVersion $meta.Version

      $downloadDir = Join-Path (Join-Path $env:TEMP 't3-cutover') $meta.Version
      $null = New-Item -ItemType Directory -Path $downloadDir -Force
      $resolvedYml = Join-Path $downloadDir 'latest.yml'
      Copy-Item -LiteralPath $stagingYml -Destination $resolvedYml -Force
    } finally {
      if (Test-Path -LiteralPath $stagingYml) {
        Remove-Item -LiteralPath $stagingYml -Force -ErrorAction SilentlyContinue
      }
    }

    $resolvedInstaller = Join-Path $downloadDir $meta.FileName
    $reuseCached = $false
    if (Test-Path -LiteralPath $resolvedInstaller -PathType Leaf) {
      $cachedSha512 = Get-FileSha512Base64 -FilePath $resolvedInstaller
      if ([string]::Equals($cachedSha512, $meta.Sha512, [StringComparison]::Ordinal)) {
        $reuseCached = $true
        Write-Host "  Reusing cached installer in $resolvedInstaller (SHA-512 matches)."
      }
    }

    if (-not $reuseCached) {
      $installerUrl = "$ReleaseDownloadBaseUrl/$([Uri]::EscapeDataString($meta.FileName))"
      $partFile = "$resolvedInstaller.part"
      Write-Host "  Downloading $installerUrl..."
      Invoke-DownloadFile -Uri $installerUrl -OutFile $partFile -Label $meta.FileName
      Move-Item -LiteralPath $partFile -Destination $resolvedInstaller -Force
    }

    $installerFile = Get-Item -LiteralPath $resolvedInstaller
    $actualSha512 = Get-FileSha512Base64 -FilePath $resolvedInstaller
    if (-not [string]::Equals($actualSha512, $meta.Sha512, [StringComparison]::Ordinal)) {
      Remove-Item -LiteralPath $resolvedInstaller -Force -ErrorAction SilentlyContinue
      throw "SHA-512 mismatch for downloaded installer $resolvedInstaller. Expected '$($meta.Sha512)', got '$actualSha512'. No changes were made."
    }

    Write-Host "  Installer: $resolvedInstaller ($(Format-ByteSize -Bytes $installerFile.Length))"
    Write-Host "  latest.yml: $resolvedYml (version $($meta.Version))"
    Write-Host '  SHA-512:   verified match.'

    return [PSCustomObject]@{
      InstallerPath    = $resolvedInstaller
      LatestYmlPath    = $resolvedYml
      Version          = $meta.Version
      InstalledVersion = $verCheck.InstalledVersion
      Sha512           = $actualSha512
      SizeBytes        = $installerFile.Length
      Downloaded       = $true
    }
  }

  if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
    throw "Installer not found: $InstallerPath"
  }
  $resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
  $installerFile = Get-Item -LiteralPath $resolvedInstaller

  $resolvedYml = if ([string]::IsNullOrWhiteSpace($YmlPath)) {
    Join-Path $installerFile.DirectoryName 'latest.yml'
  } else {
    $YmlPath
  }
  if (-not (Test-Path -LiteralPath $resolvedYml -PathType Leaf)) {
    throw "latest.yml not found: $resolvedYml"
  }
  $resolvedYml = (Resolve-Path -LiteralPath $resolvedYml).Path
  $meta = Read-LatestYmlMetadata -YmlPath $resolvedYml
  $verCheck = Assert-ForkReleaseVersion -ReleaseVersion $meta.Version

  $actualSha512 = Get-FileSha512Base64 -FilePath $resolvedInstaller
  if (-not [string]::Equals($actualSha512, $meta.Sha512, [StringComparison]::Ordinal)) {
    throw "SHA-512 mismatch for $resolvedInstaller. Expected '$($meta.Sha512)', got '$actualSha512'."
  }

  Write-Host "  Installer: $resolvedInstaller ($(Format-ByteSize -Bytes $installerFile.Length))"
  Write-Host "  latest.yml: $resolvedYml (version $($meta.Version))"
  if ($meta.FileName -and -not $meta.FileName.Equals($installerFile.Name, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Host "  Note: latest.yml path is '$($meta.FileName)' (file name is '$($installerFile.Name)')." -ForegroundColor Yellow
  }
  Write-Host '  SHA-512:   verified match.'

  return [PSCustomObject]@{
    InstallerPath    = $resolvedInstaller
    LatestYmlPath    = $resolvedYml
    Version          = $meta.Version
    InstalledVersion = $verCheck.InstalledVersion
    Sha512           = $actualSha512
    SizeBytes        = $installerFile.Length
    Downloaded       = $false
  }
}

function Get-T3ScheduledTasks {
  $tasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
    $matchAction = $false
    foreach ($action in @($_.Actions)) {
      if ($action.Execute -match 't3' -or $action.Arguments -match 't3code') {
        $matchAction = $true
        break
      }
    }
    $matchAction -or ($_.TaskName -match 't3code')
  })
  return $tasks
}

function Get-ShortcutAudit {
  param(
    [Parameter(Mandatory)] [string] $TargetStartMenuDir,
    [Parameter(Mandatory)] [string] $TargetTaskbarDir,
    [Parameter(Mandatory)] [string] $TargetInstallDir
  )
  $wsh = New-Object -ComObject WScript.Shell
  $startMenuItems = @()
  if (Test-Path -LiteralPath $TargetStartMenuDir) {
    $startMenuItems = @(Get-ChildItem -LiteralPath $TargetStartMenuDir -Filter 'T3 Code*.lnk' -File -ErrorAction SilentlyContinue | ForEach-Object {
      $sc = $wsh.CreateShortcut($_.FullName)
      [PSCustomObject]@{ Path = $_.FullName; Name = $_.Name; Target = $sc.TargetPath; Arguments = $sc.Arguments }
    })
  }
  $taskbarItems = @()
  if (Test-Path -LiteralPath $TargetTaskbarDir) {
    $taskbarItems = @(Get-ChildItem -LiteralPath $TargetTaskbarDir -Filter '*.lnk' -File -ErrorAction SilentlyContinue | ForEach-Object {
      $sc = $wsh.CreateShortcut($_.FullName)
      if ($_.Name -match 'T3' -or (Test-PathUnderDirectory -CandidatePath $sc.TargetPath -Directory $TargetInstallDir)) {
        [PSCustomObject]@{ Path = $_.FullName; Name = $_.Name; Target = $sc.TargetPath; Arguments = $sc.Arguments }
      }
    })
  }
  return [PSCustomObject]@{
    StartMenu = $startMenuItems
    Taskbar   = $taskbarItems
  }
}

function Get-BackupDriveFreeSpace {
  param([Parameter(Mandatory)] [string] $TargetBackupRoot)
  $fullPath = [IO.Path]::GetFullPath($TargetBackupRoot)
  $root = [IO.Path]::GetPathRoot($fullPath)
  $drive = New-Object IO.DriveInfo($root)
  return [PSCustomObject]@{
    DriveName = $drive.Name
    FreeBytes = [long]$drive.AvailableFreeSpace
  }
}

function Test-DesktopSettingsUpdateChannel {
  param([Parameter(Mandatory)] [string] $TargetT3Home)
  $settingsPath = Join-Path $TargetT3Home 'userdata\desktop-settings.json'
  if (-not (Test-Path -LiteralPath $settingsPath -PathType Leaf)) {
    return [PSCustomObject]@{ Path = $settingsPath; Exists = $false; UpdateChannel = $null }
  }
  try {
    $json = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    $channel = if ($json.PSObject.Properties.Name -contains 'updateChannel') { [string]$json.updateChannel } else { $null }
    return [PSCustomObject]@{ Path = $settingsPath; Exists = $true; UpdateChannel = $channel }
  } catch {
    return [PSCustomObject]@{ Path = $settingsPath; Exists = $true; UpdateChannel = '<unreadable>' }
  }
}

function Show-CutoverPlanAndConfirm {
  param(
    [Parameter(Mandatory)] $InstallerInfo,
    [switch] $EnableBackup,
    [string] $TargetBackupRoot,
    [Parameter(Mandatory)] [string] $TargetInstallDir,
    [Parameter(Mandatory)] [string] $TargetAppDataProfile,
    [Parameter(Mandatory)] [string] $TargetT3Home,
    [Parameter(Mandatory)] [int] $TargetPort,
    [switch] $ExcludeWorktrees,
    [switch] $IsDryRun
  )
  Write-Host '[Step 3/10] Inspecting live state and building cutover plan...'

  $processes = @(Get-InstallDirProcesses -TargetInstallDir $TargetInstallDir)
  $listeners = @(Get-PortListeners -TargetPort $TargetPort)
  $tasks = @(Get-T3ScheduledTasks)
  $channelCheck = Test-DesktopSettingsUpdateChannel -TargetT3Home $TargetT3Home
  $installedShown = if ([string]::IsNullOrWhiteSpace($InstallerInfo.InstalledVersion)) { '<not installed>' } else { $InstallerInfo.InstalledVersion }
  $sourceNote = if ($InstallerInfo.Downloaded) { 'downloaded from GitHub' } else { 'local file' }

  $totalBackupBytes = 0L
  $requiredFreeBytes = 0L

  Write-Host ''
  Write-Host '=== Cutover Plan ===' -ForegroundColor Cyan
  Write-Host "  Installed version:   $installedShown"
  Write-Host "  Release version:     $($InstallerInfo.Version)"
  Write-Host "  Installer:           $($InstallerInfo.InstallerPath) ($sourceNote)"
  Write-Host "  App identity:        appId=$AppId, uninstallGuid=$UninstallGuid, profile=$ProfileName, port=$TargetPort"

  if ($EnableBackup) {
    $shortcuts = Get-ShortcutAudit -TargetStartMenuDir $StartMenuDir -TargetTaskbarDir $TaskbarDir -TargetInstallDir $TargetInstallDir
    $appDataStats = Get-DirectoryStats -Path $TargetAppDataProfile
    $worktreesDir = Join-Path $TargetT3Home 'worktrees'
    $worktreesStats = Get-DirectoryStats -Path $worktreesDir -SkipJunctions
    $t3Excludes = if ($ExcludeWorktrees) { @($worktreesDir) } else { @() }
    $t3HomeStats = Get-DirectoryStats -Path $TargetT3Home -SkipJunctions -ExcludeDirs $t3Excludes
    $installStats = Get-DirectoryStats -Path $TargetInstallDir

    $totalBackupBytes = $appDataStats.ByteCount + $t3HomeStats.ByteCount + $installStats.ByteCount
    $requiredFreeBytes = $totalBackupBytes * 2L
    $driveInfo = Get-BackupDriveFreeSpace -TargetBackupRoot $TargetBackupRoot

    Write-Host "  Install dir:         $TargetInstallDir ($(Format-ByteSize -Bytes $installStats.ByteCount), $($installStats.FileCount) files)"
    Write-Host "  AppData profile:     $TargetAppDataProfile ($(Format-ByteSize -Bytes $appDataStats.ByteCount), $($appDataStats.FileCount) files)"
    $wtNote = if ($ExcludeWorktrees) { 'excluding worktrees' } else { "including worktrees ($(Format-ByteSize -Bytes $worktreesStats.ByteCount))" }
    Write-Host "  T3 home:             $TargetT3Home ($(Format-ByteSize -Bytes $t3HomeStats.ByteCount), $($t3HomeStats.FileCount) files; $wtNote)"
    if ($t3HomeStats.SkippedJunctions -gt 0) {
      Write-Host "                       (skipped $($t3HomeStats.SkippedJunctions) junction(s) to match robocopy /XJ)"
    }
    Write-Host "  Untouched dev fork:  $(Join-Path ([Environment]::GetFolderPath('UserProfile')) '.t3-fork') and $(Join-Path $env:APPDATA 't3code-fork')"
    Write-Host "  Backup:              enabled -> $TargetBackupRoot"
    Write-Host "  Estimated backup:    $(Format-ByteSize -Bytes $totalBackupBytes) (2x required: $(Format-ByteSize -Bytes $requiredFreeBytes))"
    Write-Host "  Free on $($driveInfo.DriveName):         $(Format-ByteSize -Bytes $driveInfo.FreeBytes)"

    if ($driveInfo.FreeBytes -lt $requiredFreeBytes) {
      $msg = "Insufficient free space on $($driveInfo.DriveName): need $(Format-ByteSize -Bytes $requiredFreeBytes) (2x backup size), have $(Format-ByteSize -Bytes $driveInfo.FreeBytes)."
      if ($IsDryRun) {
        Write-Host "  [SPACE ERROR] $msg" -ForegroundColor Red
      } else {
        throw $msg
      }
    } else {
      Write-Host '  Free space check:    PASS'
    }
  } else {
    Write-Host "  Install dir:         $TargetInstallDir"
    Write-Host "  AppData profile:     $TargetAppDataProfile"
    Write-Host "  T3 home:             $TargetT3Home"
    Write-Host "  Untouched dev fork:  $(Join-Path ([Environment]::GetFolderPath('UserProfile')) '.t3-fork') and $(Join-Path $env:APPDATA 't3code-fork')"
    Write-Host '  Backup:              disabled (pass -Backup to back up before installing)'
    if ($ExcludeWorktrees) {
      Write-Host '  Note:                -SkipWorktrees has no effect without -Backup.' -ForegroundColor Yellow
    }
  }

  Write-Host ''
  Write-Host '  Desktop settings update channel:'
  if (-not $channelCheck.Exists) {
    Write-Host "    $($channelCheck.Path): not found (will default to latest)"
  } elseif ($channelCheck.UpdateChannel -eq 'nightly') {
    Write-Host "    WARNING: $($channelCheck.Path) has updateChannel='nightly'. Switch to Stable in Settings > About after cutover." -ForegroundColor Yellow
  } else {
    Write-Host "    $($channelCheck.Path): updateChannel not set to nightly (resolves to latest for fork version)."
  }

  Write-Host ''
  Write-Host "  Processes under install dir ($($processes.Count)):"
  if ($processes.Count -eq 0) {
    Write-Host '    (none running)'
  } else {
    foreach ($p in $processes) {
      $role = if ($p.CommandLine -match '--type=') { 'child' } else { 'main/helper' }
      Write-Host "    PID $($p.ProcessId): $($p.Name) [$role] -> $($p.ExecutablePath)"
    }
  }

  Write-Host "  Listeners on port $TargetPort ($($listeners.Count)):"
  if ($listeners.Count -eq 0) {
    Write-Host '    (none)'
  } else {
    foreach ($l in $listeners) {
      Write-Host "    $($l.LocalAddress):$($l.LocalPort) owned by PID $($l.OwningProcess)"
    }
  }

  Write-Host "  Scheduled tasks matching t3 ($($tasks.Count)):"
  if ($tasks.Count -eq 0) {
    Write-Host '    (none)'
  } else {
    foreach ($t in $tasks) {
      Write-Host "    $($t.TaskName) (State=$($t.State))"
    }
  }

  if ($EnableBackup) {
    Write-Host '  Registry keys to export:'
    Write-Host "    - $UninstallRegPath"
    Write-Host "    - $InstallRegPath (if present)"
    Write-Host "    - $ProtocolRegPath (if present)"

    Write-Host '  Shortcuts to back up:'
    if ($shortcuts.StartMenu.Count -eq 0 -and $shortcuts.Taskbar.Count -eq 0) {
      Write-Host '    (none found)'
    } else {
      foreach ($sc in $shortcuts.StartMenu) {
        Write-Host "    [Start Menu] $($sc.Path) -> $($sc.Target) $($sc.Arguments)"
      }
      foreach ($sc in $shortcuts.Taskbar) {
        Write-Host "    [Taskbar]    $($sc.Path) -> $($sc.Target) $($sc.Arguments)"
      }
    }
  }

  Write-Host ''
  Write-Host '  Planned actions:'
  Write-Host "    Step 4:  Check scheduled tasks matching t3"
  Write-Host "    Step 5:  Gracefully close main window(s) under $TargetInstallDir and wait up to 90 s (exact PIDs only; never stop by name)"
  if ($EnableBackup) {
    Write-Host "    Step 6:  Robocopy profile, T3 home, and install dir into $TargetBackupRoot; copy shortcuts; export registry; verify counts & write manifest.json"
  } else {
    Write-Host '    Step 6:  Backup skipped (default; pass -Backup to enable)'
  }
  Write-Host "    Step 7:  Run silent NSIS install: `"$($InstallerInfo.InstallerPath)`" /S; verify DisplayVersion=$($InstallerInfo.Version) and app-update.yml (yeskiy/t3code)"
  Write-Host '    Step 8:  Fork flags without launcher (Task 4):'
  foreach ($flag in $ForkKnownEnvFlags) {
    $currentVal = [Environment]::GetEnvironmentVariable($flag.Name, 'User')
    $displayVal = if ([string]::IsNullOrEmpty($currentVal)) { '<unset>' } else { $currentVal }
    Write-Host "             - $($flag.Name)=$displayVal | code default: $($flag.DefaultBehavior)"
  }
  if ($ForkRequiredUserEnvVars.Count -eq 0) {
    Write-Host '             - User env vars to write: none (all current fork features default on without env flags)'
  } else {
    foreach ($entry in $ForkRequiredUserEnvVars.GetEnumerator()) {
      Write-Host "             - Set User env var $($entry.Key)=$($entry.Value)"
    }
  }
  Write-Host "    Step 9:  Start T3 Code (Beta).exe from $TargetInstallDir and wait up to 120 s for port $TargetPort"
  if ($EnableBackup) {
    Write-Host "    Step 10: Print summary and restore command: powershell -NoProfile -ExecutionPolicy Bypass -File `"$RepoRoot\fork\Restore-T3Nightly.ps1`" -BackupPath `"$TargetBackupRoot`""
  } else {
    Write-Host "    Step 10: Print summary and rollback note (install latest Nightly from $NightlyReleasesUrl over the fork)"
  }

  Write-Host ''
  Write-Host 'Every agent session in T3 Code stops now. Let running threads settle first.' -ForegroundColor Yellow

  if ($IsDryRun) {
    Write-Host ''
    Write-Host 'Dry run complete. No processes were stopped and no installed files or settings were changed.' -ForegroundColor Cyan
    return [PSCustomObject]@{ Continue = $false; TotalBackupBytes = $totalBackupBytes; RequiredFreeBytes = $requiredFreeBytes }
  }

  $promptText = if ($EnableBackup) {
    'Type CUTOVER to close T3 Code, back up data, and install the fork'
  } else {
    'Type CUTOVER to close T3 Code and install the fork'
  }
  $reply = Read-Host $promptText
  if ($reply -cne 'CUTOVER') {
    throw 'Cutover cancelled by user before stopping T3 Code.'
  }

  return [PSCustomObject]@{ Continue = $true; TotalBackupBytes = $totalBackupBytes; RequiredFreeBytes = $requiredFreeBytes }
}

function Test-T3ScheduledTasksInteractive {
  Write-Host '[Step 4/10] Checking for T3 scheduled tasks...'
  $tasks = @(Get-T3ScheduledTasks)
  if ($tasks.Count -eq 0) {
    Write-Host '  OK: no T3 scheduled tasks found.'
    return
  }
  Write-Host '  Found scheduled task(s) that may start T3 Code or hold files during cutover:' -ForegroundColor Yellow
  foreach ($t in $tasks) {
    Write-Host "    - $($t.TaskName) (State=$($t.State))"
  }
  $reply = Read-Host 'Stop or disable the task first. Type CONTINUE to proceed anyway'
  if ($reply -cne 'CONTINUE') {
    throw 'Cutover paused because a T3 scheduled task is present.'
  }
}

function Stop-NightlyGracefully {
  param(
    [Parameter(Mandatory)] [string] $TargetInstallDir,
    [Parameter(Mandatory)] [int] $TargetPort,
    [switch] $AllowForceKill
  )
  Write-Host '[Step 5/10] Stopping installed T3 Code gracefully...'
  $procs = @(Get-InstallDirProcesses -TargetInstallDir $TargetInstallDir)
  $mainCandidates = @($procs | Where-Object { $_.CommandLine -notmatch '--type=' })

  foreach ($candidate in $mainCandidates) {
    $dotNetProc = Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue
    if ($dotNetProc -and $dotNetProc.MainWindowHandle -ne [IntPtr]::Zero) {
      Write-Host "  Sending CloseMainWindow() to PID $($candidate.ProcessId) ($($candidate.Name))..."
      $null = $dotNetProc.CloseMainWindow()
    }
  }

  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    $remaining = @(Get-InstallDirProcesses -TargetInstallDir $TargetInstallDir)
    $portListeners = @(Get-PortListeners -TargetPort $TargetPort)
    if ($remaining.Count -eq 0 -and $portListeners.Count -eq 0) {
      Write-Host "  OK: all processes from $TargetInstallDir exited and port $TargetPort is free."
      return
    }
    Start-Sleep -Seconds 2
  }

  $remaining = @(Get-InstallDirProcesses -TargetInstallDir $TargetInstallDir)
  $portListeners = @(Get-PortListeners -TargetPort $TargetPort)
  if ($remaining.Count -gt 0) {
    Write-Host '  Processes still running under install dir after 90 s:' -ForegroundColor Yellow
    foreach ($p in $remaining) {
      Write-Host "    PID $($p.ProcessId): $($p.Name) ($($p.ExecutablePath))"
    }
    if (-not $AllowForceKill) {
      throw 'Processes remained after 90 s. Close T3 Code manually or re-run with -Force to confirm force-stopping those exact PIDs.'
    }
    $pidList = ($remaining | ForEach-Object { $_.ProcessId }) -join ', '
    $confirm = Read-Host "Type YES to force-stop ONLY these exact PIDs ($pidList)"
    if ($confirm -cne 'YES') {
      throw 'Force-stop declined by user.'
    }
    foreach ($p in $remaining) {
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
    $afterKill = @(Get-InstallDirProcesses -TargetInstallDir $TargetInstallDir)
    if ($afterKill.Count -gt 0) {
      throw "Some PIDs still remain after Stop-Process -Force: $(($afterKill | ForEach-Object { $_.ProcessId }) -join ', ')"
    }
  }

  $portListeners = @(Get-PortListeners -TargetPort $TargetPort)
  if ($portListeners.Count -gt 0) {
    $owners = ($portListeners | ForEach-Object { "PID $($_.OwningProcess)" }) -join ', '
    throw "Port $TargetPort is still in use by $owners."
  }
  Write-Host "  OK: install dir processes stopped and port $TargetPort is free."
}

function Invoke-RobocopyVerified {
  param(
    [Parameter(Mandatory)] [string] $Name,
    [Parameter(Mandatory)] [string] $Source,
    [Parameter(Mandatory)] [string] $Destination,
    [switch] $SkipJunctions,
    [string[]] $ExcludeDirs = @()
  )
  if (-not (Test-Path -LiteralPath $Source)) {
    throw "Backup source does not exist: $Source"
  }
  $null = New-Item -ItemType Directory -Path $Destination -Force

  $args = @($Source, $Destination, '/E', '/COPY:DAT', '/DCOPY:DAT')
  if ($SkipJunctions) { $args += '/XJ' }
  $nonEmptyExcludes = @($ExcludeDirs | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($nonEmptyExcludes.Count -gt 0) {
    $args += '/XD'
    $args += $nonEmptyExcludes
  }
  $args += @('/R:1', '/W:1', '/NP', '/NFL', '/NDL')

  Write-Host "  Copying $Name..."
  & robocopy @args | Out-Null
  $exitCode = $LASTEXITCODE
  if ($exitCode -ge 8) {
    throw "robocopy failed for $Name (exit code $exitCode): $Source -> $Destination"
  }

  $srcStats = Get-DirectoryStats -Path $Source -SkipJunctions:$SkipJunctions -ExcludeDirs $ExcludeDirs
  $dstStats = Get-DirectoryStats -Path $Destination -SkipJunctions:$SkipJunctions
  if ($srcStats.FileCount -ne $dstStats.FileCount -or $srcStats.ByteCount -ne $dstStats.ByteCount) {
    throw "Backup verification mismatch for ${Name}: source ($($srcStats.FileCount) files, $($srcStats.ByteCount) bytes) != target ($($dstStats.FileCount) files, $($dstStats.ByteCount) bytes)."
  }

  Write-Host "    Verified: $($dstStats.FileCount) files, $(Format-ByteSize -Bytes $dstStats.ByteCount) (robocopy exit $exitCode)"
  return [ordered]@{
    name            = $Name
    source          = $Source
    target          = $Destination
    sourceFileCount = $srcStats.FileCount
    targetFileCount = $dstStats.FileCount
    sourceBytes     = $srcStats.ByteCount
    targetBytes     = $dstStats.ByteCount
    exitCode        = $exitCode
  }
}

function Invoke-RegExportOptional {
  param(
    [Parameter(Mandatory)] [string] $RegKey,
    [Parameter(Mandatory)] [string] $OutputFile,
    [switch] $Required
  )
  $psKey = "Registry::$RegKey"
  if (-not (Test-Path -LiteralPath $psKey)) {
    if ($Required) {
      throw "Required registry key is missing: $RegKey"
    }
    Write-Host "  Registry key not present (skipped): $RegKey"
    return [ordered]@{ key = $RegKey; file = $OutputFile; exported = $false }
  }
  & reg.exe export $RegKey $OutputFile /y | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "reg export failed for $RegKey (exit code $LASTEXITCODE)"
  }
  Write-Host "  Exported registry: $RegKey -> $OutputFile"
  return [ordered]@{ key = $RegKey; file = $OutputFile; exported = $true }
}

function Invoke-CutoverBackup {
  param(
    [Parameter(Mandatory)] $InstallerInfo,
    [Parameter(Mandatory)] [string] $TargetBackupRoot,
    [Parameter(Mandatory)] [string] $TargetInstallDir,
    [Parameter(Mandatory)] [string] $TargetAppDataProfile,
    [Parameter(Mandatory)] [string] $TargetT3Home,
    [switch] $ExcludeWorktrees
  )
  Write-Host "[Step 6/10] Backing up data into $TargetBackupRoot..."

  $worktreesDir = Join-Path $TargetT3Home 'worktrees'
  $t3Excludes = if ($ExcludeWorktrees) { @($worktreesDir) } else { @() }
  $preTotal = (Get-DirectoryStats -Path $TargetAppDataProfile).ByteCount +
    (Get-DirectoryStats -Path $TargetT3Home -SkipJunctions -ExcludeDirs $t3Excludes).ByteCount +
    (Get-DirectoryStats -Path $TargetInstallDir).ByteCount
  $driveInfo = Get-BackupDriveFreeSpace -TargetBackupRoot $TargetBackupRoot
  if ($driveInfo.FreeBytes -lt ($preTotal * 2L)) {
    throw "Insufficient free space on $($driveInfo.DriveName) before backup: need $(Format-ByteSize -Bytes ($preTotal * 2L)), have $(Format-ByteSize -Bytes $driveInfo.FreeBytes)."
  }

  $null = New-Item -ItemType Directory -Path $TargetBackupRoot -Force

  $folders = @(
    (Invoke-RobocopyVerified -Name "appdata-$ProfileName" -Source $TargetAppDataProfile -Destination (Join-Path $TargetBackupRoot "appdata-$ProfileName")),
    (Invoke-RobocopyVerified -Name 'dot-t3' -Source $TargetT3Home -Destination (Join-Path $TargetBackupRoot 'dot-t3') -SkipJunctions -ExcludeDirs $t3Excludes),
    (Invoke-RobocopyVerified -Name 'install-dir' -Source $TargetInstallDir -Destination (Join-Path $TargetBackupRoot 'install-dir'))
  )

  $shortcutsRoot = Join-Path $TargetBackupRoot 'shortcuts'
  $startMenuBackup = Join-Path $shortcutsRoot 'start-menu'
  $taskbarBackup = Join-Path $shortcutsRoot 'taskbar'
  $null = New-Item -ItemType Directory -Path $startMenuBackup -Force
  $null = New-Item -ItemType Directory -Path $taskbarBackup -Force

  $shortcuts = Get-ShortcutAudit -TargetStartMenuDir $StartMenuDir -TargetTaskbarDir $TaskbarDir -TargetInstallDir $TargetInstallDir
  $copiedShortcuts = @()
  foreach ($sc in $shortcuts.StartMenu) {
    $dest = Join-Path $startMenuBackup $sc.Name
    Copy-Item -LiteralPath $sc.Path -Destination $dest -Force
    $copiedShortcuts += [ordered]@{ kind = 'start-menu'; name = $sc.Name; source = $sc.Path; target = $dest }
  }
  foreach ($sc in $shortcuts.Taskbar) {
    $dest = Join-Path $taskbarBackup $sc.Name
    Copy-Item -LiteralPath $sc.Path -Destination $dest -Force
    $copiedShortcuts += [ordered]@{ kind = 'taskbar'; name = $sc.Name; source = $sc.Path; target = $dest }
  }
  Write-Host "  Backed up $($copiedShortcuts.Count) shortcut(s)."

  $registryExports = @(
    (Invoke-RegExportOptional -RegKey $UninstallRegPath -OutputFile (Join-Path $TargetBackupRoot 'uninstall-key.reg') -Required),
    (Invoke-RegExportOptional -RegKey $InstallRegPath -OutputFile (Join-Path $TargetBackupRoot 'install-key.reg')),
    (Invoke-RegExportOptional -RegKey $ProtocolRegPath -OutputFile (Join-Path $TargetBackupRoot 't3code-protocol.reg'))
  )

  $envBefore = [ordered]@{}
  foreach ($flag in $ForkKnownEnvFlags) {
    $envBefore[$flag.Name] = [Environment]::GetEnvironmentVariable($flag.Name, 'User')
  }
  foreach ($entry in $ForkRequiredUserEnvVars.GetEnumerator()) {
    $envBefore[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, 'User')
  }

  $manifest = [ordered]@{
    schemaVersion    = 1
    createdAt        = (Get-Date).ToString('o')
    appId            = $AppId
    uninstallGuid    = $UninstallGuid
    profileName      = $ProfileName
    t3Home           = $TargetT3Home
    installDir       = $TargetInstallDir
    skipWorktrees    = [bool]$ExcludeWorktrees
    targetVersion    = $InstallerInfo.Version
    installerSha512  = $InstallerInfo.Sha512
    folders          = $folders
    shortcuts        = $copiedShortcuts
    registryExports  = $registryExports
    forkUserEnvVars  = [ordered]@{
      before  = $envBefore
      applied = [ordered]@{}
    }
  }

  $manifestPath = Join-Path $TargetBackupRoot 'manifest.json'
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
  Write-Host "  Wrote manifest: $manifestPath"
  return [PSCustomObject]@{ ManifestPath = $manifestPath; Manifest = $manifest }
}

function Install-ForkRelease {
  param(
    [Parameter(Mandatory)] $InstallerInfo,
    [Parameter(Mandatory)] [string] $TargetInstallDir
  )
  Write-Host '[Step 7/10] Running silent fork NSIS installer...'
  $proc = Start-Process -FilePath $InstallerInfo.InstallerPath -ArgumentList '/S' -Wait -PassThru
  if ($proc.ExitCode -ne 0) {
    throw "Installer exited with code $($proc.ExitCode)."
  }

  if (-not (Test-Path -LiteralPath $UninstallPsPath)) {
    throw "Uninstall key missing after install: $UninstallRegPath"
  }
  $uninstallProps = Get-ItemProperty -LiteralPath $UninstallPsPath
  if ($uninstallProps.DisplayVersion -ne $InstallerInfo.Version) {
    throw "Installed DisplayVersion '$($uninstallProps.DisplayVersion)' does not match release version '$($InstallerInfo.Version)'."
  }
  Write-Host "  Verified uninstall key DisplayVersion: $($uninstallProps.DisplayVersion)"

  $appUpdateYml = Join-Path $TargetInstallDir 'resources\app-update.yml'
  if (-not (Test-Path -LiteralPath $appUpdateYml -PathType Leaf)) {
    throw "app-update.yml missing after install: $appUpdateYml"
  }
  $updateText = Get-Content -LiteralPath $appUpdateYml -Raw
  if ($updateText -notmatch '(?m)^owner:\s*yeskiy\s*$' -or $updateText -notmatch '(?m)^repo:\s*t3code\s*$') {
    throw "app-update.yml does not point to yeskiy/t3code: $appUpdateYml"
  }
  Write-Host '  Verified app-update.yml: owner=yeskiy, repo=t3code'
}

function Set-ForkUserFlags {
  param(
    [string] $ManifestPath,
    $Manifest
  )
  Write-Host '[Step 8/10] Auditing and setting fork user environment variables (Task 4)...'
  foreach ($flag in $ForkKnownEnvFlags) {
    $val = [Environment]::GetEnvironmentVariable($flag.Name, 'User')
    if ($val -eq '0') {
      Write-Host "  Note: user env var $($flag.Name)=0 is set (feature explicitly disabled)." -ForegroundColor Yellow
    } else {
      $shown = if ([string]::IsNullOrEmpty($val)) { '<unset>' } else { $val }
      Write-Host "  $($flag.Name)=$shown (code default: $($flag.DefaultBehavior))"
    }
  }

  $applied = [ordered]@{}
  foreach ($entry in $ForkRequiredUserEnvVars.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'User')
    $applied[$entry.Key] = $entry.Value
    Write-Host "  Set User env var: $($entry.Key)=$($entry.Value)"
  }

  if ($applied.Count -eq 0) {
    Write-Host '  No additional User env vars required for current fork/main.'
  } elseif ($Manifest -and -not [string]::IsNullOrWhiteSpace($ManifestPath)) {
    $Manifest.forkUserEnvVars.applied = $applied
    $Manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8
  }
}

function Start-ForkApp {
  param(
    [Parameter(Mandatory)] [string] $TargetInstallDir,
    [Parameter(Mandatory)] [int] $TargetPort
  )
  Write-Host '[Step 9/10] Starting installed fork app...'
  $preferredExe = Join-Path $TargetInstallDir 'T3 Code (Beta).exe'
  if (Test-Path -LiteralPath $preferredExe -PathType Leaf) {
    $exePath = $preferredExe
  } else {
    $fallbackExe = Get-ChildItem -LiteralPath $TargetInstallDir -Filter '*.exe' -File |
      Where-Object { $_.Name -notmatch '^(Uninstall|elevate|t3-resource-monitor)' } |
      Select-Object -First 1
    if (-not $fallbackExe) {
      throw "No app executable found in $TargetInstallDir."
    }
    $exePath = $fallbackExe.FullName
  }

  Write-Host "  Launching $exePath..."
  # Explorer starts the app without this console, so closing the window does not stop it.
  Start-Process -FilePath (Join-Path $env:WINDIR 'explorer.exe') -ArgumentList "`"$exePath`"" | Out-Null

  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Date) -lt $deadline) {
    $listeners = @(Get-PortListeners -TargetPort $TargetPort)
    foreach ($l in $listeners) {
      $owner = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $($l.OwningProcess)" -ErrorAction SilentlyContinue
      if ($owner -and (Test-PathUnderDirectory -CandidatePath $owner.ExecutablePath -Directory $TargetInstallDir)) {
        Write-Host "  OK: port $TargetPort is listening (PID $($owner.ProcessId), $($owner.Name))."
        return $exePath
      }
    }
    Start-Sleep -Seconds 2
  }
  throw "Timed out after 120 s waiting for a process under $TargetInstallDir to listen on port $TargetPort."
}

function Show-CutoverSummary {
  param(
    [Parameter(Mandatory)] $InstallerInfo,
    [Parameter(Mandatory)] [string] $LaunchedExe,
    [Parameter(Mandatory)] [int] $TargetPort,
    [switch] $WithBackup,
    [string] $TargetBackupRoot
  )
  Write-Host ''
  Write-Host '[Step 10/10] Cutover complete.' -ForegroundColor Green
  Write-Host "  Installed version: $($InstallerInfo.Version)"
  Write-Host "  Executable:        $LaunchedExe"
  Write-Host "  Port:              $TargetPort listening"
  if ($WithBackup) {
    Write-Host "  Backup folder:     $TargetBackupRoot"
    Write-Host '  Keep the backup folder until you are satisfied with the fork.'
    Write-Host ''
    Write-Host 'Restore command (run from a terminal that T3 Code did not start):' -ForegroundColor Cyan
    Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File `"$RepoRoot\fork\Restore-T3Nightly.ps1`" -BackupPath `"$TargetBackupRoot`""
  } else {
    Write-Host ''
    Write-Host 'Rollback (no backup was created):' -ForegroundColor Cyan
    Write-Host "  Install the latest Nightly from $NightlyReleasesUrl over the fork."
  }
}

# Main execution
Assert-NotRunningInsideT3Code -TargetInstallDir $InstallDir -IsDryRun:$DryRun -AllowDryRunBypass:$AllowInT3DryRun
$installerInfo = Resolve-CutoverInstaller -InstallerPath $Installer -YmlPath $LatestYmlPath
$planResult = Show-CutoverPlanAndConfirm `
  -InstallerInfo $installerInfo `
  -EnableBackup:$Backup `
  -TargetBackupRoot $BackupRoot `
  -TargetInstallDir $InstallDir `
  -TargetAppDataProfile $AppDataProfileDir `
  -TargetT3Home $T3Home `
  -TargetPort $Port `
  -ExcludeWorktrees:$SkipWorktrees `
  -IsDryRun:$DryRun

if (-not $planResult.Continue) {
  exit 0
}

Test-T3ScheduledTasksInteractive
Stop-NightlyGracefully -TargetInstallDir $InstallDir -TargetPort $Port -AllowForceKill:$Force

$backupResult = $null
if ($Backup) {
  $backupResult = Invoke-CutoverBackup `
    -InstallerInfo $installerInfo `
    -TargetBackupRoot $BackupRoot `
    -TargetInstallDir $InstallDir `
    -TargetAppDataProfile $AppDataProfileDir `
    -TargetT3Home $T3Home `
    -ExcludeWorktrees:$SkipWorktrees
} else {
  Write-Host '[Step 6/10] Backup skipped (default; pass -Backup to enable).'
}

Install-ForkRelease -InstallerInfo $installerInfo -TargetInstallDir $InstallDir
if ($backupResult) {
  Set-ForkUserFlags -ManifestPath $backupResult.ManifestPath -Manifest $backupResult.Manifest
} else {
  Set-ForkUserFlags
}
$launchedExe = Start-ForkApp -TargetInstallDir $InstallDir -TargetPort $Port
Show-CutoverSummary `
  -InstallerInfo $installerInfo `
  -LaunchedExe $launchedExe `
  -TargetPort $Port `
  -WithBackup:$Backup `
  -TargetBackupRoot $BackupRoot
