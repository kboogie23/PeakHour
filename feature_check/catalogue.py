"""The feature catalogue: what PEAK HOUR promises a DJ, in plain words, and the checks that prove it.

Each Feature says what "works" means to the person using it. Its checks are:
  legacy  an existing test_windows_<name>.py script (run by check_features.py in the sandbox);
  api     a check that talks to the app's routes;
  ui      a check that drives the real page in headless Edge and looks at what a user sees;
  scale   a ui/api check on a library as big as the owner's (needs --synthetic N or --scale PATH).
A feature with no checks is a known gap and shows as "no checks written yet". `mvp=True` marks the ones that failed the
owner in real use (Reconnect Music, Track Information, Live Assist following VirtualDJ, day mode, update pop-ups, ...)
and make up --quick."""
from feature_check.api import Check, Feature
from feature_check.checks import library, health, live, settings, macparity, sweep, scale


def _legacy(*names):
    """One 'legacy' check per existing test file (names without test_windows_ and .py)."""
    return [Check('legacy', 'existing test ' + name, None, legacy='test_windows_%s.py' % name) for name in names]


def _files(*names):
    return ['test_windows_%s.py' % name for name in names]


def feature(id, area, name, works_means, checks=(), covered=(), budget_s=None, requires=(), platform='windows', mvp=False):
    return Feature(id=id, area=area, name=name, works_means=works_means, checks=list(checks) + _legacy(*covered), budget_s=budget_s,
                   covered_by=_files(*covered), requires=list(requires), platform=platform, mvp=mvp)


FEATURES = [
    # ------------------------------------------------------------------ Library
    feature('library.add_folder', 'Library', 'Add a music folder',
            'Choosing a folder puts its songs in the Library quickly, only music files, and nothing in the folder is changed.',
            covered=('intake', 'filetypes', 'scan_speed')),
    feature('library.search_sort_filter', 'Library', 'Search, sort and filter',
            'Typing in the search box narrows the list at once, even with 49,000 songs; the sort and filter buttons reorder it.',
            checks=[Check('scale', 'search keystroke on a big library', scale.search_keystroke)], requires=['ui', 'scale']),
    feature('library.play_preview', 'Library', 'Play a song to preview it',
            'Pressing play on a song starts that file within a few seconds, and the player shows it.',
            checks=[Check('ui', 'press play on a song, ask the audio engine', library.play_preview)],
            covered=('audio_stream', 'audio_formats', 'audio_decode_cancel'), budget_s=3, requires=['ui'], mvp=True),
    feature('library.track_info', 'Library', 'Track Information (source file check)',
            'Clicking a song opens its Track Information within 5 seconds, even when the song is on an unplugged drive '
            'and the library has 50,000 songs; it never hangs on "Checking Source File...".',
            checks=[Check('ui', 'click songs, wait for "Checking Source File..." to go', library.track_info),
                    Check('scale', 'Track Information on a big library', scale.track_info)],
            covered=('fast_paths', 'virtualdj_filecheck'), budget_s=5, requires=['ui'], mvp=True),
    feature('library.media_extras', 'Library', 'Video, artwork and waveform',
            'Video files preview, covers show, and the waveform draws for songs that can be read.',
            covered=('video_preview', 'video_api', 'video_store', 'waveform', 'waveform_api')),
    feature('library.first_load', 'Library', 'The Library opens quickly',
            'After starting the app, the Library list shows songs within 8 seconds on a 49,000-song library.',
            checks=[Check('scale', 'first load to the Library list', scale.library_load)], requires=['ui', 'scale']),

    # ------------------------------------------------------------------ Studio and export
    feature('studio.sets_stems_stretch', 'Studio', 'Studio sets, stems and tempo stretch',
            'Sets can be built and saved, stems split, and a song stretched to a new tempo.',
            covered=('studio', 'stems', 'stem_installer', 'stretch', 'magic_set')),
    feature('studio.daw_timeline', 'Studio', 'Studio DAW: formats, recording, plugins, controls, zoom and automation',
            'The DAW opens every supported audio format, records, hosts plug-ins, draws automation and keeps its controls working; '
            'Ctrl+wheel and Ctrl +/-/0 zoom the timeline and never the whole window; Stems offers the one-time engine install.',
            covered=('studio_formats', 'studio_recording', 'studio_plugins', 'studio_controls', 'studio_zoom', 'studio_automation',
                     'studio_polish', 'studio_stems_flow', 'studio_window_zoom'), requires=['ui']),
    feature('export.formats', 'Export', 'Export to CSV, rekordbox, M3U, Serato, djay, VirtualDJ and a mix file',
            'Each export writes a file the DJ software opens, and never overwrites the DJ software\'s own library.',
            covered=('exports', 'serato_export', 'djay_playlist', 'virtualdj_exports', 'virtualdj_lists', 'mix_export', 'crate_publish')),
    feature('export.send_to_dj_software', 'Export', 'Send to DJ software: playlists in folders for VirtualDJ, Serato and djay',
            'The Send dialog previews, then writes a playlist inside folders into each ticked program; an existing list is only '
            'replaced when Replace is ticked, and a program that is open gets the write after it closes.',
            covered=('dj_send_ui', 'virtualdj_folders', 'djay_folders', 'serato_folders')),
    feature('export.cues_to_dj_software', 'Export', 'Send cue points to VirtualDJ, Serato and djay',
            'Health > Sync to DJ copies cue points into songs that have none in the chosen program, never replaces a cue that is '
            'there, keeps a backup, and waits for an open program to close.',
            covered=('djay_cues_publish', 'djay_cue_default', 'serato_cues')),
    feature('export.dj_write_queue', 'Export', 'Writes wait for an open DJ program',
            'A write aimed at VirtualDJ, Serato or djay while it is open is queued, shown as "DJ writes waiting", and applied '
            'only after the program has closed and its files have settled; it can be cancelled.',
            covered=('dj_write_queue', 'dj_writes')),

    # ------------------------------------------------------------------ Performance
    feature('performance.dj_auto_follow', 'Performance', 'DJ Auto follows VirtualDJ, even on another tab',
            'With VirtualDJ playing, the page picks up each new song within 10 seconds even when the Performance tab is not open.',
            checks=[Check('ui', 'append a song to VirtualDJ history, watch the page', live.follow_virtualdj)],
            covered=('live_watch', 'virtualdj_live', 'virtualdj_live_cache'), budget_s=10, requires=['ui'], mvp=True),
    feature('performance.live_poll_cost', 'Performance', 'Live polling stays cheap',
            'While VirtualDJ is running, the live routes answer in under 100 ms and never re-read the whole library, '
            'so the app does not stutter.',
            checks=[Check('api', 'poll the live routes and count library reads', live.poll_cost),
                    Check('scale', 'live poll on a big library', scale.live_poll)],
            covered=('performance',), requires=['virtualdj'], mvp=True),
    feature('performance.virtualdj_connect', 'Performance', 'Connect a VirtualDJ library',
            'Connecting VirtualDJ brings its songs into the Library (49,000 songs in under 30 seconds) without changing VirtualDJ\'s files.',
            checks=[Check('scale', 'connect a 49,000-song VirtualDJ database', scale.vdj_connect)],
            covered=('virtualdj_library', 'virtualdj_database', 'virtualdj_api'), requires=['scale']),
    feature('performance.hotkey', 'Performance', 'Live Assist hotkey',
            'The Live Assist keyboard shortcut opens Live Assist from inside the DJ software.', covered=('hotkey',)),

    # ------------------------------------------------------------------ Playlists
    feature('playlists.favourites', 'Playlists', 'Playlists and favourites',
            'Songs can be starred, playlists made and opened again after a restart. (No checks written yet.)'),

    # ------------------------------------------------------------------ Health
    feature('health.open', 'Health', 'Health opens and shows its counts',
            'The Health page shows how many songs it checked and what needs fixing within 10 seconds, even on a 49,000-song library.',
            checks=[Check('ui', 'open Health and read the counts', health.health_open),
                    Check('scale', 'Health on a big library', scale.health_open)],
            covered=('virtualdj_health',), budget_s=10, requires=['ui'], mvp=True),
    feature('health.reconnect_music', 'Health', 'Reconnect Music',
            'The Reconnect Music button opens a Windows window (never a Mac-style prompt box), takes the folder or drive where '
            'the music is now, and reconnects the missing songs by file name.',
            checks=[Check('ui', 'press Reconnect Music, choose a folder, start', health.reconnect_music),
                    Check('scale', 'reconnect 1,000 files among 48,000 missing songs', scale.reconnect)],
            covered=('reconnect',), requires=['ui'], mvp=True),
    feature('health.scans_missing', 'Health', 'Health scans, stop, and remove missing songs',
            'Scans start and stop safely, years are fixed in the library only, and missing songs can be removed from the Library.',
            covered=('year_fixes', 'scan_speed')),

    # ------------------------------------------------------------------ Recording, AI, other laptops
    feature('recording.record', 'Recording', 'Record a set',
            'The recorder captures the chosen input, stops cleanly, and a recording cut short can be recovered.',
            covered=('capture', 'recording_stop', 'recording_recovery', 'recording_device_identity', 'recording_test_signal', 'wav_recovery')),
    feature('ai.status', 'AI Assist', 'AI Assist status',
            'AI Assist says plainly whether it is ready, running or needs a download, and recovers after an interruption.',
            covered=('ai', 'ai_recovery')),
    feature('remote.hub', 'Remote', 'Other laptops hub',
            'A second laptop can send its library to the hub PC and the hub shows it.', covered=('remote_hub',)),

    # ------------------------------------------------------------------ Settings
    feature('settings.day_night', 'Settings', 'Day and night mode',
            'The Day / Night button switches the whole app; in day mode every piece of text can be read (3:1 contrast or better).',
            checks=[Check('ui', 'switch to day mode and measure text contrast', settings.day_mode_readable)],
            covered=('day_mode', 'theme', 'brand_js'), requires=['ui'], mvp=True),
    feature('settings.manual', 'Settings', 'The manual',
            'The built-in manual opens and its pictures match the app.', covered=('manual',)),
    feature('settings.updates', 'Settings', 'No update pop-ups',
            'PEAK HOUR never shows a Mac App Store or AXIOM update window; updates are only offered when a feed is configured.',
            checks=[Check('ui', 'load the app, watch 10 seconds for an update window', settings.no_update_popup)],
            covered=('updates',), requires=['ui'], mvp=True),

    # ------------------------------------------------------------------ Launcher
    feature('launcher.lifecycle', 'Launcher', 'Start, single instance, clean exit, logs, installer size',
            'A second launch opens the running app, closing the window ends the app and its helpers, logs do not grow forever, '
            'and the installer stays a sensible size.', covered=('launcher', 'exit', 'installer_size')),

    # ------------------------------------------------------------------ Quality sweeps
    feature('quality.click_sweep', 'Quality', 'Click-through sweep of every tab',
            'Pressing the buttons on every tab never shows Mac wording (/Volumes, Finder, Command key, Mac App Store, macOS), '
            'never throws a JavaScript error, and never gets a server error.',
            checks=[Check('ui', 'press every safe button on every tab', sweep.sweep)], requires=['ui']),

    feature('quality.idle_smoothness', 'Quality', 'The page stays smooth when idle',
            'Leaving the Library tab alone for 30 seconds never stalls the page: no more than 3 freezes over 200 ms.',
            checks=[Check('ui', 'count main-thread stalls over 30 seconds', sweep.idle_smoothness)], requires=['ui']),

    # ------------------------------------------------------------------ Mac only: must stay hidden on Windows
    feature('mac.accessibility', 'Mac only', 'Command-F through macOS Accessibility',
            'Mac only. On Windows the "Allow access" controls are hidden (Live Assist uses a Windows hotkey instead).',
            checks=[Check('ui', 'the Allow access controls are hidden', macparity.accessibility)],
            covered=('mac_parity',), platform='mac_only', requires=['ui']),
    feature('mac.app_store_updates', 'Mac only', 'Check For Updates (Mac App Store)',
            'Mac only. On Windows there is no Check For Updates button for the Mac App Store.',
            checks=[Check('ui', 'Check For Updates is hidden', macparity.app_store_updates)], platform='mac_only', requires=['ui']),
    feature('mac.quit', 'Mac only', 'Quit (Mac app bridge)',
            'Mac only. On Windows closing the window quits; the Mac "Quit" setting is hidden.',
            checks=[Check('ui', 'Quit is hidden', macparity.quit_button)], platform='mac_only', requires=['ui']),
    feature('mac.lite_import', 'Mac only', 'AXIOM Lite import',
            'Mac only. The AXIOM Lite library import is hidden on Windows.',
            checks=[Check('ui', 'Lite import is hidden', macparity.lite_import)], platform='mac_only', requires=['ui']),
    feature('mac.account', 'Mac only', 'Account & Licence (activation off)',
            'Mac only while activation is off. The account and licence screens are hidden on Windows.',
            checks=[Check('ui', 'Account & License is hidden', macparity.account)], platform='mac_only', requires=['ui']),
]
