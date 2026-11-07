import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
from mirror import cycle

##########################################################################

class transfers(unittest.TestCase):
    def testscanning(self):
        with tempfile.TemporaryDirectory() as directory:
            home = pathlib.Path(directory)
            (home / "progress.json").write_text(json.dumps({"phase": "example-game"}))
            folders = [{"id": name, "paused": False, "devices": [{"deviceID": "pc"}, {"deviceID": "phone"}]} for name in ["codexchats", "example-site", "example-pages", "example-game", "example-portal", "example-engine"]]
            updates = []
            def request(home, route, value=None, method=None):
                if method == "PATCH":
                    updates.append((route, value))
                    return
                if route == "/rest/config":
                    return {"folders": folders}
                if route == "/rest/system/status":
                    return {"myID": "pc"}
                if route.startswith("/rest/db/completion"):
                    return {"globalItems": 10, "remoteState": "valid", "needItems": 0, "needBytes": 0}
                if route.startswith("/rest/db/status"):
                    return {"state": "scanning" if route.endswith("example-game") else "idle", "globalFiles": 10}
                self.fail("Unexpected configuration mutation: " + route)
            with patch("mirror.request", request), patch("mirror.refreshchats"), patch("mirror.refreshcode"):
                receipt = cycle(home, home, home, home)
            self.assertEqual(receipt["phase"], "example-game")
            self.assertEqual(receipt["completion"]["example-game"]["sourceState"], "scanning")
            self.assertEqual(updates, [("/rest/config/folders/codexchats", {"paused": True})])

##########################################################################

if __name__ == "__main__":
    unittest.main()
