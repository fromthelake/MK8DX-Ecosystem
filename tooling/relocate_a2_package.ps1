param(
  [string]$PackagePath = (Join-Path $PSScriptRoot '..'),
  [string]$Destination,
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

function Confirm-References([string]$Root, [string]$State) {
  $backup = Get-ScheduledTask -TaskName 'MK8DX backup' -ErrorAction Stop
  $renewal = Get-ScheduledTask -TaskName 'MK8DX certificate renewal' -ErrorAction Stop
  $expectedBackup = '"' + (Join-Path $Root 'tooling\auto_backup.py') + '" run --state-dir "' + $State + '"'
  $expectedRenewal = '"' + (Join-Path $Root 'tooling\install.py') + '" maintain-ca --state-dir "' + $State + '"'
  if ($backup.Actions.Count -ne 1 -or $backup.Actions[0].Arguments -ne $expectedBackup -or
      $renewal.Actions.Count -ne 1 -or $renewal.Actions[0].Arguments -ne $expectedRenewal) {
    throw 'The scheduled maintenance tasks do not point to this package folder.'
  }
  $shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'MK8DX beheer.lnk'
  if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) {
    throw 'The MK8DX beheer shortcut is missing.'
  }
  $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
  if ($shortcut.TargetPath -ne (Join-Path $Root 'Start-MK8DX-LAN.cmd') -or
      $shortcut.WorkingDirectory -ne $Root) {
    throw 'The MK8DX beheer shortcut does not point to this package folder.'
  }
  return $backup.Actions[0].Execute
}

function Confirm-Package([string]$Root, [string]$Revision) {
  $manifest = Get-Content -LiteralPath (Join-Path $Root 'PACKAGE_MANIFEST.json') -Raw | ConvertFrom-Json
  if ($manifest.schemaVersion -ne 'mk8dx.host-bundle.v1' -or $manifest.revision -ne $Revision) {
    throw 'The package revision does not match the active A2 installation.'
  }
  $checked = 0
  foreach ($entry in $manifest.files.PSObject.Properties) {
    $relative = $entry.Name.Replace('/', '\')
    if ([IO.Path]::IsPathRooted($relative) -or $relative -match '(^|\\)\.\.(\\|$)') {
      throw 'The package manifest contains an unsafe path.'
    }
    $path = Join-Path $Root $relative
    if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or
        (Get-Item -LiteralPath $path).Length -ne $entry.Value.bytes -or
        (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne
          $entry.Value.sha256.ToLowerInvariant()) {
      throw ('The package file failed verification: ' + $relative)
    }
    $checked++
  }
  return $checked
}

function Reset-References([string]$Root, [string]$State, [string]$Python) {
  $env:MK8DX_RELOCATE_STATE = $State
  try {
    Push-Location -LiteralPath $Root
    try {
      & $Python -c "from pathlib import Path; from tooling.setup_wizard import Wizard; import os; r=Wizard(Path(os.environ['MK8DX_RELOCATE_STATE']), True).finish(shortcut=True); assert r['task'] and r['certificateRenewal'] and r['shortcut'] and r['autostart']=='enabled', 'Maintenance registration incomplete'"
      if ($LASTEXITCODE -ne 0) { throw 'The A2 installer could not re-register maintenance.' }
    } finally {
      Pop-Location
    }
  } finally {
    Remove-Item Env:MK8DX_RELOCATE_STATE -ErrorAction SilentlyContinue
  }
}

$source = (Resolve-Path -LiteralPath $PackagePath -ErrorAction Stop).Path
$source = [IO.Path]::GetFullPath($source).TrimEnd('\')
$state = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'MK8DX\LAN')).TrimEnd('\')
$recordPath = Join-Path $state 'package.json'
$recoveryPath = Join-Path $state 'backup-recovery-code.dpapi'
if (-not (Test-Path -LiteralPath $recordPath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $recoveryPath -PathType Leaf)) {
  throw 'The installed A2 package record or recovery code is missing.'
}
$record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
if ($record.schemaVersion -ne 'mk8dx.installed-package.v1' -or
    $record.revision -notmatch '^v\d+\.\d+\.\d+(?:-rc\.\d+)?$') {
  throw 'The active installation is not a supported A2 release.'
}
$python = Confirm-References $source $state
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) { throw 'The A2 Python environment is missing.' }
$checked = Confirm-Package $source $record.revision

if ($CheckOnly) {
  Write-Output "Verified $($record.revision): $checked package files, maintenance tasks and shortcut at $source"
  exit 0
}
if (-not $Destination) { throw 'Provide -Destination or use -CheckOnly.' }
$target = [IO.Path]::GetFullPath($Destination).TrimEnd('\')
if ($target -eq $source -or $target.StartsWith($source + '\', [StringComparison]::OrdinalIgnoreCase) -or
    (Test-Path -LiteralPath $target) -or
    [IO.Path]::GetPathRoot($target) -ne [IO.Path]::GetPathRoot($source) -or
    -not (Test-Path -LiteralPath (Split-Path -Parent $target) -PathType Container)) {
  throw 'Choose a new, empty folder on the same drive, inside an existing parent folder.'
}
if (((Get-Item -LiteralPath $source -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -or
    @(Get-ChildItem -LiteralPath $source -Recurse -Force -Attributes ReparsePoint).Count -ne 0) {
  throw 'The package contains a link or junction and cannot be moved by this tool.'
}

# Same-drive Move-Item renames the package; installation data and Docker volumes stay separate.
Set-Location -LiteralPath (Split-Path -Parent $source)
Move-Item -LiteralPath $source -Destination $target -ErrorAction Stop
try {
  Reset-References $target $state $python
  $null = Confirm-References $target $state
  $null = Confirm-Package $target $record.revision
  Write-Output "MK8DX $($record.revision) now uses $target. Keep this folder in place."
} catch {
  $reason = $_.Exception.Message
  try {
    Move-Item -LiteralPath $target -Destination $source -ErrorAction Stop
    Reset-References $source $state $python
    $null = Confirm-References $source $state
  } catch {
    throw "Relocation needs manual recovery. Source: $source; target: $target; reason: $reason; recovery: $($_.Exception.Message)"
  }
  throw "Relocation was rolled back: $reason"
}
