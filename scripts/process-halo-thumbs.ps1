Add-Type -AssemblyName System.Drawing

$srcDir = 'C:\Users\Hi\Desktop\codex\liorvix\public\brand'
$outDir = 'C:\Users\Hi\Desktop\codex\liorvix\public\brand\halo'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }

Get-ChildItem "$srcDir\*.jpg" | ForEach-Object {
  $src = [System.Drawing.Image]::FromFile($_.FullName)
  $w = 240
  $h = [int]([Math]::Round($src.Height * $w / $src.Width))
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, 0, 0, $w, $h)
  $g.Dispose()
  $out = Join-Path $outDir $_.Name
  $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]88)
  $bmp.Save($out, $codec, $ep)
  $bmp.Dispose()
  $src.Dispose()
  $size = [Math]::Round((Get-Item $out).Length / 1KB)
  Write-Output ($out + ' <- ' + $w + 'x' + $h + ' | ' + $size + 'KB')
}
