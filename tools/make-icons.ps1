# アイコン PNG を作る（Windows PowerShell）: powershell -File tools/make-icons.ps1
Add-Type -AssemblyName System.Drawing
$dir = Join-Path (Split-Path $PSScriptRoot -Parent) 'icons'
foreach ($s in 180, 192, 512) {
  $b = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($b)
  $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear([System.Drawing.Color]::FromArgb(179, 52, 47))
  $f = New-Object System.Drawing.Font('Times New Roman', [single]($s * 0.58), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat; $sf.Alignment = 'Center'; $sf.LineAlignment = 'Center'
  $g.DrawString([string][char]0x0416, $f, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0, ([single]($s * 0.03)), $s, $s), $sf)
  $name = if ($s -eq 180) { 'apple-touch-icon.png' } else { "icon-$s.png" }
  $b.Save((Join-Path $dir $name), [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $b.Dispose()
}
