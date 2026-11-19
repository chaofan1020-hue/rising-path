$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
if (-not $Root) { $Root = (Get-Location).Path }
Set-Location $Root

$envFile = Join-Path $Root '.env.production.local'
if (-not (Test-Path $envFile)) {
  throw "Missing production env file: $envFile"
}

$logDir = Join-Path $Root 'output'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'citadel-daily-sync.log'
$stampFile = Join-Path $logDir 'citadel-daily-sync.lastrun'
$today = Get-Date -Format 'yyyy-MM-dd'
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
if ($env:CITADEL_DAILY_FORCE -ne 'true' -and (Test-Path $stampFile) -and ((Get-Content $stampFile -ErrorAction SilentlyContinue | Select-Object -First 1) -eq $today)) {
  Add-Content -Path $log -Value "[$stamp] skip already ran $today"
  exit 0
}
Add-Content -Path $log -Value "[$stamp] start"

$env:ENV_FILE = $envFile
$env:DOTENV_CONFIG_PATH = $envFile
$env:CITADEL_BROWSER_DETAIL_WRITE_ENABLED = 'true'
$env:CITADEL_BROWSER_PROFILE_DIR = Join-Path $env:LOCALAPPDATA 'liorvix\citadel-chrome-profile'

$pnpmArgs = @(
  'capture:citadel-browser-details',
  '--',
  '--write',
  '--limit=12'
)
if ($env:CITADEL_BROWSER_HEADLESS -eq 'true') {
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
