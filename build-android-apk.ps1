# Build and sign Android APK to dist-android\IEM.apk
# Default: aarch64 only (phones). Use -Universal for all ABIs (slow).
# Usage: .\build-android-apk.ps1
#        .\build-android-apk.ps1 -Universal
#        .\build-android-apk.ps1 -DebugApk
param(
  [switch]$Universal,
  [switch]$DebugApk
)

$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
if (-not $root) { $root = Get-Location }
Set-Location $root

$env:GRADLE_USER_HOME = Join-Path $env:USERPROFILE ".gradle"
# Release still benefits from incremental crates between APK builds.
$env:CARGO_INCREMENTAL = "1"

$tauriArgs = @("tauri", "android", "build")
if (-not $Universal) {
  $tauriArgs += @("--target", "aarch64")
  Write-Host "Building aarch64 APK (phones). Pass -Universal for all ABIs."
} else {
  Write-Host "Building universal APK (all ABIs). This takes much longer."
}
if ($DebugApk) {
  $tauriArgs += "--debug"
  Write-Host "Debug APK: faster compile, larger file."
}

npx @tauriArgs
if ($LASTEXITCODE -ne 0) { throw "tauri android build failed with exit code $LASTEXITCODE" }

Write-Host "Signing APK..."
& (Join-Path $root "scripts\sign-android-apk.ps1")
if ($LASTEXITCODE -ne 0) { throw "sign-android-apk failed with exit code $LASTEXITCODE" }

$apk = Join-Path $root "dist-android\IEM.apk"
if (-not (Test-Path -LiteralPath $apk)) { throw "Signed APK was not created: $apk" }

$info = Get-Item $apk
Write-Host ""
Write-Host "Done."
Write-Host ("  {0}" -f $info.FullName)
Write-Host ("  {0:N1} MB  {1}" -f ($info.Length / 1MB), $info.LastWriteTime)
Write-Host "Copy by USB. Do not send via WeChat."
