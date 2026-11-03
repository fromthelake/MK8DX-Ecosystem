param([Parameter(Mandatory=$true)][string]$XamppRoot)
$ErrorActionPreference = 'Stop'
$package = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$root = (Resolve-Path -LiteralPath $XamppRoot).Path
$conf = Join-Path $root 'apache\conf\httpd.conf'
$extra = Join-Path $root 'apache\conf\extra\mk8dx-local.conf'
$httpd = Join-Path $root 'apache\bin\httpd.exe'
$source = Join-Path $package 'apache\apache-mk8dx-local.conf'
if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is missing.' }
$state = Join-Path $env:LOCALAPPDATA 'MK8DX\ApacheBackup'
foreach($path in @($root,$conf,$httpd,$source)) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Required path is missing: $path" }
    $item=Get-Item -LiteralPath $path -Force
    if($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked path is not accepted: $path" }
}
$state = [IO.Path]::GetFullPath($state)
$packagePrefix = $package.TrimEnd('\') + '\'
if ($state.StartsWith($packagePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Private data must be outside the MK8DX package.'
}
$walk = Split-Path -Parent $state
while ($walk) {
    if (Test-Path -LiteralPath $walk) {
        $item = Get-Item -LiteralPath $walk -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Linked data parent is not accepted: $walk"
        }
    }
    $parent = Split-Path -Parent $walk
    if ($parent -eq $walk) { break }
    $walk = $parent
}
if (Test-Path -LiteralPath $state) {
    $item = Get-Item -LiteralPath $state -Force
    if (-not $item.PSIsContainer -or $item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Private data path is not a regular folder: $state"
    }
} else {
    New-Item -ItemType Directory -Path $state -Force | Out-Null
}
$marker = 'Include conf/extra/mk8dx-local.conf'
$backup = Join-Path $state 'apache-httpd-before-mk8dx.conf'
$previous = [IO.File]::ReadAllBytes($conf)
if(-not (Test-Path -LiteralPath $backup)) { [IO.File]::WriteAllBytes($backup,$previous) }
if(Test-Path -LiteralPath $extra) {
    if((Get-FileHash -LiteralPath $extra -Algorithm SHA256).Hash -ne
       (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash) {
        throw 'An MK8DX Apache fragment already exists with different content; review it before changing anything.'
    }
} else { Copy-Item -LiteralPath $source -Destination $extra }
$body=[IO.File]::ReadAllText($conf)
if($body -notmatch '(?m)^Include conf/extra/mk8dx-local\.conf\s*$') {
    [IO.File]::AppendAllText($conf, "`r`n$marker`r`n")
}
& $httpd -t
if($LASTEXITCODE -ne 0) {
    [IO.File]::WriteAllBytes($conf,$previous)
    throw 'Apache syntax failed; the original httpd.conf has been restored.'
}
Write-Host 'Apache syntax OK. In XAMPP Control Panel, start Apache; if it is already running, stop and start only Apache to load the new site.'
