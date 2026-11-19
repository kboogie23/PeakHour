r"""Studio DAW plays every audio and video file the Library lists, not only the eight formats the Mac build allows.

studio_daw keeps one allowlist (source_formats.FORMATS, the same set object in imports, waveforms, stretch,
drum_patterns and steady_timing): aac, aif, aiff, flac, m4a, mp3, mp4, wav. Anything else made the audio check say
"unavailable" and the waveform and stretch routes answer 400 "Audio path is not permitted". The allowlist was only a
list: every one of those routes decodes with FFmpeg, which reads ogg, opus, wma, alac, and the sound of a video file
(mpg, mpeg, avi, wmv, mkv, webm, mov, m4v, vob) just as well. Checked by rendering each format through the stretch
route (48 kHz, not silent), see test_windows_studio_formats.py. install() adds these suffixes to the shared set and to
the portable-project suffixes (bundles.SUFFIXES). Nothing is converted and nothing is written next to the owner's file.
A damaged file is still refused by the decoder and windows_audio_check says so ("The file may be damaged").
"""
import importlib

# the audio and video types Library > Type lists (windows_filetypes.AUDIO / VIDEO), minus what studio_daw already allows
EXTRA = frozenset({'.ogg', '.opus', '.wma', '.alac', '.mpg', '.mpeg', '.avi', '.wmv', '.mkv', '.webm', '.mov',
                   '.m4v', '.vob'})
TARGETS = (('studio_daw.source_formats', 'FORMATS'), ('studio_daw.imports', 'FORMATS'), ('studio_daw.waveforms', 'FORMATS'),
           ('studio_daw.stretch', 'FORMATS'), ('studio_daw.drum_patterns', 'FORMATS'),
           ('studio_daw.steady_timing', 'FORMATS'), ('studio_daw.bundles', 'SUFFIXES'))


def install():
    """Add EXTRA to every allowlist; they are normally one shared set, any that is not is replaced by a copy."""
    for module_name, attribute in TARGETS:
        module = importlib.import_module(module_name)
        current = getattr(module, attribute, None)
        if isinstance(current, set):
            current.update(EXTRA)
        elif isinstance(current, (frozenset, tuple, list)):
            setattr(module, attribute, frozenset(current) | EXTRA)
