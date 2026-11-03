#!/bin/sh
set -eu
umask 077
private_file="$(mktemp)"
trap 'rm -f "$private_file"' EXIT HUP INT TERM
cp /run/mk8dx/operator.json "$private_file"
program="$1"
shift
node "$program" --private-environment-file "$private_file" "$@"
