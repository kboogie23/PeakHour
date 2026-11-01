"""Studio DAW plugin worker on Windows: VST3 effects in place of Mac Audio Units.

studio_daw.audio_units runs a disposable native worker per request:

    worker REQUEST.json RESPONSE.json

with {"action": "scan"}, or AXIOM's validated effect settings plus "inspect",
or those plus "input"/"output" WAV paths for "render". On the Mac that worker
is a Swift Audio Unit host. This one hosts VST3 effects with Spotify's
pedalboard (JUCE) and answers in the same shapes, so AXIOM's Plugins dialog,
project format and render checks work unchanged:

- scan: effects in the standard VST3 folders, each with a stable AXIOM id
  ("61756678-XXXXXXXX-XXXXXXXX", hashed from the plugin file and name), a
  name, a manufacturer and a numeric version;
- inspect: the effect's parameters (address = parameter index; continuous
  values are the plugin's normalised 0..1 value with its own display text,
  switches are checkboxes, stepped choices are menus) and its state (base64);
- render: the prepared 48 kHz stereo clip with the saved state and parameter
  values, plus the requested tail, written as float WAV of exactly
  input + tail frames. With the DAW's tempo map ("tempo": startBeat and BPM
  points) the clip is rendered with DawDreamer, whose transport gives the
  effect the project's BPM (tempo changes inside the clip included), so
  tempo-synced delays and LFOs follow the song; the effect's control values
  are copied from pedalboard and its latency is compensated. Without a tempo
  map, or when DawDreamer cannot host the effect, pedalboard renders as before
  (no host tempo). DawDreamer's transport starts at beat 0 of the clip, so
  effects that lock to the bar line may start at a different point in the bar.

Run by AXIOM as: python -I windows_vst3_worker.py REQUEST.json RESPONSE.json
"""
import base64
import hashlib
import json
import os
import sys
from pathlib import Path

RATE = 48000
TEMPO_PPQN = 96  # tempo-map resolution handed to DawDreamer (ticks per beat)
CATALOG = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'AXIOM' / 'vst3-catalog.json'


def plugin_folders():
    # AXIOM_VST3_FOLDERS (os.pathsep-separated) replaces the standard folders, for tests. CommonProgramFiles
    # cannot do that: Windows resets it for every new process, so the worker would scan the real folder.
    override = os.environ.get('AXIOM_VST3_FOLDERS')
    if override:
        return [Path(folder) for folder in override.split(os.pathsep) if folder and Path(folder).is_dir()]
    folders = [Path(os.environ.get('CommonProgramFiles', r'C:\Program Files\Common Files')) / 'VST3',
               Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'Programs' / 'Common' / 'VST3']
    return [folder for folder in folders if folder.is_dir()]


def plugin_files(folders):
    """Every .vst3 bundle or file, without descending into bundles."""
    found = []
    for folder in folders:
        for root, dirs, files in os.walk(folder):
            for name in list(dirs):
                if name.lower().endswith('.vst3'):
                    found.append(Path(root) / name)
                    dirs.remove(name)
            found.extend(Path(root) / name for name in files if name.lower().endswith('.vst3'))
    return sorted(set(found))


def plugin_id(path, name):
    subtype = hashlib.sha256(f'{os.path.normcase(str(path))}|{name}'.encode()).hexdigest()[:8]
    maker = hashlib.sha256(f'{os.path.normcase(str(path))}'.encode()).hexdigest()[:8]
    return f'61756678-{subtype}-{maker}'


def numeric_version(text):
    parts = [int(''.join(c for c in part if c.isdigit()) or 0) for part in str(text or '').split('.')[:3]]
    parts += [0] * (3 - len(parts))
    return min(parts[0], 65535) << 16 | min(parts[1], 255) << 8 | min(parts[2], 255)


def stamp(path):
    stat = path.stat()
    return f'{stat.st_size}:{stat.st_mtime_ns}'


def scan(load):
    """Effects in the VST3 folders; plugin files are only loaded when new or changed."""
    try:
        cache = json.loads(CATALOG.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        cache = {}
    entries, fresh = [], {}
    for path in plugin_files(plugin_folders()):
        key, mark = os.path.normcase(str(path)), ''
        try:
            mark = stamp(path)
            cached = cache.get(key)
            if not cached or cached.get('stamp') != mark:
                cached = {'stamp': mark, 'plugins': describe(path, load)}
        except Exception as error:  # one broken plugin must not hide the others
            cached = {'stamp': mark, 'plugins': [], 'error': str(error)[:300]}
        fresh[key] = cached
        entries.extend(cached['plugins'])
    try:
        CATALOG.parent.mkdir(parents=True, exist_ok=True)
        CATALOG.write_text(json.dumps(fresh), encoding='utf-8')
    except OSError:
        pass
    return entries


def describe(path, load):
    import pedalboard
    try:
        names = pedalboard.VST3Plugin.get_plugin_names_for_file(str(binary(path)))
    except Exception:
        names = [None]
    plugins = []
    for name in names:
        plugin = load(path, name)
        if getattr(plugin, 'is_instrument', False):
            continue
        label = name or getattr(plugin, 'name', '') or path.stem
        plugins.append({'id': plugin_id(path, label), 'name': label,
                        'manufacturer': getattr(plugin, 'manufacturer_name', '') or 'VST3',
                        'version': numeric_version(getattr(plugin, 'version', '')),
                        'path': str(path), 'pluginName': name})
    return plugins


def binary(path):
    """The loadable file of a VST3 bundle folder (Contents\\x86_64-win\\<name>.vst3); a plain .vst3 file as is.
    pedalboard on Windows cannot open the bundle folder itself, which is how most effects ship."""
    path = Path(path)
    if path.is_dir():
        inner = sorted((path / 'Contents' / 'x86_64-win').glob('*.vst3'))
        if inner:
            return inner[0]
    return path


def pedalboard_names(path):
    """Effect names inside one VST3 file (a shell plugin holds several; DawDreamer can only open the first)."""
    import pedalboard
    try:
        return pedalboard.VST3Plugin.get_plugin_names_for_file(str(binary(path)))
    except Exception:
        return []


def load_vst3(path, name=None):
    import pedalboard
    target = str(binary(path))
    return pedalboard.load_plugin(target, plugin_name=name) if name else pedalboard.load_plugin(target)


def resolve(request, load):
    entry = next((p for p in scan(load) if p['id'] == request.get('id')), None)
    if entry is None:
        raise RuntimeError('The selected VST3 effect is no longer installed.')
    plugin = load(Path(entry['path']), entry['pluginName'])
    if request.get('state'):
        plugin.raw_state = base64.b64decode(request['state'])
    parameters = list(plugin_parameters(plugin))
    for address, value in (request.get('parameters') or {}).items():
        index = int(address)
        if 0 <= index < len(parameters):
            set_value(parameters[index], float(value))
    return plugin, parameters


def plugin_parameters(plugin):
    """pedalboard's native parameter objects, in the plugin's own order (index = AXIOM address)."""
    return plugin._parameters


def choices(parameter):
    """Labels of a stepped (non-switch) parameter, one per step."""
    steps = int(getattr(parameter, 'num_steps', 0) or 0)
    if parameter.is_boolean or not parameter.is_discrete or not 1 < steps <= 512:
        return []
    return [parameter.get_text_for_raw_value(i / (steps - 1)) for i in range(steps)]


def set_value(parameter, value):
    options = choices(parameter)
    if parameter.is_boolean:
        parameter.raw_value = 1.0 if value else 0.0
    elif options:
        parameter.raw_value = min(max(round(value), 0), len(options) - 1) / (len(options) - 1)
    else:
        parameter.raw_value = min(max(value, 0.0), 1.0)


def describe_parameters(parameters):
    rows = []
    for index, parameter in enumerate(parameters):
        options = choices(parameter)
        raw = float(parameter.raw_value)
        row = {'address': str(index), 'name': str(parameter.name or f'Parameter {index + 1}')[:200],
               'writable': True, 'displayValue': str(parameter.string_value or '')[:100]}
        if parameter.is_boolean:
            row.update(unitCode=2, min=0, max=1, value=1 if raw >= 0.5 else 0)
        elif options:
            row.update(unitCode=1, min=0, max=len(options) - 1, value=round(raw * (len(options) - 1)),
                       valueStrings=[str(v)[:100] for v in options])
        else:
            row.update(unitCode=0, min=0, max=1, value=raw)
        rows.append(row)
    return rows


def bpm_at(points, beat):
    """BPM of AXIOM's tempo map at a project beat (steps, or a linear ramp to the next point)."""
    current = points[0]
    for index, point in enumerate(points):
        if point['beat'] <= beat:
            current = point
            following = points[index + 1] if index + 1 < len(points) else None
            if point.get('linear') and following and following['beat'] > point['beat'] and beat < following['beat']:
                share = (beat - point['beat']) / (following['beat'] - point['beat'])
                return point['bpm'] + share * (following['bpm'] - point['bpm'])
    return current['bpm']


def tempo_curve(tempo, seconds):
    """A single BPM, or DawDreamer's per-tick BPM array, for a clip starting at tempo['startBeat']."""
    points = sorted(tempo['points'], key=lambda p: p['beat'])
    start = float(tempo.get('startBeat') or 0)
    first = float(bpm_at(points, start))
    if all(p['beat'] <= start for p in points[1:]) and not (points and any(p.get('linear') for p in points)):
        return first
    values, elapsed, beat, step = [], 0.0, start, 1.0 / TEMPO_PPQN
    while elapsed < seconds + 1.0:
        bpm = bpm_at(points, beat)
        values.append(bpm)
        elapsed += step * 60.0 / bpm
        beat += step
    import numpy as np
    curve = np.asarray(values, dtype=np.float32)  # DawDreamer takes float32 tempo arrays
    return float(curve[0]) if np.allclose(curve, curve[0]) else curve


def render_with_tempo(path, plugin, audio, tempo):
    """Render through DawDreamer so the effect sees the song's tempo; None if it cannot host this effect."""
    try:
        import dawdreamer
        import numpy as np
    except ImportError:
        return None
    seconds = len(audio) / RATE
    engine = dawdreamer.RenderEngine(RATE, 512)
    curve = tempo_curve(tempo, seconds)
    engine.set_bpm(curve, ppqn=TEMPO_PPQN) if not isinstance(curve, float) else engine.set_bpm(curve)
    effect = engine.make_plugin_processor('effect', str(binary(path)))
    parameters = plugin_parameters(plugin)
    if effect.get_plugin_parameter_size() != len(parameters):
        return None  # a different view of the effect: keep pedalboard's own render
    for index, parameter in enumerate(parameters):
        effect.set_parameter(index, float(parameter.raw_value))
    latency = int(effect.get_latency_samples() or 0)
    source = np.concatenate([audio, np.zeros((latency, 2), np.float32)]).T.copy() if latency else audio.T.copy()
    engine.load_graph([(engine.make_playback_processor('source', source), []), (effect, ['source'])])
    engine.render(source.shape[1] / RATE)
    output = np.asarray(engine.get_audio(), dtype=np.float32)
    return output[:, latency:latency + len(audio)]


def render(request, load):
    import numpy as np
    import soundfile as sf
    plugin, _ = resolve(request, load)
    audio, rate = sf.read(request['input'], dtype='float32', always_2d=True)
    if rate != RATE or audio.shape[1] != 2:
        raise RuntimeError('Plugin input must be 48 kHz stereo prepared audio.')
    tail = int(round(float(request.get('tailSeconds') or 0) * RATE))
    audio = np.concatenate([audio, np.zeros((tail, 2), np.float32)]) if tail else audio
    output = None
    entry = next((p for p in scan(load) if p['id'] == request.get('id')), None)
    if request.get('tempo') and entry and len(pedalboard_names(entry['path'])) <= 1:
        try:
            output = render_with_tempo(Path(entry['path']), plugin, audio, request['tempo'])
        except Exception:  # DawDreamer could not run this effect: pedalboard renders it (without host tempo)
            output = None
    if output is None:
        output = plugin.process(audio.T.copy(), RATE, reset=True)
    output = np.asarray(output, dtype=np.float32)
    if output.ndim == 1:
        output = np.stack([output, output])
    if output.shape[0] == 1:
        output = np.repeat(output, 2, axis=0)
    output = output[:2, :len(audio)]
    if output.shape[1] < len(audio):
        output = np.pad(output, ((0, 0), (0, len(audio) - output.shape[1])))
    if not np.isfinite(output).all():
        raise RuntimeError('The effect produced invalid samples.')
    sf.write(request['output'], output.T, RATE, subtype='FLOAT')
    return {'frames': int(output.shape[1])}


def handle(request, load=load_vst3):
    action = request.get('action')
    if action == 'scan':
        return {'plugins': [{key: p[key] for key in ('id', 'name', 'manufacturer', 'version')} for p in scan(load)]}
    if action == 'inspect':
        plugin, parameters = resolve(request, load)
        return {'parameters': describe_parameters(parameters),
                'state': base64.b64encode(bytes(plugin.raw_state)).decode('ascii')}
    if action == 'render':
        return render(request, load)
    raise RuntimeError('Unknown plugin action.')


def main(argv):
    request_path, response_path = argv
    request = json.loads(Path(request_path).read_text(encoding='utf-8'))
    result = handle(request)
    Path(response_path).write_text(json.dumps(result, allow_nan=False), encoding='utf-8')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        print('VST3 worker failed:', error, file=sys.stderr)
        sys.exit(1)
