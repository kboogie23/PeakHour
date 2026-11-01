"""Rubber Band command line for Studio DAW's pitch-preserving preparation.

The Mac app ships Breakfast Quay's `rubberband` program. This script accepts
the exact arguments studio_daw.stretch passes:

    rubberband -3 --centre-focus -q -t RATIO -p SEMITONES [-M MAP] INPUT OUTPUT

With Node (--node), it runs windows_rubberband.mjs: AXIOM's own Rubber Band R3
WebAssembly build and offline key-frame-map workflow, the same engine and
options as the Mac program. That engine is limited to 600 seconds of input and
256 MiB of samples; longer clips, or no Node, use FFmpeg's built-in Rubber
Band filter instead. There, a time map (-M, "source_frame target_frame" per
line) is applied piecewise: each span between anchors is stretched at its own
ratio and trimmed or padded to its exact target length, so every anchor lands
on its target frame. --centre-focus maps to the filter's channels=together.
The filter has no R3 ("finer") engine switch, so -3 runs on the library's
standard real-time engine: lengths are exact, but at large tempo changes a
transient can land up to ~15 ms early. windows_studio prefers a real
rubberband.exe whenever one is installed.

Usage: python -I windows_rubberband.py --ffmpeg FFMPEG [--node NODE] <rubberband arguments>
"""
import math
import subprocess
import sys
import types
import wave
from pathlib import Path

CREATE_NO_WINDOW = 0x08000000
ENGINE = Path(__file__).with_name('windows_rubberband.mjs')
WASM_RATE, WASM_SECONDS, WASM_BYTES = 48000, 600, 256 * 1024 * 1024


def parse(argv):
    # Not argparse: "-3" is a flag here, so argparse would read "-p -3.0" as two options.
    args = types.SimpleNamespace(ffmpeg=None, node=None, finer=False, centre=False, quiet=False,
                                 ratio=1.0, pitch=0.0, map=None)
    flags = {'-3': 'finer', '--centre-focus': 'centre', '-q': 'quiet'}
    values = {'--ffmpeg': ('ffmpeg', str), '--node': ('node', str), '-t': ('ratio', float),
              '-p': ('pitch', float), '-M': ('map', str)}
    positional, items = [], iter(argv)
    for item in items:
        if item in flags:
            setattr(args, flags[item], True)
        elif item in values:
            name, kind = values[item]
            try:
                setattr(args, name, kind(next(items)))
            except (StopIteration, ValueError):
                raise SystemExit(f'rubberband: {item} needs a valid value')
        elif item.startswith('-') and item != '-':
            raise SystemExit(f'rubberband: unsupported option {item}')
        else:
            positional.append(item)
    if len(positional) != 2 or not args.ffmpeg:
        raise SystemExit('rubberband: usage: --ffmpeg FFMPEG [--node NODE] [options] INPUT OUTPUT')
    args.input, args.output = positional
    if not (math.isfinite(args.ratio) and 1 / 8 - 1e-9 <= args.ratio <= 8 + 1e-9):
        raise SystemExit('rubberband: time ratio must be between 1/8 and 8')
    if not (math.isfinite(args.pitch) and abs(args.pitch) <= 24):
        raise SystemExit('rubberband: pitch must be within 24 semitones')
    return args


def anchors(frames, ratio, map_path):
    points = [(0, 0)]
    if map_path:
        with open(map_path, encoding='ascii') as handle:
            for line in handle:
                if line.strip():
                    source, target = line.split()
                    points.append((int(round(float(source))), int(round(float(target)))))
    points.append((frames, int(round(frames * ratio))))
    for (s0, t0), (s1, t1) in zip(points, points[1:]):
        if s1 <= s0 or t1 <= t0:
            raise ValueError('time map anchors must increase')
    return points


def spans(points):
    """Merge neighbouring spans whose stretch ratio is the same."""
    merged = [points[0]]
    for index in range(1, len(points)):
        if index + 1 < len(points) and len(merged) >= 1:
            (s0, t0), (s1, t1), (s2, t2) = merged[-1], points[index], points[index + 1]
            if abs((t1 - t0) * (s2 - s1) - (t2 - t1) * (s1 - s0)) <= 1e-9 * (s1 - s0) * (s2 - s1):
                continue
        merged.append(points[index])
    return list(zip(merged, merged[1:]))


def filter_graph(pieces, pitch, centre):
    scale = 2 ** (pitch / 12)
    options = f'pitch={scale:.12f}:pitchq=quality' + (':channels=together' if centre else '')
    chains = [f"[0:a]asplit={len(pieces)}" + ''.join(f'[i{k}]' for k in range(len(pieces)))] if len(pieces) > 1 else []
    for k, ((s0, t0), (s1, t1)) in enumerate(pieces):
        source = f'[i{k}]' if len(pieces) > 1 else '[0:a]'
        length = t1 - t0
        tempo = (s1 - s0) / length
        stretch = '' if abs(tempo - 1) < 1e-12 and pitch == 0 else f',rubberband=tempo={tempo:.12f}:{options}'
        chains.append(f'{source}atrim=start_sample={s0}:end_sample={s1},asetpts=PTS-STARTPTS{stretch},'
                      f'apad=whole_len={length},atrim=end_sample={length}[o{k}]')
    chains.append(''.join(f'[o{k}]' for k in range(len(pieces))) + f'concat=n={len(pieces)}:v=0:a=1[out]')
    return ';'.join(chains)


def main(argv=None):
    args = parse(sys.argv[1:] if argv is None else argv)
    with wave.open(args.input, 'rb') as audio:
        frames, rate, channels = audio.getnframes(), audio.getframerate(), audio.getnchannels()
    if frames < 1:
        raise SystemExit('rubberband: input has no audio')
    target = int(round(frames * args.ratio))
    if (args.node and rate == WASM_RATE and channels in (1, 2) and 960 <= frames <= WASM_SECONDS * rate
            and (frames + target) * channels * 4 <= WASM_BYTES):
        command = [args.node, str(ENGINE), repr(args.ratio), repr(args.pitch), args.map or '-', args.input, args.output]
        return subprocess.run(command, creationflags=CREATE_NO_WINDOW).returncode
    pieces = spans(anchors(frames, args.ratio, args.map))
    command = [args.ffmpeg, '-nostdin', '-v', 'error', '-n', '-i', args.input,
               '-filter_complex', filter_graph(pieces, args.pitch, args.centre),
               '-map', '[out]', '-c:a', 'pcm_f32le', args.output]
    return subprocess.run(command, creationflags=CREATE_NO_WINDOW).returncode


if __name__ == '__main__':
    sys.exit(main())
