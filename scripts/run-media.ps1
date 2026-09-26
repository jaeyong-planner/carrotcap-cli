<#
.SYNOPSIS
    Dispatch an image/video request to Grok (Media Agent) following the contract
    in agents/media.md. Files land in assets/generated/, a log in logs/media/.

.DESCRIPTION
    Wraps the grok CLI in headless mode (`grok -p`) so that:
      1. agents/media.md is always prepended to the request (auto-load contract).
      2. A real ISO-8601 UTC timestamp and task-id are injected by the caller.
      3. Grok runs in the project root (--cwd) so relative output paths resolve there.
      4. Grok's final answer is saved to logs/media/<task-id>_<slug>.grok-stdout.log.
    For interactive work use the MEDIA button (or `grok`) and type the request instead.
    Requires `grok login` once.

.PARAMETER TaskId
    Backlog task identifier or date tag, e.g. "task-012" or "2026-09-26".

.PARAMETER Slug
    Short kebab-case slug, e.g. "logo-carrot".

.PARAMETER Request
    What to make, in plain words. Use -RequestFile for long requests.

.PARAMETER RequestFile
    Path to a file containing the request.

.PARAMETER Model
    Optional Grok model override (passes through as -m).

.PARAMETER KeepLog
    Keep Grok's raw stdout after a successful run (always kept on failure). The
    durable record is the logs/media/*.md file the agent writes per agents/media.md.

.EXAMPLE
    .\scripts\run-media.ps1 -TaskId task-012 -Slug logo-carrot `
        -Request "주황색 당근 캐릭터 앱 아이콘, 1:1, 플랫 스타일, 2장"
#>
[CmdletBinding(DefaultParameterSetName = "Inline")]
param(
    # TaskId/Slug become file names under logs/media: letters, digits, '-', '_' only.
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')]
    [string] $TaskId,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')]
    [string] $Slug,

    [Parameter(Mandatory = $true, ParameterSetName = "Inline")]
    [string] $Request,

    [Parameter(Mandatory = $true, ParameterSetName = "File")]
    [string] $RequestFile,

    [string] $Model = "",

    [switch] $KeepLog
)

$ErrorActionPreference = "Stop"

$projectRoot  = Split-Path -Parent $PSScriptRoot
$contractPath = Join-Path $projectRoot "agents\media.md"
$mediaLogDir  = Join-Path $projectRoot "logs\media"
$stdoutPath   = Join-Path $mediaLogDir ("{0}_{1}.grok-stdout.log" -f $TaskId, $Slug)
# The agent must write this record (agents/media.md §4); it is how we know the run worked.
$mediaLogPath = Join-Path $mediaLogDir ("{0}_{1}.md" -f $TaskId, $Slug)
$timestampUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

if (-not (Get-Command grok -ErrorAction SilentlyContinue)) {
    throw "grok CLI not found on PATH. Install Grok Build and run 'grok login'."
}
if (-not (Test-Path $contractPath)) {
    throw "Contract file not found: $contractPath"
}
if ($PSCmdlet.ParameterSetName -eq "File") {
    if (-not (Test-Path $RequestFile)) { throw "Request file not found: $RequestFile" }
    $Request = Get-Content -Raw -Encoding UTF8 $RequestFile
}
New-Item -ItemType Directory -Path $mediaLogDir -Force | Out-Null

$contract = Get-Content -Raw -Encoding UTF8 $contractPath
$prompt = @"
[FROM] Claude Code (PM) at CARROTCAP
[TO] Grok (Media Agent)
[TASK ID] $TaskId
[SLUG] $Slug
[DISPATCHED AT] $timestampUtc

[CONTRACT — agents/media.md, follow exactly]
$contract

[OUTPUT]
- Save files under assets/generated/.
- Write the media log to exactly: logs/media/$($TaskId)_$($Slug).md

[REQUEST]
$Request
"@

# The prompt goes through a temp file: long multi-line Korean text is not safe as a
# native-exe argument in Windows PowerShell 5.1.
$logBefore = if (Test-Path -LiteralPath $mediaLogPath) { (Get-Item -LiteralPath $mediaLogPath).LastWriteTimeUtc } else { $null }
$promptFile = [System.IO.Path]::GetTempFileName()
try {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($promptFile, $prompt, $utf8NoBom)
    $grokArgs = @("--prompt-file", $promptFile, "--cwd", $projectRoot)
    if ($Model) { $grokArgs += @("-m", $Model) }
    & grok @grokArgs 2>&1 | Tee-Object -FilePath $stdoutPath
    if ($LASTEXITCODE -ne 0) { throw "grok exited with code $LASTEXITCODE. See $stdoutPath." }
} finally {
    Remove-Item -LiteralPath $promptFile -Force -ErrorAction SilentlyContinue
}

# Exit code 0 is not enough: the media log must exist and be new or updated by THIS run,
# otherwise keep grok's stdout for diagnosis and fail.
$logAfter = if (Test-Path -LiteralPath $mediaLogPath) { (Get-Item -LiteralPath $mediaLogPath).LastWriteTimeUtc } else { $null }
if ($null -eq $logAfter -or ($null -ne $logBefore -and $logAfter -le $logBefore)) {
    throw "Grok finished but did not write $mediaLogPath for this run. See $stdoutPath."
}

Write-Host "[media] files: $(Join-Path $projectRoot 'assets\generated')" -ForegroundColor Green
Write-Host "[media] log: $mediaLogPath" -ForegroundColor Green
if ($KeepLog) {
    Write-Host "[media] grok output: $stdoutPath" -ForegroundColor DarkGray
} else {
    try { Remove-Item -LiteralPath $stdoutPath -Force -ErrorAction Stop }
    catch { Write-Warning "[media] could not delete stdout log: $stdoutPath ($($_.Exception.Message))" }
}
