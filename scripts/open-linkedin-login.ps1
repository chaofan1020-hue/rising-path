# Requires STA. Opens a top-most prompt and a dedicated Edge profile for LinkedIn login.
param(
  [switch]$NoForm
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class LiorvixWin {
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

function Get-EdgePath {
  foreach ($candidate in @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  )) {
    if (Test-Path $candidate) { return $candidate }
  }
  throw 'Microsoft Edge was not found.'
}

function Get-LinkedInProfileDir {
  $dir = Join-Path $env:LOCALAPPDATA 'liorvix\linkedin-edge-profile'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  return $dir
}

function Get-LinkedInEdgeWindows {
  Get-Process msedge -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle -match 'LinkedIn|Sign in|登录' }
}

function Show-LinkedInEdge {
  $windows = @(Get-LinkedInEdgeWindows)
  foreach ($proc in $windows) {
    [void][LiorvixWin]::ShowWindow($proc.MainWindowHandle, 3)
    [void][LiorvixWin]::SetWindowPos(
      $proc.MainWindowHandle,
      [LiorvixWin]::HWND_TOPMOST,
      0, 0, 0, 0,
      ([LiorvixWin]::SWP_NOMOVE -bor [LiorvixWin]::SWP_NOSIZE -bor [LiorvixWin]::SWP_SHOWWINDOW)
    )
    [void][LiorvixWin]::SetForegroundWindow($proc.MainWindowHandle)
    [void][LiorvixWin]::FlashWindow($proc.MainWindowHandle, $true)
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
  Get-Process msedge -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
    Select-Object -First 3 |
    ForEach-Object {
      [void][LiorvixWin]::ShowWindow($_.MainWindowHandle, 3)
      [void][LiorvixWin]::SetForegroundWindow($_.MainWindowHandle)
    }
}

function Show-LoginForm {
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Liorvix LinkedIn login'
  $form.Size = New-Object System.Drawing.Size(760, 420)
  $form.StartPosition = 'CenterScreen'
  $form.TopMost = $true
  $form.MinimizeBox = $false
  $form.MaximizeBox = $false
  $form.FormBorderStyle = 'FixedDialog'
  $form.BackColor = [System.Drawing.Color]::FromArgb(255, 247, 201)
  $form.TopLevel = $true

  $title = New-Object System.Windows.Forms.Label
  $title.Text = "LinkedIn login window should now be on top.`r`nUse your own account, then close that Edge window."
  $title.Font = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)
  $title.AutoSize = $false
  $title.Size = New-Object System.Drawing.Size(700, 110)
  $title.Location = New-Object System.Drawing.Point(24, 24)
  $form.Controls.Add($title)

  $hint = New-Object System.Windows.Forms.Label
  $hint.Text = 'If you still do not see Edge, click the yellow button. After login succeeds, click Done and tell Grok to continue.'
  $hint.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  $hint.AutoSize = $false
  $hint.Size = New-Object System.Drawing.Size(700, 60)
  $hint.Location = New-Object System.Drawing.Point(24, 140)
  $form.Controls.Add($hint)

  $open = New-Object System.Windows.Forms.Button
  $open.Text = 'Open LinkedIn login again'
  $open.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
  $open.Size = New-Object System.Drawing.Size(360, 64)
  $open.Location = New-Object System.Drawing.Point(24, 220)
  $open.BackColor = [System.Drawing.Color]::FromArgb(255, 196, 0)
  $open.Add_Click({
    Start-LinkedInEdge
    [void](Show-LinkedInEdge)
  })
  $form.Controls.Add($open)

  $done = New-Object System.Windows.Forms.Button
  $done.Text = 'Done, I signed in'
  $done.Font = New-Object System.Drawing.Font('Segoe UI', 14)
  $done.Size = New-Object System.Drawing.Size(280, 64)
  $done.Location = New-Object System.Drawing.Point(404, 220)
  $done.Add_Click({ $form.Close() })
  $form.Controls.Add($done)

  $form.Add_Shown({
    $form.Activate()
    Start-LinkedInEdge
    [void](Show-LinkedInEdge)
  })
  [void]$form.ShowDialog()
}

if ($NoForm) {
  Start-LinkedInEdge
  exit 0
}

Show-LoginForm
