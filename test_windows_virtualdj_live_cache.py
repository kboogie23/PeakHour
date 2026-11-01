"""Live Assist's VirtualDJ lookup reads the library file only when it changes, not on every poll (a full read of a
large library held Python's lock long enough to make the preview player stutter)."""
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'axiom-win-probe'))
import windows_virtualdj_live as live

with tempfile.TemporaryDirectory(prefix='phlvc') as base:
    cache = Path(base) / 'library_cache.json'
    cache.write_text('{}', encoding='utf-8')
    reads = []

    class App:
        CACHE_PATH = str(cache)

        @staticmethod
        def load_cache(path):
            reads.append(path)
            return {'tracks': [{'path': 'D:\\Music\\One.mp3', 'bpm': 120}]}

    for _ in range(20):
        assert live._library(App)['d:\\music\\one.mp3']['bpm'] == 120
    assert len(reads) == 1, reads
    time.sleep(0.05)
    cache.write_text('{"changed": true}', encoding='utf-8')  # the library was saved: read again once
    for _ in range(5):
        live._library(App)
    assert len(reads) == 2, reads
print('PASS: VirtualDJ live lookup reads the library once and again only after it changes')
