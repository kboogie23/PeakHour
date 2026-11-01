@echo off
rem Starts PEAK HOUR (Windows edition) without a console window.
rem Activation is off for now. To require it again, remove "rem " from the next line.
rem set AXIOM_LICENSE_REQUIRED=1
start "" "%~dp0axiom-win-env\Scripts\pythonw.exe" "%~dp0axiom-win-probe\axiom_windows_launcher.py"
