#!/bin/sh
# Start the gateway's command (Caddy) without root (#34).
#
# The container starts as root only for the two steps below and then hands the command to a
# non-root user for good (su-exec replaces this shell; nothing keeps running as root):
#
# 1. Choose the user. The default is caddy (uid/gid 10002). Caddy also reads files that the
#    installer bind-mounts from the installation's private state directory: client-config.json
#    and, on the A2 offline route, the CA signer (intermediate.key) and the phone setup page.
#    On a Linux host those belong to the operator's account with mode 0600 in 0700 folders.
#    They keep those modes: Caddy then runs as that (non-root) account's uid:gid instead.
#    Only when no non-root user can read every mounted file does Caddy keep running as root,
#    as every image before this change did, and a warning says so.
# 2. Give Caddy's own storage (/data, /config) to that user. Installations from before this
#    change have root-owned volumes (certificates, the LAN route's local CA, autosave.json).
#    chown keeps every file mode, so private keys stay 0600; links are not followed.
#
# The same Compose files work with older (root) and newer images, so a package update or a
# rollback never has to change them together with the image.
set -eu

if [ "$(id -u)" -ne 0 ]; then
  exec "$@"
fi

# Every file Caddy reads from a bind mount (the image's own files are world-readable).
mounted_inputs() {
  for path in /etc/caddy/Caddyfile /srv/client-config.json; do
    if [ -e "$path" ]; then printf '%s\n' "$path"; fi
  done
  if [ -d /run/mk8dx ]; then find /run/mk8dx -type f; fi
}

# readable_by USER: true when USER can open every mounted input (folders included).
readable_by() {
  mounted_inputs | su-exec "$1" sh -c 'while IFS= read -r path; do test -r "$path" || exit 1; done'
}

first_unreadable_owner() {
  mounted_inputs | while IFS= read -r path; do
    if ! su-exec caddy test -r "$path"; then
      stat -c '%u:%g' "$path"
      break
    fi
  done
}

run_as=caddy
if ! readable_by caddy; then
  owner=$(first_unreadable_owner)
  if [ -n "$owner" ] && [ "${owner%%:*}" != 0 ] && [ "${owner#*:}" != 0 ] && readable_by "$owner"; then
    run_as=$owner
  else
    echo "mk8dx-gateway: some mounted files are readable only by root; Caddy runs as root" >&2
    exec "$@"
  fi
fi

if [ "$run_as" = caddy ]; then
  uid=$(id -u caddy)
  gid=$(id -g caddy)
else
  uid=${run_as%%:*}
  gid=${run_as#*:}
fi

for storage in /data /config; do
  if [ -d "$storage" ] && [ ! -L "$storage" ]; then
    find "$storage" \( ! -user "$uid" -o ! -group "$gid" \) -exec chown -h "$uid:$gid" {} +
  fi
done

exec su-exec "$run_as" "$@"
