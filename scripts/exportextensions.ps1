param([string]$source = "$env:USERPROFILE\.vscode\extensions")
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$project = Split-Path -Parent $PSScriptRoot
$destination = "$project\packages\extensions"
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$wanted = Get-Content -LiteralPath "$project\runtime\mobile\extensions.json" -Raw | ConvertFrom-Json
$receipt = @()
foreach ($id in $wanted.recommendations) {
    if ($id -eq "localtools.desktop-scm") {
        $desktop = "$env:USERPROFILE\Documents\GitHub\desktop-vscode\.claude\desktop-scm-0.1.9.vsix"
        if (Test-Path -LiteralPath $desktop) {
            $filename = "$destination\localtools.desktop-scm-0.1.9.vsix"
            Copy-Item -LiteralPath $desktop -Destination $filename -Force
            $receipt += @{id=$id; status="packaged"; version="0.1.9"; sha256=(Get-FileHash -LiteralPath $filename -Algorithm SHA256).Hash}
            continue
        }
    }
    $folders = Get-ChildItem -LiteralPath $source -Directory | Where-Object {$_.Name.StartsWith("$id-")} | Sort-Object LastWriteTime -Descending
    $folder = $folders | Select-Object -First 1
    if (!$folder) {$receipt += @{id=$id; status="not installed"}; continue}
    $manifest = Get-Content -LiteralPath "$($folder.FullName)\package.json" -Raw | ConvertFrom-Json
    if ($folder.Name -match "win32" -or $manifest.os -or $manifest.cpu) {
        $receipt += @{id=$id; status="needs linux-arm64 package"; version=$manifest.version}
        continue
    }
    $binary = Get-ChildItem -LiteralPath $folder.FullName -Recurse -File | Where-Object {$_.Extension -in @(".exe", ".dll", ".node", ".so", ".dylib")} | Select-Object -First 1
    $portablehelper = $id -eq "martinortiz.codex-stats" -and $manifest.version -eq "1.0.4" -and $binary.Name -eq "keytar.node"
    if ($binary -and !$portablehelper) {$receipt += @{id=$id; status="native binaries require review"; version=$manifest.version}; continue}
    $filename = "$destination\$id-$($manifest.version).vsix"
    if (!(Test-Path -LiteralPath $filename)) {
        $archive = [System.IO.Compression.ZipFile]::Open($filename, [System.IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($file in Get-ChildItem -LiteralPath $folder.FullName -Recurse -File) {
                $relative = $file.FullName.Substring($folder.FullName.Length + 1).Replace("\", "/")
                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, "extension/$relative", [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
            }
            $xml = '<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="' + $manifest.name + '" Version="' + $manifest.version + '" Publisher="' + $manifest.publisher + '"/><DisplayName>' + [System.Security.SecurityElement]::Escape($manifest.displayName) + '</DisplayName><Description xml:space="preserve">Local extension transfer</Description></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>'
            $entry = $archive.CreateEntry("extension.vsixmanifest")
            $writer = New-Object System.IO.StreamWriter($entry.Open())
            try {$writer.Write($xml)} finally {$writer.Dispose()}
            $entry = $archive.CreateEntry("[Content_Types].xml")
            $writer = New-Object System.IO.StreamWriter($entry.Open())
            try {$writer.Write('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>')} finally {$writer.Dispose()}
        } finally {$archive.Dispose()}
    }
    $receipt += @{id=$id; status="packaged"; version=$manifest.version; sha256=(Get-FileHash -LiteralPath $filename -Algorithm SHA256).Hash}
}
$receipt | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath "$destination\receipt.json" -Encoding utf8
$receipt | ConvertTo-Json -Depth 4
