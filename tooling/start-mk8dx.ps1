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
function Show-Banner {
  # MK8DX in block letters; the 8 in the logo's ribbon colours. ASCII only on purpose.
  $rows = @(
    @(' __  __ ', ' _  __', '  ___  ', ' ____  ', '__  __'),
    @('|  \/  |', '| |/ /', ' ( _ ) ', '|  _ \ ', '\ \/ /'),
    @('| |\/| |', "| ' / ", ' / _ \ ', '| | | |', ' \  / '),
    @('| |  | |', '| . \ ', '| (_) |', '| |_| |', ' /  \ '),
    @('|_|  |_|', '|_|\_\', ' \___/ ', '|____/ ', '/_/\_\'))
  $eight = @('Cyan', 'Cyan', 'Magenta', 'Magenta', 'Red')
  Write-Host ''
  for ($i = 0; $i -lt $rows.Count; $i++) {
    Write-Host '   ' -NoNewline
    Write-Host ($rows[$i][0] + $rows[$i][1]) -NoNewline -ForegroundColor White
    Write-Host $rows[$i][2] -NoNewline -ForegroundColor $eight[$i]
    Write-Host ($rows[$i][3] + $rows[$i][4]) -ForegroundColor White
  }
  $revision = ''
  $lan = $false
  $named = Join-Path $root 'images\images.json'
  if (Test-Path -LiteralPath $named) {
    try { $info = Get-Content -LiteralPath $named -Raw | ConvertFrom-Json; $revision = $info.revision; $lan = $info.qaOfflineCandidate -eq $true } catch { $revision = '' }
  }
  Write-Host ''
  Write-Host '   T I M E   T R I A L S' -NoNewline -ForegroundColor Yellow
  Write-Host ('   ' + $(if ($lan) { 'home & club LAN' } else { 'community server' }) + $(if ($revision) { "   package $revision" } else { '' })) -ForegroundColor DarkGray
  Write-Host ('   ' + ('-' * 44)) -ForegroundColor DarkGray
  Write-Host ''
}
function Write-Step([string]$Number, [string]$Text) {
  Write-Host ('[' + $Number + '] ') -NoNewline -ForegroundColor Cyan
  Write-Host $Text
}
Show-Banner
Write-Step '1/4' 'Checking Python'
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
Write-Step '2/4' 'Checking Docker'
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
Write-Step '3/4' 'Preparing the MK8DX programs'
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
  Write-Step '4/4' 'Opening MK8DX beheer in your browser'
  # The guided setup / "MK8DX beheer" in the browser (docs/install/A2_HOME_GUIDE_EN.md).
  & $python tooling/setup_wizard.py --state-dir $StateDir
  exit $LASTEXITCODE
}
$fresh = -not (Test-Path -LiteralPath $StateDir)
if (-not $fresh) {
  $item = Get-Item -LiteralPath $StateDir
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Installation path is a link; use a normal folder.' }
  if (-not (Test-Path -LiteralPath (Join-Path $StateDir 'operator-profile.json'))) {
    throw 'Folder exists without a complete MK8DX operator profile. Keep it and inspect it; do not reset data.'
  }
} else {
  & $python tooling/install.py wizard --state-dir $StateDir
  if ($LASTEXITCODE -ne 0) { throw 'The guided setup did not finish.' }
}
$profileData = Get-Content -LiteralPath (Join-Path $StateDir 'operator-profile.json') -Raw | ConvertFrom-Json
$offline = $profileData.route -eq 'A2_OFFLINE'
$qaFlag = @()
if ($offline) {
  if (-not $candidate) { throw 'This installation is an A2 home or club installation; start it from the mk8dx-a2 package.' }
  $qaFlag = @('--qa-offline-candidate')
}
$adminLabel = if ($offline) { 'Unlock the host page (first administrator, invitations)' } else { 'Make me administrator (after you signed in once)' }

function Invoke-MK8DXStep([string]$Label, [scriptblock]$Body) {
  Write-Host ''
  Write-Step '..' $Label
  # Out-Host: a native command's output inside a function would otherwise become its return value.
  & $Body | Out-Host
  if ($LASTEXITCODE -ne 0) {
    Write-Host '!!  That step did not finish. Read the message above; your data is kept. Fix it and choose the step again.' -ForegroundColor Red
    return $false
  }
  Write-Host 'OK  Done.' -ForegroundColor Green
  return $true
}
function Invoke-MK8DXBackup([string]$Output, [switch]$Update) {
  if ($Update) {
    & $python tooling/install.py upgrade --state-dir $StateDir --backup-output $Output @qaFlag
  } else {
    & $python tooling/lifecycle.py backup --state-dir $StateDir --output $Output
    if ($LASTEXITCODE -eq 0) { & $python tooling/lifecycle.py verify --backup $Output }
  }
  if ($LASTEXITCODE -eq 0) { Write-Host "Private backup (keep it safe, never share it): $Output" }
}

function Show-MK8DXAddress([switch]$Next) {
  $mail = Get-Content -LiteralPath (Join-Path $StateDir 'compose.env') -ErrorAction SilentlyContinue |
    Where-Object { $_ -match '^MK8DX_MAILPIT_PORT=' } | ForEach-Object { ($_ -split '=', 2)[1].Trim("'") }
  Write-Host ''
  Write-Host "   Website: $($profileData.origin)" -ForegroundColor Cyan
  if ($profileData.route -eq 'A1' -and $mail) {
    Write-Host "   Sign-in mail arrives in the local test inbox: http://127.0.0.1:$mail" -ForegroundColor Cyan
    if ($Next) { Write-Host '   Next: type 8 to open the website, sign in with your address, then type 5 to become administrator.' }
  }
}

if ($fresh) {
  # A new installation goes straight to its first setup; the menu follows afterwards.
  [void](Invoke-MK8DXStep 'First setup: database, keys and reference times (the first time takes a few minutes)' {
    & $python tooling/install.py setup --state-dir $StateDir @qaFlag })
  Show-MK8DXAddress -Next
}
while ($true) {
  Write-Host ''
  Write-Host 'What do you want to do?' -ForegroundColor Cyan
  Write-Host '  1  First setup, or finish an interrupted one'
  Write-Host '  2  Start MK8DX'
  Write-Host '  3  Check that everything works'
  Write-Host '  4  Stop MK8DX'
  Write-Host "  5  $adminLabel"
  Write-Host '  6  Make a backup (it is checked right away)'
  Write-Host '  7  Update to this package (makes a checked backup first)'
  Write-Host '  8  Open the website in your browser'
  Write-Host '  0  Close this window'
  $choice = (Read-Host 'Type a number and press Enter').Trim()
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $output = Join-Path $env:USERPROFILE "Documents\MK8DX-backups\$stamp"
  switch ($choice) {
    '1' { [void](Invoke-MK8DXStep 'First setup' { & $python tooling/install.py setup --state-dir $StateDir @qaFlag }) }
    '2' { [void](Invoke-MK8DXStep 'Starting MK8DX' { & $python tooling/install.py start --state-dir $StateDir @qaFlag }) }
    '3' { if (Invoke-MK8DXStep 'Checking MK8DX' { & $python tooling/install.py check --state-dir $StateDir @qaFlag }) { Show-MK8DXAddress } }
    '4' { [void](Invoke-MK8DXStep 'Stopping MK8DX' { & $python tooling/install.py stop --state-dir $StateDir @qaFlag }) }
    '5' { [void](Invoke-MK8DXStep $adminLabel { & $python tooling/install.py admin --state-dir $StateDir @qaFlag }) }
    '6' { [void](Invoke-MK8DXStep 'Making and checking a backup' { Invoke-MK8DXBackup $output }) }
    '7' { [void](Invoke-MK8DXStep 'Checked backup, then the update' { Invoke-MK8DXBackup $output -Update }) }
    '8' {
      Write-Host "Website: $($profileData.origin)"
      $mail = Get-Content -LiteralPath (Join-Path $StateDir 'compose.env') -ErrorAction SilentlyContinue |
        Where-Object { $_ -match '^MK8DX_MAILPIT_PORT=' } | ForEach-Object { ($_ -split '=', 2)[1].Trim("'") }
      if ($profileData.route -eq 'A1' -and $mail) { Write-Host "Sign-in mail for this trial arrives in the local inbox: http://127.0.0.1:$mail" }
      Start-Process $profileData.origin
    }
    '0' { exit 0 }
    default { Write-Host "'$choice' is not one of the numbers above." -ForegroundColor Yellow }
  }
}
