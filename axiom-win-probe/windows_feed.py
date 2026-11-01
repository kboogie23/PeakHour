"""Streaming feed for set recordings on Windows (in place of the Mac's AXIOM Broadcast driver).

AXIOM's Mac app installed its own virtual audio device so streaming apps (OBS and the like) could
take the clean recording feed as a microphone. On Windows a virtual audio cable does that job:
VB-CABLE, Voicemeeter or Virtual Audio Cable each add an output whose sound comes back out of a
matching input. While a set records with the feed on, every captured block is also played into
that cable's output; streaming apps pick the cable's input. Nothing is installed by PEAK HOUR.

The feed never holds up the recording: blocks wait in a short buffer (about a third of a second),
the oldest are dropped if the cable falls behind, and a feed error only stops the feed.
"""
import collections
import threading

import numpy as np
import sounddevice as sd

# Output names of virtual audio cables (lower case, matched by substring).
CABLE_NAMES = ('cable input', 'vb-audio', 'voicemeeter input', 'voicemeeter aux input', 'voicemeeter vaio',
               'virtual audio cable', 'line 1 (virtual')
MAX_BUFFER_SECONDS = 0.35


def find_cable(query=sd.query_devices, hostapis=sd.query_hostapis):
    """{'index', 'name'} of a virtual cable's output (MME entry, which converts sample rates), or None."""
    try:
        devices, apis = query(), hostapis()
    except Exception:
        return None
    mme = next((i for i, api in enumerate(apis) if 'MME' in api.get('name', '')), None)
    matches = [(index, device) for index, device in enumerate(devices)
               if device.get('max_output_channels', 0) >= 2
               and any(name in device.get('name', '').lower() for name in CABLE_NAMES)]
    if not matches:
        return None
    index, device = next(((i, d) for i, d in matches if d.get('hostapi') == mme), matches[0])
    return {'index': index, 'name': device['name']}


class StreamingFeed:
    def __init__(self, device, samplerate, channels=2, stream_factory=sd.OutputStream):
        self.device, self.samplerate, self.channels = device, int(samplerate), channels
        self._factory = stream_factory
        self._blocks = collections.deque()
        self._buffered = 0
        self._lock = threading.Lock()
        self._stream = None
        self.error = ''
        self.dropped = 0

    def start(self):
        self._stream = self._factory(device=self.device, samplerate=self.samplerate, channels=self.channels,
                                     dtype='float32', callback=self._callback)
        self._stream.start()
        return self

    def push(self, samples):
        """Queue one captured block (frames x channels); never blocks."""
        if self._stream is None or self.error:
            return
        block = np.asarray(samples, dtype=np.float32)
        if block.ndim == 1:
            block = block[:, None]
        if block.shape[1] == 1 and self.channels == 2:
            block = np.repeat(block, 2, axis=1)
        block = block[:, :self.channels]
        limit = int(self.samplerate * MAX_BUFFER_SECONDS)
        with self._lock:
            self._blocks.append(block)
            self._buffered += len(block)
            while self._buffered > limit and len(self._blocks) > 1:
                self._buffered -= len(self._blocks.popleft())
                self.dropped += 1

    def _callback(self, output, frames, time_info, status):
        output.fill(0)
        filled = 0
        with self._lock:
            while filled < frames and self._blocks:
                block = self._blocks[0]
                take = min(frames - filled, len(block))
                output[filled:filled + take] = block[:take]
                filled += take
                if take == len(block):
                    self._blocks.popleft()
                else:
                    self._blocks[0] = block[take:]
                self._buffered -= take

    def stop(self):
        stream, self._stream = self._stream, None
        if stream is not None:
            try:
                stream.stop()
            finally:
                stream.close()
