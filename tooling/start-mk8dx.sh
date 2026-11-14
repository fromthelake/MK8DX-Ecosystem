#!/bin/sh
# MK8DX host launcher for Linux and macOS (the Windows counterpart is start-mk8dx.ps1).
# An A2 offline package opens the setup wizard / "MK8DX beheer" in the browser; other routes keep the menu.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
# Options anywhere on the line; the first other argument is the installation directory.
#   --skip-countdown  no 3-2-1-GO countdown (also MK8DX_SKIP_COUNTDOWN=1)
#   --plain           plain text, no colours or animation (also MK8DX_PLAIN=1 or NO_COLOR)
state_arg=
for arg do
  case $arg in
    --skip-countdown) MK8DX_SKIP_COUNTDOWN=1 ;;
    --plain) MK8DX_PLAIN=1 ;;
    *) [ -n "$state_arg" ] || state_arg=$arg ;;
  esac
done
case "$(uname -s)" in
  Darwin) data_home="$HOME/Library/Application Support/MK8DX" ;;
  *) data_home="${XDG_DATA_HOME:-$HOME/.local/share}/mk8dx" ;;
esac
cd "$root"
# Presentation only (header, countdown, laps, spinner, finish); plain text when the output is not a terminal.
if [ -f tooling/mk8dx-ui.sh ]; then
  ui_sourced=1
  . ./tooling/mk8dx-ui.sh
else
  ui_header() { printf '\n   T I M E   T R I A L S   %s\n\n' "$1"; }
  ui_start() { :; }
  ui_lap() { printf '[LAP %s] %s\n' "$1" "$2"; }
  ui_step() { printf '\n[..] %s\n' "$1"; }
  ui_info() { printf '%s\n' "$1"; }
  ui_ok() { printf 'OK  %s\n' "${1:-Done.}"; }
  ui_fail() { printf '!!  %s\n' "$1"; }
  ui_menu_title() { printf '\n%s\n' "$1"; }
  ui_menu_item() { printf '  %s  %s\n' "$1" "$2"; }
  ui_finish() { printf '   FINISH  %s\n' "$1"; }
  ui_spin_quiet() { shift; "$@" >/dev/null 2>&1; }
  ui_t() {  # English only without tooling/mk8dx-ui.sh: just fill {0}, {1}
    ui_text=$1; shift; ui_index=0
    for ui_value do
      case $ui_text in *"{$ui_index}"*) ui_text="${ui_text%%"{$ui_index}"*}$ui_value${ui_text#*"{$ui_index}"}" ;; esac
      ui_index=$((ui_index + 1))
    done
    printf '%s' "$ui_text"
  }
fi
tagline=$(ui_t 'community server')
if [ -f images/images.json ] && grep -q '"qaOfflineCandidate": true' images/images.json; then tagline=$(ui_t 'home & club LAN'); fi
ui_header "$tagline"
ui_start
ui_lap 1/4 "$(ui_t 'Checking Python')"
ui_info "$(ui_t 'MK8DX package: {0}' "$root")"
# The package carries offline wheels for exactly Python 3.12 to 3.15 (tooling/release/host_bundle.py).
python3 -c 'import sys; assert (3, 12) <= sys.version_info[:2] <= (3, 15)' 2>/dev/null || {
  ui_fail "$(ui_t 'Python 3.12 to 3.15 is missing. Install it (Ubuntu/Debian: sudo apt install python3 python3-venv; macOS: python.org) and retry.')" >&2
  exit 1
}
python3 --version
# `docker compose version` also succeeds while the engine is stopped; `docker info` needs the running engine.
ui_lap 2/4 "$(ui_t 'Checking Docker')"
ui_spin_quiet "$(ui_t 'Waiting for the Docker engine')" docker info || {
  ui_fail "$(ui_t 'Docker is not running or this user may not use it (Linux: sudo systemctl start docker, and join the docker group; macOS: start Docker Desktop).')" >&2
  exit 1
}
docker compose version
ui_lap 3/4 "$(ui_t 'Preparing the MK8DX programs')"
# The package names its own images (images/images.json); an A2 offline package says so there.
api_tag='mk8dx/api:local-v010-node26-amd64'
web_tag='mk8dx/web:local-v010-node26-amd64'
candidate=no
if [ -f images/images.json ]; then
  api_tag=$(python3 -c 'import json; print(json.load(open("images/images.json"))["api"])')
  web_tag=$(python3 -c 'import json; print(json.load(open("images/images.json"))["web"])')
  candidate=$(python3 -c 'import json; print("yes" if json.load(open("images/images.json")).get("qaOfflineCandidate") is True else "no")')
fi
# The image bundle for this processor (Apple Silicon and Raspberry Pi are arm64).
case "$(uname -m)" in
  arm64|aarch64) arch=arm64 ;;
  *) arch=amd64 ;;
esac
bundle="images/docker-images-$arch.tar"
[ -f "$bundle" ] || bundle=images/docker-images-amd64.tar
load=no
[ -f "$bundle" ] && [ ! -f images/loaded.txt ] && load=yes
if ! docker image inspect "$api_tag" >/dev/null 2>&1 || ! docker image inspect "$web_tag" >/dev/null 2>&1; then
  [ -f "$bundle" ] || { ui_fail "$(ui_t 'Complete prebuilt image bundle is missing.')" >&2; exit 1; }
  load=yes
fi
if [ "$load" = yes ]; then
  ui_info "$(ui_t 'Loading the included Docker images. This can take several minutes.')"
  docker load --input "$bundle"
  { date -u "+Images of this package loaded %Y-%m-%dT%H:%M:%SZ" > images/loaded.txt; } 2>/dev/null ||
    ui_info "$(ui_t 'Note: the package folder is read-only, so the next start loads the images again.')"
fi
python=python3
if [ -d wheels ]; then
  # Offline Python packages for the A2 certificate tools: a private venv, never an internet download.
  hash=$(python3 -c 'import hashlib; print(hashlib.sha256(open("tooling/requirements-offline-lan.txt","rb").read()).hexdigest()[:12].upper())')
  venv="$data_home/python-offline-$hash"
  if [ ! -x "$venv/bin/python" ]; then
    ui_info "$(ui_t 'Preparing the included Python packages (once, without internet).')"
    mkdir -p "$data_home"
    python3 -m venv "$venv" || { ui_fail "$(ui_t 'Could not create the private Python environment (Ubuntu/Debian: sudo apt install python3-venv).')" >&2; exit 1; }
    "$venv/bin/python" -m pip install --no-index --find-links wheels --require-hashes -r wheels/requirements.hashes.txt ||
      { rm -rf "$venv"; ui_fail "$(ui_t 'Installing the included Python packages failed.')" >&2; exit 1; }
  fi
  python="$venv/bin/python"
fi
if [ "$candidate" = yes ]; then
  state=${state_arg:-"$data_home/LAN"}
else
  state=${state_arg:-"$HOME/mk8dx-data"}
fi
ui_info "$(ui_t 'Private installation: {0}' "$state")"
offline_install=no
if [ -f "$state/operator-profile.json" ]; then
  offline_install=$("$python" -c 'import json,sys; print("yes" if json.load(open(sys.argv[1])).get("route") == "A2_OFFLINE" else "no")' "$state/operator-profile.json")
fi
if [ "$candidate" = yes ] && { [ "$offline_install" = yes ] || [ ! -e "$state" ]; }; then
  # The guided setup / "MK8DX beheer" in the browser (docs/install/A2_HOME_GUIDE_EN.md).
  ui_lap 4/4 "$(ui_t 'Opening MK8DX beheer in your browser')"
  ui_finish "$(ui_t 'Ready. MK8DX beheer opens in your browser; keep this window open.')"
  exec "$python" tooling/setup_wizard.py --state-dir "$state"
fi
fresh=no
if [ -e "$state" ]; then
  [ ! -L "$state" ] && [ -f "$state/operator-profile.json" ] || { ui_fail "$(ui_t 'Existing path has no safe operator profile.')" >&2; exit 1; }
else
  fresh=yes
  "$python" tooling/install.py wizard --state-dir "$state" || { ui_fail "$(ui_t 'The guided setup did not finish.')" >&2; exit 1; }
fi
route=$("$python" -c 'import json,sys; print(json.load(open(sys.argv[1])).get("route", ""))' "$state/operator-profile.json")
origin=$("$python" -c 'import json,sys; print(json.load(open(sys.argv[1])).get("origin", ""))' "$state/operator-profile.json")
flag=
admin_label=$(ui_t 'Make me administrator (after you signed in once)')
if [ "$route" = A2_OFFLINE ]; then
  [ "$candidate" = yes ] || { ui_fail "$(ui_t 'This installation is an A2 home or club installation; start it from the mk8dx-a2 package.')" >&2; exit 1; }
  flag=--qa-offline-candidate
  admin_label=$(ui_t 'Unlock the host page (first administrator, invitations)')
fi
step() {
  label=$1; shift
  ui_step "$label"
  if "$@"; then ui_ok; else ui_fail "$(ui_t 'That step did not finish. Read the message above; your data is kept. Fix it and choose the step again.')"; fi
}
backup() {
  "$python" tooling/lifecycle.py backup --state-dir "$state" --output "$1" &&
    "$python" tooling/lifecycle.py verify --backup "$1" &&
    ui_info "$(ui_t 'Private backup (keep it safe, never share it): {0}' "$1")"
}
if [ "$fresh" = yes ]; then
  step "$(ui_t 'First setup: database, keys and reference times (the first time takes a few minutes)')" \
    "$python" tooling/install.py setup --state-dir "$state" $flag
fi
while :; do
  ui_menu_title "$(ui_t 'What do you want to do?')"
  ui_menu_item 1 "$(ui_t 'First setup, or finish an interrupted one')"
  ui_menu_item 2 "$(ui_t 'Start MK8DX')"
  ui_menu_item 3 "$(ui_t 'Check that everything works')"
  ui_menu_item 4 "$(ui_t 'Stop MK8DX')"
  ui_menu_item 5 "$admin_label"
  ui_menu_item 6 "$(ui_t 'Make a backup (it is checked right away)')"
  ui_menu_item 7 "$(ui_t 'Update to this package (makes a checked backup first)')"
  ui_menu_item 8 "$(ui_t 'Show the website address')"
  ui_menu_item 0 "$(ui_t 'Close')"
  printf '%s' "$(ui_t 'Type a number and press Enter: ')"
  read -r choice || exit 0
  stamp=$(date -u +%Y%m%d-%H%M%S)
  case "$choice" in
    1) step "$(ui_t 'First setup')" "$python" tooling/install.py setup --state-dir "$state" $flag ;;
    2) step "$(ui_t 'Starting MK8DX')" "$python" tooling/install.py start --state-dir "$state" $flag ;;
    3) step "$(ui_t 'Checking MK8DX')" "$python" tooling/install.py check --state-dir "$state" $flag ;;
    4) step "$(ui_t 'Stopping MK8DX')" "$python" tooling/install.py stop --state-dir "$state" $flag ;;
    5) step "$admin_label" "$python" tooling/install.py admin --state-dir "$state" $flag ;;
    6) step "$(ui_t 'Making and checking a backup')" backup "$HOME/mk8dx-backups/$stamp" ;;
    7) step "$(ui_t 'Checked backup, then the update')" "$python" tooling/install.py upgrade --state-dir "$state" --backup-output "$HOME/mk8dx-backups/$stamp" $flag ;;
    8) ui_info "$(ui_t 'Website: {0}' "$origin")" ;;
    0) exit 0 ;;
    *) printf '%s\n' "$(ui_t "'{0}' is not one of the numbers above." "$choice")" ;;
  esac
done
