# Sign the Tauri unsigned APK with the Android debug keystore.
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$sdk = $env:ANDROID_HOME
if (-not $sdk) {
  # $sdk = "Android SDK安装目录" 
  Write-Host "`n[提示] 环境变量 ANDROID_HOME 未设置。" -ForegroundColor Yellow
  $sdk = Read-Host "请输入你的 Android SDK 根目录路径 (例如 D:\Android\Sdk)"
  if (-not (Test-Path $sdk)) {
      throw "SDK 路径 '$sdk' 不存在，请检查后重试。"
  }
}
$bt = Join-Path $sdk "build-tools\35.0.0"
if (-not (Test-Path (Join-Path $bt "apksigner.bat"))) {
  $bt = Join-Path $sdk "build-tools\34.0.0"
}
$unsigned = Join-Path $root "src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk"
$aligned = Join-Path $root "src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-aligned.apk"
$outDir = Join-Path $root "dist-android"
$signed = Join-Path $outDir "IEM.apk"
$ks = Join-Path $env:USERPROFILE ".android\debug.keystore"

if (-not (Test-Path $unsigned)) { throw "Unsigned APK not found. Run npx tauri android build first." }
if (-not (Test-Path (Join-Path $bt "zipalign.exe"))) { throw "Android build-tools not found under ANDROID_HOME." }
if (-not (Test-Path $ks)) { throw "debug.keystore not found." }

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
