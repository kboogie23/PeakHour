"""Windows import compatibility for Unix-only pwd; account lookup is unsupported."""
def getpwuid(uid):
    raise OSError('Unix account lookup is unavailable on Windows')
