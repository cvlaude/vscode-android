import ctypes
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
from commands import capture

##########################################################################

@unittest.skipUnless(os.name == "nt", "Windows background commands")
class background(unittest.TestCase):
    def testhidden(self):
        result = capture([sys.executable, "-c", "import ctypes; print(ctypes.windll.kernel32.GetConsoleWindow())"], text=True)
        self.assertEqual(result.stdout.strip(), "0")

    def testfailure(self):
        with self.assertRaises(subprocess.CalledProcessError) as failure:
            capture([sys.executable, "-c", "import sys; print('stopped', file=sys.stderr); sys.exit(3)"], text=True)
        self.assertEqual(failure.exception.returncode, 3)
        self.assertIn("stopped", failure.exception.stderr)

    def testdescendants(self):
        with tempfile.TemporaryDirectory() as folder:
            marker = pathlib.Path(folder) / "child.json"
            child = "import os,pathlib,sys,time; pathlib.Path(sys.argv[1]).write_text(str(os.getpid())); time.sleep(120)"
            parent = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[2]]); time.sleep(120)"
            started = time.monotonic()
            with self.assertRaises(subprocess.TimeoutExpired):
                capture([sys.executable, "-c", parent, child, str(marker)], timeout=3)
            self.assertLess(time.monotonic() - started, 10)
            self.assertTrue(marker.exists())
            process = int(marker.read_text())
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
            kernel.OpenProcess.restype = ctypes.c_void_p
            kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
            kernel.WaitForSingleObject.restype = ctypes.c_ulong
            kernel.CloseHandle.argtypes = [ctypes.c_void_p]
            handle = kernel.OpenProcess(0x00100000, False, process)
            if handle:
                try:
                    self.assertEqual(kernel.WaitForSingleObject(handle, 2000), 0)
                finally:
                    kernel.CloseHandle(handle)

##########################################################################

if __name__ == "__main__":
    unittest.main()
