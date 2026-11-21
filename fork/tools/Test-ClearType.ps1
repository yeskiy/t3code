<#
.SYNOPSIS
Reports whether text in a screenshot region uses ClearType (color fringes) or grayscale antialiasing.
.PARAMETER Path
PNG screenshot taken at 100% display scale with the area to test.
.PARAMETER Region
x,y,width,height of a block of plain gray or white body text (no syntax colors, icons, or links).
#>
param(
  [Parameter(Mandatory)] [string] $Path,
  [Parameter(Mandatory)] [int[]] $Region
)
Add-Type -AssemblyName System.Drawing
$bitmap = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $Path).Path)
try {
  $x0, $y0, $width, $height = $Region
  $pixels = @(for ($y = $y0; $y -lt $y0 + $height; $y++) {
    for ($x = $x0; $x -lt $x0 + $width; $x++) { $bitmap.GetPixel($x, $y) }
  })
  $luma = @($pixels | ForEach-Object { 0.299 * $_.R + 0.587 * $_.G + 0.114 * $_.B })
  $background = ($luma | Sort-Object)[[int]($luma.Count / 2)]
  $ink = 0; $fringe = 0
  for ($i = 0; $i -lt $pixels.Count; $i++) {
    if ([math]::Abs($luma[$i] - $background) -lt 16) { continue }
    $ink++
    $p = $pixels[$i]
    $spread = [math]::Max([math]::Max([math]::Abs($p.R - $p.G), [math]::Abs($p.G - $p.B)), [math]::Abs($p.R - $p.B))
    if ($spread -gt 24) { $fringe++ }
  }
  $ratio = if ($ink -eq 0) { 0 } else { [math]::Round($fringe / $ink, 3) }
  [pscustomobject]@{ InkPixels = $ink; FringePixels = $fringe; FringeRatio = $ratio; Verdict = $(if ($ratio -ge 0.15) { 'ClearType' } else { 'Grayscale' }) }
}
finally { $bitmap.Dispose() }
