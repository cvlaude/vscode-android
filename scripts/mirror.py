import argparse
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
import xml.etree.ElementTree as xml
from chats import refresh as refreshchats
from priority import refresh as refreshcode

##########################################################################

def request(home, route, value=None, method=None):
    config = xml.parse(home / "config.xml").getroot()
    key = config.find("./gui/apikey").text
    address = config.find("./gui/address").text
    if address != "127.0.0.1:8385":
        raise ValueError("PC mirror API must use localhost:8385")
    data = None if value is None else json.dumps(value).encode()
    command = urllib.request.Request("http://" + address + route, data=data, method=method, headers={"X-API-Key": key, "Content-Type": "application/json"})
    with urllib.request.urlopen(command, timeout=20) as response:
        raw = response.read()
        return json.loads(raw) if raw else None

def cycle(home, repositories, chats, priority):
    config = request(home, "/rest/config")
    folders = config["folders"]
    peer = next(device["deviceID"] for device in folders[0]["devices"] if device["deviceID"] != request(home, "/rest/system/status")["myID"])
    completion = {}
    names = ["codexchats", "example-site", "example-pages", "example-game", "example-portal", "example-engine"]
    for name in names:
        query = urllib.parse.urlencode({"device": peer, "folder": name})
        try:
            completion[name] = request(home, "/rest/db/completion?" + query)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            completion[name] = {"globalItems": 0, "needItems": 1, "remoteState": "unscanned"}
        source = request(home, "/rest/db/status?" + urllib.parse.urlencode({"folder": name}))
        completion[name]["sourceState"] = source.get("state", "")
        completion[name]["sourceFiles"] = source.get("globalFiles", 0)
    ready = lambda value: value.get("sourceState") == "idle" and value.get("sourceFiles", 0) > 0 and value.get("globalItems", 0) > 0 and value.get("remoteState") == "valid" and not value.get("needItems", 1) and not value.get("needBytes", 1)
    previous = home / "progress.json"
    active = json.loads(previous.read_text()).get("phase") if previous.exists() else None
    pending = active if active in names[1:] and not ready(completion[active]) else next((name for name in names if not ready(completion[name])), None)
    for folder in folders:
        name = folder["id"]
        paused = name in names[1:] and name != pending and not ready(completion[name])
        if folder["paused"] != paused:
            request(home, "/rest/config/folders/" + urllib.parse.quote(name, safe=""), {"paused": paused}, "PATCH")
    receipt = {"updated": time.time(), "phase": pending or "ready", "completion": completion}
    temporary = home / "progress.pending"
    with temporary.open("w") as stream:
        json.dump(receipt, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(home / "progress.json")
    refreshchats(pathlib.Path.home() / ".codex", chats, 14)
    refreshcode(repositories, priority)
    return receipt

def run(args):
    marker = args.home / "watcher.pid"
    lock = (args.home / "watcher.lock").open("a+b")
    if sys.platform == "win32":
        import msvcrt
        lock.seek(0)
        lock.write(b"0")
        lock.flush()
        lock.seek(0)
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    marker.write_text(str(os.getpid()))
    last = 0
    while True:
        try:
            try:
                request(args.home, "/rest/system/ping")
            except Exception:
                subprocess.Popen([str(args.executable), "serve", "--home", str(args.home), "--log-file", str(args.home / "runtime.log"), "--log-max-size", "2097152", "--log-max-old-files", "2"], creationflags=subprocess.CREATE_NO_WINDOW)
                time.sleep(10)
            if time.monotonic() - last >= 60:
                last = time.monotonic()
                result = cycle(args.home, args.repositories, args.chats, args.priority)
                print(json.dumps({"phase": result["phase"]}), flush=True)
            if args.once:
                return
        except Exception as error:
            with (args.home / "watcher.log").open("a") as stream:
                stream.write(str(time.time()) + " " + type(error).__name__ + ": " + str(error) + "\n")
            if args.once:
                raise
        time.sleep(15)

##########################################################################

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=pathlib.Path, required=True)
    parser.add_argument("--executable", type=pathlib.Path, required=True)
    parser.add_argument("--repositories", type=pathlib.Path, default=pathlib.Path.home() / "Documents/GitHub")
    parser.add_argument("--chats", type=pathlib.Path, required=True)
    parser.add_argument("--priority", type=pathlib.Path, required=True)
    parser.add_argument("--once", action="store_true")
    run(parser.parse_args())
