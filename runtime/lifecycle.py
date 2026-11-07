import argparse
import hmac
import json
import os
import pathlib
import signal
import socket
import subprocess
import time
import urllib.request
import xml.etree.ElementTree as xml
from sync import start, home, rootfs

##########################################################################

def stoptermux():
    config = xml.parse(home / "config.xml").getroot()
    request = urllib.request.Request("http://127.0.0.1:8384/rest/system/shutdown", method="POST", headers={"X-API-Key": config.find("./gui/apikey").text})
    try:
        urllib.request.urlopen(request, timeout=5).close()
    except Exception:
        pass
    os.sync()
    for entry in pathlib.Path("/proc").iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            if entry.stat().st_uid == os.getuid() and (entry / "cmdline").read_bytes().split(b"\0")[0] == b"com.termux":
                os.kill(int(entry.name), signal.SIGTERM)
        except (OSError, PermissionError):
            pass

def run(required):
    server = socket.socket()
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        server.bind(("127.0.0.1", 8767))
    except OSError:
        return
    server.listen(2)
    server.settimeout(1)
    start()
    child = subprocess.Popen(["proot-distro", "login", "debian", "--isolated", "--", "/bin/bash", "/opt/workspace-install/runtime/start.sh"], start_new_session=True)
    state = rootfs / "root/.local/share/vscode-android"
    with (state / "lifecycle.json").open("w") as stream:
        json.dump({"pid": os.getpid(), "runtime": child.pid}, stream)
        stream.flush()
        os.fsync(stream.fileno())
    deadline = time.monotonic() + 90
    attached = False
    try:
        while child.poll() is None:
            try:
                connection, _ = server.accept()
            except socket.timeout:
                if required and time.monotonic() > deadline:
                    break
                continue
            with connection:
                connection.settimeout(3)
                expected = (state / "localaccess.key").read_text().strip()
                provided = bytearray()
                while len(provided) < 45:
                    value = connection.recv(1)
                    if not value or value == b"\n":
                        break
                    provided.extend(value)
                if not hmac.compare_digest(provided, expected.encode()):
                    continue
                attached = True
                connection.settimeout(None)
                connection.sendall(b"ready\n")
                while connection.recv(1):
                    pass
            break
    finally:
        server.close()
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=7)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
        if attached or required:
            stoptermux()

##########################################################################

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", action="store_true")
    run(parser.parse_args().app)
