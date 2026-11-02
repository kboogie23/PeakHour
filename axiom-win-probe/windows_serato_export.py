"""Studio and Playlists "Export to Serato" for Serato DJ Pro 5 on Windows.

AXIOM's export (app._write_serato_crate) registers the playlist with
utils.serato_playlist_export, which writes the single macOS root.sqlite after
checking its triggers against a catalogue reviewed from Serato for macOS. On
Windows that check stops every export ("needs an AXIOM compatibility
update"): Serato for Windows keeps one database per drive, and root.sqlite's
triggers are written against "db2." tables. Rather than widening the reviewed
catalogue, the export is sent to app._write_serato_modern_visible_crate, the
writer already used for Serato on Windows (windows_serato_library): it picks
the database of the drive holding the tracks, refuses mixed drives and the
system drive, checks Serato is closed, backs the database up, keeps Serato's
own track details and verifies the crate, restoring the backup if not.
Serato DJ Pro 5 has shown crates written this way, in order and playable.
Nested crate folders are refused here rather than flattened.
"""
from windows_serato_library import SeratoLibraryError


def make_playlist_exporter(app):
    def export_serato_playlist(database_path, playlist, name, backup_dir=None, *, transfer_key=None,
                               path_parts=None, ensure_quit=None, **_ignored):
        if path_parts and len(path_parts) > 1:
            raise SeratoLibraryError('Serato crate folders are not supported on Windows yet. '
                                     'Export this set as a top-level crate.')
        tracks = [track for track in playlist if isinstance(track, dict)]
        result = app._write_serato_modern_visible_crate(tracks, name)
        if not result.get('delivery_verified'):
            raise IOError('PEAK HOUR could not verify the Serato crate.')
        crate = result.get('crate_name') or name
        return {
            'success': True,
            'message': 'Playlist registered in Serato; library order verified.',
            'serato_library_registered': True,
            'serato_modern_database_touched': True,
            'serato_database_untouched': False,
            'source_audio_untouched': True,
            'destination_app_verified': True,
            'delivery_verified': True,
            'database_readback_verified': True,
            'serato_playlist_name': crate,
            'serato_path_parts': [crate],
            'serato_lookup': crate,
            'database_path': result.get('database_path', ''),
            'backup_path': result.get('backup_path', ''),
            'total_tracks': len(playlist),
            'exported_tracks': result.get('exported_tracks', 0),
            'verified_crate_tracks': result.get('verified_tracks', 0),
            'missing_tracks': result.get('missing_tracks', 0),
            'duplicate_tracks': result.get('duplicate_tracks', 0),
            'serato_running': False,
            'serato_restart_hint': 'Open Serato and look for ' + crate + '. Library registration and track order were verified.',
        }
    return export_serato_playlist


def install(app):
    import utils.serato_playlist_export as module
    if getattr(module, '_windows_serato_export_installed', False):
        return
    module.export_serato_playlist = make_playlist_exporter(app)  # app imports it from the module on each export
    module._windows_serato_export_installed = True
