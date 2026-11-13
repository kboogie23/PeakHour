"""Studio DAW mix saving on Windows: the Mac app's native save bridge, over HTTP.

In the Mac app, Studio DAW hands a rendered mix to the WKWebView host
(window.webkit.messageHandlers.axiomNative): mixExportSupport, mixExportChoose
(a Save panel), mixExportStart/Begin, mixExportChunk (base64 slices),
mixExportFinish (a verified receipt) and mixExportCancel. Without that host the
page can only offer a browser download of WAV; MP3 and "Add to Library" stay
disabled. windows-mix-export.js forwards the same messages here:

- the destination is chosen by the user in a Windows Save As dialog, never
  taken from the request;
- the WAV is received into a partial file beside the destination and only
  renamed into place once its length and RIFF layout verify;
- MP3 is encoded from that WAV with FFmpeg's LAME encoder at 320 kbps, and the
  Title/Artist/BPM/Key that Studio wrote into the WAV's ID3 chunk are copied to
  the MP3's ID3 tag;
- the receipt carries the saved path, byte count, audio frame count and
  SHA-256, which Studio verifies before offering Add to Library.
"""
import base64
import hashlib
import os
import re
import struct
import subprocess
import threading
import uuid
from pathlib import Path
from flask import Blueprint, jsonify, request

CREATE_NO_WINDOW = 0x08000000
CHUNK_LIMIT = 256 * 1024
SIZE_LIMIT = 58 + 28800000 * 8 + 64 * 1024  # Studio's longest render plus its metadata chunks
MP3_BITRATE = '320k'
SUPPORT = {'success': True, 'formats': ['wav', 'mp3'], 'chooseBeforeRender': True,
           'wavMetadata': True, 'musicalMetadata': True}
ID3_FRAMES = ('TIT2', 'TPE1', 'TBPM', 'TKEY')


def default_directory():
    for folder in (Path.home() / 'Music', Path.home() / 'Desktop', Path.home()):
        if folder.is_dir():
            return str(folder)
    return None


def choose_destination(filename, format):
    from tkinter import filedialog
    from windows_dialogs import _dialog
    label = 'MP3 audio' if format == 'mp3' else 'WAV audio'
    return _dialog(filedialog.asksaveasfilename, title='Save Audio', initialfile=filename,
                   initialdir=default_directory(), defaultextension='.' + format,
                   filetypes=[(label, '*.' + format)], confirmoverwrite=True)


def wav_frames(path):
    """Frames of Studio's 32-bit float stereo WAV, from its fmt and data chunks."""
    with open(path, 'rb') as handle:
        header = handle.read(12)
        if len(header) != 12 or header[:4] != b'RIFF' or header[8:] != b'WAVE':
            raise ValueError('The rendered mix is not a WAV file.')
        layout = None
        while True:
            chunk = handle.read(8)
            if len(chunk) < 8:
                raise ValueError('The rendered mix has no audio data.')
            name, size = chunk[:4], struct.unpack('<I', chunk[4:])[0]
            if name == b'fmt ':
                body = handle.read(size)
                layout = struct.unpack('<HHIIHH', body[:16])
                handle.seek(size & 1, 1)
            elif name == b'data':
                if not layout or layout[0] != 3 or layout[1] != 2 or layout[2] != 48000 or layout[5] != 32:
                    raise ValueError('The rendered mix must be 48 kHz stereo float audio.')
                if size % 8 or handle.tell() + size > os.path.getsize(path):
                    raise ValueError('The rendered mix audio is incomplete.')
                return size // 8
            else:
                handle.seek(size + (size & 1), 1)


def sha256(path):
    with open(path, 'rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def copy_tags(wav, mp3):
    """Studio's ID3 frames (Title, Artist, BPM, Key) from the WAV's id3 chunk to the MP3."""
    from mutagen.id3 import ID3
    from mutagen.wave import WAVE
    source = WAVE(wav).tags
    if not source:
        return
    tags = ID3()
    for frame in ID3_FRAMES:
        if frame in source:
            tags.add(source[frame])
    if len(tags):
        tags.save(mp3, v2_version=3)


class MixExports:
    def __init__(self, ffmpeg, chooser=choose_destination):
        self.ffmpeg = ffmpeg
        self.chooser = chooser
        self.jobs = {}
        self.lock = threading.Lock()

    def _job(self, data):
        export_id = str(data.get('exportId') or '')
        try:
            uuid.UUID(export_id)
        except ValueError:
            raise ValueError('Invalid export.')
        return export_id, self.jobs.get(export_id)

    def support(self, data):
        return dict(SUPPORT, formats=['wav', 'mp3'] if self.ffmpeg else ['wav'])

    def choose(self, data):
        export_id, job = self._job(data)
        if job:
            raise ValueError('This export already has a destination.')
        format = data.get('format')
        if format not in ('wav', 'mp3') or (format == 'mp3' and not self.ffmpeg):
            raise ValueError('Choose WAV or MP3.')
        filename = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', str(data.get('filename') or ''))[:200] or 'Untitled.' + format
        path, cancelled = self.chooser(filename, format)
        if cancelled or not path:
            return {'success': False, 'cancelled': True}
        path = Path(path)
        if path.suffix.lower() != '.' + format:
            path = path.with_name(path.name + '.' + format)
        if not path.parent.is_dir():
            raise ValueError('The chosen folder is unavailable.')
        with self.lock:
            self.jobs[export_id] = {'path': path, 'format': format, 'partial': None, 'size': 0, 'received': 0}
        return {'success': True, 'path': str(path)}

    def start(self, data):
        export_id, job = self._job(data)
        if not job or job['partial']:
            raise ValueError('Choose a destination before saving.')
        size = data.get('size')
        if type(size) is not int or not 58 < size <= SIZE_LIMIT:
            raise ValueError('Invalid rendered mix size.')
        partial = job['path'].with_name(job['path'].name + f'.{export_id[:8]}.axiom-partial.wav')
        with open(partial, 'xb'):
            pass
        job.update(partial=partial, size=size, received=0)
        return {'success': True}

    def begin(self, data):
        chosen = self.choose(data)
        if not chosen.get('success'):
            return chosen
        return self.start(data)

    def chunk(self, data):
        export_id, job = self._job(data)
        if not job or not job['partial']:
            raise ValueError('This save has not started.')
        offset = data.get('offset')
        if offset != job['received']:
            raise ValueError('Audio arrived out of order.')
        payload = base64.b64decode(str(data.get('data') or ''), validate=True)
        if not payload or len(payload) > CHUNK_LIMIT or offset + len(payload) > job['size']:
            raise ValueError('Invalid audio slice.')
        with open(job['partial'], 'r+b') as handle:
            handle.seek(offset)
            handle.write(payload)
        job['received'] = offset + len(payload)
        return {'success': True, 'received': job['received']}

    def finish(self, data):
        export_id, job = self._job(data)
        if not job or not job['partial'] or job['received'] != job['size']:
            raise ValueError('The rendered mix did not arrive completely.')
        partial, path = job['partial'], job['path']
        encoded = partial.with_name(partial.name[:-len('.wav')] + '.mp3')
        try:
            frames = wav_frames(partial)
            if job['format'] == 'wav':
                os.replace(partial, path)
                receipt = {'format': 'wav', 'bytes': os.path.getsize(path)}
            else:
                result = subprocess.run([self.ffmpeg, '-nostdin', '-v', 'error', '-y', '-i', str(partial), '-map', '0:a:0',
                                         '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', MP3_BITRATE,
                                         '-id3v2_version', '3', str(encoded)],
                                        capture_output=True, text=True, creationflags=CREATE_NO_WINDOW, timeout=900)
                if result.returncode or not encoded.is_file() or not encoded.stat().st_size:
                    raise RuntimeError('MP3 encoding failed: ' + (result.stderr.strip()[-300:] or 'no output'))
                copy_tags(partial, encoded)
                os.replace(encoded, path)
                receipt = {'format': 'mp3', 'inputBytes': job['size'], 'bytes': os.path.getsize(path)}
        finally:
            with self.lock:
                self.jobs.pop(export_id, None)
            partial.unlink(missing_ok=True)
            encoded.unlink(missing_ok=True)
        return dict(receipt, success=True, state='saved', path=str(path), frames=frames, sha256=sha256(path))

    def cancel(self, data):
        export_id, job = self._job(data)
        with self.lock:
            self.jobs.pop(export_id, None)
        if job and job['partial']:
            job['partial'].unlink(missing_ok=True)
        return {'success': True}


ACTIONS = {'mixExportSupport': 'support', 'mixExportChoose': 'choose', 'mixExportStart': 'start',
           'mixExportBegin': 'begin', 'mixExportChunk': 'chunk', 'mixExportFinish': 'finish',
           'mixExportCancel': 'cancel'}


def create_mix_export_blueprint(exports):
    blueprint = Blueprint('windows_mix_export', __name__)

    @blueprint.post('/api/windows/mix-export/<action>')
    def operate(action):
        host = request.host.split(':')[0]
        origin = request.headers.get('Origin')
        if host not in ('127.0.0.1', 'localhost') or (origin and origin.rstrip('/') != request.host_url.rstrip('/')):
            return jsonify(success=False, error='Saving requires the local PEAK HOUR engine.'), 403
        method = ACTIONS.get(action)
        data = request.get_json(silent=True)
        if not method or not isinstance(data, dict):
            return jsonify(success=False, error='Unknown save request.'), 400
        try:
            return jsonify(getattr(exports, method)(data))
        except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as error:
            return jsonify(success=False, error=str(error))
    return blueprint
