# 在项目根目录编译并签名 Android APK，输出 dist-android\IEM.apk
# 用法：在资源管理器双击 build-android-apk.bat，或 PowerShell 执行 .\build-android-apk.ps1
$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
if (-not $root) { $root = Get-Location }
Set-Location $root

$env:GRADLE_USER_HOME = Join-Path $env:USERPROFILE ".gradle"

Write-Host "Building unsigned APK (this takes several minutes)..."
npx tauri android build
if ($LASTEXITCODE -ne 0) { throw "tauri android build failed with exit code $LASTEXITCODE" }

Write-Host "Signing APK..."
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "scripts\sign-android-apk.ps1")
if ($LASTEXITCODE -ne 0) { throw "sign-android-apk failed with exit code $LASTEXITCODE" }

$apk = Join-Path $root "dist-android\IEM.apk"
if (-not (Test-Path $apk)) { throw "Signed APK was not created: $apk" }

$info = Get-Item $apk
Write-Host ""
Write-Host "Done."
Write-Host ("  {0}" -f $info.FullName)
Write-Host ("  {0:N1} MB  {1}" -f ($info.Length / 1MB), $info.LastWriteTime)
Write-Host "Copy by USB. Do not send via WeChat."
