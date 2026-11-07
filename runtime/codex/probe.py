import json
import pathlib
import subprocess
import tempfile
import time

##########################################################################

def main():
    with tempfile.TemporaryDirectory(prefix="workspaceprobe") as temporary:
        root = pathlib.Path(temporary)
        workspace = root / "workspace"
        workspace.mkdir()
        outside = root / "outside.txt"
        outside.write_text("retained", encoding="utf-8")
        script = "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_text('changed')"
        result = subprocess.run(
            ["codex", "sandbox", "--", "python3", "-c", script, str(outside)],
            cwd=workspace, capture_output=True, text=True, timeout=45
        )
        inside = subprocess.run(
            ["codex", "sandbox", "--", "python3", "-c", "import pathlib; pathlib.Path('inside.txt').write_text('allowed')"],
            cwd=workspace, capture_output=True, text=True, timeout=45
        )
        network = subprocess.run(
            ["codex", "sandbox", "--", "python3", "-c", "import socket; socket.create_connection(('1.1.1.1',443),timeout=3)"],
            cwd=workspace, capture_output=True, text=True, timeout=45
        )
        passed = result.returncode != 0 and outside.read_text(encoding="utf-8") == "retained" and inside.returncode == 0 and network.returncode != 0
        receipt = {
            "tested": time.time(), "outsideblocked": result.returncode != 0 and outside.read_text(encoding="utf-8") == "retained",
            "workspacewritable": inside.returncode == 0, "networkblocked": network.returncode != 0,
            "passed": passed, "returncodes": {"outside": result.returncode, "inside": inside.returncode, "network": network.returncode},
            "diagnostic": (result.stdout + result.stderr + inside.stdout + inside.stderr + network.stdout + network.stderr)[-6000:]
        }
        destination = pathlib.Path.home() / ".local/share/vscode-android/sandbox.json"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
        print(json.dumps(receipt, indent=2))
        raise SystemExit(0 if passed else 1)

if __name__ == "__main__":
    main()
