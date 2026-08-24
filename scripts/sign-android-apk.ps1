# Sign the Tauri APK with the Android debug keystore.
# Windows PowerShell 5.1 treats UTF-8 without BOM as ANSI; keep quotes off Chinese chars.
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

function Resolve-AndroidSdk {
  $candidates = @(
    $env:ANDROID_HOME,
    $env:ANDROID_SDK_ROOT,
    (Join-Path $env:LOCALAPPDATA "Android\Sdk")
  )
  foreach ($item in $candidates) {
    if ($item -and (Test-Path -LiteralPath $item)) { return $item }
  }
  $localProp = Join-Path $root "src-tauri\gen\android\local.properties"
  if (Test-Path -LiteralPath $localProp) {
    $line = Get-Content -LiteralPath $localProp | Where-Object { $_ -match '^\s*sdk\.dir=' } | Select-Object -First 1
    if ($line) {
      $path = ($line -replace '^\s*sdk\.dir=', '').Trim()
      $path = $path -replace '\\:', ':' -replace '\\\\', '\'
      if ($path -and (Test-Path -LiteralPath $path)) { return $path }
    }
  }
  return $null
}

function Resolve-BuildTools([string]$sdkRoot) {
  $btRoot = Join-Path $sdkRoot "build-tools"
  if (-not (Test-Path -LiteralPath $btRoot)) { return $null }
  foreach ($ver in @("36.0.0", "35.0.0", "34.0.0")) {
    $dir = Join-Path $btRoot $ver
    if (Test-Path -LiteralPath (Join-Path $dir "apksigner.bat")) { return $dir }
  }
  $found = Get-ChildItem -LiteralPath $btRoot -Directory | Sort-Object Name -Descending |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "apksigner.bat") } |
    Select-Object -First 1
  if ($found) { return $found.FullName }
  return $null
}

function Resolve-UnsignedApk {
  $apkRoot = Join-Path $root "src-tauri\gen\android\app\build\outputs\apk"
  if (-not (Test-Path -LiteralPath $apkRoot)) { return $null }
  $hit = Get-ChildItem -LiteralPath $apkRoot -Recurse -Filter "*-unsigned.apk" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($hit) { return $hit.FullName }
  return $null
}

$sdk = Resolve-AndroidSdk
if (-not $sdk) {
  Write-Host ""
  Write-Host "[hint] ANDROID_HOME is not set. Enter the Android SDK folder." -ForegroundColor Yellow
  Write-Host "Example: D:\Android\Sdk"
  $sdk = Read-Host "SDK"
  if (-not $sdk -or -not (Test-Path -LiteralPath $sdk)) {
    throw "Android SDK path not found: $sdk"
  }
}

$bt = Resolve-BuildTools $sdk
$unsigned = Resolve-UnsignedApk
$outDir = Join-Path $root "dist-android"
$aligned = Join-Path $outDir "IEM-aligned.apk"
$signed = Join-Path $outDir "IEM.apk"
$ks = Join-Path $env:USERPROFILE ".android\debug.keystore"

if (-not $unsigned) { throw "Unsigned APK not found. Run npx tauri android build first." }
if (-not $bt) { throw "Android build-tools not found under ANDROID_HOME." }
if (-not (Test-Path -LiteralPath $ks)) { throw "debug.keystore not found." }

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$zipalign = Join-Path $bt "zipalign.exe"
& $zipalign -p -f 4 $unsigned $aligned
if ($LASTEXITCODE -ne 0) { throw "zipalign failed" }

$apksigner = Join-Path $bt "apksigner.bat"
$sign = "`"$apksigner`" sign --ks `"$ks`" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --out `"$signed`" `"$aligned`""
cmd.exe /c $sign
if ($LASTEXITCODE -ne 0) { throw "apksigner sign failed" }

cmd.exe /c "`"$apksigner`" verify --verbose `"$signed`""
Write-Host "Signed APK:" $signed
