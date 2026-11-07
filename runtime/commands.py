import os
import pathlib
import re
import shutil
import subprocess
import time

##########################################################################

folder = pathlib.Path.home() / ".termux"
folder.mkdir(exist_ok=True)
filename = folder / "termux.properties"
previous = filename.read_text() if filename.exists() else ""
pattern = r"(?m)^\s*allow-external-apps\s*=.*$"
current = re.sub(pattern, "allow-external-apps=true", previous)
if not re.search(pattern, current):
    current = current.rstrip() + "\nallow-external-apps=true\n"
if current != previous:
    if filename.exists():
        recovery = folder / "recovery"
        recovery.mkdir(exist_ok=True)
        shutil.copyfile(filename, recovery / (str(time.time_ns()) + ".properties"))
    temporary = folder / "continuity.pending"
    with temporary.open("w") as stream:
        stream.write(current)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(filename)
    executable = shutil.which("termux-reload-settings")
    if executable:
        subprocess.run([executable], timeout=15, check=True)
print("Workspace startup is enabled. Allow its command permission in Android when prompted.")
