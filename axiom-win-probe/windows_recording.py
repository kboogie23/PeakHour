"""AXIOM set recording on Windows: controller/interface inputs (PortAudio) and DJ Software Audio
(one program's own output, through Windows process loopback), saved as WAV or MP3. With the
streaming feed on, the same audio also plays into a virtual audio cable (windows_feed)."""
import datetime
import json
import math
import os
import re
import subprocess
import time
import uuid
from pathlib import Path
import sounddevice as sd
from recording import SetRecordingManager, level_state
from windows_capture import WindowsInputCapture, CaptureError, sample_peak
from windows_loopback import ProcessLoopbackStream, running_applications
from windows_wav_recovery import recover_pcm16_partial
from windows_feed import find_cable, StreamingFeed
import windows_keep_awake

class WindowsRecordingManager(SetRecordingManager):
    def __init__(self, settings_path, desktop_dir, *, capture_factory=WindowsInputCapture, device_query=sd.query_devices,
                 host_query=sd.query_hostapis, ffmpeg=None, peak_sampler=sample_peak,
                 app_query=running_applications, app_stream_factory=ProcessLoopbackStream,
                 cable_finder=find_cable, feed_factory=StreamingFeed):
        super().__init__(settings_path, desktop_dir)
        self._ffmpeg = str(ffmpeg) if ffmpeg and os.path.isfile(ffmpeg) else None
        self._peak_sampler = peak_sampler
        self._app_query = app_query
        self._app_stream_factory = app_stream_factory
        self._capture_factory = capture_factory
        self._device_query = device_query
        self._host_query = host_query
        self._capture = None
        self._find_cable = cable_finder
        self._feed_factory = feed_factory
        self._feed = None
        self._finalizing = False  # True while a stopped take is being encoded to MP3 (the lock is free meanwhile)
        self._awake = None  # keeps Windows awake from the start of a take until it is saved (or fails)

    def _restore_state(self):
        # An interrupted WAV may have an unfinalized header. Keep its exact
        # bytes and never rename a path taken from an untrusted state file.
        state = self._idle_state()
        try:
            with open(self.state_path, encoding='utf-8') as handle:
                saved = json.load(handle)
            if not isinstance(saved, dict):
                raise ValueError('Invalid recording state')
            state.update(saved)
        except FileNotFoundError:
            return state
        except (OSError, ValueError, TypeError):
            state.update(status='failed', recording=False,
                         error='Recording state could not be read; existing files were left untouched.')
            return state
        if state.get('status') in ('recording', 'stopping'):
            recovery = ''
            try:
                output = Path(state.get('output_path') or '')
                partial = Path(state.get('temp_wav_path') or '')
                root = Path(self.desktop_dir).resolve(strict=True)
                if (output.is_absolute() and partial.is_absolute()
                    and partial == output.with_name(output.name + '.partial')
                    and partial.parent.resolve(strict=True) == root
                    and not partial.is_symlink() and partial.is_file()):
                    recovery = str(partial)
            except (OSError, ValueError, TypeError):
                pass
            state.update(status='failed', recording=False, started_monotonic=0.0,
                         saved_path='', recovery_path=recovery,
                         error='Recording was interrupted. The partial file was left untouched.' if recovery
                               else 'Recording was interrupted; no verified partial file was found.',
                         message='Recording interrupted')
            self._persist_state_payload(state)
        else:
            state.update(recording=False, started_monotonic=0.0)
        return state

    def _input_devices(self):
        hosts = self._host_query()
        devices = [dict(name=f"{d['name']} [{hosts[d['hostapi']]['name']}]", index=i,
                        input_channels=int(d['max_input_channels']), samplerate=int(d['default_samplerate']))
                   for i, d in enumerate(self._device_query()) if int(d['max_input_channels']) > 0]
        counts = {}
        for device in devices:
            key = device['name'].casefold()
            counts[key] = counts.get(key, 0) + 1
        for device in devices:
            device['ambiguous'] = counts[device['name'].casefold()] != 1
            if device['ambiguous']:
                device['name'] += f" [indistinguishable #{device['index']}]"
        return devices

    def devices(self, provider='auto'):
        devices = self._input_devices()
        return {'success': True, 'devices': devices, 'provider': provider or 'auto'}

    def applications(self, provider='auto'):
        """Open DJ programs whose own audio can be recorded (Windows process loopback)."""
        try:
            apps = self._app_query()
        except OSError as exc:
            return {'success': False, 'available': False, 'applications': [], 'provider': provider or 'auto',
                    'engine': 'windows-process-loopback', 'permission_required': False, 'error': str(exc)}
        return {'success': True, 'available': True, 'provider': provider or 'auto', 'engine': 'windows-process-loopback',
                'applications': [{'name': a['name'], 'bundle_id': a['bundle_id']} for a in apps],
                'permission_required': False, 'error': ''}

    def _application(self, provider, settings, source_id=''):
        """The running program to record: the one asked for, the saved choice, or one matching the provider."""
        apps = self._app_query()
        key = self._provider_key(provider)
        saved = (settings.get('application_bundle_ids') or {}).get(key, '')
        for wanted in (source_id, saved):
            match = next((a for a in apps if wanted and a['bundle_id'] == wanted), None)
            if match or source_id:
                return match, apps
        return next((a for a in apps if a['provider'] == key), apps[0] if apps else None), apps

    def _broadcast(self, settings):
        """AXIOM's Broadcast fields, for the virtual audio cable that carries the streaming feed."""
        cable = self._find_cable()
        return dict(broadcast_available=bool(cable), broadcast_enabled=bool(cable and settings.get('broadcast_enabled')),
                    broadcast_restart_required=False, broadcast_device_name=cable['name'] if cable else '')

    def _attach_feed(self, capture, samplerate, settings):
        """Start the streaming feed for this take when it is switched on; caller holds the lock."""
        self._feed = None
        if not settings.get('broadcast_enabled'):
            return
        cable = self._find_cable()
        if not cable:
            raise RuntimeError('The streaming feed needs a virtual audio cable such as VB-CABLE. Install one, or turn the feed off.')
        try:
            self._feed = self._feed_factory(cable['index'], samplerate).start()
        except Exception as exc:
            raise RuntimeError(f'The streaming feed could not open {cable["name"]}: {exc}') from exc
        capture.feed = self._feed.push

    def _stop_feed(self):
        feed, self._feed = self._feed, None
        if feed is not None:
            try:
                feed.stop()
            except Exception:
                pass

    def sources(self, provider='auto', source_mode=''):
        settings = self.load_settings()
        mode = source_mode or settings.get('source_mode', 'application')
        if mode == 'application':
            try:
                chosen, apps = self._application(provider or 'auto', settings)
                error = '' if chosen else f'Open {self._provider_label(self._provider_key(provider))} before recording its audio.'
            except OSError as exc:
                chosen, apps, error = None, [], str(exc)
            return dict(success=True, provider=provider or 'auto', source_mode=mode,
                        selected_source_id=chosen['bundle_id'] if chosen else '',
                        selected_source_label=chosen['name'] if chosen else '',
                        devices=self._input_devices(), ready=bool(chosen),
                        applications=[{'name': a['name'], 'bundle_id': a['bundle_id']} for a in apps],
                        capture_profile=None, calibration_required=False, permission_required=False,
                        **self._broadcast(settings),
                        format=settings.get('format', 'wav'), save_directory=self.desktop_dir, error=error)
        devices = self._input_devices()
        preferred = settings.get('device_names', {}).get(provider or 'auto', '') or settings.get('device_name', '')
        selected = next((d for d in devices if d['name'] == preferred), None)
        chosen = selected['name'] if selected and not selected['ambiguous'] else ''
        profile = self._capture_profile(selected, settings) if chosen else None
        return dict(success=True, provider=provider or 'auto', source_mode=mode,
                    selected_source_id=chosen if mode == 'device' else '', devices=devices,
                    applications=[], ready=bool(chosen) if mode == 'device' else False,
                    capture_profile=profile, calibration_required=bool(profile and not profile['confirmed']),
                    **self._broadcast(settings), format=settings.get('format', 'wav'),
                    save_directory=self.desktop_dir,
                    error='')

    def start(self, provider='', source_mode='', source_id=''):
        with self._lock:
            if self._capture is not None:
                raise RuntimeError('A recording is already active')
            if self._finalizing:
                raise RuntimeError('The previous recording is still being saved. Try again in a moment.')
            settings = self.load_settings()
            mode = source_mode or settings.get('source_mode', 'application')
            format = settings.get('format', 'wav')
            if format not in ('wav', 'mp3') or (format == 'mp3' and not self._ffmpeg):
                raise RuntimeError('MP3 recording needs FFmpeg; select WAV.')
            if mode == 'application':
                return self._start_application(provider, source_id, settings, format)
            if mode != 'device':
                raise RuntimeError('Choose DJ Software Audio or Controller / Interface.')
            device = next((d for d in self._input_devices() if d['name'] == source_id), None)
            if device is None:
                raise RuntimeError('The selected audio input is no longer available.')
            if device['ambiguous']:
                raise RuntimeError('Multiple inputs have the same name. Choose a uniquely identifiable device.')
            if device['input_channels'] < 2:
                raise RuntimeError('Choose a stereo input with at least two channels.')
            profile = self._capture_profile(device, settings)
            if not profile['confirmed']:
                raise RuntimeError('Confirm the controller input channel pair before recording.')
            left, right = profile['left_channel'], profile['right_channel']
            try:
                channels = (int(left), int(right))
            except (TypeError, ValueError):
                raise RuntimeError('Invalid input channel selection.')
            if min(channels) < 0 or max(channels) >= device['input_channels'] or channels[0] == channels[1]:
                raise RuntimeError('Selected input channels are unavailable.')
            os.makedirs(self.desktop_dir, exist_ok=True)
            stamp = datetime.datetime.now().strftime('%Y-%m-%d %H-%M-%S')
            output = os.path.join(self.desktop_dir, f'PEAK HOUR Set {stamp} {uuid.uuid4().hex[:8]}.wav')
            capture = self._capture_factory()
            try:
                self._attach_feed(capture, device['samplerate'], settings)
                current = next((d for d in self._input_devices() if d['name'] == source_id), None)
                if current != device:
                    raise RuntimeError('Audio inputs changed. Select the input again.')
                capture.start(output, device=device['index'], samplerate=device['samplerate'],
                              channels=channels, input_channels=max(channels)+1,
                              gain_db=settings.get('record_gain_db', 0))
            except Exception as exc:
                self._stop_feed()
                info = capture.status()
                partial = info.get('partial_path', '')
                self._state = self._idle_state()
                self._state.update(status='failed', recording=False, error=str(exc),
                                   output_path=output, temp_wav_path=partial,
                                   recovery_path=partial if partial and os.path.isfile(partial) else '',
                                   message='Recording could not start')
                self._persist_state()
                raise RuntimeError('Could not start input recording: ' + str(exc)) from exc
            self._capture = capture
            self._keep_awake()
            self._state = self._idle_state()
            self._state.update(status='recording', recording=True, started_at=datetime.datetime.now().astimezone().isoformat(),
                               started_monotonic=time.monotonic(), source_mode='device', source_id=source_id,
                               source_label=source_id, device_name=source_id, engine='windows-portaudio',
                               format=format, output_path=output, temp_wav_path=output+'.partial', message='Recording')
            self._persist_state()
            return self.status()

    def _app_capture_factory(self, pid):
        return WindowsInputCapture(stream_factory=lambda **options: self._app_stream_factory(pid, **options))

    def _start_application(self, provider, source_id, settings, format):
        """Record one DJ program's own output (process loopback); caller holds the lock."""
        try:
            app, _ = self._application(provider or settings.get('provider', 'auto'), settings, source_id)
        except OSError as exc:
            raise RuntimeError(str(exc)) from exc
        if app is None:
            raise RuntimeError(f'Open {self._provider_label(self._provider_key(provider))} before recording its audio.')
        os.makedirs(self.desktop_dir, exist_ok=True)
        stamp = datetime.datetime.now().strftime('%Y-%m-%d %H-%M-%S')
        output = os.path.join(self.desktop_dir, f'PEAK HOUR Set {stamp} {uuid.uuid4().hex[:8]}.wav')
        capture = self._app_capture_factory(app['pid'])
        try:
            self._attach_feed(capture, 48000, settings)
            capture.start(output, device=None, samplerate=48000, channels=(0, 1), input_channels=2,
                          gain_db=settings.get('record_gain_db', 0))
        except Exception as exc:
            self._stop_feed()
            info = capture.status()
            partial = info.get('partial_path', '')
            self._state = self._idle_state()
            self._state.update(status='failed', recording=False, error=str(exc), output_path=output,
                               temp_wav_path=partial, recovery_path=partial if partial and os.path.isfile(partial) else '',
                               message='Recording could not start')
            self._persist_state()
            raise RuntimeError(f'Could not record {app["name"]}: {exc}') from exc
        self._capture = capture
        self._keep_awake()
        self._state = self._idle_state()
        self._state.update(status='recording', recording=True, started_at=datetime.datetime.now().astimezone().isoformat(),
                           started_monotonic=time.monotonic(), source_mode='application', source_id=app['bundle_id'],
                           source_label=app['name'], device_name=app['name'], engine='windows-process-loopback',
                           format=format, output_path=output, temp_wav_path=output + '.partial', message='Recording')
        self._persist_state()
        return self.status()

    def status(self):
        with self._lock:
            state = dict(self._state)
            if self._capture is not None:
                info = self._capture.status()
                peak = info['peak']
                db = 20 * math.log10(peak) if peak > 0 else -120.0
                level = level_state(db)
                state.update(elapsed_seconds=int(info['seconds']), peak_dbfs=level['dbfs'],
                             signal_level=level['level'], signal=level['signal'], signal_label=level['label'])
                state.update(dropouts=info.get('dropouts', 0))
                if info['error']:
                    state.update(error=info['error'], message='Recording input error; stop to save what was recorded')
                elif info.get('limit_reached'):
                    state.update(error=info['warning'], message='Recording is full; stop to save it')
            state.pop('started_monotonic', None)
            state.update(ffmpeg_available=bool(self._ffmpeg), system_audio_available=True, save_directory=self.desktop_dir)
            return state

    def _keep_awake(self):
        if self._awake is None:
            self._awake = windows_keep_awake.hold('Recording a set', max_age=24 * 3600)  # an all-night set

    def _let_sleep(self):
        awake, self._awake = self._awake, None
        if awake is not None:
            windows_keep_awake.release(awake)

    def stop(self):
        try:
            return self._stop()
        finally:
            with self._lock:  # a start() in between must keep its own hold
                if self._capture is None:  # saved, failed, or the MP3 encode is done: Windows may sleep again
                    self._let_sleep()

    def _stop(self):
        with self._lock:
            if self._capture is None:
                raise RuntimeError('No recording is active')
            capture, self._capture = self._capture, None
            info = capture.status()
            try:
                saved = capture.stop()
            except Exception as exc:
                self._stop_feed()
                self._state.update(status='failed', recording=False, error=str(exc),
                                   recovery_path=info.get('partial_path', ''), message='Recording could not be finalized')
                self._persist_state()
                raise RuntimeError(str(exc)) from exc
            self._stop_feed()
            info = capture.status()
            dropouts = info.get('dropouts', 0)
            message, error, format = 'Recording saved', '', 'wav'
            if dropouts:
                message = f'Recording saved with {dropouts} short dropout{"" if dropouts == 1 else "s"}'
            if info.get('error') or info.get('limit_reached'):  # saved, but the take ended early
                error = (info.get('error') or info['warning']) + '; the audio recorded up to then was saved.'
            if self._state.get('format') != 'mp3':
                self._state.update(status='saved', recording=False, saved_path=saved, format=format, dropouts=dropouts,
                                   elapsed_seconds=int(info['seconds']), message=message, error=error)
                self._persist_state()
                return self.status()
            # The encode can take many minutes: let status() polls through while it runs.
            self._finalizing = True
            # Saved on disk first as a finished WAV, so a crash during the encode is not "interrupted".
            self._state.update(status='saved', recording=False, saved_path=saved, format='wav', dropouts=dropouts,
                               elapsed_seconds=int(info['seconds']), message='Encoding MP3', error=error)
            self._persist_state()
            self._state.update(status='stopping')
        try:
            try:
                saved, format = self._encode_mp3(saved), 'mp3'
            except Exception as exc:
                message, error = ('Recording saved as WAV',
                                  (error + ' ' if error else '') + 'MP3 encoding failed; the WAV was kept: ' + str(exc))
        finally:
            with self._lock:
                self._finalizing = False
        with self._lock:
            self._state.update(status='saved', recording=False, saved_path=saved, format=format,
                               message=message, error=error)
            self._persist_state()
            return self.status()

    def stop_if_recording(self, wait_seconds=1800):
        """Finish a take that is still running (the window closed); None when nothing was recording.
        Waits for an MP3 encode that is already under way."""
        deadline = time.monotonic() + wait_seconds
        while True:
            with self._lock:  # a stop already running holds the lock until it has set _finalizing
                if not self._finalizing:
                    if self._capture is None:
                        return None
                    break
            if time.monotonic() >= deadline:
                raise RuntimeError('The recording was still being saved when the wait ended.')
            time.sleep(0.2)
        return self.stop()

    def test_input(self, provider='', source_mode='', source_id='', left_channel=None, right_channel=None):
        """Listen to the chosen input for three seconds without creating an audio file."""
        settings = self.load_settings()
        provider_key = self._provider_key(provider or settings.get('provider', 'auto'))
        mode = source_mode or settings.get('source_mode', 'application')
        with self._lock:
            if self._capture is not None:
                raise RuntimeError('Stop the recording before testing the input.')
        if mode == 'application':
            try:
                app, _ = self._application(provider_key, settings, source_id)
            except OSError as exc:
                raise RuntimeError(str(exc)) from exc
            if app is None:
                raise RuntimeError(f'Open {self._provider_label(provider_key)}, play audio, then test again.')
            try:
                dbfs = self._peak_sampler(device=None, samplerate=48000, channels=(0, 1), input_channels=2, seconds=3.0,
                                          gain_db=settings.get('record_gain_db', 0),
                                          stream_factory=lambda **kw: self._app_stream_factory(app['pid'], **kw))
            except Exception as exc:
                raise RuntimeError(f'Could not test {app["name"]}: {exc}') from exc
            meter = level_state(dbfs if math.isfinite(dbfs) else -120.0)
            self._clear_failure_after_successful_test()
            return {'success': True, 'device_name': app['name'], 'source_label': app['name'],
                    'source_mode': 'application', 'provider': provider_key, 'signal': meter,
                    'message': meter['label'], 'error': '', 'source_audio_untouched': True}
        if mode != 'device':
            raise RuntimeError('Choose DJ Software Audio or Controller / Interface.')
        device = next((d for d in self._input_devices() if d['name'] == source_id), None)
        if device is None:
            raise RuntimeError('The selected audio input is no longer available.')
        if device['ambiguous']:
            raise RuntimeError('Multiple inputs have the same name. Choose a uniquely identifiable device.')
        profile = self._capture_profile(device, settings)
        pair_confirmed = bool(profile['confirmed'])
        if left_channel is not None or right_channel is not None:
            try:
                left, right = int(left_channel), int(right_channel)
            except (TypeError, ValueError):
                raise RuntimeError('Choose a valid input channel pair.')
            if left != profile['left_channel'] or right != profile['right_channel']:
                pair_confirmed = False
        else:
            left, right = int(profile['left_channel']), int(profile['right_channel'])
        if min(left, right) < 0 or max(left, right) >= device['input_channels'] or left == right:
            raise RuntimeError('That channel pair is not available on this input.')
        try:
            dbfs = self._peak_sampler(device=device['index'], samplerate=device['samplerate'], channels=(left, right),
                                      input_channels=max(left, right) + 1, seconds=3.0,
                                      gain_db=settings.get('record_gain_db', 0))
        except Exception as exc:
            raise RuntimeError('Could not test the input: ' + str(exc)) from exc
        meter = level_state(dbfs if math.isfinite(dbfs) else -120.0)
        self._clear_failure_after_successful_test()
        return {'success': True, 'device_name': device['name'], 'source_label': device['name'],
                'source_mode': 'device', 'provider': provider_key, 'device_key': profile.get('device_key', ''),
                'left_channel': left, 'right_channel': right,
                'capture_channel_label': f'Channels {left + 1}/{right + 1}', 'pair_confirmed': pair_confirmed,
                'controller_setup': '', 'controller_setup_ready': False,
                'signal': meter, 'message': meter['label'], 'error': '', 'source_audio_untouched': True}

    def _encode_mp3(self, wav):
        """MP3 recording: the take is captured as WAV, then encoded; the WAV is removed only after success."""
        bitrate = str(self.load_settings().get('mp3_bitrate') or '320k')
        if not re.fullmatch(r'(128|160|192|256|320)k', bitrate):
            bitrate = '320k'
        target = Path(wav).with_suffix('.mp3')
        partial = target.with_name(target.stem + '.partial.mp3')
        result = subprocess.run([self._ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-n', '-i', wav,
                                 '-c:a', 'libmp3lame', '-b:a', bitrate, str(partial)],
                                capture_output=True, text=True, creationflags=0x08000000, timeout=1800)
        if result.returncode or not partial.is_file() or not partial.stat().st_size or target.exists():
            partial.unlink(missing_ok=True)
            raise RuntimeError(result.stderr.strip()[-300:] or 'MP3 encoding failed')
        os.rename(partial, target)
        os.remove(wav)
        return str(target)

    def recover_interrupted(self, destination):
        """Create a new recovery copy only after an explicit caller request."""
        with self._lock:
            if self._capture is not None or self._state.get('status') != 'failed':
                raise RuntimeError('No interrupted recording is available for recovery.')
            source = Path(self._state.get('recovery_path') or '')
            output = Path(self._state.get('output_path') or '')
            target = Path(destination)
            try:
                root = Path(self.desktop_dir).resolve(strict=True)
                allowed = (source.is_absolute() and output.is_absolute() and target.is_absolute()
                           and source == output.with_name(output.name + '.partial')
                           and source.parent.resolve(strict=True) == root
                           and target.parent.resolve(strict=True) == root
                           and not source.is_symlink())
            except (OSError, ValueError):
                allowed = False
            if not allowed:
                raise RuntimeError('Recovery paths must be inside the recording folder.')
            return recover_pcm16_partial(source, target)

    def _saved_recording(self):
        with self._lock:
            saved = self._state.get('saved_path') or ''
        try:
            inside = bool(saved) and Path(saved).resolve(strict=True).parent == Path(self.desktop_dir).resolve(strict=True)
        except OSError:
            inside = False
        if not inside or not os.path.isfile(saved):
            raise RuntimeError('No saved recording is available.')
        return saved

    def reveal_saved(self):
        from windows_apps import reveal_file
        saved = self._saved_recording()
        reveal_file(saved)
        return {'success': True, 'saved_path': saved, 'message': 'Opened in File Explorer'}

    def play_saved(self):
        saved = self._saved_recording()
        os.startfile(saved)  # the user's default player for WAV files
        return {'success': True, 'saved_path': saved, 'message': 'Opened recording'}
