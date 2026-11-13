param([switch]$Demo, [switch]$Plain)
# Presentation helpers for tooling/start-mk8dx.ps1: a racing-style intro, laps for the steps and a spinner for
# quiet waits. Presentation only: no function here decides anything, every one writes text and returns.
# ASCII source on purpose (Windows PowerShell 5.1 reads a BOM-less file as ANSI); the few round glyphs are made
# with [char] at run time. Original design: no third-party logos, fonts, characters or other assets.
#
# Plain mode (no animation, no cursor control, no colour-only meaning) is chosen automatically when the output is
# redirected, and by hand with -Plain, MK8DX_PLAIN=1 or NO_COLOR. MK8DX_ASCII=1 replaces the round glyphs.
# Demo: powershell -NoProfile -File tooling\mk8dx-ui.ps1 -Demo   (add -Plain to see the plain variant)

function Test-MK8DXUiPlain {
  if ($script:MK8DXUiForcePlain) { return $true }
  if ($env:MK8DX_PLAIN -eq '1' -or $null -ne $env:NO_COLOR) { return $true }
  try { return [Console]::IsOutputRedirected } catch { return $true }
}
$script:MK8DXUiForcePlain = [bool]$Plain
$script:MK8DXUiDot = if ($env:MK8DX_ASCII -eq '1') { 'O' } else { [string][char]0x25CF }
$script:MK8DXUiTick = if ($env:MK8DX_ASCII -eq '1') { '+' } else { [string][char]0x2713 }

function Set-MK8DXUiPlain([bool]$Value) { $script:MK8DXUiForcePlain = $Value }

function Set-MK8DXCursor([bool]$Visible) {
  try { [Console]::CursorVisible = $Visible } catch { }
}

function Write-MK8DXChecker([int]$Width = 46) {
  # A chequered strip: two rows of alternating blocks.
  if (Test-MK8DXUiPlain) { Write-Host ('   ' + ('=' * $Width)); return }
  foreach ($row in 0, 1) {
    Write-Host '   ' -NoNewline
    for ($i = 0; $i -lt $Width / 2; $i++) {
      $dark = (($i + $row) % 2) -eq 0
      Write-Host '  ' -NoNewline -BackgroundColor $(if ($dark) { 'White' } else { 'Black' })
    }
    Write-Host ''
  }
}

function Write-Header([string]$Subtitle = '', [string]$Revision = '') {
  # MK8DX in block letters; the 8 in the logo's ribbon colours.
  $rows = @(
    @(' __  __ ', ' _  __', '  ___  ', ' ____  ', '__  __'),
    @('|  \/  |', '| |/ /', ' ( _ ) ', '|  _ \ ', '\ \/ /'),
    @('| |\/| |', "| ' / ", ' / _ \ ', '| | | |', ' \  / '),
    @('| |  | |', '| . \ ', '| (_) |', '| |_| |', ' /  \ '),
    @('|_|  |_|', '|_|\_\', ' \___/ ', '|____/ ', '/_/\_\'))
  $eight = @('Cyan', 'Cyan', 'Magenta', 'Magenta', 'Red')
  $plain = Test-MK8DXUiPlain
  Write-Host ''
  Write-MK8DXChecker
  Write-Host ''
  for ($i = 0; $i -lt $rows.Count; $i++) {
    if ($plain) { Write-Host ('   ' + ($rows[$i] -join '')); continue }
    Write-Host '   ' -NoNewline
    Write-Host ($rows[$i][0] + $rows[$i][1]) -NoNewline -ForegroundColor White
    Write-Host $rows[$i][2] -NoNewline -ForegroundColor $eight[$i]
    Write-Host ($rows[$i][3] + $rows[$i][4]) -ForegroundColor White
  }
  Write-Host ''
  $tail = '   ' + $Subtitle + $(if ($Revision) { "   package $Revision" } else { '' })
  if ($plain) { Write-Host ('   T I M E   T R I A L S' + $tail) }
  else {
    Write-Host '   T I M E   T R I A L S' -NoNewline -ForegroundColor Yellow
    Write-Host $tail -ForegroundColor DarkGray
  }
  Write-MK8DXChecker
  Write-Host ''
}

function Show-StartLights {
  # Five lights come on one by one, then all turn green. About 1.6 s; nothing at all in plain mode.
  if (Test-MK8DXUiPlain) { return }
  Set-MK8DXCursor $false
  try {
    $dot = $script:MK8DXUiDot
    $draw = {
      param([int]$On, [string]$Colour, [string]$Label)
      Write-Host "`r   " -NoNewline
      for ($i = 1; $i -le 5; $i++) {
        $lit = $i -le $On
        Write-Host (' ' + $dot + ' ') -NoNewline -ForegroundColor $(if ($lit) { $Colour } else { 'DarkGray' })
      }
      Write-Host ('   ' + $Label.PadRight(10)) -NoNewline -ForegroundColor $(if ($Colour -eq 'Green') { 'Green' } else { 'DarkGray' })
    }
    & $draw 0 'Red' ''
    for ($n = 1; $n -le 5; $n++) { Start-Sleep -Milliseconds 220; & $draw $n 'Red' '' }
    Start-Sleep -Milliseconds 350
    & $draw 5 'Green' 'GO!'
    Start-Sleep -Milliseconds 150
    Write-Host ''
    Write-Host ''
  } finally { Set-MK8DXCursor $true }
}

function Write-Lap([string]$Number, [string]$Text) {
  # "1/4" becomes a lap with a small progress track; any other label (for example '..') stays a plain step.
  $lap = $Number -match '^(\d+)/(\d+)$'
  if (Test-MK8DXUiPlain) {
    Write-Host ($(if ($lap) { "[LAP $Number] " } else { "[$Number] " }) + $Text)
    return
  }
  if ($lap) {
    $done = [int]$Matches[1]; $total = [int]$Matches[2]
    Write-Host ''
    Write-Host ' LAP ' -NoNewline -ForegroundColor Black -BackgroundColor Yellow
    Write-Host (' ' + $Number + ' ') -NoNewline -ForegroundColor Yellow
    for ($i = 1; $i -le $total; $i++) {
      Write-Host $(if ($i -le $done) { '==' } else { '--' }) -NoNewline -ForegroundColor $(if ($i -le $done) { 'Cyan' } else { 'DarkGray' })
    }
    Write-Host ' ' -NoNewline
    Write-Host $Text -ForegroundColor White
  } else {
    Write-Host (' ' + $Number + ' ') -NoNewline -ForegroundColor Black -BackgroundColor Cyan
    Write-Host (' ' + $Text) -ForegroundColor White
  }
}

function Write-Info([string]$Text, [string]$Colour = 'Gray') {
  if (Test-MK8DXUiPlain) { Write-Host $Text; return }
  Write-Host $Text -ForegroundColor $Colour
}

function Write-Ok([string]$Text = 'Done.') {
  # The words stay "OK  <text>" in every mode: the guides quote them.
  if (Test-MK8DXUiPlain) { Write-Host ('OK  ' + $Text); return }
  Write-Host ('OK  ' + $Text) -NoNewline -ForegroundColor Green
  Write-Host (' ' + $script:MK8DXUiTick) -ForegroundColor Green
}

function Write-Fail([string]$Text) {
  if (Test-MK8DXUiPlain) { Write-Host ('!!  ' + $Text); return }
  Write-Host ' !! ' -NoNewline -ForegroundColor White -BackgroundColor DarkRed
  Write-Host (' ' + $Text) -ForegroundColor Red
}

function Write-MenuItem([string]$Key, [string]$Text) {
  if (Test-MK8DXUiPlain) { Write-Host ('  ' + $Key + '  ' + $Text); return }
  Write-Host '  ' -NoNewline
  Write-Host (' ' + $Key + ' ') -NoNewline -ForegroundColor Black -BackgroundColor $(if ($Key -eq '0') { 'DarkGray' } else { 'White' })
  Write-Host ('  ' + $Text)
}

function Write-Finish([string]$Text) {
  Write-Host ''
  Write-MK8DXChecker
  if (Test-MK8DXUiPlain) { Write-Host ('   FINISH  ' + $Text) }
  else {
    Write-Host '   ' -NoNewline
    Write-Host ' FINISH ' -NoNewline -ForegroundColor Black -BackgroundColor White
    Write-Host ('  ' + $Text) -ForegroundColor White
  }
  Write-MK8DXChecker
}

function Invoke-WithSpinner([string]$Label, [scriptblock]$Body) {
  # Runs $Body here and returns its output unchanged; a background runspace only draws a small car moving along a
  # track with the elapsed time, on one line that is wiped afterwards. Use it only around work that prints nothing.
  if (Test-MK8DXUiPlain) { return (& $Body) }
  $state = [hashtable]::Synchronized(@{ Run = $true })
  $runspace = [runspacefactory]::CreateRunspace()
  $runspace.Open()
  $runspace.SessionStateProxy.SetVariable('state', $state)
  $runspace.SessionStateProxy.SetVariable('label', $Label)
  $painter = [powershell]::Create()
  $painter.Runspace = $runspace
  # ASCII only in the painter: [Console]::Write in Windows PowerShell encodes with the console code page.
  [void]$painter.AddScript({
    $began = [DateTime]::UtcNow
    $width = 12
    $step = 0
    while ($state.Run) {
      $pos = $step % ($width + 1)
      $track = ((' ' * $pos) + '-=o>').PadRight($width + 4)
      $elapsed = [DateTime]::UtcNow - $began
      $line = '   [' + $track + ']  ' + $label + ('  {0:mm\:ss}' -f $elapsed)
      try { [Console]::Write("`r" + $line) } catch { }
      $step++
      Start-Sleep -Milliseconds 110
    }
  })
  Set-MK8DXCursor $false
  $handle = $painter.BeginInvoke()
  try {
    return (& $Body)
  } finally {
    $state.Run = $false
    try { [void]$painter.EndInvoke($handle) } catch { }
    $painter.Dispose()
    $runspace.Dispose()
    try {
      $wipe = [Math]::Max(1, [Console]::BufferWidth - 1)
      [Console]::Write("`r" + (' ' * $wipe) + "`r")
    } catch { }
    Set-MK8DXCursor $true
  }
}

if ($Demo) {
  # Shows every element without touching Docker, Python or an installation.
  Write-Header 'home & club LAN' 'demo'
  Show-StartLights
  Write-Lap '1/4' 'Checking Python'
  Write-Info 'MK8DX package: C:\MK8DX\demo'
  Write-Lap '2/4' 'Checking Docker'
  $answer = Invoke-WithSpinner 'Waiting for the Docker engine' { Start-Sleep -Milliseconds 1500; 42 }
  Write-Info "The spinner returned $answer."
  Write-Lap '3/4' 'Preparing the MK8DX programs'
  Write-Ok
  Write-Lap '..' 'An example step'
  Write-Fail 'That step did not finish. Read the message above; your data is kept.'
  Write-Lap '4/4' 'Opening MK8DX beheer in your browser'
  Write-Finish 'Ready. The setup opens in your browser.'
}
