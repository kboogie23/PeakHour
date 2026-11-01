"""Make a separate, playable copy of a partial WAV produced by WindowsInputCapture.

Only the prototype's canonical 44-byte PCM16 WAV layout is accepted; source
bytes are never changed. This is an experimental recovery utility.
"""
import os
import stat
import struct
from pathlib import Path

class RecoveryError(RuntimeError):
    pass

def recover_pcm16_partial(source, destination):
    source, destination = Path(source).absolute(), Path(destination).absolute()
    if source == destination or destination.suffix.lower() != '.wav':
        raise ValueError('Choose a separate WAV recovery filename')
    if source.is_symlink() or not source.is_file():
        raise RecoveryError('Partial recording must be a regular non-symlink file')
    with source.open('rb') as inp:
        before = os.fstat(inp.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise RecoveryError('Partial recording is not a regular file')
        header = inp.read(44)
        if len(header) != 44:
            raise RecoveryError('The WAV header is incomplete')
        riff, riff_size, wave, fmt, fmt_len, format_id, channels, rate, byte_rate, align, bits, data, data_size = struct.unpack('<4sI4s4sIHHIIHH4sI', header)
        if (riff, wave, fmt, data, fmt_len, format_id, bits) != (b'RIFF', b'WAVE', b'fmt ', b'data', 16, 1, 16):
            raise RecoveryError('Unsupported WAV layout; source was not changed')
        if channels not in (1, 2) or rate <= 0 or align != channels * 2 or byte_rate != rate * align:
            raise RecoveryError('WAV audio parameters are invalid')
        payload = before.st_size - 44
        if payload <= 0 or payload % align or payload > 0xffffffff - 36:
            raise RecoveryError('Audio data is empty, incomplete, or too large for RIFF')
        fixed = struct.pack('<4sI4s4sIHHIIHH4sI', riff, 36+payload, wave, fmt, fmt_len,
                            format_id, channels, rate, byte_rate, align, bits, data, payload)
        try:
            output = destination.open('xb')
        except FileExistsError:
            raise RecoveryError('Recovery destination already exists') from None
        try:
            with output:
                output.write(fixed)
                remaining = payload
                while remaining:
                    block = inp.read(min(1024*1024, remaining))
                    if not block:
                        raise RecoveryError('Source changed during recovery')
                    output.write(block); remaining -= len(block)
                after = os.fstat(inp.fileno())
                if (after.st_size, after.st_mtime_ns, after.st_ino) != (before.st_size, before.st_mtime_ns, before.st_ino):
                    raise RecoveryError('Source changed during recovery')
                output.flush(); os.fsync(output.fileno())
        except BaseException as exc:
            # Keep the new, possibly incomplete copy. Deleting by pathname
            # after a concurrent replacement could delete somebody else's file.
            raise RecoveryError('Recovery failed; an incomplete copy may remain at ' + str(destination)) from exc
    return {'path': str(destination), 'frames': payload // align, 'sample_rate': rate,
            'channels': channels, 'source_preserved': True}
