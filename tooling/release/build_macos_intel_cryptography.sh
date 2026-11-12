#!/bin/sh
# Builds the one A2 wheel that has no Intel Mac download: cryptography (pinned in
# tooling/requirements-offline-lan.txt). Its makers stopped publishing x86_64 macOS wheels after 48.0.1, and
# going back to 48 would ship known security advisories. So the pinned version is built from its source, on
# an Intel Mac, with OpenSSL linked in statically: the wheel needs nothing from Homebrew or the system.
#
# Run on an Intel Mac (GitHub runner macos-15-intel, or your own) with Python 3.12+, a C compiler (Xcode
# command line tools), Rust (rustup) and perl:
#   sh tooling/release/build_macos_intel_cryptography.sh <output-folder>
# The release workflow runs it, tests the wheel and hands it to the macos/amd64 A2 package.
set -eu

out=${1:?usage: build_macos_intel_cryptography.sh <output-folder>}
root=$(cd "$(dirname "$0")/../.." && pwd)
test "$(uname -s)" = Darwin || { echo "Run this on macOS." >&2; exit 2; }
test "$(uname -m)" = x86_64 || { echo "Run this on an Intel Mac (uname -m says $(uname -m))." >&2; exit 2; }

openssl_version=3.5.9
openssl_sha256=603f5602e2eef00d77fbd429d34dcd5822bb301757a1bc9cdb24c670f1eb859a
crypto_version=$(sed -n 's/^cryptography==//p' "$root/tooling/requirements-offline-lan.txt")
test -n "$crypto_version"

# The oldest macOS the other wheels support (cffi ships macosx_10_15_x86_64).
export MACOSX_DEPLOYMENT_TARGET=10.15
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"

echo "OpenSSL $openssl_version, static, for macOS $MACOSX_DEPLOYMENT_TARGET and newer"
curl -fsSL -o "$work/openssl.tar.gz" \
  "https://github.com/openssl/openssl/releases/download/openssl-$openssl_version/openssl-$openssl_version.tar.gz"
echo "$openssl_sha256  $work/openssl.tar.gz" | shasum -a 256 -c -
tar -xzf "$work/openssl.tar.gz" -C "$work"
(cd "$work/openssl-$openssl_version" &&
  ./Configure darwin64-x86_64-cc no-shared no-tests --prefix="$work/openssl" --libdir=lib >/dev/null &&
  make -j"$(sysctl -n hw.ncpu)" >/dev/null && make install_sw >/dev/null)

echo "cryptography $crypto_version from source"
python3 -m venv "$work/venv"
"$work/venv/bin/python" -m pip install -q --upgrade pip
OPENSSL_DIR="$work/openssl" OPENSSL_STATIC=1 OPENSSL_NO_VENDOR=1 \
  "$work/venv/bin/python" -m pip wheel -q --no-deps --no-binary cryptography \
  "cryptography==$crypto_version" -w "$out"

wheel=$(ls "$out"/cryptography-"$crypto_version"-*macosx*_x86_64.whl)
echo "built $(basename "$wheel")"
# Only system libraries may be linked: no Homebrew or build-folder paths.
unzip -q -o "$wheel" -d "$work/check"
find "$work/check" -name '*.so' | while read -r library; do
  if otool -L "$library" | tail -n +2 | grep -v -e '/usr/lib/' -e '/System/Library/' | grep -q .; then
    echo "linked outside the system: $library" >&2; otool -L "$library" >&2; exit 1
  fi
done
echo "ok: $(basename "$wheel") links only system libraries"
