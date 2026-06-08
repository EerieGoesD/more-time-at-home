# Regenerates the Store tile PNGs in msix\Assets\ from a source icon PNG.
# Defaults to src-tauri\icons\128x128@2x.png if no path is passed.
#
# Usage:
#   pwsh -NoProfile -File generate-tiles.ps1                # uses default Tauri icon
#   pwsh -NoProfile -File generate-tiles.ps1 -Source C:\path\to\new-icon.png

[CmdletBinding()]
param(
    [string]$Source
)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$pkgDir = $PSScriptRoot
$repo   = Split-Path -Parent $pkgDir

if (-not $Source) {
    $candidates = @(
        (Join-Path $repo 'src-tauri\icons\128x128@2x.png'),
        (Join-Path $repo 'src-tauri\icons\icon.png'),
        (Join-Path $repo 'src-tauri\icons\128x128.png')
    )
    $Source = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Source -or -not (Test-Path $Source)) { throw "Source icon not found." }

$outDir = Join-Path $pkgDir 'Assets'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$bg     = [System.Drawing.ColorTranslator]::FromHtml('#2C3E50')
$img = [System.Drawing.Image]::FromFile($Source)

function Save-Tile([int]$w, [int]$h, [string]$name, [bool]$fillBg, [double]$padFrac) {
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.SmoothingMode     = 'AntiAlias'
    $g.PixelOffsetMode   = 'HighQuality'

    if ($fillBg) { $g.Clear($script:bg) } else { $g.Clear([System.Drawing.Color]::Transparent) }

    $availW = $w * (1 - 2 * $padFrac)
    $availH = $h * (1 - 2 * $padFrac)
    $scale  = [Math]::Min($availW / $script:img.Width, $availH / $script:img.Height)
    $drawW  = [int]($script:img.Width  * $scale)
    $drawH  = [int]($script:img.Height * $scale)
    $x      = [int](($w - $drawW) / 2)
    $y      = [int](($h - $drawH) / 2)

    $g.DrawImage($script:img, $x, $y, $drawW, $drawH)
    $g.Dispose()
    $bmp.Save((Join-Path $script:outDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "  Wrote $name ($w x $h)"
}

Write-Host "Generating MSIX tiles from $Source" -ForegroundColor Cyan

Save-Tile  50  50  'StoreLogo.png'         $true 0.10
Save-Tile  44  44  'Square44x44Logo.png'   $true 0.10
Save-Tile  71  71  'SmallTile.png'         $true 0.10
Save-Tile 150 150  'Square150x150Logo.png' $true 0.15
Save-Tile 310 310  'LargeTile.png'         $true 0.20
Save-Tile 310 150  'Wide310x150Logo.png'   $true 0.15
Save-Tile 620 300  'SplashScreen.png'      $true 0.20

$img.Dispose()
Write-Host "All tiles in: $outDir" -ForegroundColor Green
