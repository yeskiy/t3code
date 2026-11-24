<#
.SYNOPSIS
Syncs upstream/main into every local feature/* branch and updates the fork/main integration branch via forward merges.

.DESCRIPTION
Fetches upstream/main, merges it into each feature/* branch (handling branches checked out in linked worktrees),
and merges upstream/main plus every feature/* branch into fork/main.
Never pushes or force-pushes. Never deletes branches unless both -DeleteMerged and -Force are passed.
Stops on the first conflict and prints the conflicted files and exact recovery steps.

.PARAMETER UpstreamRemote
Git remote name for upstream. Default: upstream.

.PARAMETER UpstreamBranch
Upstream branch name to fetch and merge. Default: main.

.PARAMETER IntegrationBranch
Local integration branch name. Default: fork/main.

.PARAMETER FeaturePrefix
Prefix used to auto-discover feature branches when -Features is omitted. Default: feature/.

.PARAMETER Features
Optional explicit list of feature branch names to sync and merge into the integration branch.

.PARAMETER SkipFetch
Skip running git fetch against the upstream remote. Useful when resuming after resolving a conflict.

.PARAMETER DeleteMerged
Delete local feature branches already merged into the integration branch (and not checked out in any worktree).
Requires -Force.

.PARAMETER Force
Required together with -DeleteMerged to allow deleting merged local feature branches. Never triggers a force-push.

.PARAMETER DryRun
Print the sync plan without fetching or modifying any branch or worktree.

.PARAMETER RepoPath
Repository root path. Defaults to the repository containing this script.
#>
[CmdletBinding()]
param(
  [string] $UpstreamRemote = 'upstream',
  [string] $UpstreamBranch = 'main',
  [string] $IntegrationBranch = 'fork/main',
  [string] $FeaturePrefix = 'feature/',
  [string[]] $Features,
  [switch] $SkipFetch,
  [switch] $DeleteMerged,
  [switch] $Force,
  [switch] $DryRun,
  [string] $RepoPath
)

$ErrorActionPreference = 'Stop'

if ($DeleteMerged -and -not $Force) {
  throw 'Refusing to delete branches without -Force. Re-run with -DeleteMerged -Force.'
}

function Invoke-GitCapture {
  param(
    [Parameter(Mandatory)] [string] $Directory,
    [Parameter(Mandatory)] [string[]] $Arguments
  )
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & git -C $Directory @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  return [PSCustomObject]@{
    ExitCode = $exitCode
    Output   = @($output | ForEach-Object { "$_" })
  }
}

function Invoke-GitChecked {
  param(
    [Parameter(Mandatory)] [string] $Directory,
    [Parameter(Mandatory)] [string[]] $Arguments
  )
  $result = Invoke-GitCapture -Directory $Directory -Arguments $Arguments
  if ($result.ExitCode -ne 0) {
    $joined = ($result.Output -join [Environment]::NewLine).Trim()
    throw "git $($Arguments -join ' ') failed in $Directory (exit $($result.ExitCode)): $joined"
  }
  return $result.Output
}

function Get-WorktreeBranchMap {
  param([Parameter(Mandatory)] [string] $Directory)
  $lines = Invoke-GitChecked -Directory $Directory -Arguments @('worktree', 'list', '--porcelain')
  $map = @{}
  $currentPath = $null
  foreach ($line in $lines) {
    if ($line -match '^worktree (.+)$') {
      $currentPath = $Matches[1].Trim()
    } elseif ($line -match '^branch refs/heads/(.+)$' -and $currentPath) {
      $map[$Matches[1].Trim()] = $currentPath
    } elseif ([string]::IsNullOrWhiteSpace($line)) {
      $currentPath = $null
    }
  }
  return $map
}

function Test-InProgressGitOperation {
  param([Parameter(Mandatory)] [string] $Directory)
  $gitDirLines = Invoke-GitChecked -Directory $Directory -Arguments @('rev-parse', '--git-dir')
  $gitDir = ($gitDirLines | Select-Object -First 1).Trim()
  if (-not [IO.Path]::IsPathRooted($gitDir)) {
    $gitDir = Join-Path $Directory $gitDir
  }
  $markers = @('MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'rebase-merge', 'rebase-apply')
  foreach ($marker in $markers) {
    if (Test-Path -LiteralPath (Join-Path $gitDir $marker)) {
      return $marker
    }
  }
  return $null
}

function Assert-CleanWorktree {
  param(
    [Parameter(Mandatory)] [string] $Directory,
    [Parameter(Mandatory)] [string] $Label
  )
  $inProgress = Test-InProgressGitOperation -Directory $Directory
  if ($inProgress) {
    throw "$Label ($Directory) has an unfinished Git operation ($inProgress). Finish or abort it first."
  }
  $status = Invoke-GitChecked -Directory $Directory -Arguments @('status', '--porcelain')
  $dirty = @($status | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($dirty.Count -gt 0) {
    throw "$Label ($Directory) has uncommitted changes. Commit, stash, or discard them before syncing."
  }
}

function Show-ConflictAndExit {
  param(
    [Parameter(Mandatory)] [string] $Directory,
    [Parameter(Mandatory)] [string] $TargetBranch,
    [Parameter(Mandatory)] [string] $SourceRef,
    [string[]] $MergeOutput
  )
  $conflicts = Invoke-GitCapture -Directory $Directory -Arguments @('diff', '--name-only', '--diff-filter=U')
  Write-Host ''
  Write-Host "CONFLICT while merging '$SourceRef' into '$TargetBranch' in:" -ForegroundColor Red
  Write-Host "  $Directory" -ForegroundColor Red
  if ($conflicts.Output.Count -gt 0) {
    Write-Host ''
    Write-Host 'Conflicted files (check nearby // fork: markers):' -ForegroundColor Yellow
    foreach ($file in $conflicts.Output) {
      if (-not [string]::IsNullOrWhiteSpace($file)) {
        Write-Host "  - $file"
      }
    }
  } elseif ($MergeOutput.Count -gt 0) {
    Write-Host ''
    Write-Host ($MergeOutput -join [Environment]::NewLine)
  }
  Write-Host ''
  Write-Host 'To resolve and continue:' -ForegroundColor Cyan
  Write-Host "  1. Open the conflicted files in `"$Directory`" and resolve each conflict."
  Write-Host "  2. git -C `"$Directory`" add <resolved-files>"
  Write-Host "  3. git -C `"$Directory`" commit --no-edit"
  Write-Host '  4. Re-run: fork/Sync-Upstream.ps1 -SkipFetch'
  Write-Host ''
  Write-Host 'To abort this merge instead:' -ForegroundColor Cyan
  Write-Host "  git -C `"$Directory`" merge --abort"
  exit 1
}

function Merge-RefIntoBranch {
  param(
    [Parameter(Mandatory)] [string] $RepoRoot,
    [Parameter(Mandatory)] [hashtable] $WorktreeMap,
    [Parameter(Mandatory)] [string] $TargetBranch,
    [Parameter(Mandatory)] [string] $SourceRef,
    [Parameter(Mandatory)] [ref] $SwitchedRepoRoot
  )
  $normalizedRoot = [IO.Path]::GetFullPath($RepoRoot)
  $linkedWorktree = $null
  if ($WorktreeMap.ContainsKey($TargetBranch)) {
    $candidateDir = [IO.Path]::GetFullPath($WorktreeMap[$TargetBranch])
    if (-not $candidateDir.Equals($normalizedRoot, [StringComparison]::OrdinalIgnoreCase)) {
      $linkedWorktree = $WorktreeMap[$TargetBranch]
    }
  }

  $targetDir = if ($linkedWorktree) { $linkedWorktree } else { $RepoRoot }

  if (-not $linkedWorktree) {
    $currentBranch = ((Invoke-GitChecked -Directory $RepoRoot -Arguments @('rev-parse', '--abbrev-ref', 'HEAD')) | Select-Object -First 1).Trim()
    if ($currentBranch -ne $TargetBranch) {
      $null = Invoke-GitChecked -Directory $RepoRoot -Arguments @('checkout', $TargetBranch)
      $SwitchedRepoRoot.Value = $true
    }
  }

  $ancestor = Invoke-GitCapture -Directory $targetDir -Arguments @('merge-base', '--is-ancestor', $SourceRef, 'HEAD')
  if ($ancestor.ExitCode -eq 0) {
    Write-Host "  Up to date: $TargetBranch already contains $SourceRef"
    return
  }

  Write-Host "  Merging $SourceRef -> $TargetBranch ($targetDir)..."
  $merge = Invoke-GitCapture -Directory $targetDir -Arguments @('merge', '--no-edit', $SourceRef)
  if ($merge.ExitCode -ne 0) {
    Show-ConflictAndExit -Directory $targetDir -TargetBranch $TargetBranch -SourceRef $SourceRef -MergeOutput $merge.Output
  }
  Write-Host "  Merged: $TargetBranch" -ForegroundColor Green
}

$startDir = if ($RepoPath) { (Resolve-Path -LiteralPath $RepoPath).Path } else { Split-Path -Parent $PSScriptRoot }
$repoRoot = ((Invoke-GitChecked -Directory $startDir -Arguments @('rev-parse', '--show-toplevel')) | Select-Object -First 1).Trim()
$upstreamRef = "$UpstreamRemote/$UpstreamBranch"

# Verify remote and integration branch exist.
$remoteCheck = Invoke-GitCapture -Directory $repoRoot -Arguments @('remote', 'get-url', $UpstreamRemote)
if ($remoteCheck.ExitCode -ne 0) {
  throw "Git remote '$UpstreamRemote' is not configured in $repoRoot."
}
$intCheck = Invoke-GitCapture -Directory $repoRoot -Arguments @('show-ref', '--verify', '--quiet', "refs/heads/$IntegrationBranch")
if ($intCheck.ExitCode -ne 0) {
  throw "Integration branch '$IntegrationBranch' does not exist locally."
}

$rerere = Invoke-GitCapture -Directory $repoRoot -Arguments @('config', '--get', 'rerere.enabled')
if ($rerere.ExitCode -ne 0 -or (($rerere.Output -join '').Trim() -ne 'true')) {
  Write-Host 'Tip: run "git config rerere.enabled true" so Git replays repeated conflict resolutions.' -ForegroundColor DarkYellow
}

# Resolve feature branch list.
$featureBranches = @()
if ($Features -and $Features.Count -gt 0) {
  foreach ($candidate in $Features) {
    $exact = Invoke-GitCapture -Directory $repoRoot -Arguments @('show-ref', '--verify', '--quiet', "refs/heads/$candidate")
    if ($exact.ExitCode -eq 0) {
      $featureBranches += $candidate
      continue
    }
    $prefixed = "$FeaturePrefix$candidate"
    $withPrefix = Invoke-GitCapture -Directory $repoRoot -Arguments @('show-ref', '--verify', '--quiet', "refs/heads/$prefixed")
    if ($withPrefix.ExitCode -eq 0) {
      $featureBranches += $prefixed
      continue
    }
    throw "Feature branch '$candidate' was not found locally."
  }
} else {
  $discovered = Invoke-GitChecked -Directory $repoRoot -Arguments @('for-each-ref', '--sort=refname', '--format=%(refname:short)', "refs/heads/$FeaturePrefix*")
  $featureBranches = @($discovered | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and $_ -ne $IntegrationBranch })
}

$worktreeMap = Get-WorktreeBranchMap -Directory $repoRoot

# Identify every directory that will be touched and confirm it is clean before changing anything.
$dirsToCheck = @{}
$needsRootCheckout = $false
foreach ($branch in (@($featureBranches) + @($IntegrationBranch))) {
  if ($worktreeMap.ContainsKey($branch)) {
    $dirsToCheck[$worktreeMap[$branch]] = $branch
  } else {
    $needsRootCheckout = $true
  }
}
if ($needsRootCheckout) {
  $dirsToCheck[$repoRoot] = 'current checkout'
}

foreach ($entry in $dirsToCheck.GetEnumerator()) {
  Assert-CleanWorktree -Directory $entry.Key -Label $entry.Value
}

Write-Host "Upstream:    $upstreamRef"
Write-Host "Integration: $IntegrationBranch"
Write-Host "Features ($($featureBranches.Count)):"
if ($featureBranches.Count -eq 0) {
  Write-Host "  (none matching '$FeaturePrefix*')"
} else {
  foreach ($branch in $featureBranches) {
    $where = if ($worktreeMap.ContainsKey($branch)) { "worktree: $($worktreeMap[$branch])" } else { "checkout in $repoRoot" }
    Write-Host "  - $branch ($where)"
  }
}
if ($DeleteMerged) {
  Write-Host 'Cleanup:     will delete merged local feature branches not checked out in any worktree (-DeleteMerged -Force)'
}

if ($DryRun) {
  Write-Host ''
  Write-Host 'Dry run complete. No branches or worktrees were modified.' -ForegroundColor Cyan
  exit 0
}

if (-not $SkipFetch) {
  Write-Host ''
  Write-Host "Fetching $upstreamRef..."
  $null = Invoke-GitChecked -Directory $repoRoot -Arguments @('fetch', '--no-tags', $UpstreamRemote, $UpstreamBranch)
}

$refCheck = Invoke-GitCapture -Directory $repoRoot -Arguments @('rev-parse', '--verify', '--quiet', "refs/remotes/$upstreamRef")
if ($refCheck.ExitCode -ne 0) {
  throw "Remote ref '$upstreamRef' does not exist. Re-run without -SkipFetch."
}

$originalHead = ((Invoke-GitChecked -Directory $repoRoot -Arguments @('rev-parse', '--abbrev-ref', 'HEAD')) | Select-Object -First 1).Trim()
$switchedRepoRoot = $false

Write-Host ''
Write-Host "Step 1: Merge $upstreamRef into each feature branch"
foreach ($branch in $featureBranches) {
  Merge-RefIntoBranch `
    -RepoRoot $repoRoot `
    -WorktreeMap $worktreeMap `
    -TargetBranch $branch `
    -SourceRef $upstreamRef `
    -SwitchedRepoRoot ([ref] $switchedRepoRoot)
}

Write-Host ''
Write-Host "Step 2: Update $IntegrationBranch with $upstreamRef and all feature branches"
Merge-RefIntoBranch `
  -RepoRoot $repoRoot `
  -WorktreeMap $worktreeMap `
  -TargetBranch $IntegrationBranch `
  -SourceRef $upstreamRef `
  -SwitchedRepoRoot ([ref] $switchedRepoRoot)

foreach ($branch in $featureBranches) {
  Merge-RefIntoBranch `
    -RepoRoot $repoRoot `
    -WorktreeMap $worktreeMap `
    -TargetBranch $IntegrationBranch `
    -SourceRef $branch `
    -SwitchedRepoRoot ([ref] $switchedRepoRoot)
}

if ($switchedRepoRoot -and $originalHead -and $originalHead -ne 'HEAD') {
  $null = Invoke-GitChecked -Directory $repoRoot -Arguments @('checkout', $originalHead)
}

if ($DeleteMerged -and $Force) {
  Write-Host ''
  Write-Host 'Step 3: Delete merged local feature branches (-DeleteMerged -Force)'
  $freshWorktreeMap = Get-WorktreeBranchMap -Directory $repoRoot
  foreach ($branch in $featureBranches) {
    if ($freshWorktreeMap.ContainsKey($branch)) {
      Write-Host "  Skipped $branch (checked out in $($freshWorktreeMap[$branch]))"
      continue
    }
    $merged = Invoke-GitCapture -Directory $repoRoot -Arguments @('merge-base', '--is-ancestor', $branch, $IntegrationBranch)
    if ($merged.ExitCode -ne 0) {
      Write-Host "  Skipped $branch (not an ancestor of $IntegrationBranch)"
      continue
    }
    $null = Invoke-GitChecked -Directory $repoRoot -Arguments @('branch', '-d', $branch)
    Write-Host "  Deleted $branch" -ForegroundColor Yellow
  }
}

$finalSha = ((Invoke-GitChecked -Directory $repoRoot -Arguments @('rev-parse', '--short', $IntegrationBranch)) | Select-Object -First 1).Trim()
Write-Host ''
Write-Host "Sync complete. $IntegrationBranch is at $finalSha." -ForegroundColor Green
Write-Host 'Next manual steps:'
Write-Host "  1. Run checks: vp run check:changed $upstreamRef"
Write-Host "  2. Push without force: git push origin ${IntegrationBranch}:main"
Write-Host '  3. Disable any newly added upstream workflows on GitHub.'
