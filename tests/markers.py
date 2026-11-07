import pathlib
import sys
import tempfile
import unittest
import xml.etree.ElementTree as xml

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from runtime.markers import name, offline, relocate

##########################################################################

class markers(unittest.TestCase):
    def testmove(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / ".stfolder").mkdir()
            (root / ".stfolder/marker.txt").write_text("original")
            folder = {"path": directory, "markerName": ".stfolder", "paused": False}
            updates = []
            self.assertTrue(relocate(folder, updates.append))
            self.assertEqual(updates, [{"paused": True}, {"markerName": name, "paused": False}])
            self.assertFalse((root / ".stfolder").exists())
            self.assertEqual((root / name / "marker.txt").read_text(), "original")
            folder.update(updates[-1])
            self.assertFalse(relocate(folder, updates.append))
            self.assertEqual(len(updates), 2)

    def testmissing(self):
        with tempfile.TemporaryDirectory() as directory:
            updates = []
            with self.assertRaises(ValueError):
                relocate({"path": directory, "markerName": ".stfolder"}, updates.append)
            self.assertEqual(updates, [{"paused": True}])
            self.assertFalse((pathlib.Path(directory) / name).exists())

    def testoffline(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / ".stfolder").mkdir()
            config = root / "config.xml"
            tree = xml.Element("configuration")
            folder = xml.SubElement(tree, "folder", {"path": directory})
            xml.SubElement(folder, "markerName").text = ".stfolder"
            offline(tree, config)
            self.assertEqual(xml.parse(config).getroot().find("folder/markerName").text, name)
            self.assertTrue((root / name).is_dir())

##########################################################################

if __name__ == "__main__":
    unittest.main()
