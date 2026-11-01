// Rubber Band R3 for Studio DAW on Windows, run by Node.
//
// AXIOM ships Rubber Band compiled to WebAssembly (static/vendor) together with
// stretch-engine.mjs, the offline two-pass R3 workflow with a key-frame map
// that its browser build uses in place of the Mac `rubberband` program. This
// script runs that same engine on a WAV file:
//
//   node windows_rubberband.mjs RATIO SEMITONES MAP|- INPUT OUTPUT
//
// RATIO is output/input duration, MAP is the "source_frame target_frame" file
// written by studio_daw.stretch (or - for none). Input is 48 kHz mono/stereo
// PCM or float WAV; output is a 48 kHz stereo float WAV of exactly the mapped
// length.
import {readFileSync, writeFileSync} from 'node:fs';
import Rubberband from './static/vendor/rubberband-wasm-0.2.0/rubberband.mjs';
import {stretch, encodeWav} from './static/js/studio-daw/stretch-engine.mjs';

function readWav(path) {
  const data = readFileSync(path), view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tag = at => data.toString('ascii', at, at + 4);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Input is not a WAV file.');
  let format = null, offset = 12;
  while (offset + 8 <= data.length) {
    const id = tag(offset), size = view.getUint32(offset + 4, true), body = offset + 8;
    if (id === 'fmt ') {
      let code = view.getUint16(body, true);
      if (code === 0xFFFE) code = view.getUint16(body + 24, true);  // WAVE_FORMAT_EXTENSIBLE
      format = {code, channels: view.getUint16(body + 2, true), rate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true)};
    } else if (id === 'data') {
      if (!format) throw new Error('WAV data precedes its format.');
      const {code, channels, rate, bits} = format, width = bits / 8;
      if (rate !== 48000 || ![1, 2].includes(channels)) throw new Error('Input must be 48 kHz mono or stereo.');
      if (!(code === 1 && [16, 24, 32].includes(bits)) && !(code === 3 && bits === 32)) throw new Error('Unsupported WAV sample format.');
      const frames = Math.floor(Math.min(size, data.length - body) / (width * channels));
      const out = Array.from({length: channels}, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) {
        const at = body + (i * channels + c) * width;
        out[c][i] = code === 3 ? view.getFloat32(at, true)
          : bits === 16 ? view.getInt16(at, true) / 32768
          : bits === 32 ? view.getInt32(at, true) / 2147483648
          : (((data[at] | data[at + 1] << 8 | data[at + 2] << 16) << 8) >> 8) / 8388608;
      }
      return out;
    }
    offset = body + size + (size & 1);
  }
  throw new Error('WAV file has no audio data.');
}

const [ratioText, pitchText, mapPath, input, output] = process.argv.slice(2);
try {
  if (!output) throw new Error('Usage: windows_rubberband.mjs RATIO SEMITONES MAP|- INPUT OUTPUT');
  const ratio = Number(ratioText), pitch = Number(pitchText), channels = readWav(input), frames = channels[0].length;
  const inner = mapPath === '-' ? [] : readFileSync(mapPath, 'ascii').split('\n').filter(line => line.trim())
    .map(line => line.trim().split(/\s+/).map(value => Math.round(Number(value))));
  const plan = {pitch, frames: [[0, 0], ...inner, [frames, Math.round(frames * ratio)]]};
  const result = stretch(await Rubberband(), channels, plan);
  const stereo = result.channels.length === 2 ? result.channels : [result.channels[0], result.channels[0]];
  writeFileSync(output, Buffer.from(encodeWav(stereo)), {flag: 'wx'});
} catch (error) {
  process.stderr.write(`rubberband: ${error.message}\n`);
  process.exit(1);
}
