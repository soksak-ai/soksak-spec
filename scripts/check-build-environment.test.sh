#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
[ -x "$root/scripts/check-build-environment.sh" ] || {
  echo 'BUILD_ENVIRONMENT_CONTRACT_RED: canonical preflight is missing' >&2
  exit 1
}

fixture=$(mktemp -d "${TMPDIR:-/tmp}/soksak-build-environment.XXXXXX")
trap 'rm -rf "$fixture"' EXIT HUP INT TERM
mkdir -p "$fixture/bin" "$fixture/scripts"
cp "$root/scripts/check-build-environment.sh" "$fixture/scripts/check-build-environment.sh"
printf '%s\n' '26.7.0' > "$fixture/.node-version"
printf '%s\n' '{"engines":{"node":"26.7.0"},"packageManager":"pnpm@11.22.0"}' > "$fixture/package.json"
printf '%s\n' 'lockfileVersion: 9.0' > "$fixture/pnpm-lock.yaml"

printf '%s\n' \
  '#!/bin/sh' \
  'case "$1" in' \
  '  --version) printf '\''v%s\n'\'' "$FIXTURE_NODE_VERSION" ;;' \
  '  -p)' \
  '    case "$2" in' \
  '      process.platform) printf '\''%s\n'\'' "$FIXTURE_NODE_PLATFORM" ;;' \
  '      process.arch) printf '\''%s\n'\'' "$FIXTURE_NODE_ARCH" ;;' \
  '      *) exit 2 ;;' \
  '    esac' \
  '    ;;' \
  '  *) exit 2 ;;' \
  'esac' > "$fixture/bin/node"
printf '%s\n' \
  '#!/bin/sh' \
  '[ "$#" -eq 1 ] && [ "$1" = --version ] || {' \
  '  echo '\''preflight attempted to mutate dependency state'\'' >&2' \
  '  exit 97' \
  '}' \
  'printf '\''%s\n'\'' "$FIXTURE_PNPM_VERSION"' > "$fixture/bin/pnpm"
chmod +x "$fixture/bin/node" "$fixture/bin/pnpm" "$fixture/scripts/check-build-environment.sh"

case "$(uname -s)" in
  Darwin)
    fixture_platform=darwin
    if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then fixture_arch=arm64; else fixture_arch=x64; fi
    ;;
  Linux)
    fixture_platform=linux
    case "$(uname -m)" in aarch64|arm64) fixture_arch=arm64 ;; x86_64|amd64) fixture_arch=x64 ;; *) exit 1 ;; esac
    ;;
  MINGW*|MSYS*|CYGWIN*) fixture_platform=win32; fixture_arch=x64 ;;
  *) exit 1 ;;
esac

output=$(PATH="$fixture/bin:/usr/bin:/bin" \
  FIXTURE_NODE_VERSION=26.7.0 FIXTURE_NODE_PLATFORM="$fixture_platform" FIXTURE_NODE_ARCH="$fixture_arch" \
  FIXTURE_PNPM_VERSION=11.22.0 \
  "$fixture/scripts/check-build-environment.sh")
printf '%s\n' "$output" | grep -Fq "BUILD_ENVIRONMENT_READY required=$fixture_platform/$fixture_arch node=v26.7.0 nodeRuntime=$fixture_platform/$fixture_arch pnpm=11.22.0 lockSHA256="

set +e
PATH="$fixture/bin:/usr/bin:/bin" \
  FIXTURE_NODE_VERSION=25.9.0 FIXTURE_NODE_PLATFORM="$fixture_platform" FIXTURE_NODE_ARCH="$fixture_arch" \
  FIXTURE_PNPM_VERSION=11.22.0 \
  "$fixture/scripts/check-build-environment.sh" > "$fixture/mismatch.out" 2>&1
status=$?
set -e
[ "$status" -eq 78 ] || { echo "expected mismatch exit 78, got $status" >&2; exit 1; }
grep -Fq 'TOOLCHAIN_MISMATCH:' "$fixture/mismatch.out"

printf 'BUILD_ENVIRONMENT_CONTRACT_GREEN platform=%s architecture=%s\n' "$fixture_platform" "$fixture_arch"
