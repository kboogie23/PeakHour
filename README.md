# PeakHour

PEAK HOUR is the Windows edition of AXIOM PRO: a DJ set-building app with a 90s hip-hop look in red and platinum. It works alongside Serato DJ Pro, VirtualDJ and djay Pro.

- **User manual:** `axiom-win-probe/static/manual/index.html`. In the app it opens from Settings → System → User Manual.
- **Work log:** `investigation.md` records every change, what was found and how it was checked.

## What's in this repository

| Path | What it is |
|---|---|
| `axiom-win-probe/` | The app: AXIOM's compiled modules (`*.pyc`), templates and static files, plus the Windows layer (`windows_*.py`, `static/js/shared/windows-*.js`, `axiom_windows_launcher.py`) |
| `test_windows_*.py` | Tests. Run each with the project Python, for example `axiom-win-env\Scripts\python.exe test_windows_browser.py` |
| `build_installer.py`, `installer/` | Builds `dist\PEAK HOUR Setup <version>.exe` and the standalone manual |
| `make_manual_screenshots.py`, `manual_shots.py` | Retake the manual's screenshots from the sandbox |
| `run_axiom_walkthrough_server.py`, `run_intake_sandbox.py` | Run PEAK HOUR on test copies, never the real libraries |
| `Start PEAK HOUR.cmd` | Starts PEAK HOUR from this folder |
| `requirements-windows-probe.txt` | Exact package versions of the project Python |

## Not in this repository

These stay on the PC where they were made:

- `python/` and `axiom-win-env/`: the Python runtime and its packages. Recreate them as described below.
- `fixtures/` and `probe-home/`: copies of real music and DJ databases. Tests that need fixtures can't run until fixtures are made on that PC.
- `dist/`: the built Setup and zip.
- `axiom_package/`, `axiom_extracted/`, `axiom_bytecode/`: the original macOS package and the files extracted from it.

## Set up on another Windows PC

1. Install [uv](https://docs.astral.sh/uv/) and Git, then clone this repository.
2. In the cloned folder, make the project Python and install the packages:

   ```
   uv python install 3.12.15
   uv venv axiom-win-env --python 3.12.15
   uv pip install --python axiom-win-env -r requirements-windows-probe.txt
   ```

3. Start PEAK HOUR with `Start PEAK HOUR.cmd`. Its data lives in `%LOCALAPPDATA%\AXIOM DJ`.

## House rules

- Leave AXIOM's licence code unchanged. Activation is off only through `AXIOM_LICENSE_REQUIRED=0`.
- Test with copies or the sandbox. Never write to real DJ libraries or music without the owner's approval.
- Never commit API keys. AI Assist stores keys encrypted per PC, outside this folder.
- Any change a user can see also updates the user manual: the how-to, "What's new", the "Last updated" date and the affected screenshots.
