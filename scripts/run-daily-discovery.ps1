$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env.local'
if (-not (Test-Path -LiteralPath $envFile)) {
  throw 'Create .env.local from .env.example and set SCHEDULE_SECRET before running scheduled discovery.'
}

$secretLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^\s*SCHEDULE_SECRET\s*=' } | Select-Object -Last 1
if (-not $secretLine -or $secretLine -notmatch '^\s*SCHEDULE_SECRET\s*=\s*(.+?)\s*$') {
  throw 'SCHEDULE_SECRET is missing from .env.local.'
}
$scheduleSecret = $Matches[1].Trim().Trim('"').Trim("'")
if (-not $scheduleSecret) { throw 'SCHEDULE_SECRET is empty in .env.local.' }

Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3000/api/scheduled/discover' -Headers @{ Authorization = "Bearer $scheduleSecret" } | ConvertTo-Json -Depth 6
