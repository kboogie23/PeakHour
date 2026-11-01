# PEAK HOUR installer (per user, no admin rights needed).
# Unpacks PEAK-HOUR.zip to %LOCALAPPDATA%\Programs\PEAK HOUR, adds Start menu and desktop shortcuts,
# and lists PEAK HOUR in Settings > Apps with an Uninstall button. Your music, recordings and
# PEAK HOUR's own data (%LOCALAPPDATA%\AXIOM DJ) are never touched.
# Testing switches: -Destination, -StartMenu, -Desktop (other folders), -NoRegistry, -Quiet.
param(
  [string]$Zip = (Join-Path $PSScriptRoot 'PEAK-HOUR.zip'),
  [string]$Destination = (Join-Path $env:LOCALAPPDATA 'Programs\PEAK HOUR'),
  [string]$StartMenu = (Join-Path ([Environment]::GetFolderPath('Programs')) 'PEAK HOUR.lnk'),
  [string]$Desktop = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'PEAK HOUR.lnk'),
  [switch]$NoRegistry,
  [switch]$Quiet
)
$ErrorActionPreference = 'Stop'
$UninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PEAK HOUR'

function Say([string]$Text) { if (-not $Quiet) { Write-Host $Text } }
function Fail([string]$Text) {
  if (-not $Quiet) { Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show($Text, 'PEAK HOUR Setup', 'OK', 'Error') }
  throw $Text
}

# A click in this console window turns on Windows' text selection ("Select" in the title), which pauses the
# script at its next line of output until Esc is pressed: Setup looked stuck. Selection is turned off here.
if (-not $Quiet) {
  try {
    $Host.UI.RawUI.WindowTitle = 'PEAK HOUR Setup'
    Add-Type -Namespace PeakHour -Name Console -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int n);
[DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr h, out uint m);
[DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr h, uint m);
'@
    $consoleInput = [PeakHour.Console]::GetStdHandle(-10); $mode = 0
    if ([PeakHour.Console]::GetConsoleMode($consoleInput, [ref]$mode)) { [void][PeakHour.Console]::SetConsoleMode($consoleInput, ($mode -band (-bnot 0x40)) -bor 0x80) }
  } catch { }
}

if (-not (Test-Path -LiteralPath $Zip)) { Fail "The PEAK HOUR package is missing: $Zip" }

# PEAK HOUR must be closed: its own Python runs from the install folder.
$running = Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='python.exe'" |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($Destination, [StringComparison]::OrdinalIgnoreCase) }
if ($running) { Fail 'Close PEAK HOUR, then run Setup again.' }

$staging = "$Destination.new"
if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
Say 'Unpacking PEAK HOUR...'
New-Item -ItemType Directory -Force -Path $staging | Out-Null
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'  # Windows 10 1803+; far faster than Expand-Archive
if (Test-Path -LiteralPath $tar) {
  # tar -v names each file as it is unpacked: counted against the package's file list for a progress bar.
  $total = 0
  try { Add-Type -AssemblyName System.IO.Compression.FileSystem; $archive = [IO.Compression.ZipFile]::OpenRead($Zip); $total = $archive.Entries.Count; $archive.Dispose() } catch { }
  $done = 0; $before = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & $tar -xvf $Zip -C $staging 2>&1 | ForEach-Object {
    $done++
    if (-not $Quiet -and $total -and ($done % 250 -eq 0)) {
      $percent = [Math]::Min(99, [int]($done * 100 / $total))
      Write-Progress -Activity 'Unpacking PEAK HOUR' -Status "$percent% ($done of $total files)" -PercentComplete $percent
    }
  }
  $code = $LASTEXITCODE; $ErrorActionPreference = $before
  if (-not $Quiet) { Write-Progress -Activity 'Unpacking PEAK HOUR' -Completed }
  if ($code -ne 0) { Remove-Item -LiteralPath $staging -Recurse -Force; Fail 'PEAK HOUR could not be unpacked. Check free disk space, then run Setup again.' }
} else {
  Expand-Archive -LiteralPath $Zip -DestinationPath $staging -Force
}
$runtime = Join-Path $staging 'runtime\pythonw.exe'
$launcher = Join-Path $staging 'app\axiom_windows_launcher.py'
if (-not (Test-Path -LiteralPath $runtime) -or -not (Test-Path -LiteralPath $launcher)) {
  Remove-Item -LiteralPath $staging -Recurse -Force
  Fail 'The PEAK HOUR package is incomplete. Download Setup again.'
}

# Swap the new copy in; an older copy is kept until the new one is in place.
$previous = "$Destination.old"
if (Test-Path -LiteralPath $previous) { Remove-Item -LiteralPath $previous -Recurse -Force }
if (Test-Path -LiteralPath $Destination) { Rename-Item -LiteralPath $Destination -NewName (Split-Path $previous -Leaf) }
New-Item -ItemType Directory -Force -Path (Split-Path $Destination) | Out-Null
Rename-Item -LiteralPath $staging -NewName (Split-Path $Destination -Leaf)
if (Test-Path -LiteralPath $previous) { Remove-Item -LiteralPath $previous -Recurse -Force }

$python = Join-Path $Destination 'runtime\pythonw.exe'
$app = Join-Path $Destination 'app'
$icon = Join-Path $app 'static\brand\favicon.ico'
$shell = New-Object -ComObject WScript.Shell
foreach ($link in @($StartMenu, $Desktop)) {
  if (-not $link) { continue }
  New-Item -ItemType Directory -Force -Path (Split-Path $link) | Out-Null
  $shortcut = $shell.CreateShortcut($link)
  $shortcut.TargetPath = $python
  $shortcut.Arguments = '"' + (Join-Path $app 'axiom_windows_launcher.py') + '"'
  $shortcut.WorkingDirectory = $app
  $shortcut.IconLocation = "$icon,0"
  $shortcut.Description = 'PEAK HOUR - built for hip-hop DJs'
  $shortcut.Save()
}

$version = (Get-Content -Raw -LiteralPath (Join-Path $Destination 'version.txt')).Trim()
if (-not $NoRegistry) {
  New-Item -Force -Path $UninstallKey | Out-Null
  $uninstall = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $Destination 'uninstall.ps1') + '"'
  $values = @{ DisplayName = 'PEAK HOUR'; DisplayVersion = $version; Publisher = 'PEAK HOUR'; DisplayIcon = $icon;
               InstallLocation = $Destination; UninstallString = $uninstall; NoModify = 1; NoRepair = 1 }
  foreach ($name in $values.Keys) {
    $type = if ($values[$name] -is [int]) { 'DWord' } else { 'String' }
    New-ItemProperty -Force -Path $UninstallKey -Name $name -Value $values[$name] -PropertyType $type | Out-Null
  }
  $size = [int]((Get-ChildItem -LiteralPath $Destination -Recurse -File | Measure-Object Length -Sum).Sum / 1KB)
  New-ItemProperty -Force -Path $UninstallKey -Name EstimatedSize -Value $size -PropertyType DWord | Out-Null
}
Say "PEAK HOUR $version is installed in $Destination"  # Setup (IExpress) then shows its "PEAK HOUR is installed" message
