#Requires -Version 5.1
<#
.SYNOPSIS
  cursor-atomic-workflow 항목을 agy / codex / claude / cursor / opencode CLI로 비대화형 실행한다.
.EXAMPLE
  ./invoke-worker.ps1 -Worker agy -Workspace C:\proj -PromptFile C:\brief.md -LogFile C:\run.log -Skills cursor-atomic-workflow,tdd
#>
param(
  [Parameter(Mandatory)]
  [ValidateSet('agy', 'codex', 'claude', 'cursor', 'opencode')]
  [string]$Worker,

  [Parameter(Mandatory)]
  [string]$Workspace,

  [Parameter(Mandatory)]
  [string]$PromptFile,

  [string]$LogFile,

  [string]$LastMessageFile,

  [string]$Skills,

  [string]$Model,

  [int]$TimeoutMin = 45
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::InputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Get-ReadPromptFileInstruction {
  param([string]$PromptPath)
  return "Read the file at the following path and carry out its instructions exactly. Path: $PromptPath"
}

function Refresh-Path {
  $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [System.Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = @($machine, $user, $env:Path) -join ';'
}

function Resolve-Bin {
  param([string[]]$Names)
  foreach ($name in $Names) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  }
  return $null
}

function Find-SkillRoot {
  param([string]$WorkspacePath)
  $dir = (Resolve-Path -LiteralPath $WorkspacePath).Path
  while ($dir) {
    $candidate = Join-Path $dir '.agents\skills'
    if (Test-Path -LiteralPath $candidate) { return $candidate }
    $parent = Split-Path $dir -Parent
    if (-not $parent -or $parent -eq $dir) { break }
    $dir = $parent
  }
  return $null
}

function Build-SkillsBlock {
  param([string]$WorkspacePath, [string]$SkillsCsv)
  if ([string]::IsNullOrWhiteSpace($SkillsCsv)) { return '' }
  $skillRoot = Find-SkillRoot $WorkspacePath
  if (-not $skillRoot) { return '' }
  $lines = @('MUST read skills (first tool calls):')
  foreach ($name in ($SkillsCsv -split ',')) {
    $name = $name.Trim()
    if (-not $name) { continue }
    $skillFile = Join-Path $skillRoot "$name\SKILL.md"
    if (Test-Path -LiteralPath $skillFile) {
      $lines += "- $skillFile"
    }
  }
  if ($lines.Count -le 1) { return '' }
  return ($lines -join "`n") + "`n`n"
}

function Get-SkillAddDirs {
  param([string]$WorkspacePath)
  $dirs = @((Resolve-Path -LiteralPath $WorkspacePath).Path)
  $skillRoot = Find-SkillRoot $WorkspacePath
  if ($skillRoot) { $dirs += $skillRoot }
  return $dirs
}

Refresh-Path

if (-not (Test-Path -LiteralPath $Workspace)) {
  throw "Workspace not found: $Workspace"
}
if (-not (Test-Path -LiteralPath $PromptFile)) {
  throw "Prompt file not found: $PromptFile"
}

$ws = (Resolve-Path -LiteralPath $Workspace).Path
$promptPath = (Resolve-Path -LiteralPath $PromptFile).Path
$prompt = Get-Content -LiteralPath $promptPath -Raw -Encoding UTF8
if ([string]::IsNullOrWhiteSpace($prompt)) {
  throw "Prompt file is empty: $promptPath"
}

if ([string]::IsNullOrWhiteSpace($Skills)) {
  $Skills = 'cursor-atomic-workflow,tdd'
}
$skillsBlock = Build-SkillsBlock $ws $Skills
if ($skillsBlock) { $prompt = $skillsBlock + $prompt }

if (-not $LogFile) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $LogFile = Join-Path $env:TEMP "cursor-atomic-workflow-$Worker-$stamp.log"
}
$effectivePromptFile = [System.IO.Path]::ChangeExtension($LogFile, '.effective-prompt.md')
Set-Content -LiteralPath $effectivePromptFile -Value $prompt -Encoding UTF8 -NoNewline
$logDir = Split-Path -Parent $LogFile
if ($logDir) {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}
if (-not $LastMessageFile) {
  $LastMessageFile = [System.IO.Path]::ChangeExtension($LogFile, '.last.md')
}

$agyTimeout = '{0}m0s' -f $TimeoutMin
$agyModel = $Model
if ([string]::IsNullOrWhiteSpace($agyModel) -and $env:CURSOR_ATOMIC_AGY_MODEL) {
  $agyModel = $env:CURSOR_ATOMIC_AGY_MODEL
}
if (-not [string]::IsNullOrWhiteSpace($agyModel)) {
  $resolveScript = Join-Path $PSScriptRoot 'resolve-agy-model.mjs'
  if (Test-Path -LiteralPath $resolveScript) {
    $agyModel = (& node $resolveScript $agyModel).Trim()
  } elseif ($agyModel -eq 'gemini-3.8-flash' -or $agyModel -eq 'gemini-3.8-flash-medium') {
    $agyModel = 'gemini-3.8-flash-high'
  }
}

Push-Location -LiteralPath $ws
$exitCode = 1
try {
  $modelNote = if ($agyModel) { $agyModel } else { 'default' }
  "worker=$Worker workspace=$ws started=$(Get-Date -Format o) agy_model=$modelNote" | Set-Content -LiteralPath $LogFile -Encoding UTF8

  switch ($Worker) {
    'agy' {
      $bin = Resolve-Bin @('agy', 'agy.exe')
      if (-not $bin) { throw 'agy not on PATH. Run scripts/ensure-workers.ps1 -Workers agy' }
      $agyArgs = @('--output-format', 'text', '--mode', 'accept-edits', '--dangerously-skip-permissions', '--print-timeout', $agyTimeout)
      if ($agyModel) { $agyArgs += @('--model', $agyModel) }
      foreach ($dir in (Get-SkillAddDirs $ws)) { $agyArgs += @('--add-dir', $dir) }
      $agyArgs += @('-p', (Get-ReadPromptFileInstruction $effectivePromptFile))
      & $bin @agyArgs 2>&1 | Tee-Object -FilePath $LogFile -Append
      $exitCode = $LASTEXITCODE
    }
    'codex' {
      $bin = Resolve-Bin @('codex.exe', 'codex')
      if (-not $bin) { throw 'codex not on PATH. Run scripts/ensure-workers.ps1 -Workers codex' }
      $codexPrompt = Get-ReadPromptFileInstruction $effectivePromptFile
      & $bin exec $codexPrompt --sandbox workspace-write -c 'approval_policy="never"' -C $ws --color never -o $LastMessageFile 2>&1 |
        Tee-Object -FilePath $LogFile -Append
      $exitCode = $LASTEXITCODE
    }
    'claude' {
      $bin = Resolve-Bin @('claude.exe', 'claude')
      if (-not $bin) { throw 'claude not on PATH. Run scripts/ensure-workers.ps1 -Workers claude' }
      $claudeArgs = @('-p', '--dangerously-skip-permissions')
      foreach ($dir in (Get-SkillAddDirs $ws)) { $claudeArgs += @('--add-dir', $dir) }
      Get-Content -LiteralPath $effectivePromptFile -Raw -Encoding UTF8 | & $bin @claudeArgs 2>&1 |
        Tee-Object -FilePath $LogFile -Append
      $exitCode = $LASTEXITCODE
    }
    'cursor' {
      $bin = Resolve-Bin @('cursor-agent.cmd', 'cursor-agent')
      if (-not $bin) { throw 'cursor-agent not on PATH.' }
      Get-Content -LiteralPath $effectivePromptFile -Raw -Encoding UTF8 |
        & $bin -p --force --trust --workspace $ws --output-format text 2>&1 |
        Tee-Object -FilePath $LogFile -Append
      $exitCode = $LASTEXITCODE
    }
    'opencode' {
      $bin = Resolve-Bin @('opencode.exe', 'opencode')
      if (-not $bin) { throw 'opencode not on PATH. Run scripts/ensure-workers.ps1 -Workers opencode' }
      $ocPrompt = Get-ReadPromptFileInstruction $effectivePromptFile
      & $bin run --dir $ws --auto --title "cursor-atomic-workflow" $ocPrompt 2>&1 |
        Tee-Object -FilePath $LogFile -Append
      $exitCode = $LASTEXITCODE
    }
  }
} finally {
  Pop-Location
}

if ($null -eq $exitCode) { $exitCode = 0 }
"finished=$(Get-Date -Format o) exit=$exitCode" | Add-Content -LiteralPath $LogFile -Encoding UTF8
Write-Output "log=$LogFile"
Write-Output "exit=$exitCode"
exit $exitCode
