<#
.SYNOPSIS
    Dispatch a research task to Gemini (Researcher Agent) following the
    contract in agents/researcher.md, and save the cleaned output to logs/research/.

.DESCRIPTION
    Wraps the gemini CLI so that:
      1. agents/researcher.md is always prepended to the prompt (auto-load contract).
      2. A real ISO-8601 UTC timestamp and task-id are injected by the PM, not by the LLM.
      3. CLI noise lines (true color warning, ripgrep fallback, tool errors) are stripped
         from the captured output. Everything before the first Markdown H1 is dropped.
      4. The cleaned report is written to logs/research/<task-id>_<slug>.md.

.PARAMETER TaskId
    Backlog task identifier, e.g. "task-003".

.PARAMETER Slug
    Short kebab-case slug describing the research target, e.g. "electron-migration".

.PARAMETER PromptFile
    Path to the user-authored prompt body file (the [TASK] / [DELIVERABLE] block).

.PARAMETER Model
    Optional Gemini model override. If omitted, uses gemini default.

.EXAMPLE
    .\scripts\run-researcher.ps1 -TaskId task-003 -Slug node-pty-abi `
        -PromptFile .\logs\research\_prompt_task-003.txt
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $TaskId,

    [Parameter(Mandatory = $true)]
    [string] $Slug,

    [Parameter(Mandatory = $true)]
    [string] $PromptFile,

    [string] $Model = ""
)

$ErrorActionPreference = "Stop"

$projectRoot   = Split-Path -Parent $PSScriptRoot
$contractPath  = Join-Path $projectRoot "agents\researcher.md"
$researchDir   = Join-Path $projectRoot "logs\research"
$outputPath    = Join-Path $researchDir ("{0}_{1}.md" -f $TaskId, $Slug)
$timestampUtc  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

if (-not (Test-Path $contractPath)) {
    throw "Contract file not found: $contractPath"
}
if (-not (Test-Path $PromptFile)) {
    throw "Prompt file not found: $PromptFile"
}
if (-not (Test-Path $researchDir)) {
    New-Item -ItemType Directory -Path $researchDir -Force | Out-Null
}

$contract = Get-Content -Raw -Encoding UTF8 $contractPath
$body     = Get-Content -Raw -Encoding UTF8 $PromptFile

$header = @"
[FROM] Claude Code (PM) at carrotcap-cli
[TO] Gemini (Researcher Agent)
[TASK ID] $TaskId
[DISPATCHED AT] $timestampUtc

[CONTRACT — agents/researcher.md, follow exactly]
$contract

[PM INSTRUCTIONS]
- Use the [DISPATCHED AT] timestamp above as your "조사 시점"; do NOT invent a different one.
- Output ONLY the Markdown report described below. No preface, no closing remarks.
- Do not run shell commands or grep on this repository — work from the [CONTEXT] block alone.

[TASK BODY]
"@

$fullPrompt = $header + "`n" + $body

# Capture raw output (stdout + stderr) into a temp string.
$rawLines = $fullPrompt | gemini -p "" 2>&1 | ForEach-Object { "$_" }

# Strip leading noise: drop everything before the first Markdown H1.
$startIdx = -1
for ($i = 0; $i -lt $rawLines.Count; $i++) {
    if ($rawLines[$i] -match "^# ") { $startIdx = $i; break }
}
if ($startIdx -lt 0) {
    Write-Warning "No Markdown H1 found in Gemini output — saving raw."
    $cleaned = $rawLines
} else {
    $cleaned = $rawLines[$startIdx..($rawLines.Count - 1)]
}

# Write UTF-8 with BOM (per global encoding rule for .md files).
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($outputPath, ($cleaned -join "`r`n"), $utf8Bom)

Write-Host "[researcher] saved: $outputPath" -ForegroundColor Green
Write-Host "[researcher] task-id: $TaskId  dispatched-at: $timestampUtc"
