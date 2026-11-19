"""Studio and Playlists "Export to Serato" for Serato DJ Pro 5 on Windows.

AXIOM's export (app._write_serato_crate) registers the playlist with
utils.serato_playlist_export, which writes the single macOS root.sqlite after
checking its triggers against a catalogue reviewed from Serato for macOS. On
Windows that check stops every export, because Serato for Windows keeps one
database per drive. The export is sent to windows_serato_library.write_crate_folder
instead, for a plain crate and for crate folders (["Parent", "Child"]) alike: it
picks the database of the drive holding the tracks, refuses mixed drives and the
system drive, checks Serato is closed, backs the database up, keeps Serato's own
track details, verifies the crate and puts the backup back on any failure.

Like Serato DJ Pro 5 itself it writes both the database rows and the legacy files
(Subcrates\\Parent%%Child.crate, neworder.pref). Parents are found by name or created,
never renamed or removed. A crate folder's last crate only has its tracks replaced if
PEAK HOUR made it or the caller confirms (overwrite=True); a plain crate name is
replaced as it always was. Every write keeps a receipt that undo_crate_write can use.
"""
from windows_serato_library import SeratoLibraryError, digest_crate_folders, write_crate_folders

_APP = None


def make_playlist_exporter(app):
    def export_serato_playlist(database_path, playlist, name, backup_dir=None, *, transfer_key=None,
                               path_parts=None, ensure_quit=None, overwrite=False, **_ignored):
        tracks = [track for track in playlist if isinstance(track, dict)]
        parts = list(path_parts) if path_parts else [name]
        # a flat crate and a crate folder are written the same way: database rows plus Serato's legacy files.
        # Exporting again to a plain crate name has always replaced that crate's tracks; folders ask first.
        result = write_crate_folders(app, tracks, parts, overwrite=bool(overwrite) or len(parts) == 1)
        crate = result['crate_name']
        return {
            'success': True,
            'message': ('Crate folder already up to date in Serato.' if result['unchanged']
                        else 'Playlist registered in Serato crate folders; library order verified.'),
            'serato_library_registered': True,
            'serato_modern_database_touched': not result['unchanged'],
            'serato_database_untouched': False,
            'source_audio_untouched': True,
            'destination_app_verified': True,
            'delivery_verified': True,
            'database_readback_verified': True,
            'serato_playlist_name': result['path_parts'][-1],
            'serato_path_parts': result['path_parts'],
            'serato_lookup': crate,
            'database_path': result['database_path'],
            'backup_path': result['backup_path'],
            'legacy_crate_path': result['legacy_crate'],
            'backup_id': result['backup_id'],
            'created_crates': result['created_crates'],
            'drives': result['drives'],
            'skipped': result['skipped'],
            'skipped_counts': result['skipped_counts'],
            'summary': result['summary'],
            'warnings': result['warnings'],
            'total_tracks': len(playlist),
            'exported_tracks': result['exported_tracks'],
            'verified_crate_tracks': result['verified_tracks'],
            'missing_tracks': result['missing_tracks'],
            'duplicate_tracks': result['duplicate_tracks'],
            'serato_running': False,
            'serato_restart_hint': 'Open Serato and look for ' + ' > '.join(result['path_parts']) +
                                   '. Library registration and track order were verified.',
        }
    return export_serato_playlist


def _request(payload):
    """(tracks, crate path parts, overwrite) from a queue payload: {"path_parts": [...] or "name", "tracks": [...]}."""
    if not isinstance(payload, dict):
        raise SeratoLibraryError('The crate request is not valid.')
    parts = payload.get('path_parts') or payload.get('name')
    tracks = payload.get('tracks')
    if not parts or not isinstance(tracks, list):
        raise SeratoLibraryError('The crate request needs a crate path and a list of tracks.')
    tracks = [t if isinstance(t, dict) else {'path': str(t)} for t in tracks]
    return tracks, [parts] if isinstance(parts, str) else list(parts), payload.get('overwrite') is True


def apply_crate_folder(payload, app=None):
    """Queue writer: write the crate (or crate folder) now. Raises SeratoOpenError while Serato is open."""
    app = app or _APP
    tracks, parts, overwrite = _request(payload)
    return make_playlist_exporter(app)(None, tracks, parts[-1], path_parts=parts, overwrite=overwrite)


def preview_crate_folder(payload, app=None):
    """Queue stale check: a hash that changes when the library, the crate or the tracks change. Writes nothing."""
    tracks, parts, overwrite = _request(payload)
    return digest_crate_folders(app or _APP, tracks, parts, overwrite=overwrite)


def register_with_queue(queue, app=None):
    """Register Serato's 'crate_folder' writer with the DJ write queue (windows_dj_write_queue)."""
    queue.register('serato', 'crate_folder', lambda payload: apply_crate_folder(payload, app),
                   lambda payload: preview_crate_folder(payload, app))


def create_blueprint(app, license_guard=None):
    """Routes for the Send dialog: /api/windows/serato/folders/{preview,apply}. Body: {path_parts|path, tracks:[absolute
    paths], overwrite?}; apply also needs confirm:true. While Serato is open the write is queued (202)."""
    from flask import Blueprint, jsonify, request
    from windows_dj_write_queue import queue_if_open
    from windows_serato_library import SeratoOpenError, _ensure_serato_closed, preview_crate_folders as library_preview
    bp = Blueprint('windows_serato_folders', __name__)

    @bp.before_request
    def local_only():
        if request.remote_addr not in ('127.0.0.1', '::1'):
            return jsonify(success=False, error='Writing to Serato requires this PC'), 403
        origin = request.headers.get('Origin')
        if request.method != 'GET' and (not origin or origin.rstrip('/') != request.host_url.rstrip('/')):
            return jsonify(success=False, error='Writing to Serato requires a same-origin request'), 403

    def payload_of(data):
        parts = data.get('path_parts') or data.get('path')
        tracks = data.get('tracks')
        if not parts or not isinstance(tracks, list) or not tracks or len(tracks) > 5000:
            raise SeratoLibraryError('Choose a crate path and send a list of tracks.')
        for value in tracks:
            if not isinstance(value, str) or not value.strip():
                raise SeratoLibraryError('Track paths must be text.')
        return {'path_parts': [parts] if isinstance(parts, str) else list(parts), 'tracks': list(tracks),
                'overwrite': data.get('overwrite') is True or data.get('replace') is True}

    def respond(action, what):
        gate = license_guard(what) if license_guard else None
        if gate:
            return gate
        try:
            result = action()
            if isinstance(result, tuple):
                return jsonify(result[0]), result[1]
            return jsonify(result)
        except SeratoOpenError as exc:
            return jsonify(success=False, error=str(exc), code='serato_open'), 409
        except (SeratoLibraryError, OSError, ValueError) as exc:
            return jsonify(success=False, error=str(exc), code=getattr(exc, 'code', 'error')), 400

    @bp.post('/api/windows/serato/folders/preview')
    def preview_route():
        def action():
            payload = payload_of(request.get_json(silent=True) or {})
            plan = library_preview(app, payload['tracks'], payload['path_parts'], overwrite=payload['overwrite'])
            try:
                _ensure_serato_closed()
                running = False
            except SeratoLibraryError:
                running = True
            plan.pop('tracklist', None)
            return dict(plan, success=True, list_exists=plan['leaf_exists'], serato_open=running)
        return respond(action, 'Send playlists to Serato')

    @bp.post('/api/windows/serato/folders/apply')
    def apply_route():
        data = request.get_json(silent=True) or {}
        if data.get('confirm') is not True:
            return jsonify(success=False, error='Confirm before writing to Serato', code='bad_request'), 400

        def action():
            payload = payload_of(data)
            plan = library_preview(app, payload['tracks'], payload['path_parts'], overwrite=payload['overwrite'])
            if plan['needs_confirm']:
                return {'success': False, 'error': 'A Serato crate with this name already exists. Nothing was overwritten.',
                        'code': 'crate_exists'}, 409
            # closed: written under the program's lock (serialised with the queue watcher); open: queued (202).
            # Both bodies carry backup_id for the Undo button (POST /api/windows/serato/folders/undo).
            return queue_if_open('serato', 'crate_folder', payload, 'Serato',
                                 lambda: dict(apply_crate_folder(payload, app), success=True))
        return respond(action, 'Send playlists to Serato')
    return bp


def install(app):
    global _APP
    import utils.serato_playlist_export as module
    _APP = app
    if getattr(module, '_windows_serato_export_installed', False):
        return
    module.export_serato_playlist = make_playlist_exporter(app)  # app imports it from the module on each export
    module._windows_serato_export_installed = True
