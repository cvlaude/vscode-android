import json
import os
import pathlib
import re
import shutil
import stat
import tempfile
import time
import xml.etree.ElementTree as xml
import zipfile
import zlib

##########################################################################

def atomic(filename, value):
    temporary = filename.with_suffix(".pending")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(filename)
    descriptor = os.open(filename.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def checked(entry):
    name = entry.filename
    relative = pathlib.PurePosixPath(name)
    if "\\" in name or ":" in name or relative.is_absolute() or ".." in relative.parts:
        raise ValueError("Invalid extension path")
    if stat.S_ISLNK(entry.external_attr >> 16):
        raise ValueError("Linked extension files are not imported")
    return relative.parts[1:]


def complete(entries, target):
    for entry in entries:
        filename = target.joinpath(*checked(entry))
        if not filename.is_file() or filename.stat().st_size != entry.file_size:
            return False
        checksum = 0
        with filename.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                checksum = zlib.crc32(chunk, checksum)
        if checksum != entry.CRC:
            return False
    return True


def seed(packages, extensions):
    extensions.mkdir(parents=True, exist_ok=True)
    registry = extensions / "extensions.json"
    previous = json.loads(registry.read_text()) if registry.exists() else []
    records = list(previous)
    for package in sorted(packages.glob("*.vsix")):
        with zipfile.ZipFile(package) as archive:
            manifest = json.loads(archive.read("extension/package.json"))
            identity = (manifest["publisher"] + "." + manifest["name"]).lower()
            version = manifest["version"]
            if not re.fullmatch(r"[a-z0-9][a-z0-9.-]+", identity) or not re.fullmatch(r"[a-zA-Z0-9.+-]+", version):
                raise ValueError("Invalid extension identity")
            definition = xml.fromstring(archive.read("extension.vsixmanifest"))
            platform = definition.find(".//{*}Identity").get("TargetPlatform", "")
            if platform and platform not in ("linux-arm64", "universal", "web"):
                raise ValueError("This extension requires a different platform: " + identity)
            relative = identity + "-" + version + ("-" + platform if platform else "")
            target = extensions / relative
            existing = next((item for item in records if item["identifier"]["id"] == identity and item["version"] == version), None)
            if existing and (extensions / existing["relativeLocation"]).is_dir():
                print("Installed: " + identity, flush=True)
                continue
            print("Importing: " + identity, flush=True)
            entries = [entry for entry in archive.infolist() if entry.filename.startswith("extension/") and not entry.is_dir()]
            if not target.exists() or not complete(entries, target):
                if target.exists():
                    recovery = extensions.parent / "recovery" / (relative + "-" + str(time.time_ns()))
                    recovery.parent.mkdir(parents=True, exist_ok=True)
                    target.rename(recovery)
                temporary = pathlib.Path(tempfile.mkdtemp(prefix=".seed", dir=extensions))
                try:
                    for entry in entries:
                        filename = temporary.joinpath(*checked(entry))
                        filename.parent.mkdir(parents=True, exist_ok=True)
                        with archive.open(entry) as source, filename.open("xb") as output:
                            shutil.copyfileobj(source, output, 1024 * 1024)
                        filename.chmod(0o700 if (entry.external_attr >> 16) & 0o111 else 0o600)
                    temporary.rename(target)
                finally:
                    if temporary.exists():
                        shutil.rmtree(temporary)
            records = [item for item in records if item["identifier"]["id"] != identity]
            metadata = {"installedTimestamp": int(time.time() * 1000), "pinned": True, "source": "vsix"}
            if platform:
                metadata["targetPlatform"] = platform
            records.append({"identifier": {"id": identity}, "version": version,
                "location": {"$mid": 1, "path": "/root/.local/share/code-server/extensions/" + relative, "scheme": "file"},
                "relativeLocation": relative, "metadata": metadata})
            if registry.exists():
                backup = extensions.parent / "recovery" / ("extensions-" + str(time.time_ns()) + ".json")
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(registry, backup)
            atomic(registry, records)
    print("Extension import complete", flush=True)


if __name__ == "__main__":
    prefix = pathlib.Path(os.environ.get("PREFIX", ""))
    expected = pathlib.Path("/data/data/com.termux/files/usr")
    if prefix.resolve() != expected.resolve() or not expected.is_dir():
        raise SystemExit("Run this helper in Termux after Debian installation")
    project = pathlib.Path(__file__).resolve().parent.parent
    rootfs = prefix / "var/lib/proot-distro/containers/debian/rootfs"
    if not (rootfs / "usr/bin/bash").is_file():
        raise SystemExit("Debian rootfs not found; this installer requires proot-distro 5")
    destination = rootfs / "root/.local/share/code-server/extensions"
    seed(project / "packages/extensions", destination)
