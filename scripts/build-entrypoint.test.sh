#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
fail() {
  printf 'BUILD_ENTRYPOINT_INVALID: %s\n' "$1" >&2
  exit 1
}

[ -f "$root/Makefile" ] || fail 'Makefile is missing'
[ -f "$root/.node-version" ] || fail '.node-version is missing'

node_owner=$(awk 'NF { value=$0; count++ } END { if (count == 1) print value; else exit 1 }' "$root/.node-version" 2>/dev/null || true)
manifest_flat=$(tr '\n' ' ' < "$root/package.json")
node_projection=$(printf '%s\n' "$manifest_flat" | sed -n 's/.*"engines"[[:space:]]*:[[:space:]]*{[^}]*"node"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
[ -n "$node_owner" ] && [ "$node_owner" = "$node_projection" ] || fail '.node-version and package.json engines.node differ'
printf '%s\n' "$manifest_flat" | grep -Eq '"packageManager"[[:space:]]*:[[:space:]]*"pnpm@[0-9]+[.][0-9]+[.][0-9]+"' || fail 'packageManager must own an exact pnpm version'
grep -Eq '^channel = "[0-9]+[.][0-9]+[.][0-9]+"$' "$root/rust-toolchain.toml" || fail 'rust-toolchain.toml must own an exact Rust version'
grep -Eq '^go [0-9]+[.][0-9]+[.][0-9]+$' "$root/go/platformspec/go.mod" || fail 'go.mod must own an exact Go version'

for target in preflight prepare build verify; do
  grep -Eq "^${target}:" "$root/Makefile" || fail "Makefile target is missing: $target"
done
grep -Eq '^[A-Z0-9_]*(VERSION|REPOSITORY|COMMIT|TARGETS)[[:space:]]*:=' "$root/Makefile" && fail 'Makefile duplicates declarative build metadata'

for workflow in "$root/.github/workflows/verify.yml" "$root/.github/workflows/release.yml"; do
  grep -Fq 'node-version-file: .node-version' "$workflow" || fail "workflow does not inject the Node owner: $workflow"
  grep -Fq 'package_json_file: package.json' "$workflow" || fail "workflow does not inject the pnpm owner: $workflow"
  grep -Fq 'rust-toolchain.toml' "$workflow" || fail "workflow does not inject the Rust owner: $workflow"
  grep -Fq 'go-version-file: go/platformspec/go.mod' "$workflow" || fail "workflow does not inject the Go owner: $workflow"
done

grep -Fq 'make verify' "$root/.github/workflows/verify.yml" || fail 'verify workflow does not call make verify'
grep -Fq 'make verify' "$root/.github/workflows/release.yml" || fail 'release workflow does not call make verify'

printf 'BUILD_ENTRYPOINT_READY node=%s\n' "$node_owner"
