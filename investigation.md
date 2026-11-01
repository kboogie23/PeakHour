# AXIOM PRO investigation ledger

Target: `C:\Users\Dgatling\Downloads\AXIOM_1.0.5_PRO.pkg`.
SHA-256: `60a63b77cedf609f5a49fb709eeef8776196b7a9ad090de87e870d6249188fa9`.

## Observations
- REA package inspection `ev_35cb8c132c0e22aeae1ff7e71ae280b414bc0053e156292898fb2e2386d1bbdb` identified PKG but cannot inventory its children on Windows. The XAR table was inspected independently; the archived SHA-1 of PackageInfo, Scripts, Payload and Bom matched. The gzip/CPIO payload was extracted without execution to `work/axiom_extracted`. Symlinks and other non-regular objects were deliberately not recreated, so this is not a runnable faithful bundle.
- Bundle Info.plist identifies AXIOM PRO 1.0.5, build 20261016_1522; executable AXIOM DJ is ARM64 Mach-O, SHA-256 `f0876f6fe5e3bf49e8c6beb1f021408aedbeec24297bea474cd085f7fc2bd727`.
- REA inspection `ev_9dede6b4c7ed799653b79d8d9a3e01556f59b5d1c9ec3661b9d1f5e202c87ed9` identifies a PyInstaller archive targeting Python 3.12; complete container inventory has 2805 regular entries and no reported integrity mismatches. REA extraction `ev_6e2956bf5294543816a58f3de90273601a47c51ea8c40f2612b1f4d9382156bf` materialized 2804 files; extracted bytecode uses reconstructed headers and is saved in `work/axiom_bytecode`.
- REA Python bytecode inspection `ev_723a2e257b9b0c2f9b116801e7f8275a40504b989326aebd6eff8dfd97d33b80` recorded 1,192 code objects in app.pyc; analysis reports code identity and metadata, not source or runtime behavior.
- Bundle contains web templates/static assets, Flask, macOS frameworks, native audio helpers and third-party audio/ML dependencies. `axiom_build.json` claims library preparation, saved playlists, Serato/djay exports, live assistance, Health, Performance and Studio DAW, among other functions; these are product claims requiring implementation and runtime verification, not verified behavior.
- Packaged release metadata describes trial/subscription/account and engine entitlements. Do not assume a Windows reproduction can reuse or bypass the provider's services or activation; determine legitimate access and design from evidence.

## Remaining work
- Build a feature-by-feature inventory from actual templates, code-object metadata and bundled files, tracing API routes and behavior. Investigate Mac-specific dependencies and platform boundaries, file formats, device/audio routing and data safety.
- Determine which backend logic can be lawfully and technically reused or reimplemented, and which external services or hardware are required. Verify behavior against the original using a Mac where static evidence is insufficient.
- Implement the complete Windows x64 application and verify each feature, round-trip compatibility, audio behavior and safe data handling. No Windows application has been built or tested yet.

## Windows compatibility probe (2026-10-30)
- Installed CPython 3.12.15 x64 and Windows dependencies in workspace-local environments. `work/stage_probe.py` stages 126 matching application modules from the packaged source manifest and the shipped web resources; four manifest source entries were not present in the extracted bytecode. It is an experimental probe, not a distribution.
- Static CPython disassembly and module/route inventory are in `work/bytecode_inventory`. Source manifest records hashes, not source code. Routes and function names do not by themselves establish working behavior.
- `work/probe_startup.py` restricts outbound connections and subprocess execution, points user data to `work/probe-home`, and imports the backend. It registered 269 routes; Flask test client returned HTTP 200 for `/`, `/api/app/version`, `/api/license/status`, `/api/account/status`, `/api/library/folders`, and `/api/library/stats`. These are empty-profile smoke tests, not feature parity. Licensing reports guest preview; no entitlement checks have been altered.
- `work/axiom-win-probe/fcntl.py` provides an experimental Windows LockFileEx adapter. `work/test_flock.py` passed cross-process exclusive/shared contention and release checks. Windows path safety, reentrancy, process crash recovery, and real application write workflows remain unverified. POSIX O_NOFOLLOW and directory-sync semantics have no automatic equivalent and must not be assumed.
- `pwd.py` and `resource.py` are explicit unsupported-operation stubs in the probe. Audio playback/capture, native UI, keychain, source selection, sidecars, plugins, stem processing, safe export, and software-specific paths are not yet adapted or verified. Network and child-process restrictions used during probing must be reconsidered deliberately for each feature; do not claim they represent normal runtime behavior.

## Windows scan and preview experiments (2026-10-30)
- `work/probe_scanner.py` creates an isolated one-second WAV and uses the original scanner to scan it, reload the cache, find the track, rescan with a stable ID, and check its SHA-256 remains unchanged. Passed on Windows using the experimental lock adapter. This is a one-file synthetic test, not evidence for all formats, metadata, path layouts or a real library.
- `work/axiom-win-probe/windows_audio.py` supplies a preliminary soundfile/PortAudio preview deck with play, pause, resume, seek, volume and completion. `work/test_windows_audio.py` verified it with a two-second silent WAV on the default Windows audio output. `work/probe_audio_routes.py` injected it only into an isolated test process and exercised the original play/pause/seek/resume/stop HTTP endpoints successfully. No licensing code was changed.
- Audio limitations: the reported position is based on frames delivered to the output buffer rather than measured audible latency; compressed formats depend on libsndfile, channel and sample-rate compatibility depend on the device, and device switching, fault recovery, timing, real tracks, concurrency and DAW playback are not established. The adapter is not integrated into a user-facing launcher and does not implement recording, stems, plugin processing or live DJ application audio capture.

## Windows UI and source-selection experiments (2026-10-30)
- `work/probe_server.py` served the backend on loopback with outbound socket/subprocess calls and non-read HTTP requests blocked; in-app browser inspection showed the original entrance, guest-access dialog, navigation, and Connect Your Music screen. Its 403 write policy and offline CSP deliberately limit the test, so this does not demonstrate a normal working application. The temporary server and tab were closed.
- Original `utils.path_ops.is_safe_location` recognizes the home directory and macOS `/Volumes`/`/Users` paths, not general Windows drive paths. `work/axiom-win-probe/windows_paths.py` implements preliminary Windows local fixed/removable drive admission, disallows drive roots, configured protected system folders, non-existent and network paths, and resolves paths before checking. `work/test_windows_paths.py` passes bounded synthetic checks. This path validation is not race-resistant and does not make file write operations safe against junction/reparse changes; network drives are unsupported in this prototype.
- `work/axiom-win-probe/windows_dialogs.py` provides native Tk folder and Serato file selectors with cancel/error cleanup; mocked dialog tests pass. `work/probe_picker_routes.py` injected these adapters into an isolated process and verified original Serato picker route success and cancel using a disposable empty fixture. Actual Windows dialog interaction and real Serato parsing/export have not been tested; no user data or real library was accessed.

## Windows recording primitive (2026-10-30)
- Static inspection of `recording.pyc` shows the original SetRecordingManager invokes a macOS-specific system-audio helper and handles device and per-application sources, settings, WAV/MP3 output, monitoring and recovery. Its complete behavior remains to be mapped and reproduced.
- `work/axiom-win-probe/windows_capture.py` implements an experimental sounddevice input stream primitive with user-selected channel(s), gain, bounded producer queue, WAV writing, exclusive partial creation, and final rename. It reports input overflow, non-finite audio, a stopped input, and write failures, leaving partial files for recovery. It is not yet wired into AXIOM's recording manager or exposed as a finished product. Per-application/system loopback, MP3, device selection UI, live metering, Windows permissions, actual hardware, crash recovery and long recording validation remain untested or unimplemented.
- `work/test_windows_capture.py` uses a fake input stream and generated PCM to validate selected stereo channel order, sample count and WAV format, refusal to overwrite, overflow and stopped-device partial retention. No microphone, controller, live system audio, or user music was accessed. This test does not establish audio hardware compatibility or real-time reliability.

## Recording API integration experiment (2026-10-30)
- `work/axiom-win-probe/windows_recording.py` adapts AXIOM's original recording-manager interface to the experimental Windows input capture primitive. It lists input devices, preserves the original settings and multichannel confirmation contract, handles zero-based selected channels, exposes recording/level status, and refuses unsupported application capture, MP3, Broadcast and unconfirmed multichannel input rather than reporting them as working. It is injected only into isolated tests and has not been integrated into a distributable launch.
- `work/probe_recording_routes.py` exercises original source/start/status/stop Flask endpoints with a simulated four-channel device, checks rejection before pair confirmation, confirms channels 3/4 using the original settings format, and verifies resulting WAV samples and order. Synthetic testing passes; no actual audio input was opened. Device IDs and format support, sustained capture, crash handling, simultaneous requests, permissions, system/application capture and actual controller hardware remain unverified. Device name/index stability needs improvement before everyday use.

## Recording failure handling (2026-10-30)
- Windows manager now preserves a partial file and reports failed state on input-start failure, overflow/stop failure, or an interrupted state on next initialization. Unlike the original macOS restoration, the Windows adapter does not automatically move or rewrite the partial WAV; it only reports a verified in-output-directory partial path. The file may have an incomplete WAV header and has not been proved playable or repaired.
- `work/test_windows_recording_recovery.py` simulates interrupted state and input-start failure, checks the partial remains unchanged, and checks a state file pointing outside the output folder cannot cause that file to be moved. `work/probe_recording_routes.py` verifies simulated overflow produces an unsuccessful stop and failed status with a retained partial. Actual process termination, storage failures, path races and hardware disconnects have not been tested.

## Explicit WAV recovery experiment (2026-10-30)
- `work/axiom-win-probe/windows_wav_recovery.py` creates a separate exclusive recovery copy from the exact canonical PCM16 WAV layout produced by the Windows capture prototype. It validates header/channel/rate/alignment/size, derives RIFF and data sizes from bytes actually present, verifies the opened source did not change during copying, syncs the new file and leaves the original partial unchanged. It rejects unsupported or malformed layouts and existing destinations. An interrupted recovery may leave an incomplete new copy; it does not delete by pathname after an error.
- `WindowsRecordingManager.recover_interrupted` provides an explicit internal call constrained to its recording folder and the expected partial name; it is not yet exposed in the application UI. `work/test_windows_wav_recovery.py` terminates a child process with `os._exit` while using a fake input stream, reopens the saved interrupted manager state, invokes recovery, verifies a playable WAV and PCM values, and checks original partial hash and no-overwrite/invalid-input behavior. The test verifies surviving bytes, not that every captured frame survives buffering or sudden power loss. Actual hardware, race-resistant Windows handle confinement and arbitrary WAV formats are not established.

## Combined Windows bootstrap (2026-10-30)
- `work/axiom-win-probe/windows_bootstrap.py` assembles Windows path admission, folder/file dialogs, preview audio and recording manager around the original backend without changing access/licensing checks or starting a server. It requires caller-provided recording and settings directories and remains an experimental internal bootstrap.
- `work/probe_combined.py` runs all adapters in one isolated backend process: original UI response and guest tier, synthetic scan/cache, silent preview through original routes, mocked Serato selector, and simulated capture through original recording routes. Source WAV hash was unchanged. The actual browser/server test remains read-only.
- Updated `work/probe_server.py` to use the combined bootstrap. A live loopback HTTP check returned 200 for the main page, version and recording-source discovery; the Windows input-device enumeration returned 13 entries without opening a device. The read-only guard returned 403 for recording-start POST; the server was stopped. This establishes only wiring and device enumeration, not hardware recording, full functionality, robust isolation or a production launcher.

## Studio DAW MIDI investigation (2026-10-30)
- The shipped `studio_daw/midi.pyc` provides a cross-platform RtMidi bridge and same-origin/token-protected Flask endpoints. Added `python-rtmidi==1.5.8` to the workspace Windows Python environment; the native Windows backend initialized and listed one input without opening or reading a MIDI device.
- `work/test_windows_midi.py` exercises the original MIDI blueprint with a simulated port: connect, open, note-on/note-off delivery, token rejection, stop, and duplicate-device-name rejection pass. This preserves the original authorization and avoids touching a real controller. Real MIDI input, latency, hot-plug, Web MIDI integration, multi-controller behavior and DAW recording remain unverified.
- `work/requirements-windows-probe.txt` records the current development environment package versions for reproducibility; it is not a tested distribution lockfile.

## Windows waveform preparation experiment (2026-10-30)
- Installed `imageio-ffmpeg==0.7.0` into the workspace-only environment for a Windows FFmpeg binary. `work/axiom-win-probe/windows_audio_process.py` implements a narrowly scoped, experimental subprocess interface limited to a configured executable; it is not installed into the application bootstrap and does not provide the original macOS sidecar's process-tree ownership, resource limits or sandbox guarantees. It deliberately rejects descriptor-based access. The binary's licensing and redistribution terms must be assessed before any distribution.
- `work/test_windows_waveform.py` runs the shipped waveform decoder against a generated WAV and checks output and unchanged source. `work/test_windows_waveform_api.py` exercises the original waveform Flask blueprint with a synthetic file: decoding, cache reuse, same-origin rejection and unchanged source passed. The test must close Flask streamed responses on Windows before temporary files can be removed; this does not establish actual browser response lifetime or cache eviction behavior. `work/test_windows_audio_process.py` checks termination of a synthetic FFmpeg process and rejection of unsupported descriptor access.
- These tests run with fixture-scoped paths. The adapter lacks a Windows Job Object, process/resource confinement and full cancellation coverage; it must not be treated as a production replacement. Time stretch, stems, plugin processing and normal user-facing DAW playback remain incomplete.

## Windows audio process ownership experiment (2026-10-30)
- `work/axiom-win-probe/windows_job.py` creates a Windows Job Object with kill-on-close, and the experimental FFmpeg adapter assigns its child process to it, fails and terminates the process if assignment fails, and terminates/closes the job on cancellation or process completion. Microsoft documents job and child-job cleanup at https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects .
- `work/test_windows_job_tree.py` uses controlled Python parent/child processes to confirm job termination stops both; `work/test_windows_job_owner.py` confirms a controlled helper exits after its owner calls `os._exit`. Original waveform and FFmpeg tests still pass. These are synthetic process tests; they do not establish equivalent macOS sidecar resource limits or sandboxing.
- Assignment happens after process creation, leaving a pre-assignment race. Process identity verification, atomic suspended startup/job assignment, limits, network/file confinement, output pipe handling and complete cancellation scenarios remain unresolved. The adapter remains excluded from the normal bootstrap and should not be treated as production-ready.

## Suspended Windows helper startup (2026-10-30)
- The experimental process adapter now creates its helper with `CREATE_SUSPENDED`, assigns it to the kill-on-close Job Object, locates and validates the single initial thread via a Windows thread snapshot, and resumes it only after successful assignment. Windows Tool Help thread enumeration is documented at https://learn.microsoft.com/en-us/windows/win32/api/tlhelp32/nf-tlhelp32-thread32first . Assignment and resume failure terminate and wait for the created process.
- `work/test_windows_suspended_job.py` verifies controlled helper code cannot execute before assignment and does not execute when assignment or resume is forced to fail. Existing process-tree, owner-exit, FFmpeg termination and waveform API tests pass. This is not atomic creation in the job: if the owner dies in the narrow interval after creating the suspended child but before assignment, a suspended orphan may remain. Snapshot enumeration and thread identity remain subject to OS behavior; no production security sandbox, resource limits or network/file confinement is provided. The adapter remains excluded from the normal bootstrap.

## Windows Serato path and crate investigation (2026-10-30)
- Static inspection of the original `_serato_relpath_to_absolute_path` shows it strips an explicit Windows drive prefix, making it unsuitable for Windows libraries. `work/axiom-win-probe/windows_serato_paths.py` resolves a volume-relative path only when a local Serato root volume is supplied, preserves explicit drive paths, and rejects traversal, ambiguous drive-relative paths, UNC/device paths and cross-volume relative crate writing. It is an experimental helper and is not installed into the normal bootstrap; these rejection choices leave network and multi-drive workflows incomplete.
- Matched the packaged `serato-tools==4.0.1` in the development environment. `work/probe_serato_crate.py` exercises AXIOM's original atomic crate writer and library parser on a disposable synthetic crate, verifies order and Unicode path round trip using the Windows resolver, and checks source audio hashes. `work/test_windows_serato_paths.py` checks bounded path cases. No real Serato library was read or changed; this does not establish Serato DJ software acceptance, modern database behavior, concurrent update safety, drive-remapping, network volumes or export rollback.
- The original write path contains macOS-specific running-process checks. Do not enable real Windows Serato writes until Windows process detection, safe file handling and application-level compatibility are verified.

## Windows Serato process preflight (2026-10-30)
- `work/axiom-win-probe/windows_serato_processes.py` enumerates a Windows Tool Help process snapshot, matches exact case-insensitive names for Serato DJ Pro, DJ Lite and Serato Studio, and refuses a guarded write when one is detected or enumeration fails. Serato documents these executable names at https://support.serato.com/hc/en-us/articles/360004267516-Troubleshooting-sign-in-activation . No process is terminated by this code.
- `work/test_windows_serato_processes.py` checks the real snapshot includes the test process, known-name matching and fail-closed errors. `work/test_windows_serato_live_process.py` launches and stops an owned disposable program named `Serato DJ Pro.exe` and confirms detection. The synthetic crate test checks the guard prevents the original crate writer from being called for a simulated running process.
- This is a preflight, not an interprocess lock: Serato can start after the snapshot, alternate executable names and related programs may not be recognized, and snapshots do not establish exclusive database access. It is not wired into the normal bootstrap and real Serato writes remain unverified. A robust concurrency/backup design and tests with actual Serato are still required.

## New-crate publication experiment (2026-10-30)
- `work/axiom-win-probe/windows_crate_publish.py` is a fixture-only prototype for creating a new legacy volume-relative crate: it prepares original Serato crate bytes in a same-directory exclusive temporary file, reparses and verifies ordered paths, rechecks source file identity and known Serato process names, then publishes via a no-overwrite hard link. Existing crates, cross-volume inputs, duplicate tracks, UNC locations and modern database updates are intentionally not implemented. It is not wired into the application bootstrap.
- `work/test_windows_crate_publish.py` verifies a disposable new crate, ordered paths and source hashes; it rejects existing destinations, simulated running Serato, duplicate tracks, a destination appearing just before commit, and a track changing during preparation. This does not establish compatibility with Serato software, guarantee exclusive access, or protect against adversarial directory/junction races. Hard-link support depends on the filesystem. A process can start or a source can change after preflight; actual library writes remain unverified.

## Windows preview formats (2026-10-30)
- `work/axiom-win-probe/windows_audio.py` now tries libsndfile first and, for local M4A/AAC/MP4 containers that libsndfile rejects, uses the experimental FFmpeg process adapter to decode a temporary stereo PCM WAV. The fallback applies a local-file protocol whitelist, 120-second decode deadline and a 1 GiB output cap with a conservative near-limit rejection, checks source stat identity before/after, and removes its temporary copy on stop or error. This is not a security sandbox, source identity is not a full content hash, and max-size/error/cancellation behavior needs more testing. The FFmpeg redistribution/licensing question remains open.
- `work/test_windows_audio_formats.py` creates one-second silent MP3, M4A/AAC, raw AAC, FLAC, AIFF and Ogg fixtures, checks preview starts on the current Windows output, checks source SHA-256 remains unchanged and verifies cache cleanup, including an invalid M4A case. Existing WAV audio and combined-bootstrap tests pass. These synthetic tests do not prove all codecs, metadata variants, long tracks, device format combinations, real-time accuracy, concurrent operations or real music playback.

## Windows preview concurrency (2026-10-30)
- `windows_audio.py` now serializes stream transitions and cancels a pending decode when Stop or a newer play request arrives. FFmpeg waiting checks cancellation periodically and terminates a still-running owned process before temporary cleanup. An older decode is checked again before it can attach an output stream.
- `work/test_windows_audio_concurrency.py` uses delayed synthetic opens and a fake output stream to verify Stop and newer selections prevent stale playback. `work/test_windows_audio_decode_cancel.py` uses a simulated stalled decoder to verify cancellation, termination and temporary cleanup. Existing format and original audio-route tests pass. This does not yet prove responsiveness with a real stalled FFmpeg, hardware device failure, concurrent seek/pause, accurate device latency or extended playback.

## Windows input-device identity (2026-10-30)
- `windows_recording.py` now identifies inputs by device name plus host API rather than persisting transient PortAudio numeric indices. It rejects indistinguishable duplicate names on the same host API and re-enumerates immediately before opening the selected index. This changes the experimental prototype's saved selection names; old index-based selections require reselection.
- `work/test_windows_recording_device_identity.py` uses simulated reordering, duplicates and a mid-start change to verify index re-resolution or rejection. Original recording-route and combined tests pass. A read-only enumeration of actual Windows inputs was performed without opening any device.
- Names are not persistent hardware identifiers: two different devices can use the same name at different times, and enumeration can change after the final check. A real Windows endpoint-identity adapter and actual hardware/hot-plug testing are still needed; the check is not a guarantee against all wrong-device capture.

## Expanded user requirements (2026-10-30)
- User explicitly requires Windows compatibility with Serato, VirtualDJ, and Algoriddim djay Pro, including MP3 and video media such as AVI, MP4 and VOB. User chose in-app video preview only; a separate venue/full-screen output is not required. Preserve original source media and paths and support the requested DJ workflows; no application compatibility is complete yet.
- The packaged AXIOM scanner's `SUPPORTED_FORMATS` is `.mp3`, `.m4a`, `.wav`, `.aiff`, `.flac`, `.aac`; the original extracted interface did not establish VirtualDJ support. An isolated experiment extending the scanner's format list found synthetic AVI/MP4/VOB entries, but AVI/VOB lacked durations, so extension changes alone are inadequate.
- Serato documents that video support depends on containers and codecs and lists AVI/MP4 but not VOB; it states Serato Video does not support MPEG-2: https://support.serato.com/hc/en-us/articles/202305724-Serato-Video-supported-formats-and-codecs . A local preview or playlist entry cannot establish that a particular third-party DJ application will play the media; per-application format limitations and possible conversion need explicit design and testing. Algoriddim documents distinct Windows data locations at https://help.algoriddim.com/topic/using-djay/where-does-djay-store-data .

## Video media and preview experiments (2026-10-30)
- `windows_media_probe.py` and its subprocess worker use PyAV `19.0.2` to inspect local media streams, codecs and duration without changing source files. `test_windows_video_probe.py` verifies generated AVI, MP4 and VOB with audio and video streams; `windows_audio.py` can extract their audio for preview. The probe is not a security sandbox and supports only the tested codecs/layouts.
- `windows_video_preview.py` generates a separate H.264/AAC MP4 preview for supported input containers, rejects incomplete output/duration mismatch and existing destination, and checks source stat identity. `test_windows_video_preview.py` passes generated AVI, MP4 and VOB cases with source SHA-256 unchanged. Full-file transcoding, a 512 MiB cap, timeout, no concurrent cancellation and no production-grade decoder isolation remain limitations.
- `windows_video_api.py` provides an opt-in, loopback-only test API with same-origin mutation checks, random preview IDs and byte-range serving; `test_windows_video_api.py` exercises it. `video_preview_demo.py` used a separate test page and isolated synthetic AVI: browser loaded the 160x120 prepared preview and played its silent 1-second video to completion. The test server and tab were closed. This is not integrated into the actual AXIOM interface, and live workflow, accessibility, long clips, codecs, invalid inputs and cache lifecycle need further work.

## VirtualDJ lists experiment (2026-10-30)
- VirtualDJ documents XML-based ordered lists since 2024: https://virtualdj.com/wiki/Lists.html . `windows_virtualdj_lists.py` reads bounded XML without DTD/entities and creates a new ordered list without overwriting an existing destination, with absolute paths, sizes, indices and duplicates retained. `test_windows_virtualdj_lists.py` checks generated MP3/AVI/MP4/VOB path entries, XML escaping, order, duplicate retention, source hashes, overwrite and DTD rejection.
- This is fixture-only list interchange, not live VirtualDJ integration. VirtualDJ software acceptance, legacy versions, track analysis, cue points, live deck state, existing lists and source updates are unverified. The official developer page says it offers no technical support for database modifications outside VirtualDJ: https://virtualdj.com/wiki/Developers .

## Opt-in AXIOM video interface and scanner (2026-10-30)
- `windows_video_scan.py` extends the packaged scanner in the opt-in Windows bootstrap with video extensions and falls back to the isolated PyAV metadata probe when ordinary tags do not provide duration. `test_windows_video_scan.py` verifies generated AVI, MP4 and VOB are indexed with durations, survive cache reload and search, retain stable IDs on rescan, and leave source hashes unchanged. The probe is synchronous per unreadable video; large-library performance, cancellation, codec coverage and hostile-media isolation remain open.
- The staged `audio-player.js` diverts video preview requests to `windows-video-preview.js` only after the opt-in local capabilities endpoint succeeds; a modal video control plays a generated H.264/AAC temporary preview and requests cleanup on close. `windows_bootstrap.py` enables the scanner and local video blueprint only with an explicit cache, path policy and FFmpeg path. This is an experimental workspace build, not a distributable application.
- `probe_video_ui_server.py` allowed only its synthetic AVI and a small set of local actions. The test button invoked the original `playAudioFile` path in the extracted AXIOM interface; the first attempt exposed an audit-hook subprocess failure, corrected by passing the validated executable explicitly. The retry opened the AXIOM video modal and played the silent 1-second fixture; close returned HTTP 200 for temporary-preview deletion. No real library or account was used. `probe_video_bootstrap.py` separately verifies scanner-to-video-API wiring with a fixture. It does not prove the licensed library UI flow, all metadata/containers, concurrent closes or normal application lifecycle.
- The preview API returns controlled errors for malformed media and rejects cross-origin or missing-origin state changes in the fixture tests. Decoder process sandboxing, full media coverage, streaming without full transcode, long jobs/cancellation, production session authorization and cleanup on crashes remain unresolved. `windows_audio_process.py` still uses suspended-start Job ownership but is not a complete process sandbox.

## Read-only VirtualDJ database and list matching (2026-10-30)
- VirtualDJ's documented v8 database structure records `Scan/Bpm` as seconds per beat; see https://virtualdj.com/wiki/VDJ_database.html . `windows_virtualdj_database.py` reads bounded XML without DTD/entities, preserves original path/metadata/cue attributes and unknown direct sections, derives BPM as 60/interval, and leaves streaming/relative paths unresolved. It does not modify the database or open media. Nested unknown-section structure, undocumented schema variations and live concurrent writes are not fully handled.
- The reader joins documented XML list entries to database tracks by normalized Windows path, preserves list order and duplicates, and explicitly reports matched, missing, ambiguous and unresolved paths. `test_windows_virtualdj_database.py` checks synthetic MP3/VOB paths, BPM, cue attributes, repeated/ambiguous paths, nonlocal paths, original file hash and DTD rejection. No actual VirtualDJ database or application was tested.
- `windows_virtualdj_api.py` provides an opt-in paged read-only endpoint restricted by an explicit caller-supplied path policy, same-origin/local checks and a required license guard. `windows_bootstrap.py` wires it only when explicitly enabled and supplies AXIOM's original `_license_gate`; `probe_virtualdj_bootstrap.py` verified the guest profile is denied rather than bypassing activation. `test_windows_virtualdj_api.py` verifies synthetic pagination, matching, origin and guard behavior and unchanged XML hashes. UI integration, real VirtualDJ schema coverage, data permissions, authenticated-session security and live software compatibility remain incomplete.

## VirtualDJ dialog browser check (2026-10-30)
- `work/virtualdj_ui_fixture.py` served the staged `windows-virtualdj.js`/`.css` with fixture XML. In the in-app browser the capabilities call revealed the "Inspect VirtualDJ" button; choosing the fixture database and list, then Inspect, showed "2 matched · 1 missing · 0 ambiguous · 0 unresolved" with MATCHED Test Song, MATCHED Test Video, MISSING missing.mp4. Server stopped afterwards. Not yet tested inside the full AXIOM interface or with a real VirtualDJ library.

## djay Pro on Windows (2026-10-30)
- The user confirmed AXIOM PRO is their own product (2026-10-30).
- djay 5.6.7091.0 is installed here as `59BEBC1A.djay`; its AppxManifest executable is `djayApp.exe`. Algoriddim documents the Windows data folder as `%HOMEPATH%\Music\djay` (https://help.algoriddim.com/topic/using-djay/where-does-djay-store-data). No `MediaLibrary.db` exists on this machine yet, so no real djay library has been read.
- AXIOM's djay code (reader, cues, colors, play counts, beatgrid publisher, analysis) converts file URLs with `os.path.normpath(unquote(urlparse(u).path))`. A synthetic `database2` table run through the original `read_djay_tracks` on Windows returned `\C:\Music\Café One.mp3`, a broken path. Building URLs with `'file://' + quote(path)` likewise produced invalid URLs for `C:\...` paths.
- Safety defect: `_mac_process_snapshot` returns `running=False` on any non-macOS platform and `_running_dj_publish_apps` only checks on `darwin`, so on Windows AXIOM's "quit Serato/djay before writing" guards silently pass.
- `work/axiom-win-probe/windows_djay.py` (installed by `windows_bootstrap.build_backend`) gives the djay-related modules an `os.path.normpath` that strips the leading separator before a drive letter and a `quote` that renders drive paths as `/C:/...`; it replaces the process snapshot/running/publish-app checks with a Windows process listing mapping "djay Pro"/"djay" to `djayApp.exe` (and the unverified legacy `djay Pro.exe`) and Serato labels to Serato's documented executables, failing closed when processes cannot be listed; and points djay library discovery at `%USERPROFILE%\Music\djay\djay Media Library.djayMediaLibrary\MediaLibrary.db` (honouring `AXIOM_DJAY_NOW_PLAYING_PATH`).
- `work/test_windows_djay.py` builds a synthetic djay library with AXIOM's own FastCoding encoder and verifies the original reader now returns the correct `C:\...\Café One.mp3` path, title and BPM with database and track hashes unchanged, URL encoding in both directions, default locations and fail-closed snapshot. `work/test_windows_djay_live_process.py` launches a disposable `djayApp.exe` and confirms detection (pid and start time) and clearing after exit.
- Unverified: whether djay for Windows stores locations as standard `file:///C:/...` URLs, its real schema/blob variants, UNC/network paths, and every djay write path (playlists, beatgrids, play counts) against a real library. Next step: open djay once, add one disposable track, then run the reader read-only against a copy of the resulting `MediaLibrary.db`.

## Real djay for Windows library, read from a copy (2026-10-30)
- The user opened djay 5.6 and played one track. djay created `%USERPROFILE%\Music\djay\djay Media Library\MediaLibrary.db` (+ `-wal`, `-shm`). The folder has no `.djayMediaLibrary` suffix, so the default path above was wrong. The three files were copied (FileShare read; djay was running) to the session scratchpad and only the copy was read. The original could not be hashed while djay held it open.
- Format differences from the macOS layout AXIOM expects:
  - Locations are FastCoding URL objects (tag 33) holding `file:///C:%5CUsers%5C...%20...`, with backslashes percent-encoded. AXIOM reads locations by regex, so the tag does not matter there, and the existing path fix already turns `/C:\...` into `C:\...`.
  - Every number is a double: `playCount` 1.0, playlist `type` 1.0, `deckNumber` 1.0. Line 82 of `read_djay_tracks` rejects non-int `playCount`, so every played track was reported "Unreadable djay track record".
  - There is no `mediaItems` collection. Title/artist are in `mediaItemTitleIDs` and BPM/key in `mediaItemAnalyzedData`. Line 103 skips locations without a `mediaItems` entry, so no tracks would be listed even after the play-count fix.
- `windows_djay.py` now wraps `utils.dj_transfer.decode_djay_record`, converting whole, non-negative float play counts to int; other fractional or negative counts are still rejected. It also gives `dj_transfer` a sqlite3 proxy that, for AXIOM's track query only, adds `mediaItems` rows built from `mediaItemTitleIDs`/`mediaItemAnalyzedData` (title, bpm, titleID, titleIDs, the only fields the reader uses) for keys with no real `mediaItems` record. `quote` now produces djay's own `/C:%5C...` form. Library discovery prefers `djay Media Library` and falls back to the suffixed name.
- `work/check_real_djay_copy.py <copy>` refuses paths under the live `Music\djay` folder. On the copy, the original reader returned 1 track with the correct existing path, title, artist, play count 1 and BPM 105.5, no errors, with and without the preparation options. The copy's files were unchanged by that run (an earlier raw inspection had altered the copy; not the original).
- `test_windows_djay.py` adds a synthetic djay-for-Windows-layout library (hand-built FastCoding blobs, `%5C` URL object, float play count, no `mediaItems`) and a 2.5 play count that must still be rejected. `test_windows_djay_live_process.py` now tolerates a real djay already running. Process detection found the real running `djayApp.exe` (pid 28108).
- Still unverified: every djay write path on Windows. AXIOM's encoder writes integers where djay for Windows writes doubles, and writers may expect `mediaItems` records, so playlist/beatgrid/play-count publishing must stay disabled until tested on a disposable copy. Also unverified: libraries with many tracks, cue/grid data on Windows, and UNC/network paths.

## djay writes on Windows, tested on disposable copies (2026-10-30)
- Writers: `utils.djay_play_count_publish.publish_counts` (play counts); `app._write_djay_native_playlist` (playlists, including YapDatabase view pages); `djay_beatgrid_publisher` / `utils.djay_grid_batch` (beatgrids, also writing djay's Metadata folder); and the `utils.djay_cue_codec` / `utils.djay_play_count_codec` / `utils.djay_playlist_codec` codecs.
- Play counts now work end to end on a copy of the real library. Problems found and fixed in `windows_djay.py`:
  - `running_dj_apps` shelled out to `/usr/bin/pgrep`. On Windows that failed closed, blocking every publish. Replaced with a Windows process check that also fails closed. With djay open it now refuses with "Quit djay Pro, then try again."
  - The codec only accepts integer `playCount` and writes int64. A wrapper hands it the equal int64 and converts the result back to a double, matching djay for Windows. Missing counts are inserted as doubles, and integer (macOS-layout) counts are left to AXIOM unchanged. The wrapper decodes the result and refuses if anything but `playCount` differs.
  - The `mediaItems` existence check falls back to `mediaItemTitleIDs`.
  - The connection wrapper broke `sqlite3.backup`; it now unwraps the target.
  - `os.fsync` on a file opened `'rb'` fails on Windows (EBADF). The proxy reopens the file for writing with `ReOpenFile` and calls `FlushFileBuffers`.
  - Directory fsync (`os.open(dir, O_RDONLY)`) is impossible on Windows. The proxy's `os.replace` is `MoveFileEx(REPLACE_EXISTING|WRITE_THROUGH)`, which returns once the rename is on disk, and fsync of a directory descriptor is then a no-op. These os overrides apply only to the djay-related modules.
- Result on the copy (via `work/check_djay_play_count_write.py`): AXIOM reported success with read-back verified; `PRAGMA integrity_check` ok; exactly one record changed, in 2 bytes (the double 1.0 -> 7.0); the reader returned play count 7. djay itself has not opened a library written this way.
- `app.DJAY_MEDIA_LIBRARY_DIR/_DB` still held the macOS `.djayMediaLibrary` name and are now set from the Windows location. `DJAY_METADATA_ROOT` still points at the macOS Group Container. djay for Windows keeps metadata under `%LOCALAPPDATA%\Packages\59BEBC1A.djay_e3tqh12mt5rj6\LocalCache\Local\Algoriddim\djay\Metadata` (MSIX-virtualised); not yet wired.
- Playlists are not supported yet. `_write_djay_native_playlist` stops before writing with "Unexpected djay playlist root type" because the Windows root playlist stores `type` as 1.0. AXIOM builds playlist and item records from scratch, so a real djay-for-Windows playlist (made in djay) is needed as a reference before adapting it. Cue writing and beatgrids are untested for the same reason; `read_cues` on the real record returned [] (no cues set).
- `test_windows_djay_play_count.py` covers the codec wrapper, guard, fsync/replace helpers and a full synthetic publish. Synthetic library construction moved to `work/djay_fixture.py`. Suite: 32 test files, 0 failed. Disposable library copies inside the workspace were deleted afterwards.

## djay for Windows playlists and cues, from a real sample (2026-10-30)
- The user made a playlist "AXIOM Test" in djay with the one track, set a hot cue and quit djay. The library was copied again (djay closed) and compared with the earlier copy.
- What djay wrote:
  - **Playlist records:** `mediaItemPlaylists` has `type` 0.0 (double) and `itemUUIDs` as a mutable ordered set (FastCoding tag 27). The root's `type` is 1.0 (double) and its `childUUIDs` an immutable ordered set (tag 12). `mediaItemPlaylistItems` is byte-identical to AXIOM's item builder.
  - **Extension rows:** relationships Parent/ItemPlaylist/ItemMediaItem (rules 4) and Child/Item (rules 2); `secondaryIndex_mediaItemPlaylistIndex`; `view_mediaItemPlaylistsView`, `view_mediaView` "playlist" and `view_mediaItemPlaylistView` pages; an `fts_searchIndex` playlist row. These are exactly the rows AXIOM's writer maintains.
  - **Other:** djay also bumps `yap2` `snapshot`, which AXIOM does not. It also created a real `mediaItems` record (plus artist, genre and label records) when the track entered a playlist.
- AXIOM writes `type` as FastCoding's integer constant and an immutable `itemUUIDs`. Its root contract requires `('integer', 1)`, so it refused the Windows root before writing.
- `windows_djay.py` now adapts AXIOM's playlist primitives:
  - `encode_windows_playlist` writes djay for Windows' layout: double `type`, mutable `itemUUIDs`, immutable `childUUIDs`, FastCoding string aliases, header counts.
  - `_djay_decode_fastcoding_object` reports a whole-number double `type` as `('integer', n)`, but only when the Windows encoder reproduces the record byte for byte.
  - `_djay_encode_fastcoding_object` and `_djay_fastcoding_playlist_blob` emit the Windows layout. Unsupported shapes fall back to AXIOM's encoder, so AXIOM's own lossless checks reject them.
  - AXIOM's root contract, append, verification and view/relationship code run unchanged.
- **Verification:**
  - AXIOM's builder reproduces djay's own "AXIOM Test" playlist record byte for byte. Appending that playlist to djay's earlier empty root reproduces djay's one-child root byte for byte (`test_windows_djay_playlist.py`, using djay's bytes as the reference).
  - `work/check_djay_playlist_write.py` ran the full `_write_djay_native_playlist` on a disposable copy (`allow_running=True` because djay was then running on the real library; `reopen=False`). The result: success, backup verified, read-back verified, integrity ok, 1/1 tracks.
  - The added rows mirror djay's (same relationship names and rules, index, view groups and FTS row).
  - Not yet opened in djay.
- **Cues are not supported yet:**
  - The real record has two `ADCCuePoint`s: number 1.0 at 0.016 s, colour `#CC0000`, comment ''; and number 2.0 at 0.0 s with no colour or comment. djay's property order is time, endTime, comment, number, color.
  - `utils.djay_cue_codec.read_cues` fails with KeyError 'color' on the second cue, so `replace_cues` refuses and transfer preparation reports `transfer_preparation_error: 'color'` (safe).
  - Its `normalized_cues` also rejects float slot numbers.
  - On a synthetic colour-complete record, AXIOM writes `number` as int64 in the order time, endTime, number, comment, color, and refuses to overwrite differing existing cues.
  - **Display bug:** `utils.cues.parse_djay_cues_blob` (byte-scanning heuristic used for display) misreads the Windows record. It reports cue 1 at 1128 ms instead of 16 ms and invents a cue labelled "cuePoints" (#A3FF00), so AXIOM would display wrong djay cues on Windows.
  - Needed from the user: whether djay shows one or two hot cues and where.
- Beatgrids: `DJAY_METADATA_ROOT` still points at the macOS Group Container and is not wired to djay's Windows Metadata folder; untested.
- `djay_fixture.blob` now writes real header object/string counts (AXIOM's cue codec checks them). Suite: 33 test files, 0 failed. Disposable library copies, backups and reports were removed from the probe home.

## djay for Windows cues (2026-10-30)
- The user confirmed djay shows two hot cues on the sample track. The second (number 2.0, time 0.0) has no `color` or `comment` in the record.
- **AXIOM's two djay cue readers both failed on Windows records:**
  - `utils.djay_cue_codec.read_cues` (transfer) required a `color` key (KeyError) and an int slot (`normalized_cues` rejects 1.0).
  - `utils.cues.parse_djay_cues_blob` (display) skipped every cue whose `number` is not an int. Finding none, it fell back to byte scanning, which reported cue 1 at 1128 ms instead of 16 ms and invented a cue labelled "cuePoints".
- **Fix in `windows_djay.py`:**
  - The `decode_djay_record` used by both readers turns whole-number cue slots into ints. The display reader picks it up from `utils.dj_track_colors`, which it imports per call.
  - For the transfer reader only, a colourless cue gets `#A3FF00`, the colour AXIOM's own `utils.cues._cue_color_hex` already shows for colourless djay cues, so display and transfer agree.
  - Fractional slots are still refused.
- **Result on the real copy:** display shows CUE 1 16 ms `#CC0000` and CUE 2 0 ms `#A3FF00`; transfer cues are the same two with no `transfer_preparation_error`.
- **Writes:**
  - The only caller of `replace_cues` is `utils.dj_cue_transfer_research.publish_to_djay`. Its own docstring says "No route or active-library destination", limited to generated audio and disposable databases, so AXIOM has no live djay cue-writing feature.
  - `replace_cues` only fills cue-less tracks: an identical existing set returns the record unchanged, and a differing set is refused. So a colourless djay cue is never rewritten with the default colour.
  - The wrapper converts AXIOM's int64 `number` on newly written cues to djay's double in place (same length and alignment), then decodes and refuses if anything else differs.
  - AXIOM writes the properties in a different order from djay (time, endTime, number, comment, color versus djay's time, endTime, comment, number, color). That is unverified with djay.
  - Tested on real records: the cue-less record from copy 1 got 2 cues with double slots and no other change; the cued record from copy 2 was unchanged when given identical cues and refused when given different ones.
- `test_windows_djay_cues.py` covers all of the above on synthetic records. Suite: 34 test files, 0 failed.

## djay for Windows beatgrids, first findings (2026-10-30)
- djay 5.6 for Windows keeps per-track analysis at `%LOCALAPPDATA%\Packages\59BEBC1A.djay_e3tqh12mt5rj6\LocalCache\Local\Algoriddim\djay\Metadata\<2 hex>\<track key>.djayMetadata`. That is 32 files here. The `??/<key>.djayMetadata` layout matches what `djay_beatgrid_publisher._live_metadata_path` expects. The files are binary plists: `info`, `keyInfo`, `waveInfoCompact`, `newGainInfo`, `deepBeatTrackerInfo` (version 8, model ARDeepBeatTrackerModel1011_9, compressed beats/transients), `songStructureInfo` and `waveColorsInfo`.
- Live grid publishing path: Beatgrid Doctor -> `utils.djay_doctor_job` -> `utils.djay_grid_batch.publish_djay_batch` -> `publish_djay_existing_track_beatgrid`. It writes the metadata plist, `bpm` on `mediaItems` and `mediaItemAnalyzedData`, and `beatGridEdits` in `mediaItemUserData`. `app._beatgrid_doctor_djay_writer_proof` builds its own macOS-layout library, so it does not cover djay for Windows. `app.DJAY_METADATA_ROOT` is still the macOS Group Container.
- `work/check_djay_beatgrid_write.py` ran `publish_djay_existing_track_beatgrid` on copies of the real library and the track's metadata file in `work/fixtures/djay-grid`. AXIOM stopped before writing with "Invalid native djay editor segment analysis". `_require_native_editor_metadata` requires `type(deepBeatTrackerInfo['hasStraightSegment']) is bool`, but djay for Windows stores the integer 1. `straightGrid` and `forcedStraightGrid` are integers too.
- Not yet done: adapting the metadata checks and payload to integer flags, the database-side grid writes, and wiring `DJAY_METADATA_ROOT`.

## djay for Windows beatgrids: writer adapted, tested on disposable copies (2026-10-30)
- **Metadata flags:** every `.djayMetadata` file on this machine (32; 14 at analysis version 8, 18 at version 7, which AXIOM's version check already refuses) stores grid flags as integers, and none contains a plist boolean. AXIOM requires booleans when checking (`hasStraightSegment`) and writes booleans (`straightGrid`/`forcedStraightGrid`). `djay_beatgrid_publisher` and `studio_daw.djay_analysis` now get a plistlib proxy that reads 0/1 flags in `deepBeatTrackerInfo` as booleans and writes them back as integers. Nothing else in the plist is touched.
- **Path lookup:** `studio_daw.djay_analysis.read_analysis` (used for grid read-back and djay grid import) compared `Path(unquote(url.path))` with the track path, which fails for `/C:%5C...`. Its `unquote` now drops the separator before a drive letter.
- **Metadata location:** `app.DJAY_METADATA_ROOT` now points at the djay package's `LocalCache\Local\Algoriddim\djay\Metadata`. It falls back to `%LOCALAPPDATA%\Algoriddim\djay\Metadata` when exactly one package is not found.
- **Numbers as doubles:** AXIOM's grid record writers emit float32 BPM/positions and compact 0/1/true constants (macOS style); they would also have turned djay's double `bpm` into float32. `transcode_numbers` re-lays a FastCoding record token by token with every number as a double. It reproduced all 148 parseable real djay-for-Windows records byte for byte, and those records contain no number other than a double. It does not parse URL objects (tag 33), which only content packs and locations use. The three writers (`_replace_djay_root_numeric_properties`, `_replace_djay_root_properties`, `_replace_djay_manual_grid_edit`) are wrapped, and each result must decode to the same values as AXIOM's output.
- **Result on copies of the real library and metadata (`work/check_djay_beatgrid_write.py`):** success; 240 beats read back with the downbeat on beat 0; integrity ok; source MP3 hash unchanged. Database changes: `mediaItems` and `mediaItemAnalyzedData` bpm 105.5 (double), `isStraightGrid` 1.0, and user-data `manualBPM` 105.5 plus a new `ADCBeatGridEdits`. Cues and play count are byte-identical. Metadata: new compressed beats, `forcedStraightGrid` 0 -> 1 (integer).
- **Unverified:**
  - djay for Windows has not produced an `ADCBeatGridEdits` here, so the property set and collection types AXIOM writes (immutable empty `downbeatMarkers` array) are unconfirmed.
  - The batch/job layers (`djay_grid_batch`, `djay_doctor_job`) have not been run on Windows.
  - Nothing has been opened in djay.
- Test-suite fix: `test_windows_job_owner.py` and `test_windows_job_tree.py` waited for a marker file but not its PID content (an intermittent race); they now wait for the content. `test_windows_djay_beatgrid.py` was added. Suite: 35 test files, 0 failed. Grid fixtures and backups were deleted.

## djay for Windows grid edit compared with AXIOM's (2026-10-30)
- The user moved the downbeat on the sample track in djay's beatgrid editor and quit djay. The library and the track's `.djayMetadata` were copied again.
- djay wrote an `ADCBeatGridEdits` into `mediaItemUserData`:
  - `firstDownbeatPosition` 0.587494432926178, with `nrOfBeatShift`, `firstGridSegmentTempoExponent`, `lastGridSegmentTempoExponent` and `fractionalBeatShift` all 0.0. All are doubles.
  - `downbeatMarkers` is an empty immutable array (tag 10).
  - The record was placed after `cuePoints`.
  - djay did not change any `deepBeatTrackerInfo` value in the metadata plist. Play count went 1.0 -> 2.0 and a history session was added.
- Given the same downbeat, AXIOM's `_replace_djay_manual_grid_edit` (with the double conversion) produces the same class, the same six properties in the same order, the same array type and the same doubles. The bytes are identical apart from one alignment padding byte, because the object sits at a different offset in the record (FastCoding aligns to absolute offsets). `test_windows_djay_beatgrid.py` now holds djay's object bytes as the reference.
- Full `publish_djay_existing_track_beatgrid` on copies holding djay's edit: success; 240 beats; integrity ok; source unchanged. djay's edit was replaced in place by AXIOM's (one `ADCBeatGridEdits`, 0.5875 -> 0.0188), with only doubles in all three records.
- **Pre-existing AXIOM behaviour, not Windows-specific:** the publisher re-reads user data after writing only when the track already had `manualBPM` (`if user_row and manual_bpm_before is not None`, line 1164). For tracks without one, its report shows `manual_bpm_after`/`manual_first_downbeat_after` as null even though both were written. The check scripts decode the stored records independently.
- **Still unverified:** djay opening a library AXIOM wrote; the Beatgrid Doctor batch/job layers on Windows; tracks with downbeat markers or tempo-segment edits.
- Suite: 35 test files, 0 failed. Grid fixtures and backups were deleted.

## VirtualDJ with the user's real data (2026-10-30)
- **Installed:** VirtualDJ 8.5 (`C:\Program Files\VirtualDJ\virtualdj.exe`). Home folder `%LOCALAPPDATA%\VirtualDJ` with `database.xml` (Version "2023", 459 entries), `MyLists\test.vdjfolder` (16 videos), `Playlists\test.m3u` and history. A per-drive database `E:\VirtualDJ\database.xml` (Version "8.5", 272 entries) also exists, and all its paths are full `E:\...` paths. Copies were read in the scratchpad.
- **Reader:** `windows_virtualdj_database.read_database` read both copies with every section recognised (Tags, Infos, Scan, Poi, Comment, Link), and `match_list` matched all 16 list songs. The copies were unchanged.
- **List format:** VirtualDJ 8.5 saves lists as `MyLists\<name>.vdjfolder`, not the `.xml` in "My Lists" that https://virtualdj.com/wiki/Lists.html describes.
  - Layout: CRLF lines, a tab before each `<song ... />` (with a space before `/>`), entities including `&apos;`.
  - Attributes appear in the order path, size, songlength (one decimal), artist, title, remix, idx, and only when known.
  - The root is `ordered="yes"` plus `singleDrive="yes"` for a single-drive list (the documented default is no).
  - The inspect endpoint and the file picker only accepted `.xml`, so real lists could not be inspected. Fixed.
- **New in `windows_virtualdj_lists.py`:**
  - `format_vdjfolder` reproduces the user's real `test.vdjfolder` byte for byte from its songs.
  - `song_entry` takes artist/title/remix/length from the VirtualDJ databases. For the 16 songs, 15 entries equal VirtualDJ's; the 16th differs only by `remix="1080p"`, a tag the database gained in 2026 after the list was saved in 2024.
  - `database_paths` (home database plus `<drive>:\VirtualDJ\database.xml` for other drives).
  - `ensure_virtualdj_closed` (process `virtualdj.exe`; fails closed).
  - `write_new_vdjfolder`: no overwrite; staged in the same folder; re-read and byte-verified; tracks re-checked; hard-link publish.
- **API:** `POST /api/windows/virtualdj/lists` (same local/same-origin/license gates; tracks must pass the caller's path policy) creates the list in VirtualDJ's `MyLists`. Capabilities report `create_lists`. Inspect accepts `.vdjfolder`.
- **Checks:**
  - With VirtualDJ open (the user started it at 12:35) the real guard refused: "Quit VirtualDJ, then try again."
  - `work/check_virtualdj_list_write.py` with a stand-in home (copy of the database; guard disabled for the stand-in only via `AXIOM_CHECK_STANDIN_ONLY=1`) created a 12-track list (6 on E:, using the real E: database read-only). Order, sizes and database details were correct; singleDrive was omitted for the mixed drives; a repeat was refused with 409; tracks were unchanged.
  - The 16 videos in the user's 2024 list no longer exist on disk, so that exact list cannot be recreated.
- `test_windows_virtualdj_vdjfolder.py` added. Suite: 36 test files, 0 failed; `probe_virtualdj_bootstrap.py` still confirms the license gate.
- **Not done:**
  - No AXIOM screen offers "export to VirtualDJ" yet (the API exists; UI integration pending).
  - VirtualDJ has not opened a list AXIOM wrote.
  - Writing into VirtualDJ's database (cues, BPM, tags) is not implemented; VirtualDJ's developer page says database edits outside VirtualDJ are unsupported.
- 2026-10-30 12:40, with the user's approval and VirtualDJ closed (real guard passed), AXIOM's API wrote `%LOCALAPPDATA%\VirtualDJ\MyLists\AXIOM Test.vdjfolder`. It holds 5 tracks: 2 MP3 and 1 MP4 on C:, and 2 MP3 on E:. Details came from both databases (4 of 5 had tags; `Record.mp4` has none). The main database, the E: database and `test.vdjfolder` were byte-identical before and after; the only new file is the list. The E: Judas Priest file is now 5947184 bytes while VirtualDJ's database records 5947133 (changed since VirtualDJ's scan), and the list carries the current size. Awaiting the user's check in VirtualDJ; the list can be deleted from VirtualDJ or by removing that file.
- The user confirmed (2026-10-30) that VirtualDJ 8.5 shows "AXIOM Test" with all five songs in order and plays them, including the MP4 and the two E: tracks. This is the first confirmation of a list written by AXIOM's Windows code being accepted by the real application. Still open: an AXIOM screen offering the export.

## Serato on this PC, first real-data read (2026-10-30)
- **Not installed:** Serato DJ has no uninstall entry and no running process. `C:\Users\Dgatling\Music\_Serato_` holds only a 72-byte `database V2` header (an empty library, last written 2023-12-11). Drive E: has a real library at `E:\_Serato_`: `database V2` (259,883 bytes), `Subcrates\Samples.crate`, last written 2023-12-11.
- **Path bug:** AXIOM's `_serato_relpath_to_absolute_path` prefixes a separator (macOS semantics).
  - On Windows a C: home library (`...\Music\_Serato_`) gave `\Users\...` with no drive, and an absolute `E:\x` with no library gave `\x`.
  - Drive-root libraries such as `E:\_Serato_` already resolved correctly.
  - `windows_serato_paths.make_relpath_resolver` (installed by `windows_bootstrap.build_backend`) keeps drive paths and gives relative paths the library's drive. It falls back to AXIOM's own result when no library is known or the input is unsafe. Added to `test_windows_serato_paths.py`.
- **Real read:** AXIOM's original `_load_serato_library_tracks` on the real `E:\_Serato_\database V2` (read-only; SHA-256 of the database and crate identical before and after) gave 277 rows, 270 usable tracks (all present on E:), 7 missing files, 266 with crate evidence, and BPM/key/year where Serato had them. Reading a copy elsewhere resolves paths against the copy's drive, so Serato drive libraries must be read in place (read-only) or with their original root.
- Suite 36/0; the Serato crate, picker and combined probes still pass.
- **Not yet done:** Serato writes against real data (crates in `Subcrates`, Serato's newer SQLite library, cue publishing, Beatgrid Doctor, play-count mirroring). Serato acceptance cannot be checked without Serato DJ installed.
- **Drive library discovery:** AXIOM's `_serato_database_candidates` finds drive libraries by scanning macOS `/Volumes`. `windows_serato_paths.make_database_candidates` (installed by the bootstrap) adds `<drive>\_Serato_\database V2` for fixed and removable drives (GetDriveTypeW 2/3; network drives skipped). With no arguments, AXIOM's loader now finds `E:\_Serato_` and loads its 270 tracks. Tested with stand-in drive roots.
- **Crate export (`_write_serato_crate`)** writes `SERATO_SUBCRATES_DIR\<name>.crate` (home library) or registers in `SERATO_MODERN_LIBRARY_DB`, which still points at the macOS `~/Library/Application Support/Serato/Library/root.sqlite`. The Windows location of Serato's newer library, and how Serato for Windows records crates for tracks on another drive (home crate versus `E:\_Serato_\Subcrates`), will be observed once the user has installed Serato DJ, rather than assumed.

## Serato DJ Pro 5 for Windows: newer library and crate export (2026-10-30)
- **Installed:** the user installed Serato DJ Pro 5.0.0.1278, opened it once with E: connected, and quit. Serato created/upgraded:
  - `%LOCALAPPDATA%\Serato\Library\master.sqlite` and `root.sqlite`;
  - `E:\_Serato_\Library\location.sqlite`, upgraded to schema v34 with its own backup zips;
  - `Music\_Serato_\DBV2-legacy.zip`.
  The old `database V2` files were not modified.
- **Layout (master `connection` table):** `root.sqlite` is the system drive (C:), and each other drive has `<drive>:/_Serato_/Library/location.sqlite` (D: and E: registered); a `remote_libraries.sqlite` is also listed.
  - E: assets (277) use drive-relative `portable_id` (`Samples/...`), and the `Samples` crate is container 2 there (container 15 in master).
  - `master.sqlite` uses the Serato-only collation `serato_asset_string_comparator` (sorted-list indexes) and function `serato_str_norm` (asset triggers), so it must never be written. `root.sqlite` and `location.sqlite` have neither; their revision triggers are declared on `main.`/`db2.` tables.
- **AXIOM defects found on copies before any real write:**
  1. `_serato_modern_portable_id` kept the drive (`E:/Samples/...`), so existing assets would not be found and duplicates would be inserted.
  2. A single target database (the macOS `~/Library/Application Support/Serato/Library/root.sqlite`) cannot hold crates for tracks on other drives.
  3. Updating existing assets overwrote Serato data from AXIOM's track details: the key was blanked (`G#m`/`E`/`Ebm` -> ''), an empty artist became "Unknown Artist", a title was trimmed, and file_size was replaced.
- **Fix in `windows_serato_library.py` (installed by the bootstrap):**
  - `SERATO_MODERN_LIBRARY_DB` and candidates point at `%LOCALAPPDATA%\Serato\Library`.
  - Drive-relative `portable_id`.
  - `_write_serato_modern_visible_crate` picks the tracks' drive database and refuses mixed drives. It also refuses the system drive (root.sqlite) until a real root.sqlite with tracks shows Serato for Windows' format there.
  - `_write_serato_modern_crate_to_database` and `_serato_modern_track_fields` give tracks Serato already has Serato's own title, artist, BPM, key, year and size, so the export adds membership only. New tracks still get AXIOM's details.
- **On a copy of the real E: location.sqlite:** AXIOM's writer added crate "AXIOM Test" (5 tracks, ordered, same parent/type/space as Serato's `Samples`); 277 assets before and after; no duplicates; integrity and foreign keys ok. Existing assets changed only in `revision`. The full `_write_serato_modern_visible_crate` path (Serato-running check, backup, verify) also succeeded on a copy. AXIOM names that backup `root.sqlite.beatgrid_doctor_*.bak` even for a location database (cosmetic, AXIOM's naming).
- `test_windows_serato_library.py` added; suite 37/0.
- **Not yet verified:** Serato opening a database AXIOM wrote (needs the user's approval to write the real `E:\_Serato_\Library\location.sqlite`, with Serato closed); legacy `.crate` export and Serato 5's DBV2 sync; C: tracks; cue publishing, Beatgrid Doctor and play counts for Serato.
- **Real write, 2026-10-30 13:03,** with the user's approval and Serato closed (real process check passed; no journal files):
  - **Backups:** the user's `E:\_Serato_\Library\location.sqlite` (SHA-256 459CC915...) and `%LOCALAPPDATA%\Serato\Library\master.sqlite`/`root.sqlite` were copied to the session scratchpad (`serato-real-backup`). AXIOM's own backup went to `probe-home\Music\_Serato_\Export Backups`.
  - **The write:** `_write_serato_modern_visible_crate` chose `E:\_Serato_\Library\location.sqlite` and added crate "AXIOM Test" (container 3; same parent/type/space as `Samples`) with 5 ordered tracks. Delivery was verified; integrity ok; no foreign-key problems.
  - **Unchanged:** the 5 existing assets changed only `revision` 856 -> 857. `Samples` still holds 271 tracks. master.sqlite was not written.
  - Awaiting the user's check in Serato.
- The user confirmed (2026-10-30) that Serato DJ Pro 5.0 shows "AXIOM Test" in the E: library with all five tracks in order, and that they load and play. This is the first Serato acceptance of a crate written by AXIOM's Windows code. Still open for Serato: C: (root.sqlite) tracks, mixed-drive crates, legacy `.crate` export and Serato 5's DBV2 sync, cue publishing, Beatgrid Doctor, play-count mirroring, and an AXIOM screen offering the export.

## Windows launcher (2026-10-30)
- **macOS reference (`axiom_bytecode/axiom_desktop_launcher`):**
  - Sets `AXIOM_PACKAGED=1`; uses `AXIOM_HOST` 127.0.0.1 and `AXIOM_PORT` 8080; logs to `~/Library/Logs/AXIOM DJ/launch.log`.
  - Frees the port with `lsof ... | kill -9`, imports `app` and runs `app.run(host, port, threaded=True)` on a thread.
  - Waits up to 30 s, then opens the macOS WebKit window (`axiom_native_window`), falling back to `open URL`, with dialogs on failure.
  - `app._runtime_base_dir` honours `AXIOM_RUNTIME_DIR`; otherwise it uses `~/Library/Application Support/AXIOM DJ`.
- **`work/axiom-win-probe/axiom_windows_launcher.py`:**
  - Data in `%LOCALAPPDATA%\AXIOM DJ` (`AXIOM_RUNTIME_DIR`), log `Logs\launch.log`, recordings in `Music\AXIOM DJ\Recordings`.
  - Port 8080, or a free port if another program holds it. It never kills processes, which the macOS launcher does.
  - Single instance through a `msvcrt` lock plus `launcher.port`; a second launch reopens the running AXIOM.
  - `build_backend` with video preview (imageio-ffmpeg 7.1) and VirtualDJ endpoints. The VirtualDJ path policy is `is_safe_location` plus VirtualDJ's own home (AppData is otherwise excluded).
  - A `before_request` guard accepts only loopback clients with Host `127.0.0.1:<port>`/`localhost:<port>` (DNS-rebinding protection).
  - Werkzeug `make_server` on a thread so it can be shut down. The cockpit opens in a Microsoft Edge `--app` window with its own profile (`AXIOM DJ\Window`), and AXIOM stops when it closes. Without Edge, or if Edge hands off within 3 s, the default browser opens and a "Click OK to quit AXIOM" dialog stops it.
  - Startup errors show a dialog pointing at the log. `AXIOM_NO_OPEN=1` runs headless (tests).
  - Licensing is untouched.
- **`work/Start AXIOM.cmd`:** starts it with the venv's `pythonw.exe` (no console).
- **Checks:**
  - A headless isolated run served the cockpit in about 1 s. In the built-in browser AXIOM showed its activation screen ("Ready to unlock AXIOM?"); "Back to Guest Preview" showed the cockpit with "Engine status: Online".
  - The only console errors were AXIOM's guest-mode responses: `/api/dropbox/pending` 403 "Guest Preview ... 500 tracks" and `/api/license/validate` 400 "AXIOM is not activated."
  - A foreign Host header got 403.
  - `test_windows_launcher.py` covers port choice, the lock, the VirtualDJ policy, a headless launch, the Host guard and second-instance reuse.
  - Lessons: the venv `python.exe` is a redirector with a child interpreter, so the test ends the process tree and waits for the lock. An early manual run created an empty `Music\AXIOM DJ\Recordings` in the real profile; it was removed, and tests now isolate USERPROFILE.
- Suite 38/0.
- **Not yet verified:** the Edge window and close-to-quit on the user's desktop; activation with the user's own key; the activation text still says "Mac app access" (AXIOM's UI copy). This is a workspace prototype using the project's Python environment, not an installer.
- **Activation off for now (owner's request, 2026-10-30).**
  - AXIOM computes `AXIOM_LICENSE_REQUIRED` from the `AXIOM_LICENSE_REQUIRED` environment variable, then `axiom_build.json` `license_required` ("1"), then frozen/`AXIOM_PACKAGED`. When it is false, `_public_license_status` reports `dev_unlocked`, "Licensing is not required for this build."
  - The launcher now defaults the variable to `0` (logged at start), and `Start AXIOM.cmd` has a commented `set AXIOM_LICENSE_REQUIRED=1` to require activation again. AXIOM's licence code is unchanged.
  - Verified: status `dev_unlocked`, access tier `full`, no activation screen.
- **Window placement.** The user reported the main screen was not full screen and sat off to the right. The page itself has no overflow at 1280x720, 1024x700 or 800x600 (scrollWidth equals innerWidth, scroll 0). The Edge app window opened at Edge's default placement, whereas the macOS window is full size. The launcher now passes `--start-maximized` (`edge_command`); the launcher test checks the flag and `dev_unlocked`. Suite 38/0.
- The user's first real launch (13:39, port 8080) was still running with its window open. It must be closed before the new settings apply, because a second launch reuses the running instance. Not yet confirmed on the user's screen.

## User's first real session: fixes (2026-10-30)
- **Cause of most reports:** the user's 13:46 launch reused the 13:39 instance (the original Edge window was still open), so they were running the old settings with activation required. AXIOM's `_initial_activation_gate`/`_license_gate` block library connections, VirtualDJ endpoints and much of Performance in that state.
- **Pickers hidden behind AXIOM:** `windows_dialogs` opened Tk dialogs from a Flask worker. The server is a background process while the user clicks in Edge, and Windows' foreground rules keep such a dialog behind the maximized AXIOM window, so the request appears to hang. The dialogs now use a tiny transparent topmost owner window, brought to the front with `AttachThreadInput`/`SetForegroundWindow`, and one dialog at a time. In a `pythonw` check the folder dialog was the foreground window and Cancel still returned `('', True)`. `test_windows_dialogs.py` still passes.
- **Logging:** the launcher now sends Python logging warnings and stderr to `launch.log` (pythonw discarded AXIOM's request errors).
- **Serato:** checked with `work/run_axiom_check_server.py` (launcher setup, AXIOM data in a test folder, real DJ libraries read). `POST /api/library/connect_serato/start` connected 270 tracks from both Serato libraries in about 1 s; the cockpit then showed "270 TRACKS".
- **Performance:**
  - Loads with activation off. "Open Live Assist" (non-macOS path) opened `/live_assist_window` in a 438x690 popup that starts collapsed: a black window with a tab at its edge, which on macOS is an edge-docked panel.
  - The staged `static/js/surfaces/performance-live.js` popup now passes AXIOM's own `popup` flag (`&popup=1`), which opens it expanded; confirmed expanded.
  - Remaining Mac-only parts (Command-F accessibility hotkey, CoreAudio status, edge-docked panel) are not ported.
- **VirtualDJ:**
  - AXIOM has no VirtualDJ library source; the music-source chooser offers only Music Folder and Serato Database V2.
  - New `windows_virtualdj_library.py` reads VirtualDJ's home database plus each local drive's `VirtualDJ\database.xml`, maps media songs to AXIOM's rekordbox-shaped records (title/artist/album/genre/comment, BPM from Scan, Camelot via `get_camelot`, energy, era, year, cue count, `needs_relink` when missing) and merges them with AXIOM's `_merge_connected_dj_tracks`.
  - `POST /api/windows/virtualdj/connect_library` (licence gate, same origin); capabilities report `connect_library`.
  - `windows-virtualdj.js` adds a "VirtualDJ Library / Connect VirtualDJ" card to the chooser, using AXIOM's intake overlay, toast and library refresh.
  - On the user's data: 511 tracks (486 with Camelot, 291 with BPM, 21 missing files marked for relink). Both VirtualDJ databases were byte-identical before and after.
  - Inspect also worked on the real `database.xml` with the AXIOM Test list (3 matched; 2 E: songs are in the E: database).
- **rekordbox (found in passing):** AXIOM's `_dj_export_path` turned `file://localhost/C:/Users/a%20b.mp3` into `C:Users\a b.mp3`, so every rekordbox track needed relinking. `windows_djay.make_export_path` fixes it.
- `test_windows_virtualdj_library.py` added. Suite 39/0.
- **Not confirmed on the user's desktop:** the pickers, Live Assist popup, VirtualDJ card and activation-off launch all need the old 13:39 instance closed first.

## Running AXIOM for the user (2026-10-30 14:04)
- The 13:39 instance was still running (the user's 14:02 launch reused it, adding a window to its Edge process). Closing its main window left the launcher waiting for the extra window, so the launcher and its Edge processes were stopped directly. Then `Start AXIOM.cmd` started the new version: "Activation not required", licence status `full`, one Edge app window. The user began using it at once (track lookups in the log).
- **Health crash:** with request errors now logged, Unified Health failed with `AttributeError: module 'os' has no attribute 'uname'` in `scanner._axiom_key_analyzer_paths`, which picks the macOS CoreML key-analyzer helper by CPU.
  - A scan of all AXIOM bytecode for POSIX-only os calls found: `getuid` in `audio_core.cleanup_audio_core_results` and `scanner._shared_rust_sections` (st_uid ownership checks); `uname` in scanner and recording; `getuid` in `app.api_performance_refresh_audio` (inside a Darwin-only branch) and `utils.macos_export_access` (macOS-only); `killpg` in `studio_daw.audio_process`.
  - New `windows_posix.py` gives scanner and audio_core an os proxy with `uname` (platform values) and `getuid` (0, matching Windows' st_uid). The key-analyzer lookup now returns no helper and Health continues as designed. `test_windows_posix.py` added. Not yet handled: `studio_daw.audio_process` `killpg` (Studio).
- **Log size:** werkzeug per-request lines were reaching the log through stderr; the werkzeug logger is now set to WARNING.
- Suite 40/0. These two fixes apply from the next AXIOM start; the running instance (14:04) does not have them.

## Page-by-page walkthrough and fixes (2026-10-30, 14:15-15:22)
Run on a sandbox (`run_axiom_walkthrough_server.py fixtures/walkthrough`): the user's profile, Serato/djay/VirtualDJ data and 17 test files (MP3, WAV, MP4, AVI, VOB) copied into the workspace. An audit hook refused every Python write outside the workspace, and Serato crates for other drives were refused. No write was ever attempted outside (no `blocked-writes.log`). The 12 test MP3s with a same-named original elsewhere hash-identical to it; two other copies only share a name with unrelated older files, which are unchanged.

**Working (checked in the app):**
- Library: add folder, search, sort, previews (MP3 audio, MP4/AVI/VOB video), Find, Add, favourites, Track Information, Scan Key, Track Prep, Show Setup, Paste a Playlist, Fresh Picks, Recently Added, Matching Songs, Rescan (keeps videos; removes only missing files: 21 of 518, each confirmed missing on disk).
- Sources: Music Folder; Serato database V2 (`E:\_Serato_\database V2`, 270 usable tracks, read-only); Connect VirtualDJ (17 to 514 tracks).
- Settings: persistence, recording device list, updates, Intelligence Pack, account (dev unlocked), Dropbox, backups.
- Studio: Magic Set, Save Set, set brief, Version chooser, Matching Songs, Manual Build, CSV/M3U/XML exports, djay handoff (correctly refuses tracks not in djay's collection).
- Studio DAW: opens, decodes, shows waveforms and timing, plays, exports WAV.
- Performance: Serato connected, DJ Auto, Use Track, recommendations (5 for Brick House), Use Next, energy and tempo intents, Coach, Session Receipt, Save Session.
- Live Assist: opens expanded with suggestions. Recording on Focusrite WASAPI starts, stops and saves a valid 48 kHz stereo WAV.
- Playlists: select, rename, delete and Undo, Import Sets (JSON), Favourites.
- Health: Scan Health (17 checked, 20 fixes saved, no crash), Beatgrid Doctor check for djay and Serato, Test Batch, Session Receipt, queue.

**Fixed:**
- **Studio DAW** (new `windows_studio.py`). All 4 songs were "native full-source decoder unavailable": `studio_daw.audio_process` runs every FFmpeg job through a macOS Rust sidecar (AF_UNIX plus descriptor passing).
  - Now `audio_process.Popen` is a plain Windows child process with no console window.
  - `resolve_audio_tool` returns the launcher's FFmpeg (installed before `app` import, since the stretch, waveform and import blueprints read it at import). Rubber Band is used if on PATH.
  - `source_probe` and `drum_analysis_process` get a PeekNamedPipe selector; `prepared_cache` gets `rmtree` with `avoids_symlink_attacks`; `stems` gets `SIGKILL`.
- **O_NOFOLLOW etc.** (`windows_posix.py`). `os.O_NOFOLLOW` raised AttributeError in 12 modules: Studio cache, beat-grid batch and library, djay grid batch, native playlist files, Serato review, recovery and stage.
  - The os proxy now maps O_NOFOLLOW to an ELOOP refusal for links and junctions, and O_NONBLOCK to nothing.
  - It always adds O_BINARY (without it, Windows text mode would write CRLF).
  - It also provides `utime(fd)` (checked with samestat) and a no-op `set_blocking`, and uses windows_djay's directory fsync and replace.
  - This fixed the Studio DAW cache-lease 422 ("Unsafe prepared cache directory") and a 500 in stretch status.
- **Recording**: Focusrite WASAPI failed with "Unanticipated host error … WDM-KS". PortAudio's WASAPI needs COM on the opening thread, and Flask threads have none; `windows_capture.ensure_com()` (MTA) now runs before open and stop.
- **Serato Studio/Playlists export** (new `windows_serato_export.py`). The 409 "compatibility update" came from `utils.serato_playlist_export` (one macOS root.sqlite, triggers reviewed on macOS).
  - The export now goes to the Windows writer Serato already accepted (`_write_serato_modern_visible_crate`): the drive's database, Serato closed, backup, verify and restore. Nested folders and mixed drives are refused.
  - `test_windows_serato_export.py` runs it on a copy of the real E: location.sqlite: ordered, verified, no new assets, integrity ok.
  - **Not yet tested on the live library.**
- **VirtualDJ export** (`windows-virtualdj.js`): "Handoff to VirtualDJ" in the sidebar Export menu (current Studio set) and "Export to VirtualDJ" in a saved playlist's Export dialog. Both create a new `MyLists\<name>.vdjfolder`, refuse an existing name (409) and were verified in the sandbox. The name dialog finishes from its buttons, because a dialog's `close` event never fired in the hidden pane.
- **Reopen after export / reveal** (new `windows_apps.py`): `_open_mac_application` now starts apps by their Start menu id (`Get-StartApps` then `explorer shell:AppsFolder\<id>`; Serato DJ Pro and djay Pro are listed). The recording manager's reveal (Explorer `/select`) and play (default player) now work. Tests use a recorded runner; the real relaunch has not been observed.
- **Tests added:** `test_windows_studio.py`, `test_windows_exports.py` (XML Location and None; rescan with videos), `test_windows_apps.py`, `test_windows_serato_export.py`. Suite 44/0.

**Still not working or not ported:**
- Studio DAW MP3 export and "add to library" need the Mac app's native bridge; WAV export downloads through the browser.
- Studio stretch (pitch-preserving tempo) needs Rubber Band, which is not installed (it would have to be downloaded).
- Stems need AXIOM's bundled model worker; plugins are macOS Audio Units.
- Recording Test Signal; "DJ Software Audio" capture (use Stereo Mix or the interface); Broadcast driver.
- Serato BPM from database V2 is sparse (Serato 5 keeps BPM in its newer library), and history sessions read 0.
- Mac wording ("This Mac", Finder) and the Command-F card remain.
- C: tracks for Serato's root.sqlite are still refused.
- At an 800 px window height, the last Export menu item sits under the sidebar track counter.

**User's AXIOM:** restarted at 15:21 with all of the above (`Start AXIOM.cmd`, port 8080, activation off).

## Mac-only features replaced with Windows equivalents (2026-10-30)

| Mac mechanism | Windows replacement | Verified by |
|---|---|---|
| Bundled `rubberband` CLI (R3) | `windows_rubberband.py` takes the same arguments and runs AXIOM's own Rubber Band R3 WebAssembly engine (`stretch-engine.mjs`) under Node; FFmpeg's built-in Rubber Band filter is the fallback beyond 600 s or with no Node. A real `rubberband.exe` is preferred if installed. Fixed: negative pitch (`-p -3`) was read as the `-3` flag. | `test_windows_stretch.py`: exact length, clicks within 0.5 ms, time map, negative pitch. The FFmpeg filter alone was measured up to 16 ms off. |
| WKWebView save bridge (`mixExport*`) for MP3, Save panel and Add to Library | `windows_mix_export.py` + `windows-mix-export.js`: Windows Save As, chunked WAV, MP3 at 320 kbps via FFmpeg LAME with ID3 Title/Artist/BPM/Key copied from Studio's WAV tags, verified receipt. `export.js` also looks for `AxiomWindowsMixExport`. | `test_windows_mix_export.py` (dialog stubbed), including Add to Library of the MP3. |
| ScreenCaptureKit helper (DJ Software Audio) | `windows_loopback.py`: WASAPI process loopback (Windows 10 2004+) through ctypes COM; sounddevice-shaped stream reused by the existing capture/meter code; silent gaps filled from packet timestamps; open DJ programs from Toolhelp32. | `test_windows_app_audio.py`: a helper process's 440 Hz tone captured alone, in real time. |
| Core Audio meter helper (Test Signal) | `sample_peak` in `windows_capture.py`: 3 s on the chosen channel pair, no file. | `test_windows_recording_test_signal.py` |
| Helper-side MP3 recording | WAV take, then FFmpeg LAME at the chosen bitrate; WAV removed only after success. | same test |
| Bundled stem runtime (PyTorch MPS) | `%LOCALAPPDATA%\AXIOM\stem-runtime` (Python 3.12.15, PyTorch 2.6.0+cu124, Demucs 4.0.1, numpy 1.26.4), the Mac package's checkpoint copied to `%LOCALAPPDATA%\AXIOM\stem-models` (SHA-256 verified), and `windows_stem_worker.py` running AXIOM's worker with CUDA in place of MPS. | `test_windows_stems.py`: 20 s clip split on the GTX 1070 in 12.3 s, model load included. |
| Swift Audio Unit worker | `windows_vst3_worker.py`: VST3 effects through pedalboard 0.9.26, the same request/response protocol (scan/inspect/render). | `test_windows_vst3.py`: stand-in plugin plus the real worker process through AXIOM's endpoint. No real VST3 effect loaded: only NDI plugins are installed, and NDI Output would broadcast. |

Still open: host tempo is not passed to VST3 effects; AXIOM Broadcast (Mac virtual audio driver) has no Windows equivalent here; some server messages still say "Mac".

## Health year fix, VirtualDJ parity, scan speed, laptop libraries, stress test (2026-10-30, evening)

- Health "2 missing years" (Al Green "Im Still In Love With You", two edits): tags drop the apostrophe; every catalog found nothing for "im"; AXIOM tried ~10 MusicBrainz variants per song and was rate-limited ("MusicBrainz is busy"); the songs later received the file date (2021, `file_date_estimate`). Fix Eras' Smart view (also an empty "Search Library") lists only songs with era evidence, so they never appeared and Scan details showed Manual 0. `windows_year_fixes.py`: contractions restored for catalog queries (Apple Music now returns 1972 at 94% in two requests); Smart view adds songs with no year, or a file-date/folder-guessed year, as Manual rows (AXIOM's own row format, at most 500 rows, full count). The user's two songs still carry 2021 (not changed by me); they now show in Fix Eras with that explanation.
- VirtualDJ: beat grid check in the Beatgrid Doctor menu (`windows_virtualdj_grids.py`, AXIOM's BeatgridEngine on VirtualDJ's stored grid; read-only; review list via the list writer); Health Accelerator "VirtualDJ Database" (`windows_virtualdj_health.py`, fills missing BPM/key/year by exact path, never overwrites); VirtualDJ lists for favorites, no-cue songs, year fixes (`windows_virtualdj_exports.py`, same selection as the Serato versions); Live Assist now-playing from VirtualDJ history (`windows_virtualdj_live.py`, through the Serato slot only while Serato is closed; write guards untouched).
- Not yet for VirtualDJ: writing cues, grid repairs or play counts into VirtualDJ's database (writes to the DJ database need a verified format and the owner's approval on the real file).
- Scan speed: key/BPM analysis was 3.83 s/song with 2 workers (AXIOM's macOS memory probe fails on Windows); `windows_scan_speed.py` sizes workers from CPUs and memory: 6 here, 2.78 s/song (−27%). Tag scanning: 687 songs/s on 5,000 files. Reusing DJ analysis (VirtualDJ accelerator) avoids audio analysis entirely.
- Laptop libraries: `windows_remote_hub.py` on the home address (http://192.168.0.128:8080/), one engine per laptop (`windows_device_server.py`, own AXIOM_RUNTIME_DIR), uploads via `windows_remote_library.py` (VirtualDJ/Serato added to AXIOM's connect_dj_source). Private addresses only; PC-side actions refused; origin checked. Fixed during testing: refused requests now read their body first (Windows reset the connection otherwise).
- Stress (sandbox): 50,000 songs — load 0.8 s, search 2.1 s, Health 0.9 s, era audit 3.9 s, duplicates 11.2 s, stats 6.3 s (AXIOM's per-song timeline_year; same on macOS); 50,000-song VirtualDJ database (12 MB) read in 2.9 s, accelerator preview 5.0 s / apply 7.9 s; peak memory 1.2 GB. 57/57 tests pass.

## Red & platinum "urban" Windows look (2026-10-30, night)

- `windows_theme.py` recolours AXIOM as it is served (styles, page, scripts, AXIOM's own artwork), cached in `data\theme-cache`: lime → street red, green-blacks → asphalt, pale greens → platinum, green-greys → steel; the day-mode navy/blue accent (in `--…day…` variables and `body.light-mode` rules) → oxblood red. Emerald, orange, info blue and all album art / Serato / djay / rekordbox logos are unchanged. `windows-theme-urban.css` adds concrete grain, platinum headings, red rail and focus rings. `AXIOM_THEME=classic` restores the original look.
- Found and fixed while building it: Tailwind's `rgb(163 255 0/var(--tw-bg-opacity,1))` form, template-literal alphas, AXIOM's `[style*="rgba(163,255,0"]` rules; warm-up vs page-load writing the same cache file (now one recolour per file); a quadratic selector regex (1 MB page now 0.03 s).
- Also fixed: the laptop hub left the real interpreters behind the venv launcher running after stop (now ends the process tree; the hub test checks the engine ports close).
- 58/58 tests pass.

## VirtualDJ write-back and PEAK HOUR naming (2026-10-30, late night)

- `windows_virtualdj_write.py`: Health > Sync to DJ > "Send to VirtualDJ" (and "Write Repairs to VirtualDJ" on the VirtualDJ grid check). Writes into VirtualDJ's database.xml (format read from the real 8.5/2023 files: `<Poi Pos Num Color(ARGB) Type="cue"/>`, `<Scan Bpm(sec/beat) Phase/>` + `<Poi Type="beatgrid"/>`, `<Infos PlayCount/>`; CRLF, `&apos;`).
  - Cues: Serato, then djay, then AXIOM's saved cues, into empty slots only; a VirtualDJ cue within 30 ms or in the same slot is kept.
  - Play counts: max(Serato location.sqlite / root.sqlite by drive-relative id, djay) and only raised. AXIOM's `read_serato_counts` returns nothing on Windows (drive-relative ids), so this reads Serato read-only itself.
  - Grids: straight repairs kept by the grid check (`repair_grid`); refused when the stored grid changed since the check, has several markers, or a hand-set Tags BPM differs. Fluid repairs are not written.
  - Only the changed songs' lines are edited; every other byte stays. VirtualDJ must be closed (checked twice). Preview token, backup + receipt in AXIOM data `virtualdj-writes`, verify by re-reading (only planned songs/values differ), atomic replace, rollback on failure, Undo while VirtualDJ has not saved since.
  - `test_windows_virtualdj_write.py` (synthetic). `check_virtualdj_write_copy.py` on copies of both real databases: 23 cues + 2 Serato play counts on 25 songs, second preview empty, undo byte-identical, real files unchanged. Live preview in the app (not written): 23 cues, 3 play counts (one from djay) on 26 songs. **The real VirtualDJ databases have not been written.**
- `static/js/shared/windows-rename.js`: shows PEAK HOUR wherever AXIOM's wording says AXIOM (text, tooltips, placeholders, alert/confirm). Kept: folder paths (`Music\AXIOM DJ\Recordings`), song titles/artists, the licence window and the AXIOM Lite import, code/data names. Health workspace wordmark renamed in `health-cockpit.js`; the "AX" artwork placeholder is now "PH".

## Mac-only features and the account/licence screens (2026-10-30, late night)

- `windows_mac_parity.py` (installed by `build_backend`):
  - Reveal in Finder (`/api/library/reveal`, duplicate archive "open folder") refused off macOS; now File Explorer (`explorer /select,`), same library/file checks, local only.
  - Core Audio check reported "Audio Repair Needed" on every PC (looks for macOS's audio daemon). Now the Windows Audio service (`sc query Audiosrv`) + default output (WASAPI full name); refresh re-scans devices and gives Windows advice.
  - Duplicate cleanup's macOS Trash refused off macOS. Now the Recycle Bin (SHFileOperationW, FOF_ALLOWUNDO); the recycled `$R` file is found from its `$I` record (v1/v2) so AXIOM's SHA-256 check after the move still runs. Windows writes `$I` slightly after the call returns, so it waits up to 3 s. Verified once on the real Recycle Bin with two small text files (left there).
- `windows-hide-mac.js`: hides Command-F via macOS Accessibility (Settings, Performance, Live Assist), Check For Updates (Mac App Store), Quit (Mac app bridge), the AXIOM Broadcast feed (Mac driver), the AXIOM Lite import, and, while `/api/account/status` says no sign-in and `/api/license/status` says full access, Settings > Account & License, the sign-in window and the activation window. Licence code unchanged; with AXIOM_LICENSE_REQUIRED=1 they show again.
- `windows-rename.js` phrases: Finder -> File Explorer, macOS Trash -> the Recycle Bin, Core Audio -> Windows audio, Mac Audio -> PC Audio, this/your/another Mac -> PC, Command-click -> Ctrl-click, Audio Unit -> VST3, recording note, "System Settings" tooltip -> Settings.
- `test_windows_mac_parity.py`.

## Readability pass and activity meter (2026-10-30, late night)

- Sidebar menu on a solid plate (white, heavier lettering). Region covers without their titles: `make_region_backgrounds.py` crops below "<region> / 90s HIP-HOP" and the sleeve border, softens slightly -> `static/brand/regions/*-bg.jpg`; overlay .66-.86.
- Softer red: theme accent saturation 58-68%, lightness held near 40% (`RED_SAT`, `_red_light`), day-mode accent #961c26, art saturation lift 0.12; `--ph-red` #b3262f. THEME_VERSION peak-hour-90s-2.
- Type: `static/windows-fonts.css` replaces desktop-fonts.css on every page: "Bebas Neue" -> Bahnschrift SemiBold Condensed (local, wdth 75 / wght 600 via @font-face descriptors; ~7% wider than Bebas), "Barlow" -> Segoe UI (Semibold/Bold/Black by weight); bundled files as fallback.
- Font Size setting (80-150%) only resized song titles. `windows-font-scale.js` zooms #main-content-wrapper (the main area reflows inside the window; html zoom overflowed vh-sized parts such as the sidebar); Settings (#master-hud, the only fixed element inside) is counter-zoomed so it always fits; titles no longer scale twice.
- `static/css/windows-activity.css`: Health scan banner -> slim top-centre meter (task, thin bar, %, Stop); player-takeover messages -> small card above the player's right end, player stays usable; "working" messages hidden while the meter shows.
- Settings > Set Recording: description rewritten for Windows (Serato, VirtualDJ, djay, rekordbox, Traktor via process loopback, or controller/interface; WAV/MP3; folder shown below); its 3px description column fixed (full width above the controls).

## Real VST3 effect (2026-10-30, late night)

- Downloaded with the owner's OK: Dragonfly Reverb 3.2.10 (GPL-3), `dragonfly-reverb-3.2.10-win64.zip`, 22,447,365 bytes, SHA-256 ca5f35f9…0824c66, from github.com/michaelwillis/dragonfly-reverb. Only the four `.vst3` bundles were extracted, to `fixtures/vst3-plugins` (zip deleted). Nothing installed.
- Bug found: pedalboard on Windows cannot open a VST3 bundle folder, so every bundle-format effect (most modern ones) was skipped. `windows_vst3_worker.binary()` loads `Contents\x86_64-win\<name>.vst3`; ids still come from the bundle path.
- Bug found in the tests: Windows resets `CommonProgramFiles` for each new process, so the worker started by AXIOM's endpoint scanned the PC's real VST3 folder. `AXIOM_VST3_FOLDERS` now replaces the standard folders (tests and the check use it). The PC's NDI bundles contain only an icon (no plug-in file) and never loaded.
- `check_vst3_real_plugin.py`: 4 Dragonfly effects found; Hall Reverb shows 20 controls; a drum hit rendered with a 2 s tail (dry tail silent, wet tail RMS 0.0071); AXIOM's endpoint (real worker process) lists the same 4. The running app (started with AXIOM_VST3_FOLDERS for that check, then restarted normally) returned the same list and controls.
- Still open: host tempo not passed to VST3 effects (pedalboard has no transport). "Audio Unit" wording in the DAW dialog -> "VST3 effect" (windows-rename.js).

## Gaps: Ctrl+F Live Assist, streaming feed, installer (2026-10-31, early)

- `windows_hotkey.py` (started by the launcher; Settings > Workflow "Ctrl+F Shows Live Assist", on by default, `live-assist-hotkey.json`): polls GetAsyncKeyState for Ctrl+F (no hook, nothing recorded) and, while Serato/VirtualDJ/djay/rekordbox/Traktor is the front window, shows the "PEAK HOUR Live Assist" window without taking focus (SWP_NOACTIVATE; verified focus unchanged on the real desktop) or opens it in the cockpit's Edge profile (that first open takes focus). `test_windows_hotkey.py`.
- `windows_feed.py`: streaming feed in place of the Mac AXIOM Broadcast driver. With the feed on, each captured block also plays into a virtual audio cable output (VB-CABLE, Voicemeeter, Virtual Audio Cable; MME entry) for OBS etc.; ~0.35 s buffer, oldest dropped, a feed error never stops the take. AXIOM's broadcast_* fields now come from the cable; Settings/Live Assist Streaming Feed control shown again. No cable on this PC, so not heard end to end. `test_windows_feed.py`.
- Installer: `build_installer.py` -> `dist/PEAK HOUR/` (runtime = the project's CPython 3.12 + venv site-packages, app/, version.txt, uninstall.ps1), `PEAK-HOUR-1.0.5-win.zip` (287 MB), `PEAK HOUR Setup 1.0.5-win.exe` (IExpress, ~284 MB). `installer/install.ps1`: per user to %LOCALAPPDATA%\Programs\PEAK HOUR, unpack with Windows tar (19 s; Expand-Archive took 224 s), swap in, Start menu + desktop shortcuts with the icon, Settings > Apps entry (HKCU Uninstall). `uninstall.ps1` refuses folders that are not a PEAK HOUR install; keeps AXIOM DJ data and recordings. Sandbox test (no real shortcuts/registry): installed app served the page, hotkey active, audio ready; reinstall and uninstall clean. Not included: GPU stem runtime (separate), code signing (needs the publisher's certificate), update feed (needs hosting).
- VST3 tempo: needs a host that passes BPM (DawDreamer 0.9.0, cp312 win wheel 23.1 MB) — waiting for the owner's OK. Licensing: pedalboard (already used) and DawDreamer are GPL-3; selling PEAK HOUR with them inside raises GPL obligations to settle before release.
- VST3 tempo (with the owner's OK): DawDreamer 0.9.0 (`dawdreamer-0.9.0-cp312-cp312-win_amd64.whl`, 23,089,487 bytes, SHA-256 0076ebe3…e945f5b9, PyPI) installed offline from that file with uv (no dependencies). AXIOM's DAW already sends `tempo: {startBeat, points[{beat,bpm,linear}]}` with every effect render; the worker now renders through DawDreamer when it is present (`render_with_tempo`): constant BPM, or a float32 per-tick curve (96 ppqn) for tempo changes/ramps inside the clip; control values copied from pedalboard by index (DawDreamer's load_state did not accept pedalboard's state blob — values came back as defaults); latency compensated; any DawDreamer failure falls back to pedalboard. Dragonfly Hall at 92 BPM: same tail as pedalboard (0.00702 vs 0.00710). Not proven with a tempo-synced effect (none installed); DawDreamer's transport starts at the clip's beat 0, not its bar position. GPL-3 like pedalboard.

## Stress-test report for a second PC (2026-10-31)

Settings > Library & Data > **Stress-Test Report** (`windows_stress_report.py`, `static/js/shared/windows-stress-report.js`)
saves `PEAK HOUR Stress Report <PC> <date time>.zip` on the Desktop: `report.txt`, `report.json` and the last 2 MB of each
log in `%LOCALAPPDATA%\AXIOM DJ\Logs`. Contents: PC (Windows, CPU, memory, scan workers, free space on library drives,
PEAK HOUR version from `version.txt`); the loaded library (`library_cache.json`, read-only): songs per type, missing
BPM/key/artist/length/year, key-scan states and speed of the latest run, files gone from disk; every file under the library
folders by type, flagged when PEAK HOUR does not import that type, plus 260+ character paths, non-English names and folders
that could not be opened; up to 8 random files per imported type opened with `windows_media_probe` (codec list, each
failure with its error); every request over 1.5 s, 5xx responses and ERROR log records since start (`Activity`, installed
by the launcher); VirtualDJ/Serato/djay libraries found. Time limits (walk 240 s / 3M files, exists-check 90 s, opening
180 s) mark a section partial instead of hanging. Nothing outside the zip is written.
Checked: `test_windows_stress_report.py` (fixture library with good/broken WAVs, .mkv, .jpg, non-English and 260+ path
names, recycle-bin folder skipped, nested library folder counted once, music unchanged) and a real run on this PC
(56 songs, 59 files, 8 MP3s opened, 636 requests none slow, 2 VirtualDJ databases, Serato and djay found, about 10 s).
Note: AXIOM's scanner imports .mp3 .wav .aiff .flac .m4a .aac (and the video types added for Windows); .aif and .ogg
files will show as not imported, which is AXIOM's own list.

## "Adding your music" on a big library (2026-10-31, from the second laptop)

Reported: 20,275 tracks, "LIVE." with no percentage, Hide progress did nothing, scrollbars on a laptop.
- Hide progress: AXIOM's status loop (library-connections.js, every 1.2 s) calls updateMusicIntakeOverlay, whose
  render removes `hidden`, so the window came straight back. `static/js/shared/windows-intake.js` wraps the four
  overlay functions: once hidden it stays hidden; a top tab meter (styled like the Health scan meter) shows the
  import with Show to reopen it, and after the library is ready shows step 2 (reading track details).
- No percentage: AXIOM's scan indexes as it walks, so the job never has a total. `windows_intake.py` wraps
  `_run_add_folder_job` and counts the supported music files from the directory listing alone (same rules as
  the scanner: SUPPORTED_FORMATS, sidecars, excluded folders, recycle bin) in a second thread, then writes it as
  the job's `total` (AXIOM's own window turns that into a percentage). `/api/windows/import-progress` adds
  step 1/2, files per second and time left; step 2 is timed from `library_ready` (`step_started_at`).
- Measured here: the first pass (paths only, no file opened) indexes 5,000 local MP3s in about 1.3 s; step 2
  reads tags at roughly 1,200/s. The laptop's 20,275 in 266 s (~76/s) for step 1 points at a slow drive
  (USB/network); the stress-test report will show it.
- Laptop screens (Windows scaling gives ~1180x570 CSS px): `static/css/windows-intake.css` sizes the window to
  the viewport (overflow: clip, since focus on Hide progress scrolled the clipped box 125 px), hides the player
  while it is open, and the edition label "PRO" is removed.
- Art: `static/brand/vault-crate.png` (make_vault_crate.py: themed crate with the PEAK HOUR mark replacing the
  AXIOM "A / PRO" plate) and `static/brand/folder-open-red.svg`.
- Lime icons app-wide: AXIOM tints black icons with CSS filter chains (sepia/saturate/hue-rotate), which the
  colour substitutions never saw. windows_theme.filter_color evaluates each chain on a black icon (Filter Effects
  matrices in sRGB) and a green result is replaced by ICON_RED, which gives recolor(163,255,0) exactly
  (THEME_VERSION peak-hour-90s-3). Blue (day mode) and orange filters are unchanged.
Checked: test_windows_intake.py (count rules, progress maths, a real 5,000-song import through AXIOM's job ends
with total 5,000), test_windows_theme.py (filter cases), and in the browser at 1180x570 and 1920x1040 with a
sandbox server slowed to ~77 files/s (run_intake_sandbox.py, PH_SLOW_SCAN): percentage, speed and time left,
Hide progress stays hidden through status checks, meter, Show, step 2 meter, library loaded 5,000.

### "Finalizing" stall on a USB drive (same day, desktop with the laptop's drive)

The import of X:\VIDEO\MP4 (Crucial X10, exFAT, 20,283 MP4s of ~130 MB in ONE folder) sat at 20,275 for minutes
on both PCs. A faulthandler dump of the same scan showed it in ntpath.realpath (scanner.py line 409, after the
walk). realpath opens each file; on this exFAT folder that cost 9-18 ms a file (exFAT searches the folder for
each open) and a counted import (5,000-song fixture) showed realpath per file 4 times in step 1 and 4 more in
step 2 (app._scan_and_merge_folder), i.e. ~15-18 min of "Finalizing" per step with no progress shown.
windows_intake.FastRealpath: in the add-folder job thread only, each folder is resolved once and listed once,
and a plain file's real path is the folder's real path + the name as the listing stores it (links, reparse
points, unlisted names, bytes and other threads use Windows' realpath). On the real drive: 355 inputs (random
files, upper-cased names, a missing file, the folder, ..\ and / forms) identical to ntpath.realpath; all 20,330
entries in 0.34 s instead of ~265 s. The window says "all files found, saving your library" instead of "99%,
0 s left" while that runs. test_windows_intake.py covers junctions, case, missing files, other threads.
Step 2 on that drive reads ~27 videos a second (mutagen opening each MP4).

### Lag with 20,339 tracks (Health > Fix details)

The PEAK HOUR window's renderer used ~97% of a core and 3.9 GB while the server was idle. Long-animation-frame
script attribution in the same view: AXIOM's static/color-laws.js `checkElements`, run by setInterval every 2 s,
calls getComputedStyle on every p/h*/span/a/button/input/textarea and again up each one's ancestor chain to find a
background, ~250 ms per run on Health (2.0 s blocked in a 15 s sample); the result is used only when its debugMode
is on, which it never is. static/js/shared/windows-performance.js makes setupContrastChecking start only when
debug mode is switched on (toggleColourDebug still works). Measured on a fresh page: 10 getComputedStyle calls in
6 s with debug off (0 from color-laws), 20,580 in 5 s after toggling debug on. cta-typography.js (full re-scan of
CTA buttons on any class change) costs ~2% and is left as AXIOM wrote it.

### Server-side snags with 20,339 tracks (same day)

Every request, even /api/app/window_heartbeat, took ~0.55 s: the server sat at 100% of a core. A new local-only
/api/windows/threads (sampled stacks of every thread; also in the stress-test report as `threads`) showed the
`axiom-health-count-1` thread (AXIOM's _run_health_scan_job, started each time Health opens) in os.stat on every
track: ~6 ms each on the exFAT USB drive, 265.5 s per count. windows_performance.faster_health_count runs that
thread inside FastRealpath.active(stat=True): stat and realpath answered from one listing per folder (size and
modified time identical on 300 sampled files; the listing has no st_ino/st_dev, which no function reachable from
the count reads, and the import never uses it). Count 265.5 s -> 5.7 s; the full /api/library/health response
(4.5 MB, timestamps removed) identical. Also, each with exact answers:
- recording_classification: below 900 s with no override AXIOM always answers "music"; answered directly
  (identical on all 20,339 tracks + edge cases). get-tracks 0.6 s -> 0.3 s.
- _track_source_connected: once per file per GET request (was twice per row).
- _strip_suffixes rebuilt its pattern for every title/artist (7.4M re.escape calls); built once per suffix list
  (identical on 98,481 strings). enrichment_report 11.6 s -> 2.65 s.
Left as AXIOM wrote them: utility_audit ~6 s, dupes ~3.7 s, era_audit ~1.5 s (their cost is the work itself).
After the restart: heartbeat 5 ms, server 0% idle. test_windows_performance.py covers all of the above.

## AI Assist: Claude or ChatGPT for years, titles/artists, genres, energy (2026-10-31)

With the owner's OK, from PyPI into axiom-win-env (offline install with uv from downloaded wheels; versions at
least two weeks old): anthropic 1.15.0, openai 3.32.0, pydantic 2.14.1, pydantic-core 2.50.1, httpx2/httpcore2
2.13.1, anyio 4.15.1, jiter 0.17.0, h11 0.16.0, sniffio 1.3.1, docstring-parser 0.18.0, opentelemetry-api 1.45.1,
annotated-types 0.8.0, typing-inspection 0.4.4, truststore 0.10.5 (7.3 MB). build_installer's import check covers them.
windows_ai.py + static/js/shared/windows-ai.js + static/css/windows-ai.css, Settings > Library & Data > AI Assist:
- Keys: typed by the owner, sent only to this PC's server, stored with Windows DPAPI (CurrentUser, extra entropy) in
  %LOCALAPPDATA%\AXIOM DJ\ai\keys.dat; never returned to the page or logged. POSTs are this-PC only.
- Claude: official SDK, Messages API, output_config json_schema + effort medium; Opus 5.5 (default) and Sonnet 5.5
  through beta server-side-fallback-2026-07-01 with fallbacks "default"; Haiku 5.5 plain (no fallback). Refusal and
  max_tokens stop reasons reported. ChatGPT: official SDK, Responses API, strict json_schema, store=False; GPT-5.5
  default, GPT-5.4, GPT-5.4 mini.
- Tasks (40 tracks per request, up to 5,000 per run): release year (+ remix/version year, compared with AXIOM's
  catalogue candidates), tidy title/artist (keeps DJ version tags), genre (prefers the library's own top 80 genres),
  energy (Low/Mid/High/Ultra). Scope "only the ones that need it" or all.
- Suggestions only, saved per run in ai\runs\<id>.json. Applying the ticked ones goes through PEAK HOUR's own
  endpoints (update_year, update_track_metadata, update_genre) via the app's test client with the launcher's host;
  energy (no AXIOM endpoint; AXIOM derives it from BPM and recomputes when BPM changes) is saved like AXIOM saves:
  file_lock(CACHE_PATH+'.edit'), _resolve_library_cache_tracks_for_health, _commit_unified_health_cache_locked,
  with energy_source "ai_approved". Music files and DJ libraries are untouched (Health publish does that).
Checked: test_windows_ai.py (real SDKs against stand-in Claude/OpenAI servers: request shapes, fallback header,
strict schema, refusal and bad-key messages, DPAPI round trip with no plaintext on disk, all four tasks through a
fixture library, skip leaves tracks unchanged, music files byte-identical) and the window at 1180x570.
Not checked: a real Claude or OpenAI call (needs the owner's key and is billed to it).
Consumer logins (ChatGPT Plus/Pro, Claude Pro/Max): not usable by other apps; see the answer in the session.
- Playlists (added the same day): AI Assist > Build a playlist. The DJ describes the set (optional BPM and year
  limits, 5-100 tracks). PEAK HOUR narrows the library to at most 600 candidates (filters; long recordings left out;
  best matches for the words of the brief first, then an even spread), sends id/artist/title/BPM/key/year/genre/
  energy/length, and the AI returns ordered ids with a reason each (schema: name, notes, tracks[id, why]). Unknown ids
  and repeats are dropped. The list is shown first; Save calls the page's own upsertSavedPlaylist(name, tracks,
  {forceNew: true}) so it is a normal saved set (Playlists, Studio, exports to Serato/VirtualDJ/djay), never
  replacing one with the same name. Messages show inside the window (the player bar that carries PEAK HOUR's
  messages is hidden while it is open). Checked with the stand-in server (order kept, unknown id and repeat dropped,
  filters, cap, minutes) and in the page (6 real tracks saved in Playlists, no AI notes stored in the set).
- OpenAI 429 with code "credit_balance_exhausted" (type "insufficient_quota") on the owner's key: the API account had
  no credit (a ChatGPT subscription does not include API use). Both codes now say so; other 429s show OpenAI's own
  explanation; Claude's "credit balance is too low" 400 likewise. Covered in test_windows_ai.py.
- Apply ticked looked dead: each approved year went through AXIOM's update_year, which resolves every library track
  (canonical_path) and checks every track with os.path.islink twice (_unified_health_cache_track_index): ~93 s per
  save on the exFAT drive (cProfile: 20,230 islink calls, 98 s). Apply now runs in the background with progress
  ("Saving 12 of 144"), refuses a second click while saving, and runs inside FastRealpath.active(); FastRealpath now
  also answers os.path.islink from the listing (exact: 105 entries on the drive, junction and missing file). The
  listing stat stays off in saves (AXIOM's cache signature reads st_ino of library_cache.json). On a copy of the
  library: 10 saves 27.5 s (2.75 s each, was ~93 s), years correct.

### Setup looked stuck at "Unpacking" (2026-10-31)
The install had finished (files 13:10:58, shortcuts 13:11:06, uninstall key 13:11:08) but install.ps1 sat at 0% CPU on
its last Write-Host: a click in the console turns on QuickEdit selection, which blocks the next output until Esc.
install.ps1 now turns QuickEdit off (SetConsoleMode, ENABLE_QUICK_EDIT_MODE cleared), titles the window "PEAK HOUR
Setup", shows a Write-Progress bar from tar -v (files unpacked of the zip's entry count) and ends with an "installed"
message box. Sandbox install with -Quiet: 22,070 files in 27 s, exit 0, parser clean.

### Faster video preview, audio-only playback, Library > Type (2026-10-31)

- Preview converted every video in full (libx264 veryfast) before playing: 52.4 s for an 87 MB, 4-minute music video
  on the exFAT drive. 60 sampled videos from X:\VIDEO\MP4 were all H.264 + AAC in MP4 (10 with moov at the end), which
  Edge plays as they are. windows_video_preview.preview_plan: H.264 8-bit 4:2:0 with AAC/MP3/no sound in MP4/M4V/MOV
  -> "direct" (the library file is streamed with range requests, nothing copied); other H.264 -> "copy" (picture
  copied, sound to AAC); anything else -> full conversion. The media worker now reports pix_fmt. The page converts
  automatically if Edge cannot play a direct file. Measured on the real library: prepare 2.7 s (isolated probe
  process) + first frame 0.3 s; first preview after the drive woke 8.4 s.
- Audio only: "Play audio only" in the video window and "Always play audio only" (window checkbox, and Settings >
  Library & Data > Play Video Tracks As Audio Only, kept in localStorage) send video tracks to the normal player
  (soundtrack decoded in 0.8 s). audio-player.js passes artist/BPM/key/energy to the video window for this.
- Library > Type (windows_filetypes.py, static/js/shared/windows-filetypes.js): All files / All audio / All video /
  each extension with counts (/api/windows/library/types). The page adds filetype= to /get-tracks and
  /api/library/search through appendLibraryRootParams; the server gives those two requests a narrowed copy of AXIOM's
  search snapshot under its own index key (AXIOM skips track_matches_era when the era is "All", so that hook did not
  work). Real library: MP3 (56) shows only the 56 MP3s. JPG covers and other non-music files are not library tracks.
Checked: test_windows_video_direct.py, test_windows_filetypes.py, existing video tests; 67 tests pass.
- Setup builds then failed with IExpress exit 1. A minimal SED built fine and ours built fine from %TEMP%; the failing
  case was IExpress having to overwrite the previous 319 MB setup exe (set aside, the same SED built in 485 s).
  build_installer.py now moves the previous exe to .previous, restores it if IExpress fails, deletes it on success.
  (Quoting the SED path for iexpress.exe makes it fail with "Error opening the IExpress Self Extraction Directive
  file"; the build passes it unquoted.) install.ps1 no longer shows its own finish box: IExpress's FinishMessage does.

## User manual (2026-10-31)
- `axiom-win-probe/static/manual/index.html`: offline user manual (15 chapters: install, getting around, adding music, Library and the Type filter, video tracks, Studio and Magic Set, exports to Serato/djay/VirtualDJ, Performance and Live Assist, Playlists, Health, AI Assist, other laptops, Settings, troubleshooting, What's new). Opened from Settings > System > User Manual (`#settings-user-manual`, new window); ships in Setup with the app folder.
- 25 screenshots in `static/manual/img/`, taken by `make_manual_screenshots.py` (headless Edge over the DevTools protocol, standard-library WebSocket client) from the walkthrough sandbox; shot list in `manual_shots.py`. Shots clear toasts and show the sandbox profile path as `C:\Users\You`. Headless Edge has no H.264 decoder, so the video-window shot shows an FFmpeg frame of the clip (E: drive) as the player picture. The studio-set shot adds songs to the sandbox's own set.
- Every wording in the manual was checked against the app (labels, menus, Set Prep Options, DJ Auto, AI Assist options).
- Rule: each user-visible change updates the manual (how-to, What's new, Last updated) and retakes affected shots.

## Edge or Chrome for the window (2026-10-31)
- `windows_browser.py`: Settings > System > "Open PEAK HOUR In" (Microsoft Edge default, Google Chrome). Choice in `window-browser.json`, used from the next start; a browser that is not installed falls back to the other, neither gives the default browser. Separate app-window profiles (`Window` for Edge, `Window-Chrome`), since the formats differ. Live Assist uses the same browser and profile. The launcher's `find_edge` is replaced by `window_browser()`; the close-detection loop watches the chosen profile's lockfile.
- Checked on this PC with an isolated data folder: Chrome opened `--app=http://127.0.0.1:8099/` with its own profile, the page loaded, and closing the Chrome window stopped PEAK HOUR (log "AXIOM window closed; stopping"). `test_windows_browser.py` added. Manual updated (install note, Settings > Use Chrome instead of Edge, What's new, new shot `settings-browser`).

## Security review fixes: laptop hub and local server (2026-11-01)
- Hub path bypass: `windows_remote_hub.py` now refuses (400) any request target that is not a plain `/path` (percent escape, `//`, backslash, control character, dot segment, absolute-form URL); the block list compares exact allowed routes. Python's own server folds a leading `//` first, so `//api/windows/...` reaches the block list and gets 403. Each laptop engine (`windows_device_server.py`) repeats the block list on the decoded path and the matched route (`install_device_guard`) and answers only requests carrying this run's secret header (`X-Axiom-Hub-Token`, random per hub run, passed in `AXIOM_HUB_TOKEN`; a client's own copy is dropped).
- DNS rebinding: Host must equal `<hub address>:<port>` (case-insensitive) or the hub answers 403 first; Origin, when present, must equal that origin.
- Pairing: the hub is opt-in (`AXIOM_HUB=1`; off otherwise). A laptop enters a 6-digit one-time code (valid 10 minutes, renewed after use, 5 wrong tries per address, 30 overall per 10 minutes) and names its library (same name again = same library). The cookie `axiom_device` is a random session token (HttpOnly, SameSite=Strict, Path=/); `devices.json` keeps only its SHA-256. No device ID or token is shown in any page. The code is in the launch log and on the PC at Library > Add music > Other laptops (`GET /api/windows/remote/pairing`, loopback only; `windows-remote.js`). Laptops that used the old ID cookie must pair again.
- Laptop engines get deny-all file policies (`build_app(port, device=True)`; new optional `safe_location` in `build_backend`); the PC keeps its current policies. Review round 1 found core routes that take a file path without the patched policy, so the hub block list and engine guard now also refuse `/api/audio/*` (would play any PC file on the PC's speakers), `/api/library/artwork`, all of `/api/studio-daw/*` (import, project bundle/unbundle, stretch, steady-timing, midi: audio files and devices of the PC), `/api/studio/upload_csv_path` and `/api/library/import_release_years_csv` (read a file by path), `/api/app/lite_migration/*` and `/api/intelligence/*` (import from this PC's folders), `/api/library/dupes/trash|software` (Recycle Bin and DJ-software actions on library paths). Left open on purpose: routes that only edit the library cache in the device folder (`bytecode_inventory/app.pyc.functions.json`: no file access beyond the cache) and `/api/library/playlist/parse` (text only). Not traced to the bottom: tag writers behind the `update_*` / `era_audit` routes. Studio DAW and the year-CSV import are therefore unavailable on a laptop.
- Review round 1 also: Content-Length must be a plain non-negative integer (else 400, never read to the end of the stream); an expired pairing code is not a wrong guess and makes (and logs) a new code, and the PC card re-fetches the code each time it is shown and every 15 s; the engine guard is inserted before the core's hooks; whoami copies names under the registry lock; `hub.json` is no longer written. Manual chapter 12 and What's new describe the opt-in hub and the pairing code.
- PC server: `local_only` now refuses non-GET/HEAD/OPTIONS requests unless Origin is `http://127.0.0.1:<port>` or `http://localhost:<port>`, or Origin is missing and Sec-Fetch-Site is `same-origin`/`none`; Origin `null` is refused. AI Assist's in-process save calls now send that Origin. The Edge/Chrome `--app` windows and the Live Assist popup load from the same origin and send it; the app uses no sandboxed frames or `file:` pages.
- Tested: `test_windows_remote_hub.py` (rewritten to build its own sandbox, stand-in engine and VirtualDJ database; real engines started) and `test_windows_launcher.py` pass. Not run here: tests that need `fixtures\stress` (absent on this PC).
- Review round 2: a laptop's uploaded database could name files on this PC (`FilePath="C:\Users\...\x.mp3"`), which core routes then read (`os.path.exists`, `isfile`, Mutagen). In a laptop engine `windows_remote_library.py` now stores every imported path as `laptop:` + the original path (not a valid Windows path) and sets `needs_relink` without checking the file (`axiom_track(check_file=False)`); the PC's own VirtualDJ connection is unchanged. Also refused for laptops: `fix_track`, `batch_fix_track`, `/api/library/unified_health/*` and `health/audio_sources`. Laptops lose per-track fix and the Health scan; search, tracks, playlists, year/genre/BPM/key edits and the rest of the cache-only routes stay. The test plants a real PC file in an uploaded database and checks the stored path, `needs_relink`, and that the engine and hub reveal nothing. Serato uploads are prefixed the same way, but `_load_serato_library_tracks` may still look at paths while reading (not traced).


2026-11-01 (recording data loss, branch fix/data-loss): two bugs fixed. (window close) Closing the window during a recording left a `.partial` with no finished header and the next launch said "Recording was interrupted". The launcher now calls `finish_recording(axiom)` after the window closes and again in `main()`'s `finally` (before the server shuts down): it calls `axiom.SET_RECORDING_MANAGER.stop_if_recording()` (new; waits for an MP3 encode already running), logs the result to launch.log, and if the stop raises it logs the traceback and leaves the `.partial` for recovery. A hard kill of the process (Task Manager, power loss) still cannot finalise; that path is unchanged. (dropouts) One PortAudio status flag or a full queue no longer fails the take. Input overflow/underflow and a non-finite block are counted as dropouts (the block is kept; non-finite becomes silence); the queue now holds about 30 s of audio, counted in frames (`queue_seconds`), and when it is full the block is dropped and replaced by the same number of silent frames in its original position, so timing holds. `status()` and the stop log report `dropouts` and `dropped_frames`; the manager shows "saved with N short dropouts". A real device error (stream stopped, stop/close failed) is still reported as an error but the audio recorded so far is finalised and renamed, with the error kept in the saved state; only a failure of the file write itself keeps the `.partial` and raises. MP3 encoding no longer holds the manager lock (status polls answer; a new start is refused with "still being saved" until it ends). 4 GiB: the wave module overflows the RIFF size at about 6.2 h of 16-bit/48 kHz stereo; chosen minimum is to stop writing 1 MiB short of the limit, flag `limit_reached`, show "Recording is full; stop to save it", and keep draining the stream, so the file stays a valid WAV and `recover_pcm16_partial` (which already rejects over-limit payloads) is unchanged. It does not roll over to a second file or use RF64/W64 (recovery and the manager's single output path would both need to change). Tests: `test_windows_capture.py`, new `test_windows_recording_stop.py`. Not tested: a real device, a real Edge window close, and the 4 GiB limit with real data (the limit is lowered in the test). Review round 1: (window close) `stop_if_recording()` now re-checks under the lock until no stop or MP3 encode is in flight, so a Stop clicked just before the window closes is waited for; `finish_recording` runs in a thread with a limit (60 s, 1900 s for MP3), publishes port 0 meanwhile so a second launch shows "PEAK HOUR is saving your recording", and logs if the limit is hit; the file writer join is limited to 60 s; the WAV is persisted as saved before the MP3 encode so a crash then is not reported as interrupted. (dropouts) a text status from the stream (ProcessLoopbackStream: "program may have closed") is a failure with that message and the take is still finalised; only real CallbackFlags count as dropouts; pauses in process loopback reach the recorder as `add_gap(frames)` (no giant zero arrays), and a silent block longer than the queue is a gap, not a dropout. Tests added in `test_windows_capture.py` and `test_windows_recording_stop.py`.

## Data-loss fixes: Recycle Bin and AI Assist (2026-11-01)
- Recycle Bin: `windows_mac_parity.recycle()` now calls `check_recyclable()` before SHFileOperation and raises OSError (file untouched, 'NOT deleted') unless the volume (GetVolumePathNameW, so mounted folders work) is DRIVE_FIXED, its bin is not set to NukeOnDelete and the file is within the per-volume MaxCapacity (HKCU ...\Explorer\BitBucket\Volume\{guid}). Backstop: the flags add FOF_WANTNUKEWARNING (0x4000) to FOF_NOCONFIRMATION, so any permanent delete Windows still decides on is asked, never silent. SHQueryRecycleBinW was not used: it reports bin size, not the quota. A volume with no GUID (SUBST drive) is refused; the NoRecycleFiles policy (HKCU/HKLM) refuses and RecycleBinSize (read as MB, smallest wins) caps the size; with no stored size, a file over 5% of the drive is refused (estimate of Windows' default quota). The FOF_WANTNUKEWARNING prompt is only a last resort: it may open without an owner window (hwnd NULL, on a server thread) and could hide behind the Edge window, so the checks above are meant to catch every case first. Same exception type as before, so the duplicate-trash callers show the message.
- AI Assist: `_load()` turns a saved run or apply left as 'running' (no live thread after a restart) into 'interrupted', saves it, and start/apply work again; status(), suggestions(), start() and apply() all go through it (the playlist job is memory-only). apply is refused while the run is live; `_save` holds a lock and retries if the dict changes under json.dumps; a bad limit/count gives a 400 ('must be a whole number'). The page shows 'Stopped when PEAK HOUR closed' for both.
- Tested: `test_windows_mac_parity.py` (temp file on the fixed drive still goes through the stand-in bin; simulated removable/network/CD drive, NukeOnDelete and over-size bin all refuse and leave the file) and new `test_windows_ai_recovery.py` (planted run files, live-run apply refusal, concurrent saves, 400s). `test_windows_ai.py` still cannot run here: `fixtures\stress\seed.mp3` is missing. Not tried: a real USB stick or a real SHFileOperation prompt.

## 2026-11-01 - Preview stalls (audio deck and video store)
- Audio: `windows_audio.py` no longer converts M4A/MP4 to a temporary WAV first. A reader thread decodes (libsndfile, or PyAV for AAC/MP4 containers) into a 2 s lock-free ring buffer; the PortAudio callback only copies from the ring (silence on underrun, no locks) and seek swaps in a new ring that the reader re-seeks to. stop/close joins the reader, which closes the file. Public API unchanged (`play/pause/resume/stop/seek/seek_relative/set_volume/status`, `NoAudioDeck` untouched). Tested: `test_windows_audio_stream.py` plus the four existing audio tests.
- Video: `VideoPreviewStore` reserves a slot under its lock, probes/converts outside it, and publishes after. A failed delete (Edge still has the file open) drops the item and queues the folder for retry (next prepare/remove, and at close); previews idle for 10 minutes expire; the page releases on pagehide with `fetch(..., {keepalive: true})`. Tested: `test_windows_video_store.py`.
- 2026-11-01 perf/housekeeping: VirtualDJ write keeps the plans of the last 3 previews (15 min) and reuses them in apply when the database bytes, the audio files' mtime/size and the Serato/djay/grid sources are unchanged (2,000 tracks: apply 4.4 s -> 0.18 s with a 2 ms simulated tag read); stage file removed on failed swap, rollback failure no longer hides the first error, written database is re-read and compared. Grid check appends finished rows to `<results>.rows` and rewrites only counters (20,000 results: 16.8 s / 2.2 GB written -> 1.0 s); full results are written at the end and after a close mid-run the rows are read back. Theme: ETag compared with the prefixed value (304 now works), recoloured dynamic pages cached by content hash. launch.log and per-device engine.log rotate at 5 MB x 3 files.
