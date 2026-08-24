#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
fail_declaration() {
  printf 'BUILD_DECLARATION_INVALID: %s\n' "$1" >&2
  exit 78
}

selection=$root/.node-version
manifest=$root/package.json
lockfile=$root/pnpm-lock.yaml
go_manifest=$root/go/platformspec/go.mod
rust_manifest=$root/rust-toolchain.toml
for required_file in "$selection" "$manifest" "$lockfile" "$go_manifest" "$rust_manifest"; do
  [ -f "$required_file" ] || fail_declaration "required owner file is missing: ${required_file#$root/}"
done

node_expected=$(awk 'NF { value=$0; count++ } END { if (count == 1) print value; else exit 1 }' "$selection" 2>/dev/null || true)
manifest_flat=$(tr '\n' ' ' < "$manifest")
node_declared=$(printf '%s\n' "$manifest_flat" | sed -n 's/.*"engines"[[:space:]]*:[[:space:]]*{[^}]*"node"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
package_manager=$(printf '%s\n' "$manifest_flat" | sed -n 's/.*"packageManager"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
case "$package_manager" in pnpm@*) pnpm_expected=${package_manager#pnpm@} ;; *) pnpm_expected= ;; esac
go_expected=$(awk '$1 == "go" && NF == 2 { print $2; count++ } END { if (count != 1) exit 1 }' "$go_manifest" 2>/dev/null || true)
rust_expected=$(sed -n 's/^channel = "\([^"]*\)"$/\1/p' "$rust_manifest")
if [ -z "$node_expected" ] || [ "$node_expected" != "$node_declared" ] || [ -z "$pnpm_expected" ] || \
   [ -z "$go_expected" ] || [ -z "$rust_expected" ]; then
  fail_declaration '.node-version, package.json, go.mod, and rust-toolchain.toml must contain exact aligned owners'
fi

host_system=$(uname -s)
host_machine=$(uname -m)
case "$host_system" in
  Darwin)
    required_platform=darwin
    go_required_os=darwin
    if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then
      required_arch=arm64
      node_required_arch=arm64
      go_required_arch=arm64
      rust_required_host=aarch64-apple-darwin
    else
      required_arch=x86_64
      node_required_arch=x64
      go_required_arch=amd64
      rust_required_host=x86_64-apple-darwin
    fi
    ;;
  Linux)
    required_platform=linux
    go_required_os=linux
    case "$host_machine" in
      arm64|aarch64)
        required_arch=arm64; node_required_arch=arm64; go_required_arch=arm64
        rust_required_host=aarch64-unknown-linux-gnu
        ;;
      x86_64|amd64)
        required_arch=x86_64; node_required_arch=x64; go_required_arch=amd64
        rust_required_host=x86_64-unknown-linux-gnu
        ;;
      *) printf 'TOOLCHAIN_MISMATCH: unsupported host architecture %s\n' "$host_machine" >&2; exit 78 ;;
    esac
    ;;
  MINGW*|MSYS*|CYGWIN*)
    required_platform=win32
    required_arch=x86_64
    node_required_arch=x64
    go_required_os=windows
    go_required_arch=amd64
    rust_required_host=x86_64-pc-windows-msvc
    ;;
  *) printf 'TOOLCHAIN_MISMATCH: unsupported host platform %s\n' "$host_system" >&2; exit 78 ;;
esac

node_actual=$(node --version 2>/dev/null || true)
node_platform=$(node -p process.platform 2>/dev/null || true)
node_arch=$(node -p process.arch 2>/dev/null || true)
pnpm_actual=$(cd "$root" && pnpm --version 2>/dev/null || true)
rust_actual=$(rustc --version 2>/dev/null | awk '{print $2}' || true)
rust_host=$(rustc -vV 2>/dev/null | sed -n 's/^host: //p' || true)
cargo_actual=$(cargo --version 2>/dev/null || true)
go_actual=$(go env GOVERSION 2>/dev/null || true)
go_host_os=$(go env GOHOSTOS 2>/dev/null || true)
go_host_arch=$(go env GOHOSTARCH 2>/dev/null || true)

if [ "$node_actual" != "v$node_expected" ] || [ "$node_platform" != "$required_platform" ] || \
   [ "$node_arch" != "$node_required_arch" ] || [ "$pnpm_actual" != "$pnpm_expected" ] || \
   [ "$rust_actual" != "$rust_expected" ] || [ "$rust_host" != "$rust_required_host" ] || [ -z "$cargo_actual" ] || \
   [ "$go_actual" != "go$go_expected" ] || [ "$go_host_os" != "$go_required_os" ] || [ "$go_host_arch" != "$go_required_arch" ]; then
  printf 'TOOLCHAIN_MISMATCH: required=%s/%s node=v%s pnpm=%s rust=%s rustHost=%s go=go%s; actual node=%s nodeRuntime=%s/%s pnpm=%s rust=%s rustHost=%s cargo=%s go=%s goRuntime=%s/%s\n' \
    "$required_platform" "$required_arch" "$node_expected" "$pnpm_expected" "$rust_expected" "$rust_required_host" "$go_expected" \
    "${node_actual:-missing}" "${node_platform:-unknown}" "${node_arch:-unknown}" "${pnpm_actual:-missing}" \
    "${rust_actual:-missing}" "${rust_host:-unknown}" "${cargo_actual:-missing}" "${go_actual:-missing}" \
    "${go_host_os:-unknown}" "${go_host_arch:-unknown}" >&2
  exit 78
fi

if command -v sha256sum >/dev/null 2>&1; then
  lock_digest=$(sha256sum "$lockfile" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  lock_digest=$(shasum -a 256 "$lockfile" | awk '{print $1}')
else
  fail_declaration 'SHA-256 command is unavailable'
fi

printf 'BUILD_ENVIRONMENT_READY required=%s/%s node=v%s nodeRuntime=%s/%s pnpm=%s rust=%s rustHost=%s go=%s goRuntime=%s/%s lockSHA256=%s\n' \
  "$required_platform" "$required_arch" "$node_expected" "$node_platform" "$node_arch" "$pnpm_expected" \
  "$rust_expected" "$rust_host" "$go_actual" "$go_host_os" "$go_host_arch" "$lock_digest"
