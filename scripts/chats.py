import argparse
import datetime
import json
import os
import pathlib
import time
from commands import capture

##########################################################################

def refresh(source, destination, days):
    cutoff = time.time() - days * 86400
    result = capture(["rg", "--files", "--hidden", "-g", "*.jsonl", str(source / "sessions")], text=True, timeout=30)
    selected = []
    destination.mkdir(parents=True, exist_ok=True)
    for name in result.stdout.splitlines():
        filename = pathlib.Path(name)
        if filename.stat().st_mtime < cutoff:
            continue
        relative = filename.relative_to(source / "sessions")
        target = destination / "sessions" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and not os.path.samefile(filename, target):
            recovery = destination.parent / "chatrecovery" / str(time.time_ns()) / relative
            recovery.parent.mkdir(parents=True, exist_ok=True)
            target.replace(recovery)
        if not target.exists():
            os.link(filename, target)
        selected.append({"path": "sessions/" + relative.as_posix(), "bytes": filename.stat().st_size})
    index = source / "session_index.jsonl"
    if index.exists():
        target = destination / index.name
        if target.exists() and not os.path.samefile(index, target):
            recovery = destination.parent / "chatrecovery" / (str(time.time_ns()) + ".index.jsonl")
            recovery.parent.mkdir(parents=True, exist_ok=True)
            target.replace(recovery)
        if not target.exists():
            os.link(index, target)
    receipt = destination / "selection.json"
    with receipt.open("w", encoding="utf-8") as stream:
        json.dump({"updated": datetime.datetime.now(datetime.timezone.utc).isoformat(), "days": days, "sessions": selected}, stream)
        stream.flush()
        os.fsync(stream.fileno())
    return {"sessions": len(selected), "bytes": sum(item["bytes"] for item in selected)}

##########################################################################

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=pathlib.Path, default=pathlib.Path.home() / ".codex")
    parser.add_argument("--destination", type=pathlib.Path, required=True)
    parser.add_argument("--days", type=int, default=14)
    parser.add_argument("--watch", action="store_true")
    args = parser.parse_args()
    while True:
        print(json.dumps(refresh(args.source, args.destination, args.days)), flush=True)
        if not args.watch:
            break
        time.sleep(60)
