"""Frozen interface shared by the runner (check_features.py), the catalogue and the checks."""
import json
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Callable, Optional, List, Dict, Any


@dataclass
class Result:
    status: str            # 'PASS' | 'FAIL' | 'SKIP' | 'N/A' | 'WARN'
    seconds: float = 0.0
    budget: Optional[float] = None
    reason: str = ''
    evidence: Dict[str, Any] = field(default_factory=dict)
    shots: List[str] = field(default_factory=list)


@dataclass
class Check:
    kind: str              # 'api' | 'ui' | 'win' | 'scale' | 'legacy'
    name: str
    run: Optional[Callable[['Context'], Result]] = None   # None for kind 'legacy'
    legacy: Optional[str] = None                          # test_windows_*.py file name for kind 'legacy'


@dataclass
class Feature:
    id: str
    area: str
    name: str
    works_means: str
    checks: List[Check] = field(default_factory=list)
    budget_s: Optional[float] = None
    covered_by: List[str] = field(default_factory=list)   # existing test files
    requires: List[str] = field(default_factory=list)     # e.g. 'ui', 'scale', 'serato'
    platform: str = 'windows'                             # or 'mac_only'
    mvp: bool = False


class CheckFailed(Exception):
    """A check found a problem: args are (reason, evidence dict)."""


class CheckSkipped(Exception):
    """A check cannot run here: args are (reason,)."""


class _Timer:
    def __init__(self, budget=None):
        self.budget = budget
        self.seconds = 0.0
        self._start = None

    def __enter__(self):
        self._start = time.perf_counter()
        return self

    def __exit__(self, *exc):
        self.seconds = time.perf_counter() - self._start
        return False

    @property
    def over_budget(self):
        return self.budget is not None and self.seconds > self.budget


class Context:
    base_url: str
    port: int
    sandbox: 'pathlib.Path'  # noqa: F821
    browser: Any             # browser or None (set by the runner from feature_check.browser)

    def __init__(self, base_url, port, sandbox, browser=None):
        self.base_url = base_url.rstrip('/')
        self.port = port
        self.sandbox = sandbox
        self.browser = browser
        self.last_request = None   # {'method','path','status','request','response'} of the latest call, for failure reports

    def _request(self, method, path, json_body=None, headers=None, data=None, timeout=60, raw=False):
        url = path if path.startswith('http') else self.base_url + (path if path.startswith('/') else '/' + path)
        head = dict(headers or {})
        body = data
        if json_body is not None:
            body = json.dumps(json_body).encode('utf-8')
            head.setdefault('Content-Type', 'application/json')
        if isinstance(body, str):
            body = body.encode('utf-8')
        req = urllib.request.Request(url, data=body, headers=head, method=method)
        try:
            resp = urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as exc:
            resp = exc
        except (urllib.error.URLError, OSError) as exc:
            self.last_request = {'method': method, 'path': path, 'status': None, 'request': json_body, 'response': repr(exc)}
            raise
        with resp:
            payload = resp.read()
            status, hdrs = resp.status if hasattr(resp, 'status') else resp.code, dict(resp.headers.items())
        out = payload
        if not raw and 'json' in hdrs.get('Content-Type', '').lower():
            try:
                out = json.loads(payload.decode('utf-8'))
            except ValueError:
                out = payload
        self.last_request = {'method': method, 'path': path, 'status': status, 'request': json_body,
                             'response': (out if not isinstance(out, bytes) else out[:2048].decode('utf-8', 'replace'))}
        return status, hdrs, out

    def get(self, path, **kw):
        """GET -> (status, headers, json_or_bytes)."""
        return self._request('GET', path, headers=kw.pop('headers', None), **kw)

    def post(self, path, json=None, **kw):
        """POST with the Origin / Sec-Fetch-Site headers the app's local_only check wants."""
        headers = dict(kw.pop('headers', None) or {})
        headers.setdefault('Origin', 'http://127.0.0.1:%d' % self.port)
        headers.setdefault('Sec-Fetch-Site', 'same-origin')
        return self._request('POST', path, json_body=json, headers=headers, **kw)

    def metrics(self) -> dict:
        """Counters from the check-only blueprint of boot_server.py."""
        return self.get('/api/_featurecheck/metrics')[2]

    def timer(self, budget=None):
        """Context manager measuring seconds (`with ctx.timer(2) as t: ...; t.seconds`)."""
        return _Timer(budget)

    def skip(self, reason):
        raise CheckSkipped(reason)

    def fail(self, reason, **evidence):
        raise CheckFailed(reason, evidence)
