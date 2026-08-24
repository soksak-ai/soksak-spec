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
mkdir -p "$fixture/go/platformspec"
printf '%s\n' 'module example.test/platformspec' '' 'go 1.26.3' > "$fixture/go/platformspec/go.mod"
printf '%s\n' '[toolchain]' 'channel = "1.98.0"' 'profile = "minimal"' > "$fixture/rust-toolchain.toml"

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
  '  -e) printf '\''%s\n'\'' "$FIXTURE_PNPM_EXECUTABLE_VERSION" ;;' \
  '  *) exit 2 ;;' \
  'esac' > "$fixture/bin/node"
printf '%s\n' \
  '#!/bin/sh' \
  '[ "$#" -eq 1 ] && [ "$1" = --version ] || {' \
  '  echo '\''preflight attempted to mutate dependency state'\'' >&2' \
  '  exit 97' \
  '}' \
  'printf '\''%s\n'\'' "$FIXTURE_PNPM_VERSION"' > "$fixture/bin/pnpm"
printf '%s\n' \
  '#!/bin/sh' \
  '[ "$1" = -C ] && [ "${2##*/}" = platformspec ] && [ "$3" = env ] || exit 2' \
  'case "$4" in' \
  '  GOVERSION) printf '\''go%s\n'\'' "$FIXTURE_GO_VERSION" ;;' \
  '  GOHOSTOS) printf '\''%s\n'\'' "$FIXTURE_GO_OS" ;;' \
  '  GOHOSTARCH) printf '\''%s\n'\'' "$FIXTURE_GO_ARCH" ;;' \
  '  *) exit 2 ;;' \
  'esac' > "$fixture/bin/go"
printf '%s\n' \
  '#!/bin/sh' \
  'case "$1" in' \
  '  --version) printf '\''rustc %s (fixture 2026-08-24)\n'\'' "$FIXTURE_RUST_VERSION" ;;' \
  '  -vV) printf '\''rustc %s (fixture 2026-08-24)\nhost: %s\nrelease: %s\n'\'' "$FIXTURE_RUST_VERSION" "$FIXTURE_RUST_HOST" "$FIXTURE_RUST_VERSION" ;;' \
  '  *) exit 2 ;;' \
  'esac' > "$fixture/bin/rustc"
printf '%s\n' \
  '#!/bin/sh' \
  '[ "$1" = --version ] || exit 2' \
  'printf '\''cargo %s (fixture 2026-08-24)\n'\'' "$FIXTURE_RUST_VERSION"' > "$fixture/bin/cargo"
chmod +x "$fixture/bin/node" "$fixture/bin/pnpm" "$fixture/bin/go" "$fixture/bin/rustc" "$fixture/bin/cargo" "$fixture/scripts/check-build-environment.sh"

case "$(uname -s)" in
  Darwin)
    fixture_platform=darwin
    fixture_go_os=darwin
    if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then
      fixture_required_arch=arm64; fixture_node_arch=arm64; fixture_go_arch=arm64; fixture_rust_host=aarch64-apple-darwin
    else
      fixture_required_arch=x86_64; fixture_node_arch=x64; fixture_go_arch=amd64; fixture_rust_host=x86_64-apple-darwin
    fi
    ;;
  Linux)
    fixture_platform=linux
    fixture_go_os=linux
    case "$(uname -m)" in
      aarch64|arm64) fixture_required_arch=arm64; fixture_node_arch=arm64; fixture_go_arch=arm64; fixture_rust_host=aarch64-unknown-linux-gnu ;;
      x86_64|amd64) fixture_required_arch=x86_64; fixture_node_arch=x64; fixture_go_arch=amd64; fixture_rust_host=x86_64-unknown-linux-gnu ;;
      *) exit 1 ;;
    esac
    ;;
  MINGW*|MSYS*|CYGWIN*)
    fixture_platform=win32; fixture_go_os=windows; fixture_required_arch=x86_64
    fixture_node_arch=x64; fixture_go_arch=amd64; fixture_rust_host=x86_64-pc-windows-msvc
    ;;
  *) exit 1 ;;
esac

fixture_path="$fixture/bin:/usr/bin:/bin:/usr/sbin:/sbin"
output=$(PATH="$fixture_path" \
  FIXTURE_NODE_VERSION=26.7.0 FIXTURE_NODE_PLATFORM="$fixture_platform" FIXTURE_NODE_ARCH="$fixture_node_arch" \
  FIXTURE_PNPM_VERSION=11.22.0 FIXTURE_PNPM_EXECUTABLE_VERSION=11.22.0 \
  FIXTURE_GO_VERSION=1.26.3 FIXTURE_GO_OS="$fixture_go_os" FIXTURE_GO_ARCH="$fixture_go_arch" \
  FIXTURE_RUST_VERSION=1.98.0 FIXTURE_RUST_HOST="$fixture_rust_host" \
  "$fixture/scripts/check-build-environment.sh")
printf '%s\n' "$output" | grep -Fq "BUILD_ENVIRONMENT_READY required=$fixture_platform/$fixture_required_arch node=v26.7.0 nodeRuntime=$fixture_platform/$fixture_node_arch pnpm=11.22.0"
printf '%s\n' "$output" | grep -Fq "rust=1.98.0 rustHost=$fixture_rust_host go=go1.26.3 goRuntime=$fixture_go_os/$fixture_go_arch lockSHA256="

set +e
PATH="$fixture_path" \
  FIXTURE_NODE_VERSION=25.9.0 FIXTURE_NODE_PLATFORM="$fixture_platform" FIXTURE_NODE_ARCH="$fixture_node_arch" \
  FIXTURE_PNPM_VERSION=11.22.0 FIXTURE_PNPM_EXECUTABLE_VERSION=11.22.0 \
  FIXTURE_GO_VERSION=1.26.3 FIXTURE_GO_OS="$fixture_go_os" FIXTURE_GO_ARCH="$fixture_go_arch" \
  FIXTURE_RUST_VERSION=1.98.0 FIXTURE_RUST_HOST="$fixture_rust_host" \
  "$fixture/scripts/check-build-environment.sh" > "$fixture/mismatch.out" 2>&1
status=$?
set -e
[ "$status" -eq 78 ] || { echo "expected mismatch exit 78, got $status" >&2; exit 1; }
grep -Fq 'TOOLCHAIN_MISMATCH:' "$fixture/mismatch.out"

set +e
PATH="$fixture_path" \
  FIXTURE_NODE_VERSION=26.7.0 FIXTURE_NODE_PLATFORM="$fixture_platform" FIXTURE_NODE_ARCH="$fixture_node_arch" \
  FIXTURE_PNPM_VERSION=11.22.0 FIXTURE_PNPM_EXECUTABLE_VERSION=10.30.3 \
  FIXTURE_GO_VERSION=1.26.3 FIXTURE_GO_OS="$fixture_go_os" FIXTURE_GO_ARCH="$fixture_go_arch" \
  FIXTURE_RUST_VERSION=1.98.0 FIXTURE_RUST_HOST="$fixture_rust_host" \
  "$fixture/scripts/check-build-environment.sh" > "$fixture/delegated.out" 2>&1
status=$?
set -e
[ "$status" -eq 78 ] || { echo "expected delegated pnpm exit 78, got $status" >&2; exit 1; }
grep -Fq 'pnpmExecutable=10.30.3' "$fixture/delegated.out"

printf 'BUILD_ENVIRONMENT_CONTRACT_GREEN platform=%s architecture=%s\n' "$fixture_platform" "$fixture_required_arch"
