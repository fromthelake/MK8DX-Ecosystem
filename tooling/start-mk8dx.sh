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
printf 'MK8DX package: %s\n' "$root"
python3 -c 'import sys; assert sys.version_info >= (3, 12)' 2>/dev/null || {
  echo 'Python 3.12 or newer is missing. Install it (Ubuntu/Debian: sudo apt install python3 python3-venv; macOS: python.org) and retry.' >&2
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
if [ -e "$state" ]; then
  [ ! -L "$state" ] && [ -f "$state/operator-profile.json" ] || { echo 'Existing path has no safe operator profile.' >&2; exit 1; }
else
  "$python" tooling/install.py wizard --state-dir "$state"
fi
printf 'Choose: 1 first setup/resume, 2 start, 3 status, 4 stop, 5 create administrator after sign-in, 6 backup, 7 update with verified backup\n'
read -r choice
case "$choice" in
  1) "$python" tooling/install.py setup --state-dir "$state" ;;
  2) "$python" tooling/install.py start --state-dir "$state" ;;
  3) "$python" tooling/install.py check --state-dir "$state" ;;
  4) "$python" tooling/install.py stop --state-dir "$state" ;;
  5) "$python" tooling/install.py admin --state-dir "$state" ;;
  6) stamp=$(date -u +%Y%m%d-%H%M%S); "$python" tooling/lifecycle.py backup --state-dir "$state" --output "$HOME/mk8dx-backups/$stamp" ;;
  7) stamp=$(date -u +%Y%m%d-%H%M%S); "$python" tooling/install.py upgrade --state-dir "$state" --backup-output "$HOME/mk8dx-backups/$stamp" ;;
  *) echo 'Choose a displayed number.' >&2; exit 1 ;;
esac
