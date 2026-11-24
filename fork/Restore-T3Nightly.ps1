<#
.SYNOPSIS
Restores T3 Code Nightly and its data from a cutover backup created by Invoke-T3Cutover.ps1 -Backup.

.DESCRIPTION
Requires a backup folder created by running Invoke-T3Cutover.ps1 -Backup (default cutover runs do not create a backup; without a backup, roll back by installing the latest Nightly from https://github.com/pingdotgg/t3code/releases over the fork).
Rolls back a cutover after saving a pre-restore snapshot of the current state:
1. Refuses to run inside T3 Code or an inherited T3CODE_* shell.
2. Reads manifest.json, prints backup metadata and sizes, and asks for RESTORE.
3. Stops the running fork app gracefully (exact PIDs from -InstallDir only; never by name).
4. Saves the current state to <BackupPath>-before-restore-<timestamp> (excluding worktrees).
5. Mirrors install dir, Electron profile, and ~/.t3 (excluding worktrees) back from the backup, imports registry exports, and restores shortcuts.
6. Reverts fork user environment variables recorded in manifest.json.
7. Starts T3 Code (Nightly).exe and waits up to 120 s for port 3773.

.PARAMETER BackupPath
Path to the cutover backup folder (containing manifest.json) created by Invoke-T3Cutover.ps1 -Backup.

.PARAMETER ProfileName
Electron userData profile folder name under -AppDataRoot. Defaults to t3code-v2.

.PARAMETER T3Home
T3 home directory to restore into. Defaults to ~/.t3.

.PARAMETER InstallDir
Desktop app install directory to restore into. Defaults to %LOCALAPPDATA%\Programs\t3code.

.PARAMETER AppDataRoot
Parent directory of the Electron profile folder. Defaults to %APPDATA%.

.PARAMETER StartMenuDir
Start Menu Programs folder for shortcut restore. Defaults to %APPDATA%\Microsoft\Windows\Start Menu\Programs.

.PARAMETER TaskbarDir
User pinned taskbar folder for shortcut restore. Defaults to %APPDATA%\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar.

.PARAMETER Port
Backend port to verify after shutdown and startup. Defaults to 3773.

.PARAMETER DryRun
Print every planned restore action without modifying any files, registry keys, processes, or environment variables.

.PARAMETER Force
Opt-in switch that allows prompting to force-stop exact remaining PIDs under -InstallDir if graceful close times out. Never skips RESTORE confirmation.

.PARAMETER AllowInT3DryRun
Only valid together with -DryRun. Allows printing the read-only dry-run plan from a shell started by T3 Code while noting that the live guard would refuse.

.PARAMETER IsolatedTest
Test mode for verifying restore behavior against isolated test copies (never live Nightly or live .t3-fork data). Refuses any overlap with live paths and skips registry import, user env changes, and app launch.

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File E:\Projects\Opened\t3code\fork\Restore-T3Nightly.ps1 -BackupPath E:\t3fork\backup\20261124-190000

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File E:\Projects\Opened\t3code\fork\Restore-T3Nightly.ps1 -BackupPath E:\t3fork\backup\20261124-190000 -DryRun
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $BackupPath,
  [string] $ProfileName = 't3code-v2',
  [string] $T3Home = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.t3'),
  [string] $InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\t3code'),
  [string] $AppDataRoot = $env:APPDATA,
  [string] $StartMenuDir = (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
  [string] $TaskbarDir = (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'),
  [ValidateRange(1024, 65535)] [int] $Port = 3773,
  [switch] $DryRun,
  [switch] $Force,
  [switch] $AllowInT3DryRun,
  [switch] $IsolatedTest
)

$ErrorActionPreference = 'Stop'

if ($AllowInT3DryRun -and -not $DryRun) {
  throw '-AllowInT3DryRun can only be used together with -DryRun.'
}

$UserProfileDir = [Environment]::GetFolderPath('UserProfile')
$LiveInstallDir = Join-Path $env:LOCALAPPDATA 'Programs\t3code'
$LiveT3Home = Join-Path $UserProfileDir '.t3'
$LiveForkHome = Join-Path $UserProfileDir '.t3-fork'
$LiveAppData = $env:APPDATA
$LiveStartMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$LiveTaskbar = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'

$TargetAppDataProfile = Join-Path $AppDataRoot $ProfileName
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'

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

function Assert-IsolatedTestTargetsSafe {
  param(
    [Parameter(Mandatory)] [string] $TargetInstallDir,
    [Parameter(Mandatory)] [string] $TargetT3Home,
    [Parameter(Mandatory)] [string] $TargetAppDataRoot,
    [Parameter(Mandatory)] [string] $TargetStartMenu,
    [Parameter(Mandatory)] [string] $TargetTaskbar
  )
  $forbidden = @(
    $LiveInstallDir,
    $LiveT3Home,
    $LiveForkHome,
    $LiveAppData,
    $LiveStartMenu,
    $LiveTaskbar
  )
  $candidates = @(
    @{ Name = 'InstallDir'; Value = $TargetInstallDir },
    @{ Name = 'T3Home'; Value = $TargetT3Home },
    @{ Name = 'AppDataRoot'; Value = $TargetAppDataRoot },
    @{ Name = 'StartMenuDir'; Value = $TargetStartMenu },
    @{ Name = 'TaskbarDir'; Value = $TargetTaskbar }
  )
  foreach ($item in $candidates) {
    foreach ($blocked in $forbidden) {
      if ((Test-PathUnderDirectory -CandidatePath $item.Value -Directory $blocked) -or
          (Test-PathUnderDirectory -CandidatePath $blocked -Directory $item.Value)) {
        throw "Refusing -IsolatedTest because -$($item.Name) ($($item.Value)) overlaps protected live path ($blocked)."
      }
    }
  }
}

function Get-DirectoryStats {
  param(
    [Parameter(Mandatory)] [string] $Path,
    [switch] $SkipJunctions,
    [string[]] $ExcludeDirs = @()
  )
  if (-not (Test-Path -LiteralPath $Path)) {
    return [PSCustomObject]@{ Exists = $false; FileCount = 0L; ByteCount = 0L }
  }
  $normalizedExcludes = @($ExcludeDirs | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object {
    [IO.Path]::GetFullPath($_).TrimEnd('\', '/')
  })
  $fileCount = 0L
  $byteCount = 0L
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
          continue
        }
        $stack.Push($sub.FullName)
      }
    } catch {
      Write-Warning "Could not enumerate '$current': $($_.Exception.Message)"
    }
  }
  return [PSCustomObject]@{ Exists = $true; FileCount = $fileCount; ByteCount = $byteCount }
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
    [switch] $AllowDryRunBypass,
    [switch] $IsIsolatedTest
  )
  Write-Host '[Step 1/7] Checking shell origin (must not run inside T3 Code)...'
  if ($IsIsolatedTest) {
    Assert-IsolatedTestTargetsSafe `
      -TargetInstallDir $InstallDir `
      -TargetT3Home $T3Home `
      -TargetAppDataRoot $AppDataRoot `
      -TargetStartMenu $StartMenuDir `
      -TargetTaskbar $TaskbarDir
    Write-Host '  [ISOLATED TEST] Verified all target paths are isolated from live data; skipping host shell guard.' -ForegroundColor Yellow
    return
  }

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

function Resolve-BackupAppDataFolder {
  param(
    [Parameter(Mandatory)] [string] $ResolvedBackupPath,
    [Parameter(Mandatory)] [string] $ExpectedProfileName
  )
  $preferred = Join-Path $ResolvedBackupPath "appdata-$ExpectedProfileName"
  if (Test-Path -LiteralPath $preferred -PathType Container) { return $preferred }
  $fallback = Join-Path $ResolvedBackupPath 'appdata-t3code-v2'
  if (Test-Path -LiteralPath $fallback -PathType Container) { return $fallback }
  throw "Backup AppData folder not found (checked '$preferred' and '$fallback')."
}

function Read-BackupManifestAndConfirm {
  param(
    [Parameter(Mandatory)] [string] $InputBackupPath,
    [switch] $IsDryRun,
    [switch] $IsIsolatedTest
  )
  Write-Host '[Step 2/7] Reading backup manifest...'
  if (-not (Test-Path -LiteralPath $InputBackupPath -PathType Container)) {
    throw "Backup folder not found: $InputBackupPath"
  }
  $resolvedBackup = (Resolve-Path -LiteralPath $InputBackupPath).Path
  $manifestPath = Join-Path $resolvedBackup 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "manifest.json not found in $resolvedBackup"
  }

  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $backupInstallDir = Join-Path $resolvedBackup 'install-dir'
  $backupAppDataDir = Resolve-BackupAppDataFolder -ResolvedBackupPath $resolvedBackup -ExpectedProfileName $ProfileName
  $backupDotT3Dir = Join-Path $resolvedBackup 'dot-t3'

  foreach ($reqDir in @($backupInstallDir, $backupAppDataDir, $backupDotT3Dir)) {
    if (-not (Test-Path -LiteralPath $reqDir -PathType Container)) {
      throw "Required backup subfolder missing: $reqDir"
    }
  }

  $preRestoreSnapshot = "$resolvedBackup-before-restore-$Timestamp"
  $currentWorktrees = Join-Path $T3Home 'worktrees'
  $currentBytes = (Get-DirectoryStats -Path $InstallDir).ByteCount +
    (Get-DirectoryStats -Path $TargetAppDataProfile).ByteCount +
    (Get-DirectoryStats -Path $T3Home -SkipJunctions -ExcludeDirs @($currentWorktrees)).ByteCount
  $drive = New-Object IO.DriveInfo([IO.Path]::GetPathRoot($preRestoreSnapshot))

  Write-Host ''
  Write-Host '=== Restore Plan ===' -ForegroundColor Cyan
  Write-Host "  Backup folder:       $resolvedBackup"
  Write-Host "  Backup created at:   $($manifest.createdAt)"
  Write-Host "  Cutover target ver:  $($manifest.targetVersion)"
  Write-Host '  Backup contents:'
  foreach ($f in @($manifest.folders)) {
    Write-Host "    - $($f.name): $($f.targetFileCount) files, $(Format-ByteSize -Bytes ([long]$f.targetBytes))"
  }
  Write-Host "  Pre-restore safety:  $preRestoreSnapshot (current state ~$(Format-ByteSize -Bytes $currentBytes); drive $($drive.Name) free $(Format-ByteSize -Bytes $drive.AvailableFreeSpace))"
  Write-Host '  Restore targets:'
  Write-Host "    - Install dir:     $backupInstallDir -> $InstallDir (/MIR)"
  Write-Host "    - AppData profile: $backupAppDataDir -> $TargetAppDataProfile (/MIR)"
  Write-Host "    - T3 home:         $backupDotT3Dir -> $T3Home (/MIR /XJ /XD worktrees)"
  if ($IsIsolatedTest) {
    Write-Host '    - Registry/Env/Start: skipped (-IsolatedTest)'
  } else {
    Write-Host "    - Registry import: uninstall-key.reg, install-key.reg (if present), t3code-protocol.reg (if present)"
    Write-Host "    - Shortcuts:       restore to $StartMenuDir and $TaskbarDir (prompt before deleting T3 Code (Beta).lnk)"
    Write-Host '    - Env vars:        revert fork user env vars recorded in manifest.json'
    Write-Host "    - Start app:       launch T3 Code (Nightly).exe and wait up to 120 s for port $Port"
  }
  Write-Host ''
  Write-Host 'WARNING: Restore overwrites current data and drops thread, project, and setting changes made after cutover.' -ForegroundColor Yellow
  Write-Host 'Note: if the fork app has Close to tray enabled, right-click the tray icon and choose Quit first.' -ForegroundColor Yellow

  if ($drive.AvailableFreeSpace -lt ($currentBytes * 2L)) {
    $msg = "Insufficient free space on $($drive.Name) for pre-restore snapshot: need $(Format-ByteSize -Bytes ($currentBytes * 2L)), have $(Format-ByteSize -Bytes $drive.AvailableFreeSpace)."
    if ($IsDryRun) {
      Write-Host "  [SPACE ERROR] $msg" -ForegroundColor Red
    } else {
      throw $msg
    }
  }

  if ($IsDryRun) {
    Write-Host ''
    Write-Host 'Dry run complete. No processes were stopped and no files, registry keys, or env vars were changed.' -ForegroundColor Cyan
    return [PSCustomObject]@{
      Continue           = $false
      ResolvedBackupPath = $resolvedBackup
      Manifest           = $manifest
      BackupInstallDir   = $backupInstallDir
      BackupAppDataDir   = $backupAppDataDir
      BackupDotT3Dir     = $backupDotT3Dir
      PreRestoreSnapshot = $preRestoreSnapshot
    }
  }

  if (-not $IsIsolatedTest) {
    $reply = Read-Host 'Type RESTORE to save current state and roll back to the Nightly backup'
    if ($reply -cne 'RESTORE') {
      throw 'Restore cancelled by user.'
    }
  }

  return [PSCustomObject]@{
    Continue           = $true
    ResolvedBackupPath = $resolvedBackup
    Manifest           = $manifest
    BackupInstallDir   = $backupInstallDir
    BackupAppDataDir   = $backupAppDataDir
    BackupDotT3Dir     = $backupDotT3Dir
    PreRestoreSnapshot = $preRestoreSnapshot
  }
}

function Stop-ForkAppGracefully {
  param(
    [Parameter(Mandatory)] [string] $TargetInstallDir,
    [Parameter(Mandatory)] [int] $TargetPort,
    [switch] $AllowForceKill,
    [switch] $IsIsolatedTest
  )
  Write-Host '[Step 3/7] Stopping running app gracefully...'
  $procs = @(Get-InstallDirProcesses -TargetInstallDir $TargetInstallDir)
  if ($procs.Count -eq 0) {
    Write-Host "  OK: no processes running from $TargetInstallDir."
    return
  }

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
    $listeners = if ($IsIsolatedTest) { @() } else { @(Get-PortListeners -TargetPort $TargetPort) }
    if ($remaining.Count -eq 0 -and $listeners.Count -eq 0) {
      Write-Host "  OK: all processes from $TargetInstallDir exited."
      return
    }
    Start-Sleep -Seconds 2
  }

  $remaining = @(Get-InstallDirProcesses -TargetInstallDir $TargetInstallDir)
  if ($remaining.Count -gt 0) {
    Write-Host '  Processes still running under install dir after 90 s (if Close to tray is on, use tray -> Quit):' -ForegroundColor Yellow
    foreach ($p in $remaining) {
      Write-Host "    PID $($p.ProcessId): $($p.Name) ($($p.ExecutablePath))"
    }
    if (-not $AllowForceKill) {
      throw 'Processes remained after 90 s. Quit T3 Code from the system tray or re-run with -Force to confirm force-stopping those exact PIDs.'
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

  if (-not $IsIsolatedTest) {
    $listeners = @(Get-PortListeners -TargetPort $TargetPort)
    if ($listeners.Count -gt 0) {
      $owners = ($listeners | ForEach-Object { "PID $($_.OwningProcess)" }) -join ', '
      throw "Port $TargetPort is still in use by $owners."
    }
  }
}

function Invoke-RobocopyStep {
  param(
    [Parameter(Mandatory)] [string] $Label,
    [Parameter(Mandatory)] [string] $Source,
    [Parameter(Mandatory)] [string] $Destination,
    [switch] $Mirror,
    [switch] $SkipJunctions,
    [string[]] $ExcludeDirs = @()
  )
  $null = New-Item -ItemType Directory -Path $Destination -Force
  $modeFlag = if ($Mirror) { '/MIR' } else { '/E' }
  $args = @($Source, $Destination, $modeFlag, '/COPY:DAT', '/DCOPY:DAT')
  if ($SkipJunctions) { $args += '/XJ' }
  $nonEmptyExcludes = @($ExcludeDirs | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($nonEmptyExcludes.Count -gt 0) {
    $args += '/XD'
    $args += $nonEmptyExcludes
  }
  $args += @('/R:1', '/W:1', '/NP', '/NFL', '/NDL')

  Write-Host "  $Label..."
  & robocopy @args | Out-Null
  $exitCode = $LASTEXITCODE
  if ($exitCode -ge 8) {
    throw "robocopy failed for $Label (exit code $exitCode): $Source -> $Destination"
  }
  Write-Host "    Done (robocopy exit $exitCode)"
}

function Save-PreRestoreState {
  param([Parameter(Mandatory)] [string] $SnapshotDir)
  Write-Host "[Step 4/7] Saving current state to $SnapshotDir..."
  $null = New-Item -ItemType Directory -Path $SnapshotDir -Force

  if (Test-Path -LiteralPath $InstallDir) {
    Invoke-RobocopyStep -Label 'Snapshot install-dir' -Source $InstallDir -Destination (Join-Path $SnapshotDir 'install-dir')
  }
  if (Test-Path -LiteralPath $TargetAppDataProfile) {
    Invoke-RobocopyStep -Label "Snapshot appdata-$ProfileName" -Source $TargetAppDataProfile -Destination (Join-Path $SnapshotDir "appdata-$ProfileName")
  }
  if (Test-Path -LiteralPath $T3Home) {
    $worktreesDir = Join-Path $T3Home 'worktrees'
    Invoke-RobocopyStep -Label 'Snapshot dot-t3 (excluding worktrees)' -Source $T3Home -Destination (Join-Path $SnapshotDir 'dot-t3') -SkipJunctions -ExcludeDirs @($worktreesDir)
  }
}

function Restore-FromBackup {
  param(
    [Parameter(Mandatory)] $Context,
    [switch] $IsIsolatedTest
  )
  Write-Host '[Step 5/7] Restoring files, registry, and shortcuts...'
  Invoke-RobocopyStep -Label 'Restore install-dir (/MIR)' -Source $Context.BackupInstallDir -Destination $InstallDir -Mirror
  Invoke-RobocopyStep -Label "Restore appdata-$ProfileName (/MIR)" -Source $Context.BackupAppDataDir -Destination $TargetAppDataProfile -Mirror
  $worktreesDir = Join-Path $T3Home 'worktrees'
  $backupWorktreesDir = Join-Path $Context.BackupDotT3Dir 'worktrees'
  Invoke-RobocopyStep -Label 'Restore dot-t3 (/MIR /XJ /XD worktrees)' -Source $Context.BackupDotT3Dir -Destination $T3Home -Mirror -SkipJunctions -ExcludeDirs @($backupWorktreesDir, $worktreesDir)

  if (-not $IsIsolatedTest) {
    $uninstallReg = Join-Path $Context.ResolvedBackupPath 'uninstall-key.reg'
    if (Test-Path -LiteralPath $uninstallReg -PathType Leaf) {
      & reg.exe import $uninstallReg | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "reg import failed for $uninstallReg (exit $LASTEXITCODE)" }
      Write-Host "  Imported registry: $uninstallReg"
    }
    foreach ($optRegName in @('install-key.reg', 't3code-protocol.reg')) {
      $optRegPath = Join-Path $Context.ResolvedBackupPath $optRegName
      if (Test-Path -LiteralPath $optRegPath -PathType Leaf) {
        & reg.exe import $optRegPath | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "reg import failed for $optRegPath (exit $LASTEXITCODE)" }
        Write-Host "  Imported registry: $optRegPath"
      }
    }
  }

  $startMenuBackup = Join-Path $Context.ResolvedBackupPath 'shortcuts\start-menu'
  if (Test-Path -LiteralPath $startMenuBackup -PathType Container) {
    $null = New-Item -ItemType Directory -Path $StartMenuDir -Force
    foreach ($lnk in (Get-ChildItem -LiteralPath $startMenuBackup -Filter '*.lnk' -File -ErrorAction SilentlyContinue)) {
      Copy-Item -LiteralPath $lnk.FullName -Destination (Join-Path $StartMenuDir $lnk.Name) -Force
      Write-Host "  Restored Start menu shortcut: $($lnk.Name)"
    }
  }

  $taskbarBackup = Join-Path $Context.ResolvedBackupPath 'shortcuts\taskbar'
  if (Test-Path -LiteralPath $taskbarBackup -PathType Container) {
    $null = New-Item -ItemType Directory -Path $TaskbarDir -Force
    foreach ($lnk in (Get-ChildItem -LiteralPath $taskbarBackup -Filter '*.lnk' -File -ErrorAction SilentlyContinue)) {
      Copy-Item -LiteralPath $lnk.FullName -Destination (Join-Path $TaskbarDir $lnk.Name) -Force
      Write-Host "  Restored taskbar shortcut: $($lnk.Name)"
    }
  }

  $betaShortcut = Join-Path $StartMenuDir 'T3 Code (Beta).lnk'
  if (Test-Path -LiteralPath $betaShortcut -PathType Leaf) {
    if ($IsIsolatedTest) {
      Write-Host "  [ISOLATED TEST] Leaving '$betaShortcut' untouched (requires interactive owner confirmation)."
    } else {
      $delReply = Read-Host "Delete '$betaShortcut' from Start menu? Type YES to delete"
      if ($delReply -ceq 'YES') {
        Remove-Item -LiteralPath $betaShortcut -Force
        Write-Host "  Removed '$betaShortcut'."
      } else {
        Write-Host "  Kept '$betaShortcut'."
      }
    }
  }
}

function Remove-ForkUserFlags {
  param(
    [Parameter(Mandatory)] $Manifest,
    [switch] $IsIsolatedTest
  )
  Write-Host '[Step 6/7] Reverting fork user environment variables...'
  if ($IsIsolatedTest) {
    Write-Host '  [ISOLATED TEST] Skipping user environment variable changes.'
    return
  }

  $applied = $null
  $before = $null
  if ($Manifest.PSObject.Properties.Name -contains 'forkUserEnvVars' -and $Manifest.forkUserEnvVars) {
    if ($Manifest.forkUserEnvVars.PSObject.Properties.Name -contains 'applied') { $applied = $Manifest.forkUserEnvVars.applied }
    if ($Manifest.forkUserEnvVars.PSObject.Properties.Name -contains 'before') { $before = $Manifest.forkUserEnvVars.before }
  }

  $revertedCount = 0
  if ($applied) {
    foreach ($prop in $applied.PSObject.Properties) {
      $name = $prop.Name
      $prevVal = $null
      if ($before -and ($before.PSObject.Properties.Name -contains $name)) {
        $prevVal = $before.$name
      }
      if ([string]::IsNullOrEmpty($prevVal)) {
        [Environment]::SetEnvironmentVariable($name, $null, 'User')
        Write-Host "  Removed User env var: $name"
      } else {
        [Environment]::SetEnvironmentVariable($name, [string]$prevVal, 'User')
        Write-Host "  Restored User env var: $name=$prevVal"
      }
      $revertedCount++
    }
  }

  if ($revertedCount -eq 0) {
    Write-Host '  No fork user environment variables were applied by this cutover.'
  }
}

function Start-RestoredNightly {
  param(
    [Parameter(Mandatory)] [string] $TargetInstallDir,
    [Parameter(Mandatory)] [int] $TargetPort,
    [switch] $IsIsolatedTest
  )
  Write-Host '[Step 7/7] Starting restored T3 Code (Nightly)...'
  if ($IsIsolatedTest) {
    Write-Host '  [ISOLATED TEST] Skipping app launch and port wait.'
    return
  }

  $exePath = Join-Path $TargetInstallDir 'T3 Code (Nightly).exe'
  if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
    $fallbackExe = Get-ChildItem -LiteralPath $TargetInstallDir -Filter '*.exe' -File |
      Where-Object { $_.Name -notmatch '^(Uninstall|elevate|t3-resource-monitor)' } |
      Select-Object -First 1
    if (-not $fallbackExe) {
      throw "Restored executable not found in $TargetInstallDir."
    }
    $exePath = $fallbackExe.FullName
  }

  Write-Host "  Launching $exePath..."
  Start-Process -FilePath $exePath -WorkingDirectory $TargetInstallDir | Out-Null

  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Date) -lt $deadline) {
    $listeners = @(Get-PortListeners -TargetPort $TargetPort)
    foreach ($l in $listeners) {
      $owner = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $($l.OwningProcess)" -ErrorAction SilentlyContinue
      if ($owner -and (Test-PathUnderDirectory -CandidatePath $owner.ExecutablePath -Directory $TargetInstallDir)) {
        Write-Host "  OK: port $TargetPort is listening (PID $($owner.ProcessId), $($owner.Name))."
        return
      }
    }
    Start-Sleep -Seconds 2
  }
  throw "Timed out after 120 s waiting for restored app under $TargetInstallDir to listen on port $TargetPort."
}

# Main execution
Assert-NotRunningInsideT3Code `
  -TargetInstallDir $InstallDir `
  -IsDryRun:$DryRun `
  -AllowDryRunBypass:$AllowInT3DryRun `
  -IsIsolatedTest:$IsolatedTest

$ctx = Read-BackupManifestAndConfirm -InputBackupPath $BackupPath -IsDryRun:$DryRun -IsIsolatedTest:$IsolatedTest
if (-not $ctx.Continue) {
  exit 0
}

Stop-ForkAppGracefully -TargetInstallDir $InstallDir -TargetPort $Port -AllowForceKill:$Force -IsIsolatedTest:$IsolatedTest
Save-PreRestoreState -SnapshotDir $ctx.PreRestoreSnapshot
Restore-FromBackup -Context $ctx -IsIsolatedTest:$IsolatedTest
Remove-ForkUserFlags -Manifest $ctx.Manifest -IsIsolatedTest:$IsolatedTest
Start-RestoredNightly -TargetInstallDir $InstallDir -TargetPort $Port -IsIsolatedTest:$IsolatedTest

Write-Host ''
Write-Host 'Restore complete.' -ForegroundColor Green
Write-Host "  Pre-restore snapshot kept at: $($ctx.PreRestoreSnapshot)"
