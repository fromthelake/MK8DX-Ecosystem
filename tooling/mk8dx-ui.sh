# Presentation helpers for tooling/start-mk8dx.sh (Linux and macOS), the counterpart of tooling/mk8dx-ui.ps1.
# Sourced, not run: ". tooling/mk8dx-ui.sh". POSIX sh, safe under "set -eu". Presentation only: no function here
# decides anything, every one writes text and returns. ASCII source; the block glyphs are built from octal escapes.
# Original design: no third-party logos, fonts, characters or other assets.
#
# Modes, chosen once when this file is sourced:
#   plain  output is not a terminal, TERM=dumb, MK8DX_PLAIN=1, NO_COLOR set or --plain: text only, no animation
#   basic  a colour terminal without UTF-8 or 256 colours, or MK8DX_RICH=0: the classic coloured look
#   rich   the default in a UTF-8 terminal with 256 or more colours (MK8DX_RICH=1 forces it): gradient logo,
#          3-2-1-GO countdown with a bell (MK8DX_SOUND=0 mutes it; MK8DX_SKIP_COUNTDOWN=1 or --skip-countdown
#          skips it), laps with a car on the track, race clock and lap results at FINISH.
# Truecolor when COLORTERM says so, otherwise the nearest 256-colour code (macOS Terminal).
# Demo: sh tooling/mk8dx-ui.sh --demo   (add --plain, or set the variables above, to see the other modes)

ui_esc=$(printf '\033')
ui_reset="${ui_esc}[0m"
ui_mode=rich
if [ ! -t 1 ] || [ "${TERM:-}" = dumb ] || [ "${MK8DX_PLAIN:-}" = 1 ] || [ -n "${NO_COLOR+x}" ]; then
  ui_mode=plain
elif [ "${MK8DX_RICH:-}" = 0 ]; then
  ui_mode=basic
elif [ "${MK8DX_RICH:-}" != 1 ]; then
  case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
    *[Uu][Tt][Ff]-8*|*[Uu][Tt][Ff]8*) ;;
    *) ui_mode=basic ;;
  esac
  if [ "$ui_mode" = rich ]; then
    case "${COLORTERM:-}" in
      *truecolor*|*24bit*) ;;
      *) colours=$(tput colors 2>/dev/null || echo 8)
         case "$colours" in ''|*[!0-9]*) colours=8 ;; esac
         [ "$colours" -ge 256 ] || ui_mode=basic ;;
    esac
  fi
fi
ui_truecolor=no
case "${COLORTERM:-}" in *truecolor*|*24bit*) ui_truecolor=yes ;; esac
ui_skip_countdown=${MK8DX_SKIP_COUNTDOWN:-0}
ui_sound=${MK8DX_SOUND:-1}

ui_set_plain() { ui_mode=plain; }

# ---- colour and glyphs -----------------------------------------------------------------------------------------
ui_fg() {  # ui_fg R G B -> the escape for that foreground colour
  if [ "$ui_truecolor" = yes ]; then
    printf '%s[38;2;%s;%s;%sm' "$ui_esc" "$1" "$2" "$3"
  else
    printf '%s[38;5;%sm' "$ui_esc" $((16 + 36 * ($1 * 5 / 255) + 6 * ($2 * 5 / 255) + $3 * 5 / 255))
  fi
}
ui_fgv() {  # like ui_fg, but into $ui_c without a subshell (for the per-character loops)
  if [ "$ui_truecolor" = yes ]; then
    ui_c="${ui_esc}[38;2;$1;$2;$3m"
  else
    ui_c="${ui_esc}[38;5;$((16 + 36 * ($1 * 5 / 255) + 6 * ($2 * 5 / 255) + $3 * 5 / 255))m"
  fi
}
ui_repeat() {  # ui_repeat TEXT N -> TEXT N times, into $ui_rep
  ui_rep=; n_=0
  while [ $n_ -lt "$2" ]; do ui_rep="$ui_rep$1"; n_=$((n_ + 1)); done
}
ui_full=$(printf '\342\226\210'); ui_upper=$(printf '\342\226\200'); ui_lower=$(printf '\342\226\204')
ui_tl=$(printf '\342\225\224'); ui_tr=$(printf '\342\225\227'); ui_bl=$(printf '\342\225\232')
ui_br=$(printf '\342\225\235'); ui_hz=$(printf '\342\225\220'); ui_vt=$(printf '\342\225\221')
ui_dash=$(printf '\342\224\200'); ui_car=$(printf '\342\226\266'); ui_tick=$(printf '\342\234\223')
ui_star=$(printf '\342\230\205'); ui_flag=$(printf '\360\237\217\201')

# The five colour stops of the logo gradient; ui_gradient T (0..1000) sets ui_r ui_g ui_b.
ui_gradient() {
  t=$1; [ "$t" -lt 0 ] && t=0; [ "$t" -gt 1000 ] && t=1000
  seg=$((t * 4)); i=$((seg / 1000)); [ "$i" -gt 3 ] && i=3; f=$((seg - i * 1000))
  case $i in
    0) set -- 235 30 45 255 200 0 ;;
    1) set -- 255 200 0 40 205 95 ;;
    2) set -- 40 205 95 0 170 255 ;;
    *) set -- 0 170 255 185 75 255 ;;
  esac
  ui_r=$(($1 + ($4 - $1) * f / 1000)); ui_g=$(($2 + ($5 - $2) * f / 1000)); ui_b=$(($3 + ($6 - $3) * f / 1000))
}

ui_cursor() {  # ui_cursor on|off
  [ "$ui_mode" = rich ] || return 0
  if [ "$1" = off ]; then printf '%s[?25l' "$ui_esc"; else printf '%s[?25h' "$ui_esc"; fi
}
# Whatever happens, the cursor comes back.
if [ "$ui_mode" = rich ]; then trap 'printf "%s[?25h" "$ui_esc"' EXIT; trap 'printf "%s[?25h\n" "$ui_esc"; exit 130' INT TERM; fi

ui_sleep() { sleep "$1" 2>/dev/null || :; }

# Milliseconds since the epoch: GNU date, else Python, else whole seconds.
ui_now() {
  ms=$(date +%s%N 2>/dev/null || :)
  case "$ms" in
    *N*|'') ms=$(python3 -c 'import time; print(int(time.time() * 1000))' 2>/dev/null || echo "$(date +%s)000") ;;
    *) ms=$((ms / 1000000)) ;;
  esac
  printf '%s' "$ms"
}
ui_time() {  # ui_time MS -> M:SS.mmm
  printf '%d:%02d.%03d' $(($1 / 60000)) $(($1 / 1000 % 60)) $(($1 % 1000))
}
ui_race_start=
ui_laps=
ui_kart=0

# ---- header ----------------------------------------------------------------------------------------------------
ui_checker() {  # a chequered strip, two rows
  width=${1:-46}
  if [ "$ui_mode" = plain ]; then
    printf '   '; i=0; while [ $i -lt "$width" ]; do printf '='; i=$((i + 1)); done; printf '\n'; return 0
  fi
  for row in 0 1; do
    printf '   '; i=0
    while [ $i -lt $((width / 2)) ]; do
      if [ $(((i + row) % 2)) -eq 0 ]; then printf '%s[47m  ' "$ui_esc"; else printf '%s[40m  ' "$ui_esc"; fi
      i=$((i + 1))
    done
    printf '%s\n' "$ui_reset"
  done
}

ui_logo_rich() {
  # Block letters in the gradient, lighter at the top, edges as a dark shadow, speed streaks on the left;
  # the rows wipe in one by one.
  width=43; y=0
  for code in '###q   ###q##q  ##q #####q ######q ##q  ##q' \
              '####q ####|##| ##pd##p==##q##p==##qb##q##pd' \
              '##p####p##|#####pd b#####pd##|  ##| b###pd' \
              '##|b##pd##|##p=##q ##p==##q##|  ##| ##p##q' \
              '##| b=d ##|##|  ##qb#####pd######pd##pd ##q' \
              'b=d     b=db=d  b=d b====d b=====d b=d  b=d'; do
    case $y in 0|5) streak=3 ;; 1|4) streak=5 ;; *) streak=7 ;; esac
    ui_repeat ' ' $((9 - streak)); pad=$ui_rep; ui_repeat '-' "$streak"
    ui_fgv 60 60 90; line="   $ui_c$pad$ui_rep "
    case $y in 0) light=400 ;; 1) light=200 ;; *) light=0 ;; esac
    rest=$code; x=0
    while [ -n "$rest" ]; do
      ch=${rest%"${rest#?}"}; rest=${rest#?}
      if [ "$ch" = ' ' ]; then line="$line "; x=$((x + 1)); continue; fi
      ui_gradient $((x * 1000 / (width - 1)))
      if [ "$ch" = '#' ]; then
        r=$((ui_r + (255 - ui_r) * light / 1000)); g=$((ui_g + (255 - ui_g) * light / 1000)); b=$((ui_b + (255 - ui_b) * light / 1000))
      else
        r=$((ui_r * 38 / 100)); g=$((ui_g * 38 / 100)); b=$((ui_b * 38 / 100))
      fi
      case $ch in
        '#') glyph=$ui_full ;; p) glyph=$ui_tl ;; q) glyph=$ui_tr ;; b) glyph=$ui_bl ;; d) glyph=$ui_br ;;
        '=') glyph=$ui_hz ;; *) glyph=$ui_vt ;;
      esac
      ui_fgv $r $g $b; line="$line$ui_c$glyph"; x=$((x + 1))
    done
    printf '%s%s\n' "$line" "$ui_reset"
    ui_sleep 0.06
    y=$((y + 1))
  done
}

ui_header() {  # ui_header SUBTITLE [REVISION]
  tail="   ${1:-}"; [ -n "${2:-}" ] && tail="$tail   package $2"
  printf '\n'
  if [ "$ui_mode" = rich ]; then
    ui_checker 56; printf '\n'
    ui_cursor off; ui_logo_rich; ui_cursor on
    printf '\n   %s[1;3m%sT I M E   T R I A L S%s%s%s%s\n' "$ui_esc" "$(ui_fg 255 214 0)" "$ui_reset" "$(ui_fg 150 150 175)" "$tail" "$ui_reset"
    ui_checker 56; printf '\n'
    return 0
  fi
  if [ "$ui_mode" = basic ]; then
    w="${ui_esc}[1;37m"; e="${ui_esc}[1;35m"; y="${ui_esc}[1;33m"; g="${ui_esc}[2m"; n=$ui_reset
  else
    w=; e=; y=; g=; n=
  fi
  ui_checker; printf '\n'
  printf '   %s __  __  _  __%s  ___  %s ____  __  __%s\n' "$w" "$e" "$w" "$n"
  printf '   %s|  \\/  || |/ /%s ( _ ) %s|  _ \\ \\ \\/ /%s\n' "$w" "$e" "$w" "$n"
  printf '   %s| |\\/| || '"'"' / %s / _ \\ %s| | | | \\  / %s\n' "$w" "$e" "$w" "$n"
  printf '   %s| |  | || . \\ %s| (_) |%s| |_| | /  \\ %s\n' "$w" "$e" "$w" "$n"
  printf '   %s|_|  |_||_|\\_\\%s \\___/ %s|____/ /_/\\_\\%s\n\n' "$w" "$e" "$w" "$n"
  printf '   %sT I M E   T R I A L S%s%s%s%s\n' "$y" "$n" "$g" "$tail" "$n"
  ui_checker; printf '\n'
}

# ---- countdown -------------------------------------------------------------------------------------------------
ui_digit_rows() {  # the five block rows of 3, 2, 1 or GO
  case $1 in
    none) printf '\n\n\n\n\n' ;;
    3) printf '%s\n' '######  ' '     ## ' ' #####  ' '     ## ' '######  ' ;;
    2) printf '%s\n' '######  ' '     ## ' ' #####  ' '##      ' '####### ' ;;
    1) printf '%s\n' ' ## ' '### ' ' ## ' ' ## ' ' ## ' ;;
    *) printf '%s\n' ' ######    ######   ## ' '##        ##    ##  ## ' '##  ####  ##    ##  ## ' \
                     '##    ##  ##    ##     ' ' ######    ######   ## ' ;;
  esac
}
ui_countdown_frame() {  # ui_countdown_frame RED GREEN(yes|no) DIGIT
  red=$1; green=$2; top=; bottom=; i=0
  while [ $i -lt 3 ]; do
    if [ "$green" = yes ]; then c=$(ui_fg 90 255 140); elif [ $i -lt "$red" ]; then c=$(ui_fg 255 45 45); else c=$(ui_fg 55 55 65); fi
    top="$top$c$ui_lower$ui_full$ui_full$ui_lower   "; bottom="$bottom$c$ui_upper$ui_full$ui_full$ui_upper   "
    i=$((i + 1))
  done
  printf '%s[8A' "$ui_esc"
  printf '\r%22s%s%s%s[K\n\r%22s%s%s%s[K\n\r%s[K\n' '' "$top" "$ui_reset" "$ui_esc" '' "$bottom" "$ui_reset" "$ui_esc" "$ui_esc"
  row=0
  ui_digit_rows "$3" | while IFS= read -r pattern; do
    t=$((row * 250)); r=255; g=$((236 + (135 - 236) * t / 1000)); b=$((60 - 60 * t / 1000))
    cells=$(printf '%s' "$pattern" | sed "s/#/$ui_full/g")
    ui_repeat ' ' $((3 + (56 - ${#pattern}) / 2))
    printf '\r%s%s%s%s%s[K\n' "$ui_rep" "$(ui_fg $r $g $b)" "$cells" "$ui_reset" "$ui_esc"
    row=$((row + 1))
  done
}
ui_countdown() {
  printf '\n\n\n\n\n\n\n\n'
  ui_cursor off
  ui_countdown_frame 0 no none        # lamps off, nothing below yet
  ui_sleep 0.5
  for step in 3 2 1 GO; do
    case $step in 3) red=1 ;; 2) red=2 ;; *) red=3 ;; esac
    if [ "$step" = GO ]; then ui_countdown_frame 3 yes GO; else ui_countdown_frame $red no $step; fi
    [ "$ui_sound" = 0 ] || printf '\a'
    if [ "$step" = GO ]; then ui_sleep 0.5; else ui_sleep 0.8; fi
  done
  ui_cursor on
}

ui_start() {  # the countdown (unless skipped), then the race clock starts
  [ "$ui_mode" = plain ] && return 0
  if [ "$ui_mode" = rich ] && [ "$ui_skip_countdown" != 1 ]; then ui_countdown; printf '\n'; fi
  ui_race_start=$(ui_now); ui_laps=
}

# ---- laps and messages -----------------------------------------------------------------------------------------
ui_lap() {  # ui_lap N/TOTAL TEXT
  number=$1; text=$2
  if [ "$ui_mode" = plain ]; then printf '[LAP %s] %s\n' "$number" "$text"; return 0; fi
  done_=${number%/*}; total=${number#*/}
  if [ "$ui_mode" = basic ]; then
    printf '\n%s[30;43m LAP %s %s[33m %s %s' "$ui_esc" "$ui_reset" "$ui_esc" "$number" "$ui_reset"
    i=1; while [ $i -le "$total" ]; do
      if [ $i -le "$done_" ]; then printf '%s[36m==' "$ui_esc"; else printf '%s[90m--' "$ui_esc"; fi; i=$((i + 1))
    done
    printf '%s %s[1;37m%s%s\n' "$ui_reset" "$ui_esc" "$text" "$ui_reset"
    return 0
  fi
  [ -n "$ui_race_start" ] || { ui_race_start=$(ui_now); ui_laps=; }
  now=$(($(ui_now) - ui_race_start))
  ui_laps="$ui_laps$done_|$now|$text
"
  span=$((total - 1)); [ $span -lt 1 ] && span=1
  ui_gradient $(((done_ - 1) * 1000 / span)); label="${ui_esc}[1;3m$(ui_fg $ui_r $ui_g $ui_b)LAP $number$ui_reset"
  target=$(((done_ - 1) * 19 / span)); pos=$ui_kart; [ $pos -gt $target ] && pos=$target
  clock="  $(ui_fg 120 120 145)$(ui_time $now)$ui_reset"
  printf '\n'; ui_cursor off
  yellow=$(ui_fg 255 214 0); grey=$(ui_fg 90 90 115); red=$(ui_fg 255 60 60); white="${ui_esc}[1m$(ui_fg 235 235 245)"
  while :; do
    before=; i=0; while [ $i -lt $pos ]; do before="$before$ui_dash"; i=$((i + 1)); done
    after=; i=$((pos + 1)); while [ $i -lt 20 ]; do after="$after$ui_dash"; i=$((i + 1)); done
    printf '\r   %s  %s%s%s%s%s%s%s %s  %s%s%s%s%s[K' "$label" "$yellow" "$before" "$red" "$ui_car" "$grey" "$after" "$ui_reset" \
      "$ui_flag" "$white" "$text" "$ui_reset" "$clock" "$ui_esc"
    [ $pos -ge $target ] && break
    pos=$((pos + 1)); ui_sleep 0.025
  done
  printf '\n'; ui_cursor on
  ui_kart=$target
}

ui_step() {  # a step that is not a lap: ui_step LABEL
  case $ui_mode in
    plain) printf '\n[..] %s\n' "$1" ;;
    *) printf '\n%s[30;46m .. %s %s[1;37m%s%s\n' "$ui_esc" "$ui_reset" "$ui_esc" "$1" "$ui_reset" ;;
  esac
}

ui_info() {  # ui_info TEXT: "Label: value" lines get a grey label and a cyan value in rich mode
  case $ui_mode in
    plain|basic) printf '%s\n' "$1" ;;
    *)
      case $1 in
        ?*:\ *) printf '     %s%-22s %s%s%s\n' "$(ui_fg 120 120 145)" "${1%%: *}:" "$(ui_fg 0 200 255)" "${1#*: }" "$ui_reset" ;;
        *) printf '     %s\n' "$1" ;;
      esac ;;
  esac
}

ui_ok() {  # the words stay "OK  <text>" in every mode: the guides quote them
  text=${1:-Done.}
  case $ui_mode in
    plain) printf 'OK  %s\n' "$text" ;;
    basic) printf '%s[32mOK  %s%s\n' "$ui_esc" "$text" "$ui_reset" ;;
    *) printf '     %s%s OK  %s%s\n' "$(ui_fg 40 235 95)" "$ui_tick" "$text" "$ui_reset" ;;
  esac
}

ui_fail() {
  case $ui_mode in
    plain) printf '!!  %s\n' "$1" ;;
    basic) printf '%s[1;37;41m !! %s %s[31m%s%s\n' "$ui_esc" "$ui_reset" "$ui_esc" "$1" "$ui_reset" ;;
    *) printf '     %s[1;37;41m !! %s %s[31m%s%s\n' "$ui_esc" "$ui_reset" "$ui_esc" "$1" "$ui_reset" ;;
  esac
}

ui_menu_title() {
  case $ui_mode in
    plain) printf '\n%s\n' "$1" ;;
    *) printf '\n%s[30;46m PIT %s %s[1;37m%s%s\n' "$ui_esc" "$ui_reset" "$ui_esc" "$1" "$ui_reset" ;;
  esac
}
ui_menu_item() {  # ui_menu_item KEY TEXT
  case $ui_mode in
    plain) printf '  %s  %s\n' "$1" "$2" ;;
    *) if [ "$1" = 0 ]; then bg=100; else bg=47; fi
       printf '  %s[30;%sm %s %s  %s\n' "$ui_esc" "$bg" "$1" "$ui_reset" "$2" ;;
  esac
}

ui_results() {  # each lap's split, the fastest in yellow with a star, and the total
  [ -n "$ui_race_start" ] && [ -n "$ui_laps" ] || return 0
  end=$(($(ui_now) - ui_race_start))
  splits=$(printf '%s' "$ui_laps" | awk -F'|' -v end="$end" '
    { n[NR]=$1; s[NR]=$2; t[NR]=$3 } END { for (i = 1; i <= NR; i++) { e = (i < NR) ? s[i+1] : end; print n[i] "|" (e - s[i]) "|" t[i] } }')
  best=$(printf '%s\n' "$splits" | awk -F'|' 'NR == 1 || $2 < m { m = $2 } END { print m }')
  count=$(printf '%s\n' "$splits" | awk 'END { print NR }')
  span=$((count - 1)); [ $span -lt 1 ] && span=1
  printf '\n'
  printf '%s\n' "$splits" | while IFS='|' read -r number ms text; do
    ui_gradient $(((number - 1) * 1000 / span))
    if [ "$ms" = "$best" ]; then colour=$(ui_fg 255 214 0); mark=" $ui_star"; else colour=$(ui_fg 235 235 245); mark='  '; fi
    printf '   %s[3m%s%-7s%s%s%s%s%s   %s%s%s\n' "$ui_esc" "$(ui_fg $ui_r $ui_g $ui_b)" "LAP $number" "$ui_reset" \
      "$colour" "$(ui_time "$ms")" "$mark" "$ui_reset" "$(ui_fg 120 120 145)" "$text" "$ui_reset"
  done
  printf '   %s[1;3m%sTOTAL  %s%s\n' "$ui_esc" "$(ui_fg 255 214 0)" "$(ui_time $end)" "$ui_reset"
}

ui_finish() {  # ui_finish TEXT
  printf '\n'
  if [ "$ui_mode" = rich ]; then
    ui_checker 56; ui_cursor off; f=0
    while [ $f -lt 14 ]; do
      ui_gradient $((f % 7 * 1000 / 6))
      printf '\r   %s[1;3m%sFINISH!%s' "$ui_esc" "$(ui_fg $ui_r $ui_g $ui_b)" "$ui_reset"
      ui_sleep 0.07; f=$((f + 1))
    done
    ui_cursor on
    printf '\r   %s[1;3m%sFINISH!%s  %s[1m%s%s%s\n' "$ui_esc" "$(ui_fg 255 214 0)" "$ui_reset" "$ui_esc" "$(ui_fg 235 235 245)" "$1" "$ui_reset"
    ui_checker 56; ui_results
    return 0
  fi
  ui_checker
  if [ "$ui_mode" = plain ]; then printf '   FINISH  %s\n' "$1"
  else printf '   %s[30;47m FINISH %s  %s[1;37m%s%s\n' "$ui_esc" "$ui_reset" "$ui_esc" "$1" "$ui_reset"; fi
  ui_checker
}

ui_spin_quiet() {  # ui_spin_quiet LABEL COMMAND...: runs COMMAND silently; a small car circles meanwhile
  label=$1; shift
  if [ "$ui_mode" = plain ]; then "$@" >/dev/null 2>&1; return $?; fi
  start=${ui_race_start:-}
  (
    began=$(ui_now); step=0
    while :; do
      pos=$((step % 13)); ui_repeat ' ' "$pos"; track="$ui_rep-=o>"; ui_repeat ' ' $((12 - pos)); track="$track$ui_rep"
      if [ -n "$start" ]; then clock=$(ui_time $(($(ui_now) - start))); else clock=$(ui_time $(($(ui_now) - began))); fi
      printf '\r   [%s]  %s  %s' "$track" "$label" "$clock"
      step=$((step + 1)); sleep 0.1 2>/dev/null || sleep 1
    done
  ) &
  painter=$!
  ui_cursor off
  if "$@" >/dev/null 2>&1; then rc=0; else rc=$?; fi
  kill "$painter" 2>/dev/null || :; wait "$painter" 2>/dev/null || :
  printf '\r%s[K' "$ui_esc"; ui_cursor on
  return $rc
}

case "${ui_sourced:-}${1:-}" in
  --demo)
    # Shows every element without touching Docker, Python or an installation.
    for arg in "$@"; do
      case $arg in --plain) ui_set_plain ;; --skip-countdown) ui_skip_countdown=1 ;; esac
    done
    ui_header 'home & club LAN' demo
    ui_start
    ui_lap 1/4 'Checking Python'
    ui_info 'MK8DX package: /opt/mk8dx/demo'
    ui_lap 2/4 'Checking Docker'
    if ui_spin_quiet 'Waiting for the Docker engine' sleep 1; then ui_info 'The spinner returned 0.'; fi
    ui_lap 3/4 'Preparing the MK8DX programs'
    ui_ok
    ui_step 'An example step'
    ui_fail 'That step did not finish. Read the message above; your data is kept.'
    ui_lap 4/4 'Opening MK8DX beheer in your browser'
    ui_finish 'Ready. The setup opens in your browser.'
    ;;
esac
