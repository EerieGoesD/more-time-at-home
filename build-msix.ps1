# Builds an .msixupload (containing a single-arch x64 .msixbundle) for
# Microsoft Store submission of More Time at Home
# (Product 9NDXRKBGVGDZ, Identity 20715EerieGoesD.282757A2A500A).
#
# A .msixbundle is required because the earlier WPF submission shipped as a
# bundle and the Store rule "Subsequent submissions must continue to contain a
# .msixbundle or .appxbundle" applies once that pattern is established.
#
# Steps:
#   1. Verify Tauri release exe exists.
#   2. Stage it next to the manifest.
#   3. makeappx pack -> .appx  (inner per-arch package)
#   4. makeappx bundle -> .msixbundle (wraps the .appx)
#   5. Compress-Archive -> .msixupload (zip wrapper the Store expects)
#
# Microsoft re-signs on the server, so we DO NOT signtool-sign anything here.

[CmdletBinding()]
param(
    [string]$Version = "1.0.12.0"
)
$ErrorActionPreference = "Stop"

$Repo     = $PSScriptRoot
$MsixDir  = Join-Path $Repo 'msix'
$DistDir  = Join-Path $Repo 'dist'
$BuildDir = Join-Path $Repo 'msix\build'
$ExeName  = 'more-time-at-home.exe'
$ExeSrc   = Join-Path $Repo "src-tauri\target\release\$ExeName"
$ExeDest  = Join-Path $MsixDir $ExeName

if (-not (Test-Path $ExeSrc)) {
    throw "Tauri release exe not found at $ExeSrc. Run 'npm run tauri build' first."
}

New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
if (Test-Path $BuildDir) { Remove-Item $BuildDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null

Copy-Item $ExeSrc $ExeDest -Force
Write-Host "Staged $ExeName from $ExeSrc" -ForegroundColor Cyan

# Locate makeappx in the latest installed Windows SDK.
$SdkBins = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Directory `
    | Where-Object { $_.Name -match '^10\.0\.' } `
    | Sort-Object Name -Descending
if (-not $SdkBins) { throw "Windows SDK not found under 'C:\Program Files (x86)\Windows Kits\10\bin'." }
$MakeAppx = Join-Path $SdkBins[0].FullName "x64\makeappx.exe"
if (-not (Test-Path $MakeAppx)) { throw "makeappx.exe not found at $MakeAppx" }
Write-Host "Using SDK: $($SdkBins[0].Name)" -ForegroundColor Cyan

# Patch the manifest Version to match the requested version.
$ManifestPath = Join-Path $MsixDir 'AppxManifest.xml'
$mf = Get-Content $ManifestPath -Raw
$mf = $mf -replace '(?<![A-Za-z])Version="\d+\.\d+\.\d+\.\d+"', "Version=`"$Version`""
Set-Content -Path $ManifestPath -Value $mf -Encoding UTF8

# 3. Pack the inner .appx. Use .appx (not .msix) so makeappx bundle accepts it
#    for the pre-1903 device family targets in the manifest.
$InnerPath = Join-Path $BuildDir "MoreTimeAtHome.Package_${Version}_x64.appx"
if (Test-Path $InnerPath) { Remove-Item $InnerPath -Force }
Write-Host "Packing inner .appx..." -ForegroundColor Cyan
& $MakeAppx pack /d $MsixDir /p $InnerPath /o | Out-Host
if ($LASTEXITCODE -ne 0) { throw "makeappx pack failed." }

# 4. Wrap into .msixbundle.
$BundleDir = Join-Path $BuildDir "bundle-input"
New-Item -ItemType Directory -Force -Path $BundleDir | Out-Null
Copy-Item $InnerPath -Destination $BundleDir -Force

$BundlePath = Join-Path $BuildDir "MoreTimeAtHome.Package_${Version}_x64_bundle.msixbundle"
if (Test-Path $BundlePath) { Remove-Item $BundlePath -Force }
Write-Host "Packing .msixbundle..." -ForegroundColor Cyan
& $MakeAppx bundle /d $BundleDir /p $BundlePath /bv $Version /o | Out-Host
if ($LASTEXITCODE -ne 0) { throw "makeappx bundle failed." }

# 5. Wrap into .msixupload (a plain zip containing the bundle).
$UploadPath = Join-Path $DistDir "MoreTimeAtHome.Package_${Version}_x64_bundle.msixupload"
$TmpZip     = Join-Path $DistDir "MoreTimeAtHome.Package_${Version}_x64_bundle.zip"
if (Test-Path $UploadPath) { Remove-Item $UploadPath -Force }
if (Test-Path $TmpZip)     { Remove-Item $TmpZip     -Force }
Write-Host "Wrapping into .msixupload..." -ForegroundColor Cyan
Compress-Archive -Path $BundlePath -DestinationPath $TmpZip -Force
Move-Item $TmpZip $UploadPath -Force

# Also surface the loose .msixbundle in dist\ for convenience.
$BundleDestPath = Join-Path $DistDir (Split-Path -Leaf $BundlePath)
if (Test-Path $BundleDestPath) { Remove-Item $BundleDestPath -Force }
Copy-Item $BundlePath $BundleDestPath -Force

# Remove the old single-arch .msix file the previous version of this script
# emitted, so the dist folder doesn't mislead.
$OldMsix = Join-Path $DistDir "MoreTimeAtHome_${Version}.msix"
if (Test-Path $OldMsix) { Remove-Item $OldMsix -Force }

Write-Host ""
Write-Host "========================================================================" -ForegroundColor Green
Write-Host " .msixupload built." -ForegroundColor Green
Write-Host "========================================================================" -ForegroundColor Green
Write-Host " File path: $UploadPath" -ForegroundColor Green
Write-Host " Bundle:    $BundleDestPath" -ForegroundColor Green
Write-Host " Directory: $DistDir" -ForegroundColor Green
Write-Host ""
Write-Host " Upload the .msixupload to Partner Center -> Packages."                   -ForegroundColor Yellow
Write-Host " Microsoft re-signs on the server, so no signtool step is needed."        -ForegroundColor Yellow
