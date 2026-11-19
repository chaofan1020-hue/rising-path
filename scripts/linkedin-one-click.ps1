# Requires STA. Login in dedicated Edge, then capture and import LinkedIn jobs.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class LiorvixOneClickWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool FlashWindow(IntPtr hWnd, bool invert);
  public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
  public const uint SWP_NOSIZE = 0x0001;
  public const uint SWP_NOMOVE = 0x0002;
  public const uint SWP_SHOWWINDOW = 0x0040;
}
"@

$Root = Split-Path -Parent $PSScriptRoot
if (-not $Root) { $Root = (Get-Location).Path }
Set-Location $Root

function Get-EdgePath {
  foreach ($candidate in @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  )) {
    if (Test-Path $candidate) { return $candidate }
  }
  throw '没有找到 Microsoft Edge。'
}

function Get-LinkedInProfileDir {
  $dir = Join-Path $env:LOCALAPPDATA 'liorvix\linkedin-edge-profile'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  return $dir
}

function Get-LinkedInEdgeProcesses {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -match 'linkedin-edge-profile' }
}

function Get-LinkedInEdgeWindows {
  Get-Process msedge -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle -match 'LinkedIn|Sign in|登录' }
}

function Show-LinkedInEdge {
  $windows = @(Get-LinkedInEdgeWindows)
  foreach ($proc in $windows) {
    [void][LiorvixOneClickWin]::ShowWindow($proc.MainWindowHandle, 3)
    [void][LiorvixOneClickWin]::SetWindowPos(
      $proc.MainWindowHandle,
      [LiorvixOneClickWin]::HWND_TOPMOST,
      0, 0, 0, 0,
      ([LiorvixOneClickWin]::SWP_NOMOVE -bor [LiorvixOneClickWin]::SWP_NOSIZE -bor [LiorvixOneClickWin]::SWP_SHOWWINDOW)
    )
    [void][LiorvixOneClickWin]::SetForegroundWindow($proc.MainWindowHandle)
    [void][LiorvixOneClickWin]::FlashWindow($proc.MainWindowHandle, $true)
  }
  return $windows.Count
}

function Start-LinkedInEdge {
  $edge = Get-EdgePath
  $profile = Get-LinkedInProfileDir
  $args = @(
    "--user-data-dir=$profile",
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--start-maximized',
    '--new-window',
    'https://www.linkedin.com/login'
  )
  Start-Process -FilePath $edge -ArgumentList $args | Out-Null
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if ((Show-LinkedInEdge) -gt 0) { return }
  }
}

function Stop-LinkedInEdge {
  Write-Host 'Closing dedicated LinkedIn Edge...'
  Get-LinkedInEdgeProcesses | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
  $deadline = (Get-Date).AddSeconds(20)
  $profile = Get-LinkedInProfileDir
  do {
    Start-Sleep -Milliseconds 400
    $alive = @(Get-LinkedInEdgeProcesses)
    $lock = Test-Path (Join-Path $profile 'lockfile')
  } while ((($alive.Count -gt 0) -or $lock) -and (Get-Date) -lt $deadline)
  if (@(Get-LinkedInEdgeProcesses).Count -gt 0) {
    throw '专用 Edge 还没关掉，抓岗会锁配置。请关掉标题带 LinkedIn 的那个 Edge 后再试。'
  }
}

function Show-LoginForm {
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Liorvix LinkedIn'
  $form.Size = New-Object System.Drawing.Size(780, 460)
  $form.StartPosition = 'CenterScreen'
  $form.TopMost = $true
  $form.MinimizeBox = $false
  $form.MaximizeBox = $false
  $form.FormBorderStyle = 'FixedDialog'
  $form.BackColor = [System.Drawing.Color]::FromArgb(255, 247, 201)
  $form.TopLevel = $true

  $title = New-Object System.Windows.Forms.Label
  $title.Text = "Dedicated Edge should be on top.`r`nSign in with your own LinkedIn account."
  $title.Font = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)
  $title.AutoSize = $false
  $title.Size = New-Object System.Drawing.Size(720, 90)
  $title.Location = New-Object System.Drawing.Point(24, 20)
  $form.Controls.Add($title)

  $hint = New-Object System.Windows.Forms.Label
  $hint.Text = "After you see your LinkedIn home or messages, click the yellow button.`r`nThis script will close that Edge and capture jobs. Keep this window open, about 10 minutes."
  $hint.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  $hint.AutoSize = $false
  $hint.Size = New-Object System.Drawing.Size(720, 70)
  $hint.Location = New-Object System.Drawing.Point(24, 120)
  $form.Controls.Add($hint)

  $open = New-Object System.Windows.Forms.Button
  $open.Text = 'Open login window again'
  $open.Font = New-Object System.Drawing.Font('Segoe UI', 13)
  $open.Size = New-Object System.Drawing.Size(280, 64)
  $open.Location = New-Object System.Drawing.Point(24, 220)
  $open.Add_Click({
    Start-LinkedInEdge
    [void](Show-LinkedInEdge)
  })
  $form.Controls.Add($open)

  $go = New-Object System.Windows.Forms.Button
  $go.Text = 'I signed in, start capture'
  $go.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
  $go.Size = New-Object System.Drawing.Size(400, 64)
  $go.Location = New-Object System.Drawing.Point(324, 220)
  $go.BackColor = [System.Drawing.Color]::FromArgb(255, 196, 0)
  $go.Add_Click({
    $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.Close()
  })
  $form.Controls.Add($go)

  $note = New-Object System.Windows.Forms.Label
  $note.Text = 'Do not close your other Edge windows. Only the dedicated LinkedIn profile window will be closed.'
  $note.Font = New-Object System.Drawing.Font('Segoe UI', 10)
  $note.AutoSize = $false
  $note.Size = New-Object System.Drawing.Size(720, 50)
  $note.Location = New-Object System.Drawing.Point(24, 300)
  $form.Controls.Add($note)

  $form.Add_Shown({
    $form.Activate()
    Start-LinkedInEdge
    [void](Show-LinkedInEdge)
  })
  return $form.ShowDialog()
}

$result = Show-LoginForm
if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
  Write-Host 'Cancelled. No capture.'
  exit 0
}

Stop-LinkedInEdge
$env:LINKEDIN_DAILY_FORCE = 'true'
Write-Host 'Starting LinkedIn capture and collector import...'
& (Join-Path $Root 'scripts\linkedin-daily-job-sync.ps1')
$code = $LASTEXITCODE
if ($null -eq $code) { $code = 0 }
if ($code -ne 0) {
  [System.Windows.Forms.MessageBox]::Show(
    "Capture failed. Exit code $code. Check the black window and output\linkedin-daily-sync.log",
    'Liorvix LinkedIn',
    'OK',
    'Error'
  ) | Out-Null
  exit $code
}
[System.Windows.Forms.MessageBox]::Show(
  'LinkedIn jobs updated. You can close this window.',
  'Liorvix LinkedIn',
  'OK',
  'Information'
) | Out-Null
exit 0
