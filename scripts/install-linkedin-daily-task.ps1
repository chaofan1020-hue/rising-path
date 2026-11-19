$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
if (-not $Root) { $Root = (Get-Location).Path }
$script = Join-Path $Root 'scripts\linkedin-daily-job-sync.ps1'
if (-not (Test-Path $script)) { throw "Missing $script" }

$taskName = 'Liorvix LinkedIn Daily Jobs'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`"" -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -Daily -At 09:40
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
try {
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Get-ScheduledTask -TaskName $taskName | Format-List TaskName, State, TaskPath
  Write-Host "Registered daily 09:40 task: $taskName"
} catch {
  Write-Host "Task Scheduler was denied: $($_.Exception.Message)"
}

$startup = [Environment]::GetFolderPath('Startup')
$startupCmd = Join-Path $startup 'Liorvix-LinkedIn-Daily.cmd'
@(
  '@echo off'
  "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$script`""
) | Set-Content -Path $startupCmd -Encoding UTF8
Write-Host "Startup launcher: $startupCmd"

$manual = Join-Path $Root '一键更新LinkedIn岗位.cmd'
$desktop = [Environment]::GetFolderPath('Desktop')
if ((Test-Path $manual) -and $desktop) {
  $w = New-Object -ComObject WScript.Shell
  foreach ($name in @('一键更新LinkedIn岗位.lnk', 'Update LinkedIn Jobs.lnk')) {
    $shortcut = $w.CreateShortcut((Join-Path $desktop $name))
    $shortcut.TargetPath = $manual
    $shortcut.WorkingDirectory = $Root
    $shortcut.WindowStyle = 1
    $shortcut.Description = 'Login, capture LinkedIn official jobs, and import to collector'
    $shortcut.Save()
  }
  Write-Host "Desktop shortcut: $(Join-Path $desktop '一键更新LinkedIn岗位.lnk')"
}
Write-Host 'Keep this Windows user logged in. Double-click 一键更新LinkedIn岗位, sign in, then click the yellow button.'
