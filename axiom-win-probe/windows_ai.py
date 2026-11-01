"""AI Assist: Claude or ChatGPT suggest release years, tidy titles and artists, genres and energy, and build
playlists from the DJ's own library.

Nothing changes until the DJ approves it. A run sends batches of tracks (artist, title, file name and what
PEAK HOUR already knows: genre, BPM, year, length) to the chosen provider, keeps the answers as
suggestions, and the review list applies only the ticked ones through PEAK HOUR's own endpoints
(update_year, update_track_metadata, update_genre), which keep their history; energy, which AXIOM works out
from BPM and has no endpoint for, is saved the same way they save (cache lock, AXIOM's commit). Music files
and DJ libraries are never written here: that stays with Health's publish steps.

Playlists: the DJ describes the set (and may limit BPM and years); PEAK HOUR narrows the library to at most 600
candidates (filters, words of the brief, then an even spread), the AI picks and orders them by id only, unknown ids
are dropped, and the page saves the result in Playlists the same way Studio saves a set (upsertSavedPlaylist).

Each provider uses its official SDK with the account's own API key: Anthropic's `anthropic` (Messages API,
structured output, server-side refusal fallback) and OpenAI's `openai` (Responses API, strict JSON schema).
Keys are typed by the DJ into Settings and stored encrypted with Windows DPAPI for this Windows account
(%LOCALAPPDATA%\\AXIOM DJ\\ai\\keys.dat); they are never sent back to the page, written to logs or shared.
"""
import base64
import ctypes
import json
import os
import re
import threading
import time
import uuid
from ctypes import wintypes
from pathlib import Path

from flask import Blueprint, jsonify, request

PROVIDERS = {
    'claude': {'name': 'Claude', 'models': ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
               'labels': {'claude-opus-5-5': 'Claude Opus 5.5 (best)', 'claude-sonnet-5-5': 'Claude Sonnet 5.5',
                          'claude-haiku-5-5': 'Claude Haiku 5.5 (lowest cost)'}},
    'openai': {'name': 'ChatGPT', 'models': ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'],
               'labels': {'gpt-5.5': 'GPT-5.5 (best)', 'gpt-5.4': 'GPT-5.4', 'gpt-5.4-mini': 'GPT-5.4 mini (lowest cost)'}},
}
FALLBACK_MODELS = {'claude-opus-5-5', 'claude-sonnet-5-5'}  # server-side refusal fallback; Haiku 5.5 has none
BATCH = 40
MAX_TRACKS = 5000
CONFIDENCE = ['high', 'medium', 'low']
ENERGY = ['Low', 'Mid', 'High', 'Ultra']


class AIError(RuntimeError):
    pass


# ------------------------------------------------------------------ key storage (Windows DPAPI)

class _Blob(ctypes.Structure):
    _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_char))]


_ENTROPY = b'PEAK HOUR AI Assist'


def _dpapi(data, protect):
    crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
    source = _Blob(len(data), ctypes.cast(ctypes.create_string_buffer(data, len(data)), ctypes.POINTER(ctypes.c_char)))
    entropy = _Blob(len(_ENTROPY), ctypes.cast(ctypes.create_string_buffer(_ENTROPY, len(_ENTROPY)), ctypes.POINTER(ctypes.c_char)))
    result = _Blob()
    call = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    if not call(ctypes.byref(source), None, ctypes.byref(entropy), None, None, 0x1, ctypes.byref(result)):  # UI forbidden
        raise AIError('Windows could not unlock the saved key. Enter it again in Settings.')
    try:
        return ctypes.string_at(result.pbData, result.cbData)
    finally:
        kernel32.LocalFree(result.pbData)


class KeyStore:
    def __init__(self, folder):
        self.folder = Path(folder)
        self.path = self.folder / 'keys.dat'
        self.lock = threading.Lock()

    def _read(self):
        try:
            return json.loads(self.path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return {}

    def get(self, provider):
        with self.lock:
            sealed = self._read().get(provider)
        return _dpapi(base64.b64decode(sealed), False).decode('utf-8') if sealed else ''

    def has(self, provider):
        with self.lock:
            return bool(self._read().get(provider))

    def set(self, provider, key):
        with self.lock:
            data = self._read()
            if key:
                data[provider] = base64.b64encode(_dpapi(key.encode('utf-8'), True)).decode('ascii')
            else:
                data.pop(provider, None)
            self.folder.mkdir(parents=True, exist_ok=True)
            partial = self.path.with_suffix('.part')
            partial.write_text(json.dumps(data), encoding='utf-8')
            os.replace(partial, self.path)


# ------------------------------------------------------------------ providers

NO_CREDIT = {'insufficient_quota', 'credit_balance_exhausted'}


def _no_credit(error):
    """OpenAI answers 429 both for "too fast" and for an account without credit; its error code or type says which
    ("credit_balance_exhausted" / "insufficient_quota" = no credit, "rate_limit_exceeded" = too fast)."""
    body = getattr(error, 'body', None)
    inner = body.get('error') if isinstance(body, dict) and isinstance(body.get('error'), dict) else body if isinstance(body, dict) else {}
    found = {getattr(error, 'code', None), getattr(error, 'type', None), inner.get('code'), inner.get('type')}
    return bool(found & NO_CREDIT)


class ClaudeProvider:
    def __init__(self, key, model, base_url=None):
        import anthropic
        self.anthropic, self.model = anthropic, model
        self.client = anthropic.Anthropic(api_key=key, max_retries=3, timeout=180.0,
                                          **({'base_url': base_url} if base_url else {}))

    def ask(self, system, prompt, schema):
        a = self.anthropic
        options = dict(model=self.model, max_tokens=16000, system=system,
                       messages=[{'role': 'user', 'content': prompt}],
                       output_config={'effort': 'medium', 'format': {'type': 'json_schema', 'schema': schema}})
        try:
            if self.model in FALLBACK_MODELS:  # a policy decline is re-run on a fallback model inside the same call
                response = self.client.beta.messages.create(betas=['server-side-fallback-2026-07-01'], fallbacks='default', **options)
            else:
                response = self.client.messages.create(**options)
        except a.AuthenticationError:
            raise AIError('Claude did not accept the API key. Check it in Settings > AI Assist.') from None
        except a.PermissionDeniedError:
            raise AIError('This Claude API key is not allowed to use that model.') from None
        except a.NotFoundError:
            raise AIError(f'Claude does not offer the model {self.model} to this key.') from None
        except a.RateLimitError:
            raise AIError('Claude is limiting how fast this key can send requests. Wait a minute and try again.') from None
        except a.BadRequestError as error:
            if 'credit balance' in str(error.message).lower():
                raise AIError('Your Claude API account has no credit left. A Claude Pro or Max subscription does not '
                              'include API use: add credit at console.anthropic.com > Billing, then press Test '
                              'again.') from None
            raise AIError(f'Claude rejected the request: {error.message}') from None
        except a.APIStatusError as error:
            raise AIError(f'Claude had a server problem ({error.status_code}). Try again later.') from None
        except a.APIConnectionError:
            raise AIError('PEAK HOUR could not reach Claude. Check the internet connection.') from None
        if response.stop_reason == 'refusal':
            raise AIError('Claude declined this batch.')
        if response.stop_reason == 'max_tokens':
            raise AIError('Claude ran out of room for this batch.')
        text = next((block.text for block in response.content if block.type == 'text'), '')
        return json.loads(text)


class OpenAIProvider:
    def __init__(self, key, model, base_url=None):
        import openai
        self.openai, self.model = openai, model
        self.client = openai.OpenAI(api_key=key, max_retries=3, timeout=180.0, **({'base_url': base_url} if base_url else {}))

    def ask(self, system, prompt, schema):
        o = self.openai
        try:
            response = self.client.responses.create(
                model=self.model, instructions=system, input=prompt, store=False,
                text={'format': {'type': 'json_schema', 'name': 'peak_hour_suggestions', 'schema': schema, 'strict': True}})
        except o.AuthenticationError:
            raise AIError('ChatGPT (OpenAI) did not accept the API key. Check it in Settings > AI Assist.') from None
        except o.PermissionDeniedError:
            raise AIError('This OpenAI API key is not allowed to use that model.') from None
        except o.NotFoundError:
            raise AIError(f'OpenAI does not offer the model {self.model} to this key.') from None
        except o.RateLimitError as error:
            if _no_credit(error):
                raise AIError('Your OpenAI API account has no credit left. A ChatGPT Plus or Pro subscription does not '
                              'include API use: add credit at platform.openai.com > Settings > Billing, then press Test '
                              'again.') from None
            detail = re.sub(r'\s+', ' ', str(getattr(error, 'message', '') or '')).strip()[:300]
            raise AIError('OpenAI is limiting how fast this key can send requests. Wait a minute and try again.'
                          + (f' (OpenAI says: {detail})' if detail else '')) from None
        except o.BadRequestError as error:
            raise AIError(f'OpenAI rejected the request: {error.message}') from None
        except o.APIStatusError as error:
            raise AIError(f'OpenAI had a server problem ({error.status_code}). Try again later.') from None
        except o.APIConnectionError:
            raise AIError('PEAK HOUR could not reach OpenAI. Check the internet connection.') from None
        if getattr(response, 'status', 'completed') != 'completed':
            raise AIError('OpenAI did not finish this batch.')
        return json.loads(response.output_text)


# ------------------------------------------------------------------ tasks

def _item_schema(properties):
    return {'type': 'object', 'additionalProperties': False,
            'properties': {'items': {'type': 'array', 'items': {
                'type': 'object', 'additionalProperties': False,
                'properties': {'id': {'type': 'string'}, **properties,
                               'confidence': {'type': 'string', 'enum': CONFIDENCE}, 'reason': {'type': 'string'}},
                'required': ['id', *properties, 'confidence', 'reason']}}},
            'required': ['items']}


BASE = ('You help a hip-hop and open-format DJ clean up a music library. You get a JSON list of tracks, each with an '
        'id, and answer with exactly one item per id. Use what you know about the recording; never invent. When you '
        'are not sure, say so with confidence "low" and keep the reason short (under 25 words). ')

TASKS = {
    'year': {
        'label': 'Release years',
        'system': BASE + ('For each track give the year the song was first released (the original recording, not '
                          'the remix, edit or compilation year), as "year". If this is a remix or re-release of an older '
                          'song, put that later version\'s year in "version_year", otherwise repeat the year. Use 0 when '
                          'you do not know.'),
        'schema': _item_schema({'year': {'type': 'integer'}, 'version_year': {'type': 'integer'}}),
    },
    'tidy': {
        'label': 'Titles & artists',
        'system': BASE + ('Tidy each title and artist for a DJ library: proper capitalisation, single spaces, '
                          '"feat." for featured artists in the artist field, the main artist first, no file junk '
                          '(underscores, "Official Video", "HD", "Lyric Video", website names, track numbers). KEEP '
                          'every version detail a DJ needs in the title, in brackets: remix and edit names, Clean, '
                          'Dirty, Intro, Outro, Extended, Short, Quick Hit, Acapella, Instrumental, Redrum, Transition, '
                          'BPM-change notes. Do not translate or "correct" deliberate spellings. Set "changed" to false '
                          'and return them unchanged when they are already fine.'),
        'schema': _item_schema({'title': {'type': 'string'}, 'artist': {'type': 'string'}, 'changed': {'type': 'boolean'}}),
    },
    'genre': {
        'label': 'Genres',
        'system': BASE + ('Give each track one genre a DJ would file it under. Use one of the library\'s genres listed '
                          'in "genres" whenever one fits, spelled exactly as listed; only propose a new genre when none '
                          'fits.'),
        'schema': _item_schema({'genre': {'type': 'string'}}),
    },
    'energy': {
        'label': 'Energy',
        'system': BASE + ('Rate how much energy each track brings to a dance floor: Low (warm-up, chill), Mid '
                          '(groove), High (peak), Ultra (biggest peak-hour records). Judge the song itself, its '
                          'intensity and crowd reaction, not only its BPM.'),
        'schema': _item_schema({'energy': {'type': 'string', 'enum': ENERGY}}),
    },
}

PLAYLIST_CANDIDATES = 600
PLAYLIST_STOPWORDS = {'the', 'and', 'into', 'with', 'for', 'from', 'set', 'mix', 'playlist', 'songs', 'tracks', 'some',
                      'that', 'this', 'about', 'like', 'more', 'less', 'only', 'then', 'start', 'end', 'hour', 'minutes'}
PLAYLIST_SYSTEM = (
    'You are an expert hip-hop and open-format DJ building a playlist for a gig. Choose ONLY from the "candidates" '
    "list (the DJ's own library), by id; never add songs that are not listed. Follow the brief. Aim for "
    '"tracks_wanted" tracks. Order them so the set flows: shape the energy the brief asks for (warm-up, build, peak, '
    'cool-down), keep neighbouring BPMs close (within about 6%, or a clean half/double-time switch), prefer '
    'neighbouring Camelot keys, and move between eras and styles smoothly. Do not use the same song twice, even in a '
    'different version, unless the brief asks for it. Give the playlist a short name, a one-line note on its shape '
    'in "notes", and for each track a "why" of under 15 words.')
PLAYLIST_SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['name', 'notes', 'tracks'], 'properties': {
    'name': {'type': 'string'}, 'notes': {'type': 'string'},
    'tracks': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'required': ['id', 'why'],
                                          'properties': {'id': {'type': 'string'}, 'why': {'type': 'string'}}}}}}


def _number(value):
    try:
        number = float(value)
        return number if number > 0 else None
    except (TypeError, ValueError):
        return None


_MESSY = re.compile(r'_|\s{2,}|\[|official|lyric|video|\bhd\b|www\.|\.com|^\d{1,3}[\s.\-]', re.I)


def _length(track):
    try:
        seconds = int(float(track.get('duration_sec') or 0))
    except (TypeError, ValueError):
        return ''
    return f'{seconds // 60}:{seconds % 60:02d}' if seconds else ''


def wants(task, scope, track, app):
    """Which tracks a run covers: 'needs' (what the task is for) or 'all'."""
    if scope == 'all':
        return True
    if task == 'year':
        missing = app._track_has_missing_year(track) if hasattr(app, '_track_has_missing_year') else not track.get('year')
        uncertain = track.get('year_health_state') == 'approximate' or track.get('year_estimated') or \
            track.get('year_source') in ('file_date_estimate', 'filename', 'estimate')
        return bool(missing or uncertain)
    if task == 'tidy':
        title, artist = str(track.get('title') or ''), str(track.get('artist') or '')
        return (not artist or artist == 'Unknown Artist' or bool(_MESSY.search(title)) or bool(_MESSY.search(artist))
                or (title.isupper() and len(title) > 4) or (title.islower() and len(title) > 4) or ' - ' in title)
    if task == 'genre':
        return not str(track.get('genre') or '').strip()
    if task == 'energy':
        return track.get('energy') in (None, '', 'Unknown')
    return False


def track_input(task, ident, track):
    row = {'id': ident, 'artist': track.get('artist') or '', 'title': track.get('title') or '',
           'file': track.get('filename') or os.path.basename(str(track.get('path') or ''))}
    if task in ('year', 'genre', 'energy'):
        row.update(genre=track.get('genre') or '', bpm=track.get('bpm') or '', length=_length(track))
    if task == 'year':
        row['current_year'] = track.get('year') or ''
    return row


def catalogue_years(track):
    years = set()
    for key in ('year_research_candidate_year', 'year_research_original_year', 'suggested_year'):
        try:
            if int(track.get(key) or 0) > 1900:
                years.add(int(track[key]))
        except (TypeError, ValueError):
            pass
    return years


# ------------------------------------------------------------------ runs

class AIAssist:
    def __init__(self, app, folder, providers=None):
        self.app, self.folder = app, Path(folder)
        self.keys = KeyStore(self.folder)
        self.providers = providers or {'claude': ClaudeProvider, 'openai': OpenAIProvider}
        self.lock = threading.Lock()
        self.job = None
        self.playlist = None
        self.stop_requested = False

    # settings
    def _settings_path(self):
        return self.folder / 'settings.json'

    def settings(self):
        try:
            data = json.loads(self._settings_path().read_text(encoding='utf-8'))
        except (OSError, ValueError):
            data = {}
        provider = data.get('provider') if data.get('provider') in PROVIDERS else 'claude'
        models = {p: (data.get('models') or {}).get(p) for p in PROVIDERS}
        models = {p: m if m in PROVIDERS[p]['models'] else PROVIDERS[p]['models'][0] for p, m in models.items()}
        return {'provider': provider, 'models': models}

    def save_settings(self, provider=None, model=None):
        current = self.settings()
        if provider:
            if provider not in PROVIDERS:
                raise AIError('Choose Claude or ChatGPT.')
            current['provider'] = provider
        if model:
            owner = next((p for p, info in PROVIDERS.items() if model in info['models']), None)
            if not owner:
                raise AIError('Choose one of the listed models.')
            current['models'][owner] = model
        self.folder.mkdir(parents=True, exist_ok=True)
        self._settings_path().write_text(json.dumps(current), encoding='utf-8')
        return current

    def client(self, provider=None):
        settings = self.settings()
        provider = provider or settings['provider']
        key = self.keys.get(provider)
        if not key:
            raise AIError(f'Add your {PROVIDERS[provider]["name"]} API key in Settings > AI Assist first.')
        return self.providers[provider](key, settings['models'][provider])

    def test(self, provider):
        answer = self.client(provider).ask(TASKS['year']['system'],
                                           json.dumps({'tracks': [{'id': 't1', 'artist': 'Mobb Deep', 'title': 'Shook Ones, Pt. II', 'file': ''}]}),
                                           TASKS['year']['schema'])
        item = (answer.get('items') or [{}])[0]
        return {'year': item.get('year'), 'model': self.settings()['models'][provider]}

    def status(self):
        settings = self.settings()
        with self.lock:
            job = dict(self.job or {})
        job.pop('items', None)
        return {'providers': {p: {'name': info['name'], 'key_set': self.keys.has(p), 'model': settings['models'][p],
                                  'models': [{'id': m, 'label': info['labels'][m]} for m in info['models']]}
                              for p, info in PROVIDERS.items()},
                'provider': settings['provider'], 'tasks': {t: v['label'] for t, v in TASKS.items()},
                'task_order': list(TASKS), 'job': job or None}  # JSON objects come back sorted

    # runs
    def _tracks(self):
        cache = self.app.load_cache(self.app.CACHE_PATH)
        return [t for t in (self.app._all_library_cache_tracks(cache) if hasattr(self.app, '_all_library_cache_tracks')
                            else cache.get('tracks') or []) if isinstance(t, dict) and t.get('path')]

    def preview(self, task, scope):
        if task not in TASKS:
            raise AIError('Choose what AI Assist should check.')
        tracks = self._tracks()
        return {'matching': sum(1 for t in tracks if wants(task, scope, t, self.app)), 'library': len(tracks)}

    def start(self, task, scope, limit, provider=None):
        if task not in TASKS:
            raise AIError('Choose what AI Assist should check.')
        limit = max(1, min(MAX_TRACKS, int(limit or 200)))
        client = self.client(provider)  # fails early without a key
        settings = self.settings()
        provider = provider or settings['provider']
        chosen = [t for t in self._tracks() if wants(task, scope, t, self.app)][:limit]
        if not chosen:
            raise AIError('No tracks need this right now.')
        with self.lock:
            if self.job and self.job.get('state') == 'running':
                raise AIError('AI Assist is already working. Wait for it or stop it first.')
            self.stop_requested = False
            self.job = {'id': uuid.uuid4().hex[:12], 'task': task, 'scope': scope, 'provider': provider,
                        'model': settings['models'][provider], 'state': 'running', 'done': 0, 'total': len(chosen),
                        'started': time.time(), 'error': None, 'items': []}
            job = self.job
        threading.Thread(target=self._run, args=(job, client, chosen), name='peak-hour-ai-assist', daemon=True).start()
        return self.status()

    def stop(self):
        self.stop_requested = True
        return self.status()

    def _genres(self):
        counts = {}
        for track in self._tracks():
            genre = str(track.get('genre') or '').strip()
            if genre:
                counts[genre] = counts.get(genre, 0) + 1
        return [g for g, _ in sorted(counts.items(), key=lambda item: -item[1])[:80]]

    def _run(self, job, client, chosen):
        task = TASKS[job['task']]
        genres = self._genres() if job['task'] == 'genre' else None
        try:
            for start in range(0, len(chosen), BATCH):
                if self.stop_requested:
                    job['state'] = 'stopped'
                    break
                batch = chosen[start:start + BATCH]
                ids = {f't{start + i}': t for i, t in enumerate(batch)}
                payload = {'tracks': [track_input(job['task'], i, t) for i, t in ids.items()]}
                if genres is not None:
                    payload['genres'] = genres
                answer = client.ask(task['system'], json.dumps(payload, ensure_ascii=False), task['schema'])
                for item in answer.get('items') or []:
                    track = ids.get(str(item.get('id')))
                    if track is not None:
                        suggestion = self._suggestion(job['task'], item, track)
                        if suggestion:
                            job['items'].append(suggestion)
                job['done'] = min(len(chosen), start + len(batch))
                self._save(job)
            else:
                job['state'] = 'done'
        except AIError as error:
            job['state'], job['error'] = 'failed', str(error)
        except Exception as error:  # the run stops and says so; nothing has been applied
            job['state'], job['error'] = 'failed', f'AI Assist stopped: {error}'
        job['finished'] = time.time()
        self._save(job)

    def _suggestion(self, task, item, track):
        base = {'id': uuid.uuid4().hex[:10], 'path': track['path'], 'artist': track.get('artist') or '',
                'title': track.get('title') or '', 'confidence': item.get('confidence') if item.get('confidence') in CONFIDENCE else 'low',
                'reason': str(item.get('reason') or '')[:240], 'status': 'pending'}
        if task == 'year':
            year = int(item.get('year') or 0)
            if not 1900 <= year <= time.gmtime().tm_year or str(year) == str(track.get('year') or ''):
                return None
            known = catalogue_years(track)
            base.update(current=track.get('year') or '', suggested=year, version_year=int(item.get('version_year') or 0) or None,
                        agrees_with_catalogue=year in known if known else None)
        elif task == 'tidy':
            title, artist = str(item.get('title') or '').strip(), str(item.get('artist') or '').strip()
            if not item.get('changed') or not title or not artist or (title, artist) == (base['title'], base['artist']):
                return None
            base.update(current=f"{base['artist']} - {base['title']}", suggested=f'{artist} - {title}',
                        new_title=title[:220], new_artist=artist[:180])
        elif task == 'genre':
            genre = re.sub(r'\s+', ' ', str(item.get('genre') or '')).strip()[:60]
            if not genre or genre.casefold() == str(track.get('genre') or '').strip().casefold():
                return None
            base.update(current=track.get('genre') or '', suggested=genre)
        elif task == 'energy':
            energy = item.get('energy')
            if energy not in ENERGY or energy == track.get('energy'):
                return None
            base.update(current=track.get('energy') or '', suggested=energy)
        return base

    def _save(self, job):
        folder = self.folder / 'runs'
        folder.mkdir(parents=True, exist_ok=True)
        partial = folder / f"{job['id']}.part"
        partial.write_text(json.dumps(job, ensure_ascii=False), encoding='utf-8')
        os.replace(partial, folder / f"{job['id']}.json")

    # playlists from the DJ's own library
    def _candidates(self, brief, bpm_min, bpm_max, year_from, year_to):
        words = {w for w in re.findall(r"[a-z0-9']{3,}", brief.lower())} - PLAYLIST_STOPWORDS
        rows = []
        for track in self._tracks():
            if hasattr(self.app, 'is_health_recording') and self.app.is_health_recording(track):
                continue  # DJ mixes and long recordings are not playlist tracks
            bpm = _number(track.get('bpm'))
            year = _number(track.get('year'))
            if (bpm_min and (not bpm or bpm < bpm_min)) or (bpm_max and (not bpm or bpm > bpm_max)):
                continue
            if (year_from and (not year or year < year_from)) or (year_to and (not year or year > year_to)):
                continue
            text = ' '.join(str(track.get(k) or '') for k in ('genre', 'artist', 'title', 'era', 'root')).lower()
            rows.append((sum(1 for w in words if w in text), track))
        if len(rows) > PLAYLIST_CANDIDATES:  # keep the best text matches, then a fair spread of the rest
            rows.sort(key=lambda row: -row[0])
            matched = [r for r in rows if r[0] > 0][:PLAYLIST_CANDIDATES]
            rest = [r for r in rows if r[0] == 0]
            step = max(1, len(rest) // max(1, PLAYLIST_CANDIDATES - len(matched)))
            rows = matched + rest[::step][:PLAYLIST_CANDIDATES - len(matched)]
        return [track for _, track in rows]

    def build_playlist(self, brief, count, bpm_min=None, bpm_max=None, year_from=None, year_to=None, provider=None):
        brief = re.sub(r'\s+', ' ', str(brief or '')).strip()[:600]
        if len(brief) < 3:
            raise AIError('Describe the playlist first, for example "90s East Coast warm-up into a peak".')
        count = max(5, min(100, int(count or 25)))
        filters = [_number(v) for v in (bpm_min, bpm_max, year_from, year_to)]
        client = self.client(provider)
        settings = self.settings()
        provider = provider or settings['provider']
        candidates = self._candidates(brief, *filters)
        if len(candidates) < 5:
            raise AIError('Fewer than 5 tracks in your library match those filters. Widen the BPM or year range.')
        with self.lock:
            if self.playlist and self.playlist.get('state') == 'running':
                raise AIError('AI Assist is already building a playlist.')
            self.playlist = job = {'id': uuid.uuid4().hex[:12], 'state': 'running', 'brief': brief, 'count': count,
                                   'provider': provider, 'model': settings['models'][provider],
                                   'candidates': len(candidates), 'started': time.time(), 'error': None}
        threading.Thread(target=self._build, args=(job, client, candidates), name='peak-hour-ai-playlist', daemon=True).start()
        return self.playlist_status()

    def _build(self, job, client, candidates):
        ids = {f'c{i}': t for i, t in enumerate(candidates)}
        rows = [{'id': i, 'artist': t.get('artist') or '', 'title': t.get('title') or '', 'bpm': t.get('bpm') or '',
                 'key': t.get('camelot') or '', 'year': t.get('year') or '', 'genre': t.get('genre') or '',
                 'energy': t.get('energy') or '', 'length': _length(t)} for i, t in ids.items()]
        try:
            answer = client.ask(PLAYLIST_SYSTEM, json.dumps({'brief': job['brief'], 'tracks_wanted': job['count'],
                                                             'candidates': rows}, ensure_ascii=False), PLAYLIST_SCHEMA)
            picked, sources, seen = [], [], set()
            for item in answer.get('tracks') or []:
                track = ids.get(str(item.get('id')))
                if track is None or track['path'] in seen:
                    continue  # only tracks from the library, each once
                seen.add(track['path'])
                row = dict(self.app.light_track(track)) if hasattr(self.app, 'light_track') else dict(track)
                row['ai_reason'] = str(item.get('why') or '')[:200]
                picked.append(row)
                sources.append(track)
            if not picked:
                raise AIError('The AI did not choose any tracks from your library. Try a different description.')
            job.update(state='done', name=str(answer.get('name') or 'AI Playlist').strip()[:80] or 'AI Playlist',
                       notes=str(answer.get('notes') or '')[:600], tracks=picked[:job['count']],
                       minutes=round(sum(_number(t.get('duration_sec')) or 0 for t in sources[:job['count']]) / 60))
        except AIError as error:
            job.update(state='failed', error=str(error))
        except Exception as error:
            job.update(state='failed', error=f'AI Assist stopped: {error}')
        job['finished'] = time.time()

    def playlist_status(self):
        with self.lock:
            return {'playlist': dict(self.playlist) if self.playlist else None}

    def suggestions(self):
        with self.lock:
            job = self.job
        if not job:
            runs = sorted((self.folder / 'runs').glob('*.json'), key=lambda p: p.stat().st_mtime) if (self.folder / 'runs').is_dir() else []
            if runs:
                try:
                    job = self.job = json.loads(runs[-1].read_text(encoding='utf-8'))
                except (OSError, ValueError):
                    job = None
        if not job:
            return {'job': None, 'items': []}
        info = {k: v for k, v in job.items() if k != 'items'}
        return {'job': info, 'items': list(job.get('items') or [])}

    # applying approved suggestions
    def _post(self, route, body):
        host = self.app.app.config.get('PEAK_HOUR_HOST') or '127.0.0.1:%s' % os.environ.get('AXIOM_PORT', '8080')
        client = self.app.app.test_client()
        response = client.post(route, json=body, base_url=f'http://{host}', headers={'Origin': f'http://{host}'}, environ_base={'REMOTE_ADDR': '127.0.0.1'})
        data = response.get_json(silent=True) or {}
        if response.status_code >= 400 or data.get('success') is False:
            raise AIError(data.get('error') or f'PEAK HOUR could not save this ({response.status_code}).')
        return data

    def _save_energy(self, path, energy):
        app = self.app
        with app.file_lock(app.CACHE_PATH + '.edit'):
            cache = app.load_cache(app.CACHE_PATH)
            matches, _ = app._resolve_library_cache_tracks_for_health(cache, path=path)
            if not matches:
                raise AIError('This track is no longer in the PEAK HOUR library.')
            import copy
            baseline = {app.canonical_path(row['path']): copy.deepcopy(row) for row in matches}
            for row in matches:
                row['energy'] = energy
                row['energy_source'] = 'ai_approved'
                row['energy_updated_at'] = app._utc_now_iso()
            app._commit_unified_health_cache_locked(cache, [row['path'] for row in matches], baseline)

    def apply(self, ids, skip=False):
        """Skip at once; apply in the background (the page shows "Saving 12 of 144") so a long list never looks
        stuck, and only one apply runs at a time."""
        with self.lock:
            job = self.job
            if not job:
                raise AIError('There are no AI suggestions to apply.')
            if (job.get('applying') or {}).get('state') == 'running':
                raise AIError('PEAK HOUR is still saving the last ones you ticked.')
            chosen = [item for item in job.get('items') or [] if item['id'] in set(ids or []) and item['status'] == 'pending']
            if not chosen:
                raise AIError('Tick the suggestions first.')
            if skip:
                for item in chosen:
                    item['status'] = 'skipped'
            else:
                job['applying'] = {'state': 'running', 'done': 0, 'total': len(chosen), 'applied': 0, 'failed': 0}
        if skip:
            self._save(job)
            return {'skipped': len(chosen), 'job': self.suggestions()['job']}
        threading.Thread(target=self._apply, args=(job, chosen), name='peak-hour-ai-apply', daemon=True).start()
        return {'job': self.suggestions()['job']}

    def _apply(self, job, chosen):
        from windows_intake import FAST_REALPATH
        progress = job['applying']
        # AXIOM's saves resolve every library track's real path to find the one to change; on a big exFAT folder
        # that is minutes per save. One folder listing answers them all with the same result (windows_intake).
        with FAST_REALPATH.active():
            for number, item in enumerate(chosen, 1):
                try:
                    if job['task'] == 'year':
                        self._post('/api/library/update_year', {'path': item['path'], 'year': item['suggested']})
                    elif job['task'] == 'tidy':
                        self._post('/api/library/update_track_metadata', {'path': item['path'], 'title': item['new_title'], 'artist': item['new_artist']})
                    elif job['task'] == 'genre':
                        self._post('/api/library/update_genre', {'path': item['path'], 'genre': item['suggested']})
                    elif job['task'] == 'energy':
                        self._save_energy(item['path'], item['suggested'])
                    item['status'] = 'applied'
                    progress['applied'] += 1
                except Exception as error:  # one track that cannot be saved does not stop the rest
                    item['status'], item['error'] = 'failed', str(error)[:300]
                    progress['failed'] += 1
                progress['done'] = number
                if number % 10 == 0:
                    self._save(job)
        progress['state'] = 'done'
        self._save(job)

def create_ai_blueprint(assist):
    bp = Blueprint('windows_ai', __name__)

    def local():
        return request.remote_addr in ('127.0.0.1', '::1')

    def respond(action):
        if request.method == 'POST' and not local():
            return jsonify(success=False, error='AI Assist can only be changed on this PC.'), 403
        try:
            return jsonify(success=True, **action())
        except AIError as error:
            return jsonify(success=False, error=str(error)), 400

    @bp.get('/api/windows/ai/status')
    def status():
        return respond(assist.status)

    @bp.post('/api/windows/ai/key')
    def key():
        data = request.get_json(silent=True) or {}
        provider, value = data.get('provider'), str(data.get('key') or '').strip()
        if provider not in PROVIDERS:
            return jsonify(success=False, error='Choose Claude or ChatGPT.'), 400
        if value and (len(value) < 20 or len(value) > 400 or any(c.isspace() for c in value)):
            return jsonify(success=False, error='That does not look like an API key. Copy the whole key and paste it again.'), 400
        return respond(lambda: (assist.keys.set(provider, value), assist.status())[1])

    @bp.post('/api/windows/ai/settings')
    def settings():
        data = request.get_json(silent=True) or {}
        return respond(lambda: (assist.save_settings(data.get('provider'), data.get('model')), assist.status())[1])

    @bp.post('/api/windows/ai/test')
    def test():
        data = request.get_json(silent=True) or {}
        return respond(lambda: assist.test(data.get('provider') or assist.settings()['provider']))

    @bp.get('/api/windows/ai/preview')
    def preview():
        return respond(lambda: assist.preview(request.args.get('task'), request.args.get('scope', 'needs')))

    @bp.post('/api/windows/ai/run')
    def run():
        data = request.get_json(silent=True) or {}
        return respond(lambda: assist.start(data.get('task'), data.get('scope', 'needs'), data.get('limit'), data.get('provider')))

    @bp.post('/api/windows/ai/stop')
    def stop():
        return respond(assist.stop)

    @bp.get('/api/windows/ai/suggestions')
    def suggestions():
        return respond(assist.suggestions)

    @bp.post('/api/windows/ai/playlist')
    def playlist():
        data = request.get_json(silent=True) or {}
        return respond(lambda: assist.build_playlist(data.get('brief'), data.get('count'), data.get('bpm_min'), data.get('bpm_max'),
                                                     data.get('year_from'), data.get('year_to'), data.get('provider')))

    @bp.get('/api/windows/ai/playlist')
    def playlist_status():
        return respond(assist.playlist_status)

    @bp.post('/api/windows/ai/apply')
    def apply():
        data = request.get_json(silent=True) or {}
        return respond(lambda: assist.apply(data.get('ids'), skip=bool(data.get('skip'))))
    return bp
