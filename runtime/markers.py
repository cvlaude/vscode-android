import argparse
import json
import os
import pathlib
import urllib.parse
import urllib.request
import xml.etree.ElementTree as xml

##########################################################################

name = ".claude/.stfolder"

def ignore(root):
    filename = root / ".stignore"
    previous = filename.read_text(encoding="utf-8-sig") if filename.exists() else ""
    if any(line.strip() in {".claude", "/.claude", ".claude/", "/.claude/"} for line in previous.splitlines()):
        return
    temporary = filename.with_suffix(".pending")
    with temporary.open("w", encoding="utf-8", newline="\n") as stream:
        stream.write(previous.rstrip() + "\n/.claude\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(filename)

def create(path):
    root = pathlib.Path(path)
    if not root.is_dir():
        raise ValueError("Missing mirror root: " + str(root))
    marker = root / name
    if not marker.resolve().is_relative_to(root.resolve()):
        raise ValueError("The mirror marker must stay inside its project")
    marker.mkdir(parents=True, exist_ok=True)
    ignore(root)
    return marker

def prepare(folder):
    root = pathlib.Path(folder["path"])
    previous = folder.get("markerName") or ".stfolder"
    if previous not in {".stfolder", name}:
        raise ValueError("Unexpected mirror marker: " + previous)
    marker = root / name
    original = root / previous
    if not root.is_dir() or not marker.resolve().is_relative_to(root.resolve()):
        raise ValueError("Missing or linked mirror root: " + str(root))
    if previous != name and original.exists():
        if marker.exists():
            raise ValueError("Both mirror markers exist: " + str(root))
        marker.parent.mkdir(parents=True, exist_ok=True)
        original.replace(marker)
    if not marker.is_dir():
        raise ValueError("Folder marker missing: " + str(root))
    ignore(root)
    return marker

def relocate(folder, patch):
    if folder.get("markerName") == name:
        prepare(folder)
        return False
    paused = folder.get("paused", False)
    patch({"paused": True})
    prepare(folder)
    patch({"markerName": name, "paused": paused})
    return True

##########################################################################

def migrate(config):
    root = xml.parse(config).getroot()
    endpoint = "http://" + root.find("./gui/address").text
    address = urllib.parse.urlparse(endpoint)
    if address.hostname != "127.0.0.1" or address.username or address.password or address.path:
        raise ValueError("The mirror API must use localhost")
    key = root.find("./gui/apikey").text
    def request(route, value=None):
        data = None if value is None else json.dumps(value).encode()
        command = urllib.request.Request(endpoint + route, data=data, method="GET" if value is None else "PATCH", headers={"X-API-Key": key, "Content-Type": "application/json"})
        with urllib.request.urlopen(command, timeout=20) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    results = []
    for folder in request("/rest/config/folders"):
        route = "/rest/config/folders/" + urllib.parse.quote(folder["id"], safe="")
        changed = relocate(folder, lambda value: request(route, value))
        results.append({"id": folder["id"], "changed": changed, "marker": name})
    return results

def offline(root, config):
    changed = False
    for folder in root.findall("folder"):
        field = folder.find("markerName")
        previous = field.text if field is not None else ".stfolder"
        prepare({"path": folder.get("path"), "markerName": previous})
        if previous != name:
            if field is None:
                field = xml.SubElement(folder, "markerName")
            field.text = name
            changed = True
    if changed:
        temporary = config.with_suffix(".pending")
        with temporary.open("wb") as stream:
            stream.write(xml.tostring(root, encoding="utf-8", xml_declaration=True))
            stream.flush()
            os.fsync(stream.fileno())
        temporary.chmod(0o600)
        temporary.replace(config)

##########################################################################

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=pathlib.Path, required=True)
    args = parser.parse_args()
    print(json.dumps(migrate(args.config)))
