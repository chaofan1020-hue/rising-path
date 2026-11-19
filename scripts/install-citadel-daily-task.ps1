$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
if (-not $Root) { $Root = (Get-Location).Path }
$script = Join-Path $Root 'scripts\citadel-daily-detail-sync.ps1'
if (-not (Test-Path $script)) { throw "Missing $script" }
if (-not (Test-Path (Join-Path $Root '.env.production.local'))) {
  throw 'Missing .env.production.local'
}

$taskName = 'Liorvix Citadel Daily Details'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`"" -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -Daily -At 09:30
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Get-ScheduledTask -TaskName $taskName | Format-List TaskName, State, TaskPath
Get-ScheduledTaskInfo -TaskName $taskName | Format-List LastRunTime, NextRunTime, LastTaskResult
Write-Host "Registered daily 09:30 task: $taskName"
Write-Host 'Keep this Windows user logged in. First capture already saved the Chrome profile.'

$manual = Join-Path $Root '更新Citadel岗位正文.cmd'
$desktop = [Environment]::GetFolderPath('Desktop')
if ((Test-Path $manual) -and $desktop) {
  $w = New-Object -ComObject WScript.Shell
  $shortcut = $w.CreateShortcut((Join-Path $desktop '更新Citadel岗位正文.lnk'))
  $shortcut.TargetPath = $manual
  $shortcut.WorkingDirectory = $Root
  $shortcut.WindowStyle = 1
  $shortcut.Description = 'Capture Citadel official job details and write to production'
  $shortcut.Save()
  Write-Host "Desktop shortcut: $(Join-Path $desktop '更新Citadel岗位正文.lnk')"
}
