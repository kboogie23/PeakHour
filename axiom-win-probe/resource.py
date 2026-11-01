"""Probe-only placeholder; process resource reporting requires a Windows adapter."""
RUSAGE_SELF = 0
def getrusage(who):
    raise OSError('POSIX resource usage is unavailable on Windows')
