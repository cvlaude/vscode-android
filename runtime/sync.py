import argparse
import json
import os
import pathlib
import subprocess
import xml.etree.ElementTree as xml
from markers import offline

##########################################################################

home = pathlib.Path.home() / ".local/share/workspace-sync"
prefix = pathlib.Path(os.environ.get("PREFIX", "/data/data/com.termux/files/usr"))
rootfs = prefix / "var/lib/proot-distro/containers/debian/rootfs"

def start():
    home.mkdir(parents=True, exist_ok=True)
    config = home / "config.xml"
    if not config.exists():
        subprocess.run([str(prefix / "bin/syncthing"), "generate", "--home", str(home), "--no-port-probing"], check=True, timeout=30)
    root = xml.parse(config).getroot()
    if root.find("./gui/address").text != "127.0.0.1:8384":
        raise ValueError("The mirror control API must listen on localhost:8384")
    marker = home / "runtime.pid"
    running = False
    if marker.exists():
        try:
            previous = int(marker.read_text())
            command = pathlib.Path("/proc") / str(previous) / "cmdline"
            running = str(home).encode() in command.read_bytes()
        except (ValueError, FileNotFoundError, PermissionError):
            pass
    if not running:
        offline(root, config)
    projects = []
    chats = ""
    folders = root.findall("folder")
    for folder in folders:
        target = pathlib.Path(folder.get("path")).relative_to(rootfs)
        if folder.get("id") == "codexchats":
            chats = "/" + target.as_posix()
        elif not folder.get("id").endswith(".code"):
            code = next((item for item in folders if item.get("id") == folder.get("id") + ".code"), None)
            projects.append({"id": folder.get("id"), "name": folder.get("label"), "path": "/" + target.as_posix(), "code": "/" + pathlib.Path(code.get("path")).relative_to(rootfs).as_posix() if code is not None else ""})
    state = rootfs / "root/.local/share/vscode-android/native-sync.json"
    state.parent.mkdir(parents=True, exist_ok=True)
    temporary = state.with_suffix(".pending")
    with temporary.open("w") as stream:
        json.dump({"endpoint": "http://127.0.0.1:8384", "key": root.find("./gui/apikey").text, "projects": projects, "chats": chats}, stream)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(state)
    state.chmod(0o600)
    if running:
        return
    child = subprocess.Popen([str(prefix / "bin/syncthing"), "serve", "--home", str(home), "--log-file", str(home / "runtime.log"), "--log-max-size", "2097152", "--log-max-old-files", "2"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT, start_new_session=True)
    with marker.open("w") as stream:
        stream.write(str(child.pid))
        stream.flush()
        os.fsync(stream.fileno())

##########################################################################

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["start"])
    parser.parse_args()
    start()
