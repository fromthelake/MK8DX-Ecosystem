param([string]$StateDir = (Join-Path $env:LOCALAPPDATA 'MK8DX\Server'))
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 turns any stderr line of a redirected native command into a terminating error
# under 'Stop' (groep3 cold run: "No such image" from the image check). Quiet probes use only the exit code.
function Invoke-NativeQuiet([scriptblock]$Command) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Command *> $null } finally { $ErrorActionPreference = $previous }
  return $LASTEXITCODE
}
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $root
Write-Host "MK8DX package: $root"
Write-Host "Private installation: $StateDir"
try {
  $python = (Get-Command python -ErrorAction Stop).Source
  # The package carries offline wheels for exactly Python 3.12 to 3.15 (tooling/release/host_bundle.py).
  & $python -c 'import sys; assert (3,12) <= sys.version_info[:2] <= (3,15)'
  if ($LASTEXITCODE -ne 0) { throw 'unsupported Python' }
  & $python --version
} catch {
  throw 'Python 3.12 to 3.15 is missing. Install the Python install manager from python.org (or the Microsoft Store), run: py install 3.15, reopen PowerShell and retry.'
}
# `docker compose version` also succeeds while the engine is stopped; `docker info` needs the running engine.
$dockerFound = $null -ne (Get-Command docker -ErrorAction SilentlyContinue)
$dockerRunning = $dockerFound -and ((Invoke-NativeQuiet { docker info }) -eq 0)
if (-not $dockerRunning) {
  throw 'Docker Desktop is missing or not running. Start Docker Desktop in Linux-container mode, wait until it shows "Engine running", and retry.'
}
docker compose version | Out-Host
# Images first: a source checkout has none, and must not run the wizard into the package's installation folder.
# A package loads its own images on its first start, even when older images carry the same tags (an update
# extracts into a new folder); later starts load again only when an image is missing.
$bundle = Join-Path $root 'images\docker-images-amd64.tar'
$loaded = Join-Path $root 'images\loaded.txt'
$load = (Test-Path -LiteralPath $bundle) -and -not (Test-Path -LiteralPath $loaded)
$tags = @('mk8dx/api:local-v010-node26-amd64', 'mk8dx/web:local-v010-node26-amd64')
$candidate = $false
$imageList = Join-Path $root 'images\images.json'
if (Test-Path -LiteralPath $imageList) {
  # The package names its own images (for example an A2 offline QA candidate).
  $named = Get-Content -LiteralPath $imageList -Raw | ConvertFrom-Json
  $tags = @($named.api, $named.web)
  $candidate = [bool]$named.qaOfflineCandidate
}
$wheels = Join-Path $root 'wheels'
if (Test-Path -LiteralPath $wheels) {
  # Offline Python packages for the A2 certificate tools: a private venv, never an internet download.
  $requirements = Join-Path $root 'tooling\requirements-offline-lan.txt'
  $hash = (Get-FileHash -LiteralPath $requirements -Algorithm SHA256).Hash.Substring(0, 12)
  $venv = Join-Path $env:LOCALAPPDATA "MK8DX\python-offline-$hash"
  if (-not (Test-Path -LiteralPath (Join-Path $venv 'Scripts\python.exe'))) {
    Write-Host 'Preparing the included Python packages (once, without internet).'
    & $python -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the private Python environment.' }
    & (Join-Path $venv 'Scripts\python.exe') -m pip install --no-index --find-links $wheels --require-hashes -r (Join-Path $wheels 'requirements.hashes.txt') | Out-Host
    if ($LASTEXITCODE -ne 0) { Remove-Item -LiteralPath $venv -Recurse -Force; throw 'Installing the included Python packages failed.' }
  }
  $python = Join-Path $venv 'Scripts\python.exe'
}
foreach ($tag in $tags) {
  if ((Invoke-NativeQuiet { docker image inspect $tag }) -ne 0) {
    if (-not (Test-Path -LiteralPath $bundle)) { throw "Missing prebuilt image $tag. Use the complete host installation package." }
    $load = $true
  }
}
if ($load) {
  $sizeGb = [math]::Round((Get-Item -LiteralPath $bundle).Length / 1GB, 1)
  Write-Host "Loading the included Docker images ($sizeGb GB). This can take several minutes; the time below keeps counting."
  # docker load shows no progress without a terminal, so print a line every 10 seconds while it runs.
  $out = Join-Path $env:TEMP "mk8dx-docker-load-$PID.txt"
  $err = Join-Path $env:TEMP "mk8dx-docker-load-$PID.err.txt"
  $loader = Start-Process -FilePath docker -ArgumentList @('load', '--input', "`"$bundle`"") -NoNewWindow -PassThru `
    -RedirectStandardOutput $out -RedirectStandardError $err
  $null = $loader.Handle  # keeps ExitCode readable after the process ends
  $began = Get-Date
  while (-not $loader.WaitForExit(10000)) {
    Write-Host ("  still loading... {0:mm\:ss}" -f ((Get-Date) - $began))
  }
  $loader.WaitForExit()
  Get-Content -LiteralPath $out, $err -ErrorAction SilentlyContinue | Out-Host
  Remove-Item -LiteralPath $out, $err -ErrorAction SilentlyContinue
  if ($loader.ExitCode -ne 0) { throw 'Image loading failed.' }
  Write-Host ("Images loaded in {0:mm\:ss}." -f ((Get-Date) - $began))
  try { Set-Content -LiteralPath $loaded -Value "Images of this package loaded $(Get-Date -Format o)" -ErrorAction Stop }
  catch { Write-Host 'Note: the package folder is read-only, so the next start loads the images again.' }
}
$profilePath = Join-Path $StateDir 'operator-profile.json'
$offlineInstall = (Test-Path -LiteralPath $profilePath) -and
  ((Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json).route -eq 'A2_OFFLINE')
if ($candidate -and ($offlineInstall -or -not (Test-Path -LiteralPath $StateDir))) {
  # The guided setup / "MK8DX beheer" in the browser (docs/install/A2_HOME_GUIDE_EN.md).
  & $python tooling/setup_wizard.py --state-dir $StateDir
  exit $LASTEXITCODE
}
if (Test-Path -LiteralPath $StateDir) {
  $item = Get-Item -LiteralPath $StateDir
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Installation path is a link; use a normal folder.' }
  if (-not (Test-Path -LiteralPath (Join-Path $StateDir 'operator-profile.json'))) {
    throw 'Folder exists without a complete MK8DX operator profile. Keep it and inspect it; do not reset data.'
  }
} else {
  & $python tooling/install.py wizard --state-dir $StateDir
  if ($LASTEXITCODE -ne 0) { throw 'The guided setup did not finish.' }
}
$offline = (Get-Content -LiteralPath (Join-Path $StateDir 'operator-profile.json') -Raw | ConvertFrom-Json).route -eq 'A2_OFFLINE'
$qaFlag = @()
if ($offline) {
  if (-not $candidate) { throw 'This package does not include the A2 offline candidate; use the A2 offline QA package.' }
  $qaFlag = @('--qa-offline-candidate')
  Write-Host 'Choose 1 first setup/resume, 2 start, 3 status, 4 stop, 5 unlock the host page (first administrator, invitations), 6 backup, 7 update with verified backup.'
} else {
  Write-Host 'Choose 1 first setup/resume, 2 start, 3 status, 4 stop, 5 create administrator after sign-in, 6 backup, 7 update with verified backup.'
}
$choice = Read-Host 'Number'
$actions = @{ '1' = 'setup'; '2' = 'start'; '3' = 'check'; '4' = 'stop'; '5' = 'admin' }
if ($choice -eq '6' -or $choice -eq '7') {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $output = Join-Path $env:USERPROFILE "Documents\MK8DX-backups\$stamp"
  if ($choice -eq '6') {
    & $python tooling/lifecycle.py backup --state-dir $StateDir --output $output
  } else {
    & $python tooling/install.py upgrade --state-dir $StateDir --backup-output $output @qaFlag
  }
  if ($LASTEXITCODE -ne 0) { throw 'Backup/update failed. Keep any partial output private and investigate.' }
  Write-Host "Private backup: $output"
} elseif ($actions.ContainsKey($choice)) {
  & $python tooling/install.py $actions[$choice] --state-dir $StateDir @qaFlag
  if ($LASTEXITCODE -ne 0) { throw 'The selected step failed. Read the error above and retry only that step.' }
} else { throw 'Choose one of the displayed numbers.' }
