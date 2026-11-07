$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$project = Split-Path -Parent $PSScriptRoot
Set-Location $project
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$tools = "$sdk\build-tools\36.1.0"
$java = "C:\Program Files\Microsoft\jdk-17.0.20.8-hotspot"
$env:JAVA_HOME = $java
$work = "$project\.claude\androidbuild\$([DateTimeOffset]::Now.ToUnixTimeMilliseconds())"
New-Item -ItemType Directory -Path "$work\generated","$work\classes","$work\dex","$project\dist" -Force | Out-Null
$manifest = [System.IO.File]::ReadAllText("$project\android\app\src\main\AndroidManifest.xml").Replace('<manifest ', '<manifest package="cat.soggy.vscodeandroid" ')
$manifest = $manifest.Replace('<application', '<application android:debuggable="true"')
[System.IO.File]::WriteAllText("$work\AndroidManifest.xml",$manifest)
function checked {
    param([string]$program,[string[]]$arguments)
    Write-Output "Building: $(Split-Path -Leaf $program)"
    & $program @arguments
    if ($LASTEXITCODE) {throw "$program failed with $LASTEXITCODE"}
}
checked "$tools\aapt.exe" @("package","-f","-m","-M","$work\AndroidManifest.xml","-S","$project\android\app\src\main\res","-I","$sdk\platforms\android-36\android.jar","-F","$work\unsigned.apk","-J","$work\generated","--min-sdk-version","26","--target-sdk-version","35","--version-code","1","--version-name","0.1.0")
$sources = @(Get-ChildItem "$work\generated","$project\android\app\src\main\java" -Filter '*.java' -Recurse | Select-Object -ExpandProperty FullName)
checked "$java\bin\javac.exe" (@("-encoding","UTF-8","-source","17","-target","17","-classpath","$sdk\platforms\android-36\android.jar","-d","$work\classes") + $sources)
checked "$java\bin\jar.exe" @("cf","$work\classes.jar","-C","$work\classes",".")
checked "$tools\d8.bat" @("--min-api","26","--lib","$sdk\platforms\android-36\android.jar","--output","$work\dex","$work\classes.jar")
$archive = [System.IO.Compression.ZipFile]::Open("$work\unsigned.apk", [System.IO.Compression.ZipArchiveMode]::Update)
try {
    foreach ($file in Get-ChildItem "$work\dex" -Filter '*.dex') {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$file.FullName,$file.Name,[System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally {$archive.Dispose()}
checked "$tools\zipalign.exe" @("-p","-f","4","$work\unsigned.apk","$work\aligned.apk")
$keystore = "$env:USERPROFILE\.android\debug.keystore"
if (!(Test-Path -LiteralPath $keystore)) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $keystore) -Force | Out-Null
    checked "$java\bin\keytool.exe" @("-genkeypair","-keystore",$keystore,"-storepass","android","-keypass","android","-alias","androiddebugkey","-dname","CN=Android Debug,O=Android,C=US","-keyalg","RSA","-validity","10000")
}
$output = "$project\dist\workspace-android-debug.apk"
checked "$tools\apksigner.bat" @("sign","--ks",$keystore,"--ks-key-alias","androiddebugkey","--ks-pass","pass:android","--key-pass","pass:android","--out",$output,"$work\aligned.apk")
checked "$tools\apksigner.bat" @("verify","--verbose",$output)
checked "$tools\aapt.exe" @("dump","badging",$output)
Get-FileHash -LiteralPath $output -Algorithm SHA256
