param([Parameter(Mandatory=$true)][string]$XamppRoot, [switch]$Remove)
# -Remove undoes only what this helper added: the Include line and an unchanged mk8dx-local.conf.
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
if ($Remove) {
    $previous = [IO.File]::ReadAllBytes($conf)
    $bytes = [Text.Encoding]::GetEncoding(28591)  # one character per byte: every other byte stays as it was
    $body = $bytes.GetString($previous)
    $added = "`r`nInclude conf/extra/mk8dx-local.conf`r`n"
    if ($body.EndsWith($added)) {
        $kept = $body.Substring(0, $body.Length - $added.Length)  # exactly what the helper appended
    } else {
        $kept = [regex]::Replace($body, '(?m)^Include conf/extra/mk8dx-local\.conf[ \t]*(\r?\n|\z)', '')
    }
    $changed = $kept -ne $body
    if ($changed) { [IO.File]::WriteAllBytes($conf, $bytes.GetBytes($kept)) }
    if (Test-Path -LiteralPath $extra) {
        if ((Get-FileHash -LiteralPath $extra -Algorithm SHA256).Hash -eq
            (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash) {
            Remove-Item -LiteralPath $extra
        } else {
            Write-Host "Left in place because it was changed after MK8DX wrote it: $extra"
        }
    }
    & $httpd -t
    if ($LASTEXITCODE -ne 0) {
        [IO.File]::WriteAllBytes($conf, $previous)
        throw 'Apache syntax failed; the previous httpd.conf has been restored.'
    }
    if ($changed) { Write-Host 'MK8DX Apache site removed. If Apache is running, stop and start it in XAMPP Control Panel.' }
    else { Write-Host 'No MK8DX Apache site was found; nothing changed.' }
    return
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
