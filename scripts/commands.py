import ctypes
import os
import subprocess
from ctypes import wintypes

##########################################################################

class limits(ctypes.Structure):
    _fields_ = [("processtime", ctypes.c_longlong), ("jobtime", ctypes.c_longlong), ("flags", wintypes.DWORD), ("minimum", ctypes.c_size_t), ("maximum", ctypes.c_size_t), ("processes", wintypes.DWORD), ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD)]

class counters(ctypes.Structure):
    _fields_ = [(name, ctypes.c_ulonglong) for name in ["reads", "writes", "other", "readbytes", "writebytes", "otherbytes"]]

class extended(ctypes.Structure):
    _fields_ = [("basic", limits), ("io", counters), ("processmemory", ctypes.c_size_t), ("jobmemory", ctypes.c_size_t), ("peakprocess", ctypes.c_size_t), ("peakjob", ctypes.c_size_t)]

##########################################################################

def capture(arguments, cwd=None, text=False, timeout=30):
    if os.name != "nt":
        return subprocess.run(arguments, cwd=cwd, capture_output=True, text=text, check=True, timeout=timeout)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    native = ctypes.WinDLL("ntdll")
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.AssignProcessToJobObject.restype = wintypes.BOOL
    kernel.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel.TerminateJobObject.restype = wintypes.BOOL
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.SetInformationJobObject.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    native.NtResumeProcess.argtypes = [wintypes.HANDLE]
    native.NtResumeProcess.restype = wintypes.LONG
    job = kernel.CreateJobObjectW(None, None)
    if not job:
        raise ctypes.WinError(ctypes.get_last_error())
    process = None
    try:
        settings = extended()
        settings.basic.flags = 0x00002000
        if not kernel.SetInformationJobObject(job, 9, ctypes.byref(settings), ctypes.sizeof(settings)):
            raise ctypes.WinError(ctypes.get_last_error())
        suspended = 0x00000004
        process = subprocess.Popen(arguments, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=text, creationflags=subprocess.CREATE_NO_WINDOW | suspended)
        if not kernel.AssignProcessToJobObject(job, int(process._handle)):
            raise ctypes.WinError(ctypes.get_last_error())
        if native.NtResumeProcess(int(process._handle)) != 0:
            raise OSError("Could not start the background command")
        try:
            output, errors = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            kernel.TerminateJobObject(job, 1)
            output, errors = process.communicate(timeout=5)
            raise subprocess.TimeoutExpired(arguments, timeout, output=output, stderr=errors)
        result = subprocess.CompletedProcess(arguments, process.returncode, output, errors)
        result.check_returncode()
        return result
    finally:
        kernel.TerminateJobObject(job, 1)
        if process is not None:
            if process.poll() is None:
                process.kill()
            process.communicate(timeout=5)
        kernel.CloseHandle(job)
