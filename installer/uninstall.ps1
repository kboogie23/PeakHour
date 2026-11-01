# PEAK HOUR uninstaller: removes the program, its shortcuts and its Settings > Apps entry.
# Your music, recordings (Music\AXIOM DJ\Recordings) and PEAK HOUR's data (%LOCALAPPDATA%\AXIOM DJ)
# are kept, so reinstalling picks up where you left off.
param(
  [string]$Destination = $PSScriptRoot,
  [string]$StartMenu = (Join-Path ([Environment]::GetFolderPath('Programs')) 'PEAK HOUR.lnk'),
  [string]$Desktop = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'PEAK HOUR.lnk'),
  [switch]$NoRegistry,
  [switch]$Quiet
)
$ErrorActionPreference = 'Stop'
$UninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PEAK HOUR'

function Say([string]$Text) { if (-not $Quiet) { Write-Host $Text } }

# Only ever remove a folder that is a PEAK HOUR install.
if (-not (Test-Path -LiteralPath (Join-Path $Destination 'app\axiom_windows_launcher.py')) -or
    -not (Test-Path -LiteralPath (Join-Path $Destination 'version.txt'))) {
  throw "This is not a PEAK HOUR install folder: $Destination"
}
$running = Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='python.exe'" |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($Destination, [StringComparison]::OrdinalIgnoreCase) }
if ($running) {
  if (-not $Quiet) { Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show('Close PEAK HOUR, then uninstall again.', 'PEAK HOUR', 'OK', 'Warning') }
  throw 'PEAK HOUR is running.'
}
foreach ($link in @($StartMenu, $Desktop)) {
  if ($link -and (Test-Path -LiteralPath $link)) { Remove-Item -LiteralPath $link -Force }
}
if (-not $NoRegistry -and (Test-Path $UninstallKey)) { Remove-Item -Path $UninstallKey -Recurse -Force }
# PowerShell has already read this script, so the folder it sits in can go; step out of it first.
Set-Location $env:TEMP
Remove-Item -LiteralPath $Destination -Recurse -Force
Say 'PEAK HOUR was removed. Your music, recordings and PEAK HOUR data were kept.'
