$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
if (-not $Root) { $Root = (Get-Location).Path }
Set-Location $Root

$logDir = Join-Path $Root 'output'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'linkedin-daily-sync.log'
$stampFile = Join-Path $logDir 'linkedin-daily-sync.lastrun'
$today = Get-Date -Format 'yyyy-MM-dd'
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
if ($env:LINKEDIN_DAILY_FORCE -ne 'true' -and (Test-Path $stampFile) -and ((Get-Content $stampFile -ErrorAction SilentlyContinue | Select-Object -First 1) -eq $today)) {
  Add-Content -Path $log -Value "[$stamp] skip already ran $today"
  exit 0
}
Add-Content -Path $log -Value "[$stamp] start"

$env:LINKEDIN_BROWSER_JOBS_WRITE_ENABLED = 'true'
$env:LINKEDIN_BROWSER_CHANNEL = 'msedge'
$env:LINKEDIN_BROWSER_PROFILE_DIR = Join-Path $env:LOCALAPPDATA 'liorvix\linkedin-edge-profile'

$pnpmArgs = @(
  'exec',
  'tsx',
  'scripts/capture-linkedin-browser-jobs.ts',
  '--write'
)
if ($env:LINKEDIN_BROWSER_HEADLESS -eq 'true') {
  $pnpmArgs += '--headless'
}

try {
  corepack pnpm @pnpmArgs
  Set-Content -Path $stampFile -Value $today
  Add-Content -Path $log -Value ("[{0}] ok exit={1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $LASTEXITCODE)
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} catch {
  Add-Content -Path $log -Value ("[{0}] error {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $_.Exception.Message)
  throw
}
