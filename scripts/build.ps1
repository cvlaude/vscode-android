param([switch]$offline)
$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $PSScriptRoot
Set-Location $project
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-17.0.20.8-hotspot"
$env:ANDROID_HOME = "$env:USERPROFILE\AppData\Local\Android\Sdk"
$gradle = Get-ChildItem -LiteralPath "$env:USERPROFILE\.gradle\wrapper\dists\gradle-8.11.1-bin" -Filter gradle.bat -Recurse | Select-Object -First 1 -ExpandProperty FullName
if (!$gradle) {throw "Gradle 8.11.1 is required"}
$arguments = @("--no-daemon", "-p", "$project\android", ":app:assembleDebug")
if ($offline) {$arguments += "--offline"}
& $gradle @arguments
if ($LASTEXITCODE) {throw "Android build failed"}
New-Item -ItemType Directory -Path "$project\dist" -Force | Out-Null
Copy-Item -LiteralPath "$project\android\app\build\outputs\apk\debug\app-debug.apk" -Destination "$project\dist\workspace-android-debug.apk"
Get-FileHash -LiteralPath "$project\dist\workspace-android-debug.apk" -Algorithm SHA256
