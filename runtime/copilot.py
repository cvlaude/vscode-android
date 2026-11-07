import json
import pathlib
import time

##########################################################################

home = pathlib.Path.home()
folders = [home / ".local/share/code-server/extensions"]
folders += list(pathlib.Path("/opt").glob("code-server-*/lib/vscode/extensions"))
recovery = home / ".local/share/vscode-android/recovery/copilot" / str(time.time_ns())
removed = []
for folder in folders:
    if not folder.is_dir():
        continue
    for entry in folder.iterdir():
        manifest = entry / "package.json"
        if not manifest.is_file():
            continue
        data = json.loads(manifest.read_text())
        identity = (data.get("publisher", "") + "." + data.get("name", "")).lower()
        if identity not in {"github.copilot", "github.copilot-chat"}:
            continue
        recovery.mkdir(parents=True, exist_ok=True)
        entry.rename(recovery / entry.name)
        removed.append(identity)
    index = folder / "extensions.json"
    if index.exists():
        data = json.loads(index.read_text())
        current = [item for item in data if item.get("identifier", {}).get("id", "").lower() not in {"github.copilot", "github.copilot-chat"}]
        if data != current:
            recovery.mkdir(parents=True, exist_ok=True)
            (recovery / "extensions.json").write_bytes(index.read_bytes())
            temporary = index.with_suffix(".pending")
            temporary.write_text(json.dumps(current))
            temporary.replace(index)
print(json.dumps({"copilotremoved": removed}))
