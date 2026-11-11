#!/bin/sh
# MK8DX host launcher for Linux and macOS (the Windows counterpart is start-mk8dx.ps1).
# An A2 offline package opens the setup wizard / "MK8DX beheer" in the browser; other routes keep the menu.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
case "$(uname -s)" in
  Darwin) data_home="$HOME/Library/Application Support/MK8DX" ;;
  *) data_home="${XDG_DATA_HOME:-$HOME/.local/share}/mk8dx" ;;
esac
cd "$root"
if [ -t 1 ]; then
  w=$(printf '\033[1;37m'); e=$(printf '\033[1;35m'); y=$(printf '\033[1;33m'); g=$(printf '\033[2m'); n=$(printf '\033[0m')
else
  w=; e=; y=; g=; n=
fi
printf '\n'
printf '   %s __  __  _  __%s  ___  %s ____  __  __%s\n' "$w" "$e" "$w" "$n"
printf '   %s|  \\/  || |/ /%s ( _ ) %s|  _ \\ \\ \\/ /%s\n' "$w" "$e" "$w" "$n"
printf '   %s| |\\/| || '"'"' / %s / _ \\ %s| | | | \\  / %s\n' "$w" "$e" "$w" "$n"
printf '   %s| |  | || . \\ %s| (_) |%s| |_| | /  \\ %s\n' "$w" "$e" "$w" "$n"
printf '   %s|_|  |_||_|\\_\\%s \\___/ %s|____/ /_/\\_\\%s\n\n' "$w" "$e" "$w" "$n"
tagline='community server'
if [ -f images/images.json ] && grep -q '"qaOfflineCandidate": true' images/images.json; then tagline='home & club LAN'; fi
printf '   %sT I M E   T R I A L S%s   %s%s%s\n\n' "$y" "$n" "$g" "$tagline" "$n"
printf 'MK8DX package: %s\n' "$root"
# The package carries offline wheels for exactly Python 3.12 to 3.15 (tooling/release/host_bundle.py).
python3 -c 'import sys; assert (3, 12) <= sys.version_info[:2] <= (3, 15)' 2>/dev/null || {
  echo 'Python 3.12 to 3.15 is missing. Install it (Ubuntu/Debian: sudo apt install python3 python3-venv; macOS: python.org) and retry.' >&2
  exit 1
}
python3 --version
# `docker compose version` also succeeds while the engine is stopped; `docker info` needs the running engine.
docker info >/dev/null 2>&1 || {
  echo 'Docker is not running or this user may not use it (Linux: sudo systemctl start docker, and join the docker group; macOS: start Docker Desktop).' >&2
  exit 1
}
docker compose version
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
  [ -f "$bundle" ] || { echo 'Complete prebuilt image bundle is missing.' >&2; exit 1; }
  load=yes
fi
if [ "$load" = yes ]; then
  echo 'Loading the included Docker images. This can take several minutes.'
  docker load --input "$bundle"
  { date -u "+Images of this package loaded %Y-%m-%dT%H:%M:%SZ" > images/loaded.txt; } 2>/dev/null ||
    echo 'Note: the package folder is read-only, so the next start loads the images again.'
fi
python=python3
if [ -d wheels ]; then
  # Offline Python packages for the A2 certificate tools: a private venv, never an internet download.
  hash=$(python3 -c 'import hashlib; print(hashlib.sha256(open("tooling/requirements-offline-lan.txt","rb").read()).hexdigest()[:12].upper())')
  venv="$data_home/python-offline-$hash"
  if [ ! -x "$venv/bin/python" ]; then
    echo 'Preparing the included Python packages (once, without internet).'
    mkdir -p "$data_home"
    python3 -m venv "$venv" || { echo 'Could not create the private Python environment (Ubuntu/Debian: sudo apt install python3-venv).' >&2; exit 1; }
    "$venv/bin/python" -m pip install --no-index --find-links wheels --require-hashes -r wheels/requirements.hashes.txt ||
      { rm -rf "$venv"; echo 'Installing the included Python packages failed.' >&2; exit 1; }
  fi
  python="$venv/bin/python"
fi
if [ "$candidate" = yes ]; then
  state=${1:-"$data_home/LAN"}
else
  state=${1:-"$HOME/mk8dx-data"}
fi
printf 'Private installation: %s\n' "$state"
offline_install=no
if [ -f "$state/operator-profile.json" ]; then
  offline_install=$("$python" -c 'import json,sys; print("yes" if json.load(open(sys.argv[1])).get("route") == "A2_OFFLINE" else "no")' "$state/operator-profile.json")
fi
if [ "$candidate" = yes ] && { [ "$offline_install" = yes ] || [ ! -e "$state" ]; }; then
  # The guided setup / "MK8DX beheer" in the browser (docs/install/A2_HOME_GUIDE_EN.md).
  exec "$python" tooling/setup_wizard.py --state-dir "$state"
fi
fresh=no
if [ -e "$state" ]; then
  [ ! -L "$state" ] && [ -f "$state/operator-profile.json" ] || { echo 'Existing path has no safe operator profile.' >&2; exit 1; }
else
  fresh=yes
  "$python" tooling/install.py wizard --state-dir "$state" || { echo 'The guided setup did not finish.' >&2; exit 1; }
fi
route=$("$python" -c 'import json,sys; print(json.load(open(sys.argv[1])).get("route", ""))' "$state/operator-profile.json")
origin=$("$python" -c 'import json,sys; print(json.load(open(sys.argv[1])).get("origin", ""))' "$state/operator-profile.json")
flag=
admin_label='Make me administrator (after you signed in once)'
if [ "$route" = A2_OFFLINE ]; then
  [ "$candidate" = yes ] || { echo 'This installation is an A2 home or club installation; start it from the mk8dx-a2 package.' >&2; exit 1; }
  flag=--qa-offline-candidate
  admin_label='Unlock the host page (first administrator, invitations)'
fi
step() {
  label=$1; shift
  printf '\n[..] %s\n' "$label"
  if "$@"; then printf 'OK  Done.\n'; else printf '!!  That step did not finish. Read the message above; your data is kept. Fix it and choose the step again.\n'; fi
}
backup() {
  "$python" tooling/lifecycle.py backup --state-dir "$state" --output "$1" &&
    "$python" tooling/lifecycle.py verify --backup "$1" &&
    printf 'Private backup (keep it safe, never share it): %s\n' "$1"
}
if [ "$fresh" = yes ]; then
  step 'First setup: database, keys and reference times (the first time takes a few minutes)' \
    "$python" tooling/install.py setup --state-dir "$state" $flag
fi
while :; do
  printf '\nWhat do you want to do?\n'
  printf '  1  First setup, or finish an interrupted one\n  2  Start MK8DX\n  3  Check that everything works\n  4  Stop MK8DX\n'
  printf '  5  %s\n' "$admin_label"
  printf '  6  Make a backup (it is checked right away)\n  7  Update to this package (makes a checked backup first)\n'
  printf '  8  Show the website address\n  0  Close\n'
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
    8) printf 'Website: %s\n' "$origin" ;;
    0) exit 0 ;;
    *) printf "'%s' is not one of the numbers above.\n" "$choice" ;;
  esac
done
