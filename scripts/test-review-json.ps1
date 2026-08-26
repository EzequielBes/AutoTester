[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [ValidateSet('general', 'security', 'performance', 'tests', 'style')]
    [string]$Skill = 'general',

    [ValidateSet('quick', 'full')]
    [string]$Intensity = 'full',

    [int]$Runs = 6,

    [string]$PromptFile = (Join-Path $PSScriptRoot '..\prompts\review-prompt.md')
)

function Get-PromptSections {
    param([string]$Markdown)

    $sections = @{}
    $parts = [regex]::Split($Markdown, "(?m)^(?=## )")
    foreach ($part in $parts) {
        if ($part -match '(?s)^## (.+?)\r?\n(.*)$') {
            $sections[$Matches[1].Trim()] = $Matches[2].Trim()
        }
    }
    return $sections
}

function Test-FindingsSchema {
    param($Parsed)

    $errors = @()
    if ($null -eq $Parsed.findings -or -not ($Parsed.findings -is [System.Collections.IEnumerable])) {
        return @('"findings" must be an array')
    }
    $validSeverities = @('high', 'medium', 'low')
    $validCategories = @('security', 'performance', 'style', 'bug', 'test-coverage')
    $i = 0
    foreach ($finding in $Parsed.findings) {
        if (-not $finding.file) { $errors += "findings[$i].file missing" }
        if (-not $finding.lines -or $finding.lines -notmatch '^\d+(-\d+)?$') { $errors += "findings[$i].lines invalid" }
        if ($validSeverities -notcontains $finding.severity) { $errors += "findings[$i].severity invalid" }
        if ($validCategories -notcontains $finding.category) { $errors += "findings[$i].category invalid" }
        if ($null -eq $finding.message -or $finding.message -eq '') { $errors += "findings[$i].message missing" }
        if ($null -eq $finding.suggestion) { $errors += "findings[$i].suggestion missing" }
        $i++
    }
    return $errors
}

if (-not (Test-Path $FilePath)) {
    throw "File not found: $FilePath"
}
if (-not (Test-Path $PromptFile)) {
    throw "Prompt file not found: $PromptFile"
}

$markdown = Get-Content -Path $PromptFile -Raw
$sections = Get-PromptSections -Markdown $markdown

$base = $sections['Base']
$skillBlock = $sections["Skill: $Skill"]
$intensityBlock = $sections["Intensity: $Intensity"]

if (-not $base) { throw 'Prompt file is missing a "## Base" section' }
if (-not $skillBlock) { throw "Prompt file is missing a `"## Skill: $Skill`" section" }
if (-not $intensityBlock) { throw "Prompt file is missing a `"## Intensity: $Intensity`" section" }

$systemPrompt = "$base`n`n$skillBlock`n`n$intensityBlock"

$fileContent = Get-Content -Path $FilePath -Raw
$relativePath = Split-Path -Leaf $FilePath
$content = "=== $relativePath ===`n$fileContent"

$results = @()

for ($run = 1; $run -le $Runs; $run++) {
    Write-Host "Run $run/$Runs..." -ForegroundColor Cyan

    $argsList = @('-p', '--output-format', 'json', '--append-system-prompt', $systemPrompt, $content)
    $rawOutput = & claude @argsList 2>$null

    $record = [ordered]@{
        Run           = $run
        Valid         = $false
        FindingsCount = $null
        Error         = $null
    }

    try {
        $envelope = $rawOutput | ConvertFrom-Json -ErrorAction Stop
        $parsed = $envelope.result | ConvertFrom-Json -ErrorAction Stop
        $errors = Test-FindingsSchema -Parsed $parsed
        if ($errors.Count -eq 0) {
            $record.Valid = $true
            $record.FindingsCount = @($parsed.findings).Count
        } else {
            $record.Error = $errors -join '; '
        }
    } catch {
        $record.Error = $_.Exception.Message
    }

    $results += [pscustomobject]$record
}

$results | Format-Table -AutoSize

$validCount = ($results | Where-Object { $_.Valid }).Count
$threshold = [math]::Ceiling(2 / 3 * $Runs)

Write-Host ""
Write-Host "Valid JSON: $validCount/$Runs (threshold: $threshold)" -ForegroundColor Yellow

if ($validCount -gt 0) {
    $counts = $results | Where-Object { $_.Valid } | Select-Object -ExpandProperty FindingsCount
    Write-Host "Findings count per valid run: $($counts -join ', ')" -ForegroundColor Yellow
}

if ($validCount -ge $threshold) {
    Write-Host "PASS: consistency threshold met." -ForegroundColor Green
    exit 0
} else {
    Write-Host "FAIL: below consistency threshold. Revise prompts/review-prompt.md (more few-shot examples, less ambiguity) and re-run." -ForegroundColor Red
    exit 1
}
