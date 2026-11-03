#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
state=${1:-"$HOME/mk8dx-data"}
cd "$root"
printf 'MK8DX package: %s\nPrivate installation: %s\n' "$root" "$state"
python3 --version
# `docker compose version` also succeeds while the engine is stopped; `docker info` needs the running engine.
docker info >/dev/null 2>&1 || {
  echo 'Docker Engine is not running or this user may not use it (sudo systemctl start docker, or join the docker group).' >&2
  exit 1
}
docker compose version
# Images first: a source checkout has none, and must not run the wizard into the installation folder.
# A package loads its own images on its first start, even when older images carry the same tags (an update
# extracts into a new folder); later starts load again only when an image is missing.
load=no
[ -f images/docker-images-amd64.tar ] && [ ! -f images/loaded.txt ] && load=yes
if ! docker image inspect mk8dx/api:local-v010-node26-amd64 >/dev/null 2>&1 ||
   ! docker image inspect mk8dx/web:local-v010-node26-amd64 >/dev/null 2>&1; then
  [ -f images/docker-images-amd64.tar ] || { echo 'Complete prebuilt image bundle is missing.' >&2; exit 1; }
  load=yes
fi
if [ "$load" = yes ]; then
  echo 'Loading the included Docker images. This can take several minutes.'
  docker load --input images/docker-images-amd64.tar
  { date -u "+Images of this package loaded %Y-%m-%dT%H:%M:%SZ" > images/loaded.txt; } 2>/dev/null ||
    echo 'Note: the package folder is read-only, so the next start loads the images again.'
fi
if [ -e "$state" ]; then
  [ ! -L "$state" ] && [ -f "$state/operator-profile.json" ] || { echo 'Existing path has no safe operator profile.' >&2; exit 1; }
else
  python3 tooling/install.py wizard --state-dir "$state"
fi
printf 'Choose: 1 first setup/resume, 2 start, 3 status, 4 stop, 5 create administrator after sign-in, 6 backup, 7 update with verified backup\n'
read -r choice
case "$choice" in
  1) python3 tooling/install.py setup --state-dir "$state" ;;
  2) python3 tooling/install.py start --state-dir "$state" ;;
  3) python3 tooling/install.py check --state-dir "$state" ;;
  4) python3 tooling/install.py stop --state-dir "$state" ;;
  5) python3 tooling/install.py admin --state-dir "$state" ;;
  6) stamp=$(date -u +%Y%m%d-%H%M%S); python3 tooling/lifecycle.py backup --state-dir "$state" --output "$HOME/mk8dx-backups/$stamp" ;;
  7) stamp=$(date -u +%Y%m%d-%H%M%S); python3 tooling/install.py upgrade --state-dir "$state" --backup-output "$HOME/mk8dx-backups/$stamp" ;;
  *) echo 'Choose a displayed number.' >&2; exit 1 ;;
esac
