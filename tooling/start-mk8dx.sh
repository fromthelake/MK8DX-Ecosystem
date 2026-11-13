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
fi
tagline='community server'
if [ -f images/images.json ] && grep -q '"qaOfflineCandidate": true' images/images.json; then tagline='home & club LAN'; fi
ui_header "$tagline"
ui_start
ui_lap 1/4 'Checking Python'
ui_info "MK8DX package: $root"
# The package carries offline wheels for exactly Python 3.12 to 3.15 (tooling/release/host_bundle.py).
python3 -c 'import sys; assert (3, 12) <= sys.version_info[:2] <= (3, 15)' 2>/dev/null || {
  ui_fail 'Python 3.12 to 3.15 is missing. Install it (Ubuntu/Debian: sudo apt install python3 python3-venv; macOS: python.org) and retry.' >&2
  exit 1
}
python3 --version
# `docker compose version` also succeeds while the engine is stopped; `docker info` needs the running engine.
ui_lap 2/4 'Checking Docker'
ui_spin_quiet 'Waiting for the Docker engine' docker info || {
  ui_fail 'Docker is not running or this user may not use it (Linux: sudo systemctl start docker, and join the docker group; macOS: start Docker Desktop).' >&2
  exit 1
}
docker compose version
ui_lap 3/4 'Preparing the MK8DX programs'
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
  [ -f "$bundle" ] || { ui_fail 'Complete prebuilt image bundle is missing.' >&2; exit 1; }
  load=yes
fi
if [ "$load" = yes ]; then
  ui_info 'Loading the included Docker images. This can take several minutes.'
  docker load --input "$bundle"
  { date -u "+Images of this package loaded %Y-%m-%dT%H:%M:%SZ" > images/loaded.txt; } 2>/dev/null ||
    ui_info 'Note: the package folder is read-only, so the next start loads the images again.'
fi
python=python3
if [ -d wheels ]; then
  # Offline Python packages for the A2 certificate tools: a private venv, never an internet download.
  hash=$(python3 -c 'import hashlib; print(hashlib.sha256(open("tooling/requirements-offline-lan.txt","rb").read()).hexdigest()[:12].upper())')
  venv="$data_home/python-offline-$hash"
  if [ ! -x "$venv/bin/python" ]; then
    ui_info 'Preparing the included Python packages (once, without internet).'
    mkdir -p "$data_home"
    python3 -m venv "$venv" || { ui_fail 'Could not create the private Python environment (Ubuntu/Debian: sudo apt install python3-venv).' >&2; exit 1; }
    "$venv/bin/python" -m pip install --no-index --find-links wheels --require-hashes -r wheels/requirements.hashes.txt ||
      { rm -rf "$venv"; ui_fail 'Installing the included Python packages failed.' >&2; exit 1; }
  fi
  python="$venv/bin/python"
fi
if [ "$candidate" = yes ]; then
  state=${state_arg:-"$data_home/LAN"}
else
  state=${state_arg:-"$HOME/mk8dx-data"}
fi
ui_info "Private installation: $state"
offline_install=no
if [ -f "$state/operator-profile.json" ]; then
  offline_install=$("$python" -c 'import json,sys; print("yes" if json.load(open(sys.argv[1])).get("route") == "A2_OFFLINE" else "no")' "$state/operator-profile.json")
fi
if [ "$candidate" = yes ] && { [ "$offline_install" = yes ] || [ ! -e "$state" ]; }; then
  # The guided setup / "MK8DX beheer" in the browser (docs/install/A2_HOME_GUIDE_EN.md).
  ui_lap 4/4 'Opening MK8DX beheer in your browser'
  ui_finish 'Ready. MK8DX beheer opens in your browser; keep this window open.'
  exec "$python" tooling/setup_wizard.py --state-dir "$state"
fi
fresh=no
if [ -e "$state" ]; then
  [ ! -L "$state" ] && [ -f "$state/operator-profile.json" ] || { ui_fail 'Existing path has no safe operator profile.' >&2; exit 1; }
else
  fresh=yes
  "$python" tooling/install.py wizard --state-dir "$state" || { ui_fail 'The guided setup did not finish.' >&2; exit 1; }
fi
route=$("$python" -c 'import json,sys; print(json.load(open(sys.argv[1])).get("route", ""))' "$state/operator-profile.json")
origin=$("$python" -c 'import json,sys; print(json.load(open(sys.argv[1])).get("origin", ""))' "$state/operator-profile.json")
flag=
admin_label='Make me administrator (after you signed in once)'
if [ "$route" = A2_OFFLINE ]; then
  [ "$candidate" = yes ] || { ui_fail 'This installation is an A2 home or club installation; start it from the mk8dx-a2 package.' >&2; exit 1; }
  flag=--qa-offline-candidate
  admin_label='Unlock the host page (first administrator, invitations)'
fi
step() {
  label=$1; shift
  ui_step "$label"
  if "$@"; then ui_ok 'Done.'; else ui_fail 'That step did not finish. Read the message above; your data is kept. Fix it and choose the step again.'; fi
}
backup() {
  "$python" tooling/lifecycle.py backup --state-dir "$state" --output "$1" &&
    "$python" tooling/lifecycle.py verify --backup "$1" &&
    ui_info "Private backup (keep it safe, never share it): $1"
}
if [ "$fresh" = yes ]; then
  step 'First setup: database, keys and reference times (the first time takes a few minutes)' \
    "$python" tooling/install.py setup --state-dir "$state" $flag
fi
while :; do
  ui_menu_title 'What do you want to do?'
  ui_menu_item 1 'First setup, or finish an interrupted one'
  ui_menu_item 2 'Start MK8DX'
  ui_menu_item 3 'Check that everything works'
  ui_menu_item 4 'Stop MK8DX'
  ui_menu_item 5 "$admin_label"
  ui_menu_item 6 'Make a backup (it is checked right away)'
  ui_menu_item 7 'Update to this package (makes a checked backup first)'
  ui_menu_item 8 'Show the website address'
  ui_menu_item 0 'Close'
  printf 'Type a number and press Enter: '
  read -r choice || exit 0
  stamp=$(date -u +%Y%m%d-%H%M%S)
  case "$choice" in
    1) step 'First setup' "$python" tooling/install.py setup --state-dir "$state" $flag ;;
    2) step 'Starting MK8DX' "$python" tooling/install.py start --state-dir "$state" $flag ;;
    3) step 'Checking MK8DX' "$python" tooling/install.py check --state-dir "$state" $flag ;;
    4) step 'Stopping MK8DX' "$python" tooling/install.py stop --state-dir "$state" $flag ;;
    5) step "$admin_label" "$python" tooling/install.py admin --state-dir "$state" $flag ;;
    6) step 'Making and checking a backup' backup "$HOME/mk8dx-backups/$stamp" ;;
    7) step 'Checked backup, then the update' "$python" tooling/install.py upgrade --state-dir "$state" --backup-output "$HOME/mk8dx-backups/$stamp" $flag ;;
    8) ui_info "Website: $origin" ;;
    0) exit 0 ;;
    *) printf "'%s' is not one of the numbers above.\n" "$choice" ;;
  esac
done
