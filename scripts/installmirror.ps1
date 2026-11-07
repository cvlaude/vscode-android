param([string]$mirrorhome, [string]$executable)
$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $PSScriptRoot
if (!(Test-Path -LiteralPath "$mirrorhome\config.xml") -or !(Test-Path -LiteralPath $executable)) {throw "Select the dedicated mirror configuration and Syncthing executable"}
$python = (python -c 'import pathlib,sys; print(pathlib.Path(sys.executable).with_name("pythonw.exe"))').Trim()
$arguments = '"' + "$project\scripts\mirror.py" + '" --home "' + $mirrorhome + '" --executable "' + $executable + '" --chats "' + "$project\.claude\chats" + '" --priority "' + "$project\.claude\priority" + '"'
$command = '"' + $python + '" ' + $arguments
$startup = [Environment]::GetFolderPath("Startup")
$filename = Join-Path $startup "Workspace mirror.vbs"
$content = 'CreateObject("WScript.Shell").Run "' + $command.Replace('"','""') + '", 0, False'
[System.IO.File]::WriteAllText($filename, $content)
Start-Process -FilePath $python -ArgumentList $arguments -WindowStyle Hidden
Write-Output "Mirror watcher installed for Windows sign-in."
