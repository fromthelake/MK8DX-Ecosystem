param([string]$StateDir = (Join-Path $env:LOCALAPPDATA 'MK8DX\Server'))
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $root
Write-Host "MK8DX package: $root"
Write-Host "Private installation: $StateDir"
try {
  $python = (Get-Command python -ErrorAction Stop).Source
  & $python -c 'import sys; assert sys.version_info >= (3,12), "Python 3.12 or newer is required"'
  if ($LASTEXITCODE -ne 0) { throw 'old Python' }
  & $python --version
} catch {
  throw 'Python 3.12+ is missing. Install it from python.org, enable Add python.exe to PATH, reopen PowerShell and retry.'
}
# `docker compose version` also succeeds while the engine is stopped; `docker info` needs the running engine.
$dockerFound = $null -ne (Get-Command docker -ErrorAction SilentlyContinue)
if ($dockerFound) { docker info *> $null }
if (-not $dockerFound -or $LASTEXITCODE -ne 0) {
  throw 'Docker Desktop is missing or not running. Start Docker Desktop in Linux-container mode, wait until it shows "Engine running", and retry.'
}
docker compose version | Out-Host
# Images first: a source checkout has none, and must not run the wizard into the package's installation folder.
# A package loads its own images on its first start, even when older images carry the same tags (an update
# extracts into a new folder); later starts load again only when an image is missing.
$bundle = Join-Path $root 'images\docker-images-amd64.tar'
$loaded = Join-Path $root 'images\loaded.txt'
$load = (Test-Path -LiteralPath $bundle) -and -not (Test-Path -LiteralPath $loaded)
foreach ($tag in @('mk8dx/api:local-v010-node26-amd64', 'mk8dx/web:local-v010-node26-amd64')) {
  docker image inspect $tag *> $null
  if ($LASTEXITCODE -ne 0) {
    if (-not (Test-Path -LiteralPath $bundle)) { throw "Missing prebuilt image $tag. Use the complete host installation package." }
    $load = $true
  }
}
if ($load) {
  Write-Host 'Loading the included Docker images. This can take several minutes.'
  docker load --input $bundle | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Image loading failed.' }
  try { Set-Content -LiteralPath $loaded -Value "Images of this package loaded $(Get-Date -Format o)" -ErrorAction Stop }
  catch { Write-Host 'Note: the package folder is read-only, so the next start loads the images again.' }
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
Write-Host 'Choose 1 first setup/resume, 2 start, 3 status, 4 stop, 5 create administrator after sign-in, 6 backup, 7 update with verified backup.'
$choice = Read-Host 'Number'
$actions = @{ '1' = 'setup'; '2' = 'start'; '3' = 'check'; '4' = 'stop'; '5' = 'admin' }
if ($choice -eq '6' -or $choice -eq '7') {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $output = Join-Path $env:USERPROFILE "Documents\MK8DX-backups\$stamp"
  if ($choice -eq '6') {
    & $python tooling/lifecycle.py backup --state-dir $StateDir --output $output
  } else {
    & $python tooling/install.py upgrade --state-dir $StateDir --backup-output $output
  }
  if ($LASTEXITCODE -ne 0) { throw 'Backup/update failed. Keep any partial output private and investigate.' }
  Write-Host "Private backup: $output"
} elseif ($actions.ContainsKey($choice)) {
  & $python tooling/install.py $actions[$choice] --state-dir $StateDir
  if ($LASTEXITCODE -ne 0) { throw 'The selected step failed. Read the error above and retry only that step.' }
} else { throw 'Choose one of the displayed numbers.' }
