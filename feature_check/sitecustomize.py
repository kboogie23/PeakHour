"""Put feature_check on PYTHONPATH and every Python process (legacy tests and their children) is guarded.
The guard is loaded by file path and this folder is then dropped from sys.path, so none of the feature_check
module names (api, report, media ...) can shadow anything in the program under test."""
import os
import sys

try:
    import importlib.util
    _here = os.path.dirname(os.path.abspath(__file__))
    _spec = importlib.util.spec_from_file_location('feature_check_guard', os.path.join(_here, 'guard.py'))
    _module = importlib.util.module_from_spec(_spec)
    sys.modules['feature_check_guard'] = _module
    _spec.loader.exec_module(_module)
    _module.install()
    sys.path[:] = [p for p in sys.path if os.path.normcase(os.path.abspath(p or '.')) != os.path.normcase(_here)]
except Exception as _exc:  # never stop Python from starting
    sys.stderr.write('feature_check sitecustomize: guard not loaded: %r\n' % (_exc,))


def _no_dialogs():
    """Legacy runs: a tkinter file chooser must never open on the owner's screen. After tkinter.filedialog is
    imported its choosers are replaced by ones that answer "cancelled" (a test that fakes them itself still wins)."""
    import importlib.abc

    class Finder(importlib.abc.MetaPathFinder):
        busy = False

        def find_spec(self, name, path, target=None):
            if name != 'tkinter.filedialog' or self.busy:
                return None
            self.busy = True
            try:
                import importlib.util
                spec = importlib.util.find_spec(name)
            finally:
                self.busy = False
            if spec is None or spec.loader is None:
                return None
            real_exec = spec.loader.exec_module

            def exec_module(module):
                real_exec(module)
                for attr in ('askdirectory', 'askopenfilename', 'askopenfilenames', 'asksaveasfilename', 'asksaveasfile', 'askopenfile', 'askopenfiles'):
                    if hasattr(module, attr):
                        setattr(module, attr, lambda *a, **k: '')
            spec.loader.exec_module = exec_module
            return spec

    sys.meta_path.insert(0, Finder())


if os.environ.get('FEATURE_CHECK_LEGACY') == '1':
    try:
        _no_dialogs()
    except Exception as _exc:
        sys.stderr.write('feature_check sitecustomize: dialog stub not installed: %r\n' % (_exc,))
