Add-Type -AssemblyName System.Drawing

$map = @(
  @{ In = 'C:\Users\Hi\Downloads\AI智能选岗.jpeg';   Out = 'C:\Users\Hi\Desktop\codex\liorvix\public\brand\ai-match.jpg' },
  @{ In = 'C:\Users\Hi\Downloads\ATS简历优化.jpeg';  Out = 'C:\Users\Hi\Desktop\codex\liorvix\public\brand\ats-resume.jpg' },
  @{ In = 'C:\Users\Hi\Downloads\自动网申填写.jpeg'; Out = 'C:\Users\Hi\Desktop\codex\liorvix\public\brand\auto-apply.jpg' },
  @{ In = 'C:\Users\Hi\Downloads\海量岗位资源.jpeg'; Out = 'C:\Users\Hi\Desktop\codex\liorvix\public\brand\global-jobs.jpg' },
  @{ In = 'C:\Users\Hi\Downloads\AI模拟面试.jpeg';   Out = 'C:\Users\Hi\Desktop\codex\liorvix\public\brand\mock-interview.jpg' }
)

New-Item -ItemType Directory -Force -Path 'C:\Users\Hi\Desktop\codex\liorvix\public\brand' | Out-Null

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }

foreach ($m in $map) {
  $src = [System.Drawing.Image]::FromFile($m.In)
  $maxW = 1200
  $w = $src.Width
  $h = $src.Height
  if ($w -gt $maxW) {
    $h = [int]($h * $maxW / $w)
    $w = $maxW
  }
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, 0, 0, $w, $h)
  $g.Dispose()
  $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]85)
  $bmp.Save($m.Out, $codec, $ep)
  $bmp.Dispose()
  $src.Dispose()
  $size = [Math]::Round((Get-Item $m.Out).Length / 1KB)
  Write-Output ($m.Out + ' <- ' + $w + 'x' + $h + ' | ' + $size + 'KB')
}
