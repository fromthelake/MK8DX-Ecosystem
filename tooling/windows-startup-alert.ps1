param([ValidateSet('docker-cli-missing', 'linux-containers-required', 'docker-timeout',
                   'services-timeout', 'stopped', 'internal-error')][string]$Reason = 'internal-error',
      [ValidateSet('A1', 'A2_OFFLINE')][string]$Route = 'A2_OFFLINE')

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'MK8DX - automatic start'
. (Join-Path $PSScriptRoot 'mk8dx-ui.ps1') -SkipCountdown
Write-Header $(if ($Route -eq 'A2_OFFLINE') { Tr 'home & club LAN' } else { Tr 'community server' })
Write-Fail (Tr 'Automatic MK8DX start failed.')
if ($Reason -in @('docker-cli-missing', 'linux-containers-required', 'docker-timeout')) {
  Write-Info (Tr 'Docker Desktop is missing or not running. Start Docker Desktop in Linux-container mode, wait until it shows "Engine running", and retry.')
} elseif ($Reason -in @('services-timeout', 'stopped')) {
  Write-Info (Tr 'Docker is ready, but MK8DX services are not.')
} else {
  Write-Info (Tr 'That step did not finish. Read the message above; your data is kept.')
}
Write-Info (Tr 'Open MK8DX beheer and choose 2 (start), then 3 (check).')
[void](Read-Host (Tr 'Press Enter to close this MK8DX message.'))
