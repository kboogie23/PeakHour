"""Experimental isolated metadata probe for local DJ media."""
import json,os,sys,tempfile
from pathlib import Path
from windows_audio_process import ffmpeg_popen_factory,DEVNULL,TimeoutExpired

SUPPORTED_MEDIA={'.mp3','.wav','.aiff','.aif','.flac','.aac','.m4a','.ogg','.mp4','.m4v','.mov','.avi','.vob','.mpg','.mpeg'}
class MediaProbeError(RuntimeError):pass

def probe_media(path, *, scratch_dir, timeout=20):
    file=Path(path)
    if not file.is_absolute() or file.suffix.lower() not in SUPPORTED_MEDIA:
        raise MediaProbeError('Choose a supported local media file')
    file=file.resolve(strict=True)
    if not file.is_file():raise MediaProbeError('Media file is unavailable')
    before=file.stat(); worker=Path(__file__).with_name('windows_media_worker.py').resolve(strict=True)
    runner=ffmpeg_popen_factory(sys.executable)
    with tempfile.TemporaryFile(dir=scratch_dir) as output:
        process=runner([sys.executable,'-I',str(worker),str(file)],stdin=DEVNULL,stdout=output,stderr=DEVNULL)
        try:
            try:code=process.wait(timeout=timeout)
            except TimeoutExpired:
                raise MediaProbeError('Media inspection timed out') from None
        finally:
            if process.poll() is None:process.kill();process.wait()
        length=output.tell()
        if length>65536:raise MediaProbeError('Media inspection result is too large')
        output.seek(0)
        try:result=json.loads(output.read().decode('utf-8'))
        except (ValueError,UnicodeError):raise MediaProbeError('Media inspection returned invalid data') from None
    after=file.stat()
    if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns):
        raise MediaProbeError('Media file changed during inspection')
    if code or not result.get('success'):raise MediaProbeError(result.get('error') or 'Media inspection failed')
    return result['media']
