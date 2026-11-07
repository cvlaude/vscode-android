param([switch]$downloadruntime, [string]$destination)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$project = Split-Path -Parent $PSScriptRoot
Set-Location $project
if (!$destination) {$destination = "$project\dist"}
New-Item -ItemType Directory -Path $destination,"$project\packages\extensions","$project\.claude\packaging" -Force | Out-Null
$stamp = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
$staging = "$project\.claude\packaging\$stamp"
New-Item -ItemType Directory -Path "$staging\mobile\extension" -Force | Out-Null
Copy-Item -Path "$project\extension\*" -Destination "$staging\mobile\extension" -Recurse
$vsix = '<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="workspace-mobile" Version="0.1.0" Publisher="localtools"/><DisplayName>Workspace Mobile</DisplayName><Description xml:space="preserve">Android workspace controls</Description></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>'
[System.IO.File]::WriteAllText("$staging\mobile\extension.vsixmanifest", $vsix)
[System.IO.File]::WriteAllText("$staging\mobile\[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>')
$mobilepackage = "$project\packages\extensions\localtools.workspace-mobile-0.1.0.vsix"
if (Test-Path -LiteralPath $mobilepackage) {Move-Item -LiteralPath $mobilepackage -Destination "$staging\previous-mobile.vsix"}
[System.IO.Compression.ZipFile]::CreateFromDirectory("$staging\mobile", $mobilepackage)
if ($downloadruntime) {
    New-Item -ItemType Directory -Path "$project\packages\runtime" -Force | Out-Null
    $versions = Get-Content -LiteralPath "$project\runtime\versions.json" -Raw | ConvertFrom-Json
    $runtime = "code-server-$($versions.codeserver)-linux-arm64.tar.gz"
    $target = "$project\packages\runtime\$runtime"
    if (!(Test-Path -LiteralPath $target)) {Invoke-WebRequest "https://github.com/coder/code-server/releases/download/v$($versions.codeserver)/$runtime" -OutFile $target -TimeoutSec 240}
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower() -ne $versions.checksums.arm64) {throw "Runtime checksum mismatch"}
}

##########################################################################

$files = @()
foreach ($folder in @("companion","shell","runtime")) {$files += Get-ChildItem -LiteralPath "$project\$folder" -File -Recurse}
$files += Get-Item -LiteralPath "$project\package.json","$project\scripts\importsessions.mjs"
foreach ($folder in @("extensions","runtime")) {
    if (Test-Path -LiteralPath "$project\packages\$folder") {$files += Get-ChildItem -LiteralPath "$project\packages\$folder" -File | Where-Object {$_.Extension -eq ".vsix" -or $_.Name -match '^code-server-.*-linux-arm64\.tar\.gz$'}}
}
$output = Join-Path $destination "workspace-runtime.zip"
$pending = "$output.$stamp.pending"
$archive = [System.IO.Compression.ZipFile]::Open($pending, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in $files) {
        $relative = $file.FullName.Substring($project.Length + 1).Replace("\", "/")
        Write-Output "Packing: $relative"
        $compression = [System.IO.Compression.CompressionLevel]::Fastest
        if ($relative.StartsWith("packages/")) {$compression = [System.IO.Compression.CompressionLevel]::NoCompression}
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $relative, $compression) | Out-Null
    }
} finally {$archive.Dispose()}
$stream = [System.IO.File]::Open($pending, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite)
try {$stream.Flush($true)} finally {$stream.Dispose()}
if (Test-Path -LiteralPath $output) {Move-Item -LiteralPath $output -Destination "$output.$stamp.previous"}
Move-Item -LiteralPath $pending -Destination $output
Get-FileHash -LiteralPath $output -Algorithm SHA256
