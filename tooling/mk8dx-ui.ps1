param([switch]$Demo, [switch]$Plain, [string]$Show = '', [string]$ShowNumber = '', [string]$ShowText = '',
  [string]$ShowSubtitle = '', [string]$ShowItems = '', [string]$ShowColour = 'Gray', [switch]$SkipCountdown)
# Presentation helpers for tooling/start-mk8dx.ps1: a racing-style intro, laps for the steps and a spinner for
# quiet waits. Presentation only: no function here decides anything, every one writes text and returns.
# ASCII source on purpose (Windows PowerShell 5.1 reads a BOM-less file as ANSI); the few round glyphs are made
# with [char] at run time. Original design: no third-party logos, fonts, characters or other assets.
#
# Plain mode (no animation, no cursor control, no colour-only meaning) is chosen automatically when the output is
# redirected, and by hand with -Plain, MK8DX_PLAIN=1 or NO_COLOR. MK8DX_ASCII=1 replaces the round glyphs.
# Demo: powershell -NoProfile -File tooling\mk8dx-ui.ps1 -Demo   (add -Plain to see the plain variant)
# Rich mode (truecolor logo, car on the track) switches on by itself in Windows Terminal; MK8DX_RICH=0 turns it off.
# -SkipCountdown or MK8DX_SKIP_COUNTDOWN=1 leaves out the countdown / start lights (off by default); the race
# clock still starts. MK8DX_SOUND=0 keeps the countdown quiet.

function Test-MK8DXUiPlain {
  if ($script:MK8DXUiForcePlain) { return $true }
  if ($env:MK8DX_PLAIN -eq '1' -or $null -ne $env:NO_COLOR) { return $true }
  try { return [Console]::IsOutputRedirected } catch { return $true }
}
$script:MK8DXUiForcePlain = [bool]$Plain
$script:MK8DXUiSkipCountdown = [bool]$SkipCountdown -or $env:MK8DX_SKIP_COUNTDOWN -eq '1'
$script:MK8DXUiDot = if ($env:MK8DX_ASCII -eq '1') { 'O' } else { [string][char]0x25CF }
$script:MK8DXUiTick = if ($env:MK8DX_ASCII -eq '1') { '+' } else { [string][char]0x2713 }

function Set-MK8DXUiPlain([bool]$Value) { $script:MK8DXUiForcePlain = $Value }

# ---- Rich mode -------------------------------------------------------------------------------------------------
# Truecolor block-letter logo, gradient laps and a small car on the track. Only in a terminal that renders 24-bit
# colour (any console that takes VT sequences: Windows Terminal, VS Code, Windows 10+ console); others keep the classic look.
# Force with MK8DX_RICH=1 / MK8DX_RICH=0. The source stays ASCII: the block glyphs are built from codes at run time
# and written with Write-Host, which hands the console UTF-16 so no code page is involved.
function Test-MK8DXUiRich {
  if (Test-MK8DXUiPlain) { return $false }
  if ($env:MK8DX_RICH -eq '0' -or $env:MK8DX_ASCII -eq '1') { return $false }
  if ($env:MK8DX_RICH -eq '1') { return $true }
  if ($env:WT_SESSION -or $env:COLORTERM -match 'truecolor|24bit' -or $env:TERM_PROGRAM -eq 'vscode') { return $true }
  try { return [bool]$Host.UI.SupportsVirtualTerminal } catch { return $false }
}
$script:MK8DXEsc = [string][char]27
$script:MK8DXReset = $script:MK8DXEsc + '[0m'
function Get-MK8DXFg([int]$Red, [int]$Green, [int]$Blue) { $script:MK8DXEsc + "[38;2;${Red};${Green};${Blue}m" }
$script:MK8DXFull = [char]0x2588
$script:MK8DXDash = [string][char]0x2500
$script:MK8DXKart = (Get-MK8DXFg 255 60 60) + [string][char]0x25B6 + [string][char]0xFE0E  # right-facing car, text style
$script:MK8DXFlag = [char]::ConvertFromUtf32(0x1F3C1)
$script:MK8DXKartPos = 0
$script:MK8DXTrackLen = 20
# Race clock: starts at GO (or the first lap), every lap is stamped, FINISH shows the splits like a result screen.
$script:MK8DXRace = $null
$script:MK8DXLaps = New-Object System.Collections.ArrayList
function Start-MK8DXRace {
  $script:MK8DXRace = [System.Diagnostics.Stopwatch]::StartNew()
  $script:MK8DXLaps.Clear()
}
function Format-MK8DXTime([double]$Ms) {
  $t = [TimeSpan]::FromMilliseconds($Ms)
  '{0}:{1:00}.{2:000}' -f [int][Math]::Floor($t.TotalMinutes), $t.Seconds, $t.Milliseconds
}


$script:MK8DXStops = @(@(235, 30, 45), @(255, 200, 0), @(40, 205, 95), @(0, 170, 255), @(185, 75, 255))
function Get-MK8DXGradient([double]$T) {
  $T = [Math]::Max(0.0, [Math]::Min(1.0, $T))  # 0.0/1.0: with int literals PowerShell picks Min(int,int) and rounds
  $seg = $T * ($script:MK8DXStops.Count - 1)
  $i = [Math]::Min([int][Math]::Floor($seg), $script:MK8DXStops.Count - 2)
  $f = $seg - $i
  $a = $script:MK8DXStops[$i]; $b = $script:MK8DXStops[$i + 1]
  return , @(0..2 | ForEach-Object { [int]($a[$_] + ($b[$_] - $a[$_]) * $f) })
}

# The logo in ASCII stand-ins: # full block, p q b d corners, = and | double lines.
$script:MK8DXLogoCode = @(
  '###q   ###q##q  ##q #####q ######q ##q  ##q',
  '####q ####|##| ##pd##p==##q##p==##qb##q##pd',
  '##p####p##|#####pd b#####pd##|  ##| b###pd',
  '##|b##pd##|##p=##q ##p==##q##|  ##| ##p##q',
  '##| b=d ##|##|  ##qb#####pd######pd##pd ##q',
  'b=d     b=db=d  b=d b====d b=====d b=d  b=d')
$script:MK8DXLogo = & { @($script:MK8DXLogoCode | ForEach-Object {
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $_.ToCharArray()) {
    $code = switch -CaseSensitive ([string]$ch) {
      '#' { 0x2588 } 'p' { 0x2554 } 'q' { 0x2557 } 'b' { 0x255A } 'd' { 0x255D } '=' { 0x2550 } '|' { 0x2551 }
      default { [int]$ch } }
    [void]$sb.Append([char]$code)
  }
  $sb.ToString() }) }
$script:MK8DXLogoWidth = ($script:MK8DXLogo | Measure-Object Length -Maximum).Maximum
# Colour codes per column, worked out once so an animation frame only glues strings together.
$script:MK8DXColFg = New-Object string[] $script:MK8DXLogoWidth
$script:MK8DXColShadow = New-Object string[] $script:MK8DXLogoWidth
$script:MK8DXColLight = @(0..4 | ForEach-Object { , (New-Object string[] $script:MK8DXLogoWidth) })
& {
  $lightAmount = @(0, 0.2, 0.4, 0.65, 0.9)
  for ($x = 0; $x -lt $script:MK8DXLogoWidth; $x++) {
    $c = Get-MK8DXGradient ($x / [double]($script:MK8DXLogoWidth - 1))
    $script:MK8DXColFg[$x] = Get-MK8DXFg $c[0] $c[1] $c[2]
    $script:MK8DXColShadow[$x] = Get-MK8DXFg ([int]($c[0] * 0.38)) ([int]($c[1] * 0.38)) ([int]($c[2] * 0.38))
    for ($lv = 1; $lv -le 4; $lv++) {
      $amt = $lightAmount[$lv]
      $script:MK8DXColLight[$lv][$x] = Get-MK8DXFg ([int]($c[0] + (255 - $c[0]) * $amt)) ([int]($c[1] + (255 - $c[1]) * $amt)) ([int]($c[2] + (255 - $c[2]) * $amt))
    }
  }
}

function Get-MK8DXLogoLine([int]$Y, [int]$Reveal = 9999, [double]$Shine = -99) {
  # One logo row: blocks in the column colour (lighter at the top and under the glint), edges as a dark shadow,
  # speed streaks on the left. $Reveal = columns shown so far, $Shine = where the diagonal glint is.
  $row = $script:MK8DXLogo[$Y]
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('   ')
  if ($Reveal -gt 0) {
    $len = [int](3 + (5 - [Math]::Abs(2.5 - $Y) * 2))
    [void]$sb.Append((Get-MK8DXFg 60 60 90) + ('-' * $len).PadLeft(9) + ' ')
  } else { [void]$sb.Append(' ' * 10) }
  $top = if ($Y -eq 0) { 2 } elseif ($Y -eq 1) { 1 } else { 0 }
  for ($x = 0; $x -lt $row.Length; $x++) {
    $ch = $row[$x]
    if ($x -ge $Reveal -or $ch -eq ' ') { [void]$sb.Append(' '); continue }
    if ($ch -eq $script:MK8DXFull) {
      $level = $top
      $d = [Math]::Abs(($x - $Y * 1.5) - $Shine)
      if ($d -lt 3) { $glint = [int][Math]::Ceiling(4 * (1 - $d / 3)); if ($glint -gt $level) { $level = $glint } }
      if ($level -gt 0) { [void]$sb.Append($script:MK8DXColLight[$level][$x]) } else { [void]$sb.Append($script:MK8DXColFg[$x]) }
    } else { [void]$sb.Append($script:MK8DXColShadow[$x]) }
    [void]$sb.Append($ch)
  }
  [void]$sb.Append($script:MK8DXReset + $script:MK8DXEsc + '[K')
  $sb.ToString()
}

function Write-MK8DXLogo {
  # Wipes in from the left, then a glint slides across (about 1 s), and the logo stays put.
  $n = $script:MK8DXLogo.Count
  $frame = {
    param([int]$Reveal, [double]$Shine)
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append($script:MK8DXEsc + "[${n}A")
    for ($y = 0; $y -lt $n; $y++) { [void]$sb.Append("`r" + (Get-MK8DXLogoLine $y $Reveal $Shine) + "`n") }
    Write-Host $sb.ToString() -NoNewline
  }
  Set-MK8DXCursor $false
  try {
    Write-Host ("`n" * ($n - 1))
    for ($rev = 0; $rev -le $script:MK8DXLogoWidth + 2; $rev += 3) { & $frame $rev -99; Start-Sleep -Milliseconds 15 }
    for ($s = -8; $s -le $script:MK8DXLogoWidth + 8; $s += 2) { & $frame 9999 $s; Start-Sleep -Milliseconds 16 }
    & $frame 9999 -99
  } finally { Set-MK8DXCursor $true }
}

function Get-MK8DXTrackLine([string]$Number, [string]$Text, [int]$Done, [int]$Total, [int]$Pos) {
  $c = Get-MK8DXGradient (($Done - 1) / [double][Math]::Max(1, $Total - 1))
  $rest = $script:MK8DXTrackLen - 1 - $Pos
  '   ' + $script:MK8DXEsc + '[1;3m' + (Get-MK8DXFg $c[0] $c[1] $c[2]) + 'LAP ' + $Number + $script:MK8DXReset + '  ' +
    (Get-MK8DXFg 255 214 0) + ($script:MK8DXDash * $Pos) + $script:MK8DXReset + $script:MK8DXKart +
    (Get-MK8DXFg 90 90 115) + ($script:MK8DXDash * $rest) + $script:MK8DXReset + ' ' + $script:MK8DXFlag + '  ' +
    $script:MK8DXEsc + '[1m' + (Get-MK8DXFg 235 235 245) + $Text + $script:MK8DXReset + $script:MK8DXEsc + '[K'
}

# ---- Countdown (rich mode) -------------------------------------------------------------------------------------
# Three lamps (off, then red one by one, all green on GO) above 3, 2, 1, GO! in yellow-orange block digits with a
# thin white outline. Drawn with half blocks, so every text cell holds two pixels and the outline stays thin.
# A short beep on 3, 2 and 1 and a longer one on GO; MK8DX_SOUND=0 keeps it quiet.
$script:MK8DXCount = @{
  '3'  = @('######  ', '     ## ', ' #####  ', '     ## ', '######  ')
  '2'  = @('######  ', '     ## ', ' #####  ', '##      ', '####### ')
  '1'  = @(' ## ', '### ', ' ## ', ' ## ', ' ## ')
  'GO' = @(' ######    ######   ## ', '##        ##    ##  ## ', '##  ####  ##    ##  ## ',
           '##    ##  ##    ##     ', ' ######    ######   ## ')
}
$script:MK8DXGlyphs = @{}
$script:MK8DXUpper = [string][char]0x2580
$script:MK8DXLower = [string][char]0x2584

function Get-MK8DXBg([int]$Red, [int]$Green, [int]$Blue) { $script:MK8DXEsc + "[48;2;${Red};${Green};${Blue}m" }

function Get-MK8DXGlyph([string]$Key) {
  # Pixel grid for one glyph: each # is 1 pixel wide and 2 high, with a 1-pixel border; 0 empty, 1 fill, 2 outline.
  if ($script:MK8DXGlyphs.ContainsKey($Key)) { return $script:MK8DXGlyphs[$Key] }
  $rows = $script:MK8DXCount[$Key]
  $w = ($rows | Measure-Object Length -Maximum).Maximum + 2
  $h = $rows.Count * 2 + 2
  $g = New-Object 'int[,]' $h, $w
  for ($r = 0; $r -lt $rows.Count; $r++) {
    for ($c = 0; $c -lt $rows[$r].Length; $c++) {
      if ($rows[$r][$c] -eq '#') { $g[(2 * $r + 1), ($c + 1)] = 1; $g[(2 * $r + 2), ($c + 1)] = 1 }
    }
  }
  for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
      if ($g[$y, $x] -ne 0) { continue }
      $edge = $false
      for ($dy = -1; $dy -le 1 -and -not $edge; $dy++) {
        for ($dx = -1; $dx -le 1; $dx++) {
          $ny = $y + $dy; $nx = $x + $dx
          if ($ny -ge 0 -and $ny -lt $h -and $nx -ge 0 -and $nx -lt $w -and $g[$ny, $nx] -eq 1) { $edge = $true; break }
        }
      }
      if ($edge) { $g[$y, $x] = 2 }
    }
  }
  $glyph = @{ Grid = $g; W = $w; H = $h }
  $script:MK8DXGlyphs[$Key] = $glyph
  return $glyph
}

function Get-MK8DXGlyphLines($Glyph, [double]$Light) {
  # Text rows for a glyph: yellow at the top running to orange at the bottom, white outline; $Light flashes it.
  $g = $Glyph.Grid; $w = $Glyph.W; $h = $Glyph.H
  $fgFill = New-Object string[] $h; $bgFill = New-Object string[] $h
  for ($py = 0; $py -lt $h; $py++) {
    $t = [Math]::Max(0.0, [Math]::Min(1.0, ($py - 1) / [double]($h - 3)))
    $rgb = @((255), ([int](236 + (135 - 236) * $t)), ([int](60 + (0 - 60) * $t)))
    $rgb = @($rgb | ForEach-Object { [int]($_ + (255 - $_) * $Light) })
    $fgFill[$py] = Get-MK8DXFg $rgb[0] $rgb[1] $rgb[2]
    $bgFill[$py] = Get-MK8DXBg $rgb[0] $rgb[1] $rgb[2]
  }
  $fgWhite = Get-MK8DXFg 255 255 255; $bgWhite = Get-MK8DXBg 255 255 255
  $lines = New-Object string[] ($h / 2)
  for ($cr = 0; $cr -lt $h / 2; $cr++) {
    $sb = New-Object System.Text.StringBuilder
    $top = 2 * $cr; $bot = $top + 1
    for ($x = 0; $x -lt $w; $x++) {
      $a = $g[$top, $x]; $b = $g[$bot, $x]
      if ($a -eq 0 -and $b -eq 0) { [void]$sb.Append(' '); continue }
      if ($b -eq 0) { [void]$sb.Append($(if ($a -eq 1) { $fgFill[$top] } else { $fgWhite }) + $script:MK8DXUpper); continue }
      if ($a -eq 0) { [void]$sb.Append($(if ($b -eq 1) { $fgFill[$bot] } else { $fgWhite }) + $script:MK8DXLower); continue }
      [void]$sb.Append($(if ($a -eq 1) { $fgFill[$top] } else { $fgWhite }) + $(if ($b -eq 1) { $bgFill[$bot] } else { $bgWhite }) +
        $script:MK8DXUpper + $script:MK8DXEsc + '[49m')
    }
    $lines[$cr] = $sb.ToString()
  }
  return , $lines
}

function Get-MK8DXLampLines([int]$Red, [bool]$Green) {
  # Three round lamps, two text rows high.
  $top = ''; $bottom = ''
  $full = [string][char]0x2588
  for ($i = 0; $i -lt 3; $i++) {
    $fg = if ($Green) { Get-MK8DXFg 90 255 140 } elseif ($i -lt $Red) { Get-MK8DXFg 255 45 45 } else { Get-MK8DXFg 55 55 65 }
    $gap = if ($i -lt 2) { '   ' } else { '' }
    $top += $fg + $script:MK8DXLower + $full + $full + $script:MK8DXLower + $gap
    $bottom += $fg + $script:MK8DXUpper + $full + $full + $script:MK8DXUpper + $gap
  }
  return , @($top, $bottom)
}

function Show-MK8DXCountdown {
  $sound = $env:MK8DX_SOUND -ne '0'
  $height = 10                                     # 2 lamp rows, 1 blank, 7 digit rows
  $lampPad = ' ' * (3 + [int]((56 - 18) / 2))
  $draw = {
    param([int]$Red, [bool]$Green, [string[]]$Digit, [int]$DigitWidth)
    $lamps = Get-MK8DXLampLines $Red $Green
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append($script:MK8DXEsc + "[${height}A")
    foreach ($l in $lamps) { [void]$sb.Append("`r" + $lampPad + $l + $script:MK8DXReset + $script:MK8DXEsc + "[K`n") }
    [void]$sb.Append("`r" + $script:MK8DXEsc + "[K`n")
    $pad = ' ' * (3 + [int]((56 - $DigitWidth) / 2))
    for ($i = 0; $i -lt 7; $i++) {
      $row = if ($Digit -and $i -lt $Digit.Count) { $pad + $Digit[$i] } else { '' }
      [void]$sb.Append("`r" + $row + $script:MK8DXReset + $script:MK8DXEsc + "[K`n")
    }
    Write-Host $sb.ToString() -NoNewline
  }
  $steps = @(@('3', 1, $false), @('2', 2, $false), @('1', 3, $false), @('GO', 3, $true))
  Set-MK8DXCursor $false
  try {
    Write-Host ("`n" * ($height - 1))
    & $draw 0 $false $null 0                       # lamps off, nothing below yet
    Start-Sleep -Milliseconds 500
    foreach ($step in $steps) {
      $glyph = Get-MK8DXGlyph $step[0]
      $go = [bool]$step[2]
      foreach ($light in 0.85, 0.55, 0.25, 0.0) {
        & $draw $step[1] $go (Get-MK8DXGlyphLines $glyph $light) $glyph.W
        Start-Sleep -Milliseconds 35
      }
      if ($sound) {
        # The beep blocks for its length, so it doubles as part of the pause.
        try { [Console]::Beep($(if ($go) { 988 } else { 523 }), $(if ($go) { 650 } else { 170 })) } catch { }
      }
      Start-Sleep -Milliseconds $(if ($go) { 200 } elseif ($sound) { 600 } else { 750 })
    }
  } finally { Set-MK8DXCursor $true }
}

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
  $tail = '   ' + $Subtitle + $(if ($Revision) { "   package $Revision" } else { '' })
  if (Test-MK8DXUiRich) {
    $script:MK8DXKartPos = 0
    Write-Host ''
    Write-MK8DXChecker 56
    Write-Host ''
    Write-MK8DXLogo
    Write-Host ''
    Write-Host ('   ' + $script:MK8DXEsc + '[1;3m' + (Get-MK8DXFg 255 214 0) + 'T I M E   T R I A L S' + $script:MK8DXReset +
      (Get-MK8DXFg 150 150 175) + $tail + $script:MK8DXReset)
    Write-MK8DXChecker 56
    Write-Host ''
    return
  }
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
  if ($script:MK8DXUiSkipCountdown) { Start-MK8DXRace; return }
  if (Test-MK8DXUiRich) {
    # Rich mode: a 3, 2, 1, GO! countdown instead of the lights; the race clock starts on GO.
    Show-MK8DXCountdown
    Start-MK8DXRace
    Write-Host ''
    return
  }
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
    Start-MK8DXRace
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
  if ($lap -and (Test-MK8DXUiRich)) {
    # The car drives from where the last lap left it to this lap's spot on the track.
    $done = [int]$Matches[1]; $total = [int]$Matches[2]
    $target = [int]((($done - 1) / [double][Math]::Max(1, $total - 1)) * ($script:MK8DXTrackLen - 1))
    $from = [Math]::Min($script:MK8DXKartPos, $target)
    if ($null -eq $script:MK8DXRace) { Start-MK8DXRace }
    $now = $script:MK8DXRace.Elapsed.TotalMilliseconds
    [void]$script:MK8DXLaps.Add(@{ Number = $done; Text = $Text; Start = $now })
    $clock = '  ' + (Get-MK8DXFg 120 120 145) + (Format-MK8DXTime $now) + $script:MK8DXReset
    Write-Host ''
    Set-MK8DXCursor $false
    try {
      for ($p = $from; $p -le $target; $p++) {
        Write-Host ("`r" + (Get-MK8DXTrackLine $Number $Text $done $total $p) + $clock) -NoNewline
        if ($p -lt $target) { Start-Sleep -Milliseconds 25 }
      }
      Write-Host ''
    } finally { Set-MK8DXCursor $true }
    $script:MK8DXKartPos = $target
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
  if (Test-MK8DXUiRich) {
    # "Label: value" lines get a grey label and a cyan value; anything else is indented in its colour.
    if ($Colour -eq 'Gray' -and $Text -match '^([^:]{2,}:)\s+(.+)$') {
      Write-Host ('     ' + (Get-MK8DXFg 120 120 145) + $Matches[1].PadRight(22) + ' ' + (Get-MK8DXFg 0 200 255) + $Matches[2] + $script:MK8DXReset)
    } else { Write-Host ('     ' + $Text) -ForegroundColor $Colour }
    return
  }
  Write-Host $Text -ForegroundColor $Colour
}

function Write-Ok([string]$Text = 'Done.') {
  # The words stay "OK  <text>" in every mode: the guides quote them.
  if (Test-MK8DXUiPlain) { Write-Host ('OK  ' + $Text); return }
  if (Test-MK8DXUiRich) {
    Write-Host ('     ' + (Get-MK8DXFg 40 235 95) + $script:MK8DXUiTick + ' OK  ' + $Text + $script:MK8DXReset)
    return
  }
  Write-Host ('OK  ' + $Text) -NoNewline -ForegroundColor Green
  Write-Host (' ' + $script:MK8DXUiTick) -ForegroundColor Green
}

function Write-Fail([string]$Text) {
  if (Test-MK8DXUiPlain) { Write-Host ('!!  ' + $Text); return }
  if (Test-MK8DXUiRich) { Write-Host '     ' -NoNewline }
  Write-Host ' !! ' -NoNewline -ForegroundColor White -BackgroundColor DarkRed
  Write-Host (' ' + $Text) -ForegroundColor Red
}

function Write-MenuItem([string]$Key, [string]$Text) {
  if (Test-MK8DXUiPlain) { Write-Host ('  ' + $Key + '  ' + $Text); return }
  Write-Host '  ' -NoNewline
  Write-Host (' ' + $Key + ' ') -NoNewline -ForegroundColor Black -BackgroundColor $(if ($Key -eq '0') { 'DarkGray' } else { 'White' })
  Write-Host ('  ' + $Text)
}

function Write-MK8DXResults {
  # Result screen: each lap's split, the fastest in yellow with a star, and the total time.
  if ($null -eq $script:MK8DXRace -or $script:MK8DXLaps.Count -eq 0) { return }
  $end = $script:MK8DXRace.Elapsed.TotalMilliseconds
  $splits = @()
  for ($i = 0; $i -lt $script:MK8DXLaps.Count; $i++) {
    $next = if ($i + 1 -lt $script:MK8DXLaps.Count) { $script:MK8DXLaps[$i + 1].Start } else { $end }
    $splits += , @($script:MK8DXLaps[$i], ($next - $script:MK8DXLaps[$i].Start))
  }
  $best = ($splits | ForEach-Object { $_[1] } | Measure-Object -Minimum).Minimum
  Write-Host ''
  foreach ($s in $splits) {
    $lap = $s[0]; $ms = $s[1]
    $c = Get-MK8DXGradient (($lap.Number - 1) / [double][Math]::Max(1, $script:MK8DXLaps.Count - 1))
    $timeFg = if ($ms -eq $best) { Get-MK8DXFg 255 214 0 } else { Get-MK8DXFg 235 235 245 }
    $mark = if ($ms -eq $best) { ' ' + [string][char]0x2605 } else { '  ' }
    Write-Host ('   ' + $script:MK8DXEsc + '[3m' + (Get-MK8DXFg $c[0] $c[1] $c[2]) + ('LAP ' + $lap.Number).PadRight(7) + $script:MK8DXReset +
      $timeFg + (Format-MK8DXTime $ms) + $mark + $script:MK8DXReset + '   ' + (Get-MK8DXFg 120 120 145) + $lap.Text + $script:MK8DXReset)
  }
  Write-Host ('   ' + $script:MK8DXEsc + '[1;3m' + (Get-MK8DXFg 255 214 0) + 'TOTAL  ' + (Format-MK8DXTime $end) + $script:MK8DXReset)
}

function Write-Finish([string]$Text) {
  Write-Host ''
  if (Test-MK8DXUiRich) {
    # FINISH flashes through the logo colours, then settles in yellow next to the message.
    Write-MK8DXChecker 56
    Set-MK8DXCursor $false
    try {
      for ($f = 0; $f -lt 14; $f++) {
        $c = Get-MK8DXGradient (($f % 7) / 6.0)
        Write-Host ("`r   " + $script:MK8DXEsc + '[1;3m' + (Get-MK8DXFg $c[0] $c[1] $c[2]) + 'FINISH!' + $script:MK8DXReset) -NoNewline
        Start-Sleep -Milliseconds 70
      }
    } finally { Set-MK8DXCursor $true }
    Write-Host ("`r   " + $script:MK8DXEsc + '[1;3m' + (Get-MK8DXFg 255 214 0) + 'FINISH!' + $script:MK8DXReset + '  ' +
      $script:MK8DXEsc + '[1m' + (Get-MK8DXFg 235 235 245) + $Text + $script:MK8DXReset)
    Write-MK8DXChecker 56
    Write-MK8DXResults
    return
  }
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
  $runspace.SessionStateProxy.SetVariable('race', $script:MK8DXRace)
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
      if ($null -ne $race) {
        $t = $race.Elapsed
        $clock = '  {0}:{1:00}.{2:000}' -f [int][Math]::Floor($t.TotalMinutes), $t.Seconds, $t.Milliseconds
      } else { $clock = '  {0:mm\:ss}' -f $elapsed }
      $line = '   [' + $track + ']  ' + $label + $clock
      try { [Console]::Write("`r" + $line) } catch { }
      $step++
      Start-Sleep -Milliseconds 50
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

if ($Show) {
  # One element per call, for the cmd launchers (Start-MK8DX-No-Docker.cmd, Manage-MK8DX-No-Docker.cmd), which keep
  # all their own logic and only hand their presentation lines to this module:
  #   -Show Intro  -ShowSubtitle <text>          header and countdown; starts the race clock
  #   -Show Header -ShowSubtitle <text>          header only
  #   -Show Lap    -ShowNumber 1/4 -ShowText <t> a lap (or a plain step for another label)
  #   -Show Info   -ShowText 'a|b' [-ShowColour] info lines ('|' separates lines)
  #   -Show Ok / Fail -ShowText <text>
  #   -Show Menu   -ShowText <title> -ShowItems '1=First;2=Second;0=Close'
  #   -Show Finish -ShowText <text>              finish line and, with a race clock, the lap results
  # Every call is a new process, so the race clock and the laps live in the file named by MK8DX_RACE_FILE
  # (start ticks, then one line per lap); Finish removes it. Without that variable there is no clock.
  $raceFile = $env:MK8DX_RACE_FILE
  function New-MK8DXRaceClock([long]$StartTicks) {
    $clock = [pscustomobject]@{ StartTicks = $StartTicks }
    $clock | Add-Member -MemberType ScriptProperty -Name Elapsed -Value {
      [TimeSpan]::FromTicks([DateTime]::UtcNow.Ticks - $this.StartTicks) }
    return $clock
  }
  if ($raceFile -and $Show -ne 'Intro' -and (Test-Path -LiteralPath $raceFile)) {
    try {
      $lines = @(Get-Content -LiteralPath $raceFile -ErrorAction Stop)
      $script:MK8DXRace = New-MK8DXRaceClock ([long]$lines[0])
      foreach ($line in $lines | Select-Object -Skip 1) {
        $part = $line -split '\|', 3
        [void]$script:MK8DXLaps.Add(@{ Number = [int]$part[0]; Start = [double]$part[1]; Text = $part[2] })
      }
    } catch { $script:MK8DXRace = $null; $script:MK8DXLaps.Clear() }
  }
  switch ($Show) {
    'Intro' {
      Write-Header $ShowSubtitle
      Show-StartLights
      if ($raceFile) {
        if ($null -eq $script:MK8DXRace) { Start-MK8DXRace }
        $start = [DateTime]::UtcNow.Ticks - $script:MK8DXRace.Elapsed.Ticks
        try { Set-Content -LiteralPath $raceFile -Value $start -Encoding ascii -ErrorAction Stop } catch { }
      }
    }
    'Header' { Write-Header $ShowSubtitle }
    'Lap' {
      $before = $script:MK8DXLaps.Count
      Write-Lap $ShowNumber $ShowText
      if ($raceFile -and $script:MK8DXLaps.Count -gt $before -and (Test-Path -LiteralPath $raceFile)) {
        $lap = $script:MK8DXLaps[$script:MK8DXLaps.Count - 1]
        try { Add-Content -LiteralPath $raceFile -Value ('{0}|{1}|{2}' -f $lap.Number, [long]$lap.Start, $lap.Text) -Encoding ascii -ErrorAction Stop } catch { }
      }
    }
    'Info' { foreach ($line in $ShowText -split '\|') { Write-Info $line $ShowColour } }
    'Ok' { if ($ShowText) { Write-Ok $ShowText } else { Write-Ok } }
    'Fail' { Write-Fail $ShowText }
    'Menu' {
      Write-Host ''
      Write-Lap 'PIT' $ShowText
      foreach ($item in $ShowItems -split ';') {
        $pair = $item -split '=', 2
        if ($pair.Count -eq 2) { Write-MenuItem $pair[0].Trim() $pair[1].Trim() }
      }
    }
    'Finish' {
      Write-Finish $ShowText
      if ($raceFile) { Remove-Item -LiteralPath $raceFile -ErrorAction SilentlyContinue }
    }
    default { Write-Host $ShowText }
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
