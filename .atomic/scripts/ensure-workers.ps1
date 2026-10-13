#Requires -Version 5.1
<#
.SYNOPSIS
  cursor-atomic-workflow CLI 워커가 PATH에 없으면 설치한다.
.EXAMPLE
  ./ensure-workers.ps1
  ./ensure-workers.ps1 -Workers agy,codex
#>
param(
  [ValidateSet('agy', 'codex', 'claude', 'cursor', 'opencode')]
  [string[]]$Workers = @('agy', 'codex', 'claude', 'opencode')
)

$ErrorActionPreference = 'Stop'

function Refresh-Path {
  $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [System.Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = @($machine, $user, $env:Path) -join ';'
}

function Test-Bin {
  param([string[]]$Names)
  foreach ($name in $Names) {
    if (Get-Command $name -ErrorAction SilentlyContinue) { return $true }
  }
  return $false
}

function Write-State {
  param($Name, $Status, $Detail)
  [pscustomobject]@{ worker = $Name; status = $Status; detail = $Detail }
}

Refresh-Path
$results = @()

foreach ($w in $Workers) {
  switch ($w) {
    'agy' {
      if (Test-Bin @('agy', 'agy.exe')) {
        $results += Write-State 'agy' 'ok' ((Get-Command agy).Source)
      } else {
        Write-Host 'Installing agy (Antigravity CLI)...'
        irm https://antigravity.google/cli/install.ps1 | iex
        Refresh-Path
        if (Test-Bin @('agy', 'agy.exe')) {
          $results += Write-State 'agy' 'installed' ((Get-Command agy).Source)
        } else {
          $results += Write-State 'agy' 'missing' 'install.ps1 ran but agy is not on PATH. Open a new terminal.'
        }
      }
    }
    'claude' {
      if (Test-Bin @('claude', 'claude.exe')) {
        $results += Write-State 'claude' 'ok' ((Get-Command claude).Source)
      } else {
        $results += Write-State 'claude' 'missing' 'Install Claude Code CLI. Do not invent a downloader.'
      }
    }
    'codex' {
      if (Test-Bin @('codex', 'codex.exe')) {
        $results += Write-State 'codex' 'ok' ((Get-Command codex).Source)
      } else {
        Write-Host 'Installing Codex CLI (winget OpenAI.Codex)...'
        winget install --id OpenAI.Codex -e --accept-package-agreements --accept-source-agreements
        Refresh-Path
        if (Test-Bin @('codex', 'codex.exe')) {
          $results += Write-State 'codex' 'installed' ((Get-Command codex).Source)
        } else {
          $results += Write-State 'codex' 'missing' 'winget succeeded or failed; reopen terminal if PATH is stale.'
        }
      }
    }
    'cursor' {
      if (Test-Bin @('cursor-agent.cmd', 'cursor-agent', 'agent.cmd')) {
        $cmd = Get-Command cursor-agent.cmd -ErrorAction SilentlyContinue
        if (-not $cmd) { $cmd = Get-Command cursor-agent -ErrorAction SilentlyContinue }
        $results += Write-State 'cursor' 'ok' $cmd.Source
      } else {
        $results += Write-State 'cursor' 'missing' 'Install Cursor Agent CLI. Do not invent a downloader.'
      }
    }
    'opencode' {
      if (Test-Bin @('opencode', 'opencode.exe')) {
        $results += Write-State 'opencode' 'ok' ((Get-Command opencode).Source)
      } else {
        Write-Host 'Installing opencode (npm -g opencode-ai)...'
        npm install -g opencode-ai
        Refresh-Path
        if (Test-Bin @('opencode', 'opencode.exe')) {
          $results += Write-State 'opencode' 'installed' ((Get-Command opencode).Source)
        } else {
          $results += Write-State 'opencode' 'missing' 'npm global bin may be off PATH.'
        }
      }
    }
  }
}

$results | Format-Table -AutoSize
$results | ConvertTo-Json -Compress
if ($results.status -contains 'missing') { exit 1 }
exit 0
