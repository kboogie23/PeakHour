"""Experimental bootstrap for testing Windows adapters with AXIOM's backend.

The caller supplies isolated paths. This module does not bypass AXIOM access
checks or start a server. Several macOS-dependent features remain unsupported.
"""
import importlib
import os
from pathlib import Path

def build_backend(*, recording_settings, recording_directory, capture_factory=None,
                  device_query=None, host_query=None, video_cache_root=None,
                  video_allowed_path=None, video_ffmpeg=None,
                  virtualdj_allowed_path=None, virtualdj_chooser=None, mix_export_chooser=None,
                  safe_location=None):
    from windows_paths import is_safe_location as windows_safe_location
    is_safe_location = safe_location or windows_safe_location  # a laptop's engine passes deny-all
    import utils.path_ops
    utils.path_ops.is_safe_location = is_safe_location
    if video_cache_root is not None:
        if not callable(video_allowed_path) or not video_ffmpeg:
            raise ValueError('Video preview requires an explicit path policy and FFmpeg executable')
        from windows_video_scan import install_video_scanning
        install_video_scanning(video_cache_root)
    if video_ffmpeg:  # before app: Studio DAW blueprints look up their audio tools when app is imported
        from windows_studio import install as install_studio
        install_studio(video_ffmpeg)
        from windows_stems import install as install_stems
        install_stems()
    from windows_scan_speed import install as install_scan_speed
    install_scan_speed()
    app = importlib.import_module('app')
    # The update feed in axiom_build.json lists the Mac releases. Windows has no feed yet, so the update check
    # answers "not configured" and the startup check stays silent. PEAK_HOUR_UPDATE_MANIFEST_URL sets a feed.
    app.AXIOM_UPDATE_MANIFEST_URL = os.environ.get('PEAK_HOUR_UPDATE_MANIFEST_URL', '').strip()
    from windows_djay import install as install_windows_djay
    install_windows_djay(app)
    from windows_serato_paths import make_relpath_resolver, make_database_candidates
    if not getattr(app, '_windows_serato_paths_installed', False):
        app._serato_relpath_to_absolute_path = make_relpath_resolver(app._serato_relpath_to_absolute_path)
        app._serato_database_candidates = make_database_candidates(app._serato_database_candidates)
        app._windows_serato_paths_installed = True
    from windows_serato_library import install as install_serato_library
    install_serato_library(app)
    from windows_serato_export import install as install_serato_export
    install_serato_export(app)
    from windows_posix import install as install_posix
    install_posix()
    from windows_exports import install as install_exports
    install_exports(app)
    from windows_brand import install as install_brand
    install_brand(app)  # PEAK HOUR names on downloaded files
    from windows_apps import install as install_apps
    install_apps(app)
    from windows_year_fixes import install as install_year_fixes
    install_year_fixes(app)
    from windows_intake import install as install_intake
    install_intake(app)  # total, percentage and time left for "Adding your music"
    from windows_performance import install as install_performance
    install_performance(app)  # same answers, faster, for big libraries
    from windows_track_info import install as install_track_info
    install_track_info(app)  # Track Information: the library is read and resolved once, not on every open
    from windows_filetypes import install as install_filetypes
    install_filetypes(app)  # Library > Type: audio, video or one file type
    from windows_remote_library import install as install_remote_library
    install_remote_library(app)
    from windows_reconnect import install as install_reconnect
    install_reconnect(app)  # Health > Reconnect Music: relink moved songs by file name
    from windows_health_snapshot import install as install_health_snapshot
    install_health_snapshot(app)  # Health opens with its last results; counts again only when the library changed
    from windows_keep_awake import install as install_keep_awake
    install_keep_awake(app)  # after intake: the PC stays awake during Health jobs and imports
    from windows_remote_hub import create_info_blueprint
    app.app.register_blueprint(create_info_blueprint())
    if os.environ.get('AXIOM_THEME', 'red-platinum') != 'classic':  # AXIOM_THEME=classic keeps the original lime look
        from windows_theme import install as install_theme
        install_theme(app.app, Path(app.CACHE_PATH).parent / 'theme-cache', Path(__file__).with_name('static'))
    from windows_virtualdj_live import install as install_virtualdj_live
    install_virtualdj_live(app)  # after install_windows_djay: wraps its process snapshot for Live Assist only
    from windows_audio import WindowsAudioDeck
    from windows_dialogs import choose_folder_dialog, choose_serato_database_dialog
    from windows_recording import WindowsRecordingManager
    options = {}
    if capture_factory is not None: options['capture_factory'] = capture_factory
    if device_query is not None: options['device_query'] = device_query
    if host_query is not None: options['host_query'] = host_query
    if video_ffmpeg: options['ffmpeg'] = video_ffmpeg  # MP3 recordings
    directory = Path(recording_directory).absolute()
    settings = Path(recording_settings).absolute()
    if not directory.is_dir() or not settings.parent.is_dir():
        raise ValueError('Recording and settings directories must already exist')
    app.is_safe_location = is_safe_location
    app.choose_folder_dialog = choose_folder_dialog
    app.choose_serato_database_dialog = choose_serato_database_dialog
    app.NATIVE_AUDIO_DECK = WindowsAudioDeck()
    app.SET_RECORDING_MANAGER = WindowsRecordingManager(str(settings), str(directory), **options)
    from windows_mac_parity import install as install_mac_parity
    install_mac_parity(app)  # File Explorer reveal, Windows audio check, Recycle Bin for duplicates
    if video_cache_root is not None:
        from windows_video_scan import install_rescan
        install_rescan(app)
        from windows_video_api import VideoPreviewStore, create_video_blueprint
        app.WINDOWS_VIDEO_STORE = VideoPreviewStore(video_cache_root, video_allowed_path, video_ffmpeg)
        app.app.register_blueprint(create_video_blueprint(app.WINDOWS_VIDEO_STORE))
    if video_ffmpeg:
        from windows_mix_export import MixExports, create_mix_export_blueprint
        app.WINDOWS_MIX_EXPORTS = MixExports(video_ffmpeg, **({'chooser': mix_export_chooser} if mix_export_chooser else {}))
        app.app.register_blueprint(create_mix_export_blueprint(app.WINDOWS_MIX_EXPORTS))
    if virtualdj_allowed_path is not None:
        if not callable(virtualdj_allowed_path):
            raise ValueError('VirtualDJ inspection requires an explicit path policy')
        from windows_virtualdj_api import create_virtualdj_blueprint
        if virtualdj_chooser is None:
            from windows_dialogs import choose_virtualdj_xml
            virtualdj_chooser = choose_virtualdj_xml
        from windows_virtualdj_library import connect as connect_virtualdj_library
        app.app.register_blueprint(create_virtualdj_blueprint(virtualdj_allowed_path, app._license_gate, virtualdj_chooser,
                                                              connect_library=lambda: connect_virtualdj_library(app)))
        from windows_virtualdj_grids import VirtualDJGridCheck, create_grid_blueprint
        app.WINDOWS_VIRTUALDJ_GRIDS = VirtualDJGridCheck(app, Path(app.CACHE_PATH).parent / 'virtualdj_grid_check.json')
        app.app.register_blueprint(create_grid_blueprint(app.WINDOWS_VIRTUALDJ_GRIDS, app._license_gate,
                                                         lambda prompt: app.choose_folder_dialog(prompt)))
        from windows_virtualdj_health import create_health_blueprint
        app.app.register_blueprint(create_health_blueprint(app, app._license_gate))
        from windows_virtualdj_exports import create_exports_blueprint
        app.app.register_blueprint(create_exports_blueprint(app, virtualdj_allowed_path, app._license_gate))
        from windows_virtualdj_write import VirtualDJWriter, create_write_blueprint
        app.WINDOWS_VIRTUALDJ_WRITER = VirtualDJWriter(app, Path(app.CACHE_PATH).parent / 'virtualdj-writes')
        app.app.register_blueprint(create_write_blueprint(app.WINDOWS_VIRTUALDJ_WRITER, app._license_gate))
    return app
