<#
.SYNOPSIS
    Dispatch a code review task to Codex (Reviewer Agent) following the
    contract in agents/reviewer.md, and save the structured report to logs/review/.

.DESCRIPTION
    Wraps the codex CLI so that:
      1. agents/reviewer.md is always prepended to the prompt (auto-load contract).
      2. A real ISO-8601 UTC timestamp and task-id are injected by the PM, not by the LLM.
      3. Codex runs with --skip-git-repo-check --sandbox read-only and -C set to the
         project root, so it can read source files but cannot mutate them.
      4. The structured "last message" is written via -o to logs/review/<task-id>_<slug>.md.
         Codex's verbose stdout (model header, token counts) is captured separately to
         logs/review/<task-id>_<slug>.codex-stdout.log for debugging.

.PARAMETER TaskId
    Backlog task identifier, e.g. "task-003".

.PARAMETER Slug
    Short kebab-case slug describing the review target, e.g. "ipc-validation".

.PARAMETER PromptFile
    Path to the user-authored prompt body file (the [FOCUS AREAS] / [DELIVERABLE] block).

.PARAMETER Model
    Optional Codex model override (passes through as -m).

.PARAMETER KeepLog
    Keep the raw Codex stdout log after a successful run (it is always kept on failure).

.EXAMPLE
    .\scripts\run-reviewer.ps1 -TaskId task-003 -Slug ipc-validation `
        -PromptFile .\logs\review\_prompt_task-003.txt
#>
[CmdletBinding()]
param(
    # TaskId/Slug become file names under logs/review: letters, digits, '-', '_' only.
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')]
    [string] $TaskId,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')]
    [string] $Slug,

    [Parameter(Mandatory = $true)]
    [string] $PromptFile,

    [string] $Model = "",

    [switch] $KeepLog
)

$ErrorActionPreference = "Stop"

$projectRoot   = Split-Path -Parent $PSScriptRoot
$contractPath  = Join-Path $projectRoot "agents\reviewer.md"
$reviewDir     = Join-Path $projectRoot "logs\review"
$outputPath    = Join-Path $reviewDir ("{0}_{1}.md" -f $TaskId, $Slug)
$stdoutLogPath = Join-Path $reviewDir ("{0}_{1}.codex-stdout.log" -f $TaskId, $Slug)
$timestampUtc  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

if (-not (Test-Path $contractPath)) {
    throw "Contract file not found: $contractPath"
}
if (-not (Test-Path $PromptFile)) {
    throw "Prompt file not found: $PromptFile"
}
if (-not (Test-Path $reviewDir)) {
    New-Item -ItemType Directory -Path $reviewDir -Force | Out-Null
}

$contract = Get-Content -Raw -Encoding UTF8 $contractPath
$body     = Get-Content -Raw -Encoding UTF8 $PromptFile

$header = @"
[FROM] Claude Code (PM) at carrotcap-cli
[TO] Codex (Reviewer Agent)
[TASK ID] $TaskId
[DISPATCHED AT] $timestampUtc

[CONTRACT — agents/reviewer.md, follow exactly]
$contract

[PM INSTRUCTIONS]
- Use the [DISPATCHED AT] timestamp above as your "리뷰 시점"; do NOT invent a different one.
- Output ONLY the structured Markdown report described in the [TASK BODY]. No preface, no closing remarks, no diff.
- You may read source files in the project root (read-only sandbox). Do NOT modify any file.

[TASK BODY]
"@

$fullPrompt = $header + "`n" + $body

$codexArgs = @(
    "exec",
    "--skip-git-repo-check",
    "--sandbox", "read-only",
    "-C", $projectRoot,
    "-o", $outputPath
)
if ($Model) {
    $codexArgs += @("-m", $Model)
}
# Trailing "-" tells codex to read the prompt from stdin.
$codexArgs += "-"

# A report left over from an earlier run must never be mistaken for this run's result.
Remove-Item -LiteralPath $outputPath -Force -ErrorAction SilentlyContinue

$fullPrompt | & codex @codexArgs 2>&1 | Tee-Object -FilePath $stdoutLogPath | Out-Null
$codexExit = $LASTEXITCODE
if ($codexExit -ne 0) {
    throw "Codex exited with code $codexExit. See $stdoutLogPath."
}

if (-not (Test-Path $outputPath)) {
    throw "Codex did not produce output file: $outputPath. See $stdoutLogPath."
}

# Re-write output as UTF-8 with BOM (per global encoding rule for .md files).
$content = Get-Content -Raw -Encoding UTF8 $outputPath
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($outputPath, $content, $utf8Bom)

Write-Host "[reviewer] saved: $outputPath" -ForegroundColor Green
# The report is the durable artifact; the raw stdout (model banner, token counts) is
# only useful for debugging a failed run.
if ($KeepLog) {
    Write-Host "[reviewer] stdout log: $stdoutLogPath" -ForegroundColor DarkGray
} else {
    try { Remove-Item -LiteralPath $stdoutLogPath -Force -ErrorAction Stop }
    catch { Write-Warning "[reviewer] could not delete stdout log: $stdoutLogPath ($($_.Exception.Message))" }
}
Write-Host "[reviewer] task-id: $TaskId  dispatched-at: $timestampUtc"
