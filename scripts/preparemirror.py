import argparse
import copy
import hashlib
import json
import os
import pathlib
import re
import xml.etree.ElementTree as xml
from commands import capture
from chats import refresh
from priority import refresh as refreshcode

##########################################################################

projects = ["example-site", "example-pages", "example-game", "example-portal", "example-engine"]

def write(filename, value):
    filename.parent.mkdir(parents=True, exist_ok=True)
    temporary = filename.with_name(filename.name + ".pending")
    with temporary.open("wb") as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(filename)

def setting(parent, name, value):
    element = parent.find(name)
    if element is None:
        element = xml.SubElement(parent, name)
    element.text = str(value)
    return element

def filters(repo, state):
    result = capture(["git", "ls-files", "--cached", "-z"], cwd=repo, timeout=30)
    tracked = result.stdout.decode("utf-8").split("\0")
    patterns = [".claude", "node_modules", ".gradle", ".cache", ".vs", ".idea", "bin", "obj", "build", "builds", "TestResults", "artifacts", "(?i).env", "(?i).env.*", "(?i)auth.json", "(?i)credentials.json", "*.key", "*.pem", "*.pfx", "*.p12", "*.jks", "*.keystore", "/.git/config", "/.git/hooks", "/.git/worktrees", "/.git/**/index.lock", "/.git/**/HEAD.lock", "/.git/ghdesktop/*.lock", "/.git/objects/pack/tmp_*", "/.git/objects/incoming-*", "/.git/objects/tmp_*", ".stignore", ".stfolder"]
    if repo.name == "example-engine":
        patterns += ["/distribution", "/dist", "/ports/roblox/generated", "/src/CutTheRopeDX.Browser/wwwroot/content"]
    ignores = sorted([repo / name for name in tracked if name and pathlib.PurePosixPath(name).name == ".gitignore"], key=lambda item: len(item.parts), reverse=True)
    if repo / ".gitignore" not in ignores and (repo / ".gitignore").exists():
        ignores.append(repo / ".gitignore")
    for filename in ignores:
        relative = filename.parent.relative_to(repo).as_posix()
        scope = "" if relative == "." else relative
        for line in reversed(filename.read_text(encoding="utf-8-sig").splitlines()):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            negate = line.startswith("!")
            value = line[1:] if negate else line
            value = value.rstrip("/")
            if value.startswith("/") or "/" in value:
                value = "/" + (scope + "/" if scope else "") + value.lstrip("/")
            elif scope:
                value = "/" + scope + "/**/" + value
            patterns.append(("!" if negate else "") + value)
    omitted = capture(["git", "ls-files", "--cached", "--ignored", "--exclude-standard", "-z"], cwd=repo, timeout=30).stdout.decode("utf-8").split("\0")
    blocked = {".claude", "node_modules", ".gradle", ".cache", ".vs", ".idea", "bin", "obj", "build", "builds", "testresults", "artifacts"}
    for name in tracked:
        parts = pathlib.PurePosixPath(name).parts
        if any(part.lower() in blocked for part in parts):
            omitted.append(name)
        basename = pathlib.PurePosixPath(name).name.lower()
        if basename.startswith(".env") or basename in {"auth.json", "credentials.json"} or pathlib.PurePosixPath(basename).suffix in {".key", ".pem", ".pfx", ".p12", ".jks", ".keystore"}:
            omitted.append(name)
        if repo.name == "example-engine" and any(name == prefix or name.startswith(prefix + "/") for prefix in ["distribution", "dist", "ports/roblox/generated", "src/CutTheRopeDX.Browser/wwwroot/content"]):
            omitted.append(name)
    write(repo / ".git/ghdesktop/mobile.json", json.dumps({"source": str(repo), "omitted": sorted(set(name for name in omitted if name))}, indent=2).encode())
    filename = repo / ".stignore"
    baseline = state / "ignores" / (repo.name + ".baseline")
    if not baseline.exists():
        write(baseline, filename.read_bytes() if filename.exists() else b"")
    original = baseline.read_text(encoding="utf-8-sig")
    current = ("#escape=\\\n" + "\n".join(dict.fromkeys(patterns)) + "\n" + original).encode("utf-8")
    if not filename.exists() or filename.read_bytes() != current:
        write(filename, current)
    exclude = repo / ".git" / "info" / "exclude"
    previous = exclude.read_bytes() if exclude.exists() else b""
    if b"/.stfolder" not in previous:
        write(exclude, previous.rstrip() + b"\n/.stfolder\n/.stignore\n")
    return hashlib.sha256(current).hexdigest()

##########################################################################

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=pathlib.Path, required=True)
    parser.add_argument("--peer", required=True)
    parser.add_argument("--address", required=True)
    parser.add_argument("--repositories", type=pathlib.Path, default=pathlib.Path.home() / "Documents" / "GitHub")
    parser.add_argument("--chats", type=pathlib.Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Z2-7-]{63}", args.peer):
        raise ValueError("Invalid peer device ID")
    root = xml.parse(args.config).getroot()
    identity = root.find("device").get("id")
    if root.findall("folder"):
        raise ValueError("Initialize an empty dedicated Syncthing configuration")
    peer = copy.deepcopy(root.find("./defaults/device"))
    peer.set("id", args.peer)
    peer.set("name", "Android workspace")
    peer.set("compression", "always")
    for address in peer.findall("address"):
        peer.remove(address)
    xml.SubElement(peer, "address").text = args.address
    xml.SubElement(peer, "address").text = "dynamic"
    root.append(peer)
    selection = refresh(pathlib.Path.home() / ".codex", args.chats, 14)
    priority = args.chats.parent / "priority"
    refreshcode(args.repositories, priority)
    folders = [(name, args.repositories / name) for name in projects] + [("codexchats", args.chats)] + [(name + ".code", priority / name) for name in projects]
    receipts = []
    for name, path in folders:
        if not path.is_dir():
            raise ValueError("Missing source repository: " + name)
        if name in projects:
            receipts.append({"name": name, "filter": filters(path, args.config.parent)})
        folder = copy.deepcopy(root.find("./defaults/folder"))
        folder.set("id", name)
        folder.set("label", name)
        folder.set("path", str(path))
        folder.set("type", "sendonly")
        folder.set("rescanIntervalS", "3600")
        folder.set("fsWatcherDelayS", "5")
        folder.set("ignorePerms", "true")
        folder.set("paused", "true" if name in projects else "false")
        setting(folder, "order", "smallestFirst")
        setting(folder, "hashers", "1")
        for device in folder.findall("device"):
            folder.remove(device)
        xml.SubElement(folder, "device", {"id": identity})
        xml.SubElement(folder, "device", {"id": args.peer})
        root.append(folder)
    setting(root.find("gui"), "address", "127.0.0.1:8385")
    setting(root.find("options"), "startBrowser", "false")
    setting(root.find("options"), "urAccepted", "-1")
    setting(root.find("options"), "maxFolderConcurrency", "1")
    setting(root.find("options"), "crashReportingEnabled", "false")
    setting(root.find("options"), "keepTemporariesH", "168")
    write(args.config, xml.tostring(root, encoding="utf-8", xml_declaration=True))
    write(args.config.parent / "sources.json", json.dumps({"projects": projects, "chats": str(args.chats), "filters": receipts}, indent=2).encode())
    print(json.dumps({"configured": len(folders), "chats": selection}))

if __name__ == "__main__":
    main()
