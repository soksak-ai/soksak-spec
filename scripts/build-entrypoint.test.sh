#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
fail() {
  printf 'BUILD_ENTRYPOINT_INVALID: %s\n' "$1" >&2
  exit 1
}

[ -f "$root/Makefile" ] || fail 'Makefile is missing'
[ -f "$root/.node-version" ] || fail '.node-version is missing'

make_value() {
  make --no-print-directory -s -C "$root" "$1" 2>/dev/null || true
}

node_owner=$(make_value print-node-version)
pnpm_owner=$(make_value print-pnpm-version)
rust_owner=$(make_value print-rust-version)
go_owner=$(make_value print-go-version)
node_selection=$(awk 'NF { value=$0; count++ } END { if (count == 1) print value; else exit 1 }' "$root/.node-version" 2>/dev/null || true)
manifest_flat=$(tr '\n' ' ' < "$root/package.json")
node_projection=$(printf '%s\n' "$manifest_flat" | sed -n 's/.*"engines"[[:space:]]*:[[:space:]]*{[^}]*"node"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
pnpm_projection=$(printf '%s\n' "$manifest_flat" | sed -n 's/.*"packageManager"[[:space:]]*:[[:space:]]*"pnpm@\([^"]*\)".*/\1/p')
rust_projection=$(sed -n 's/^channel = "\([^"]*\)"$/\1/p' "$root/rust-toolchain.toml")
go_projection=$(awk '$1 == "go" && NF == 2 { print $2; count++ } END { if (count != 1) exit 1 }' "$root/go/platformspec/go.mod" 2>/dev/null || true)
[ -n "$node_owner" ] && [ "$node_owner" = "$node_selection" ] && [ "$node_owner" = "$node_projection" ] || fail 'Makefile Node owner and projections differ'
[ -n "$pnpm_owner" ] && [ "$pnpm_owner" = "$pnpm_projection" ] || fail 'Makefile pnpm owner and packageManager projection differ'
[ -n "$rust_owner" ] && [ "$rust_owner" = "$rust_projection" ] || fail 'Makefile Rust owner and rust-toolchain projection differ'
[ -n "$go_owner" ] && [ "$go_owner" = "$go_projection" ] || fail 'Makefile Go owner and go.mod projection differ'

for target in preflight prepare build verify print-node-version print-pnpm-version print-rust-version print-go-version; do
  grep -Eq "^${target}:" "$root/Makefile" || fail "Makefile target is missing: $target"
done

for workflow in "$root/.github/workflows/verify.yml" "$root/.github/workflows/release.yml"; do
  grep -Fq 'id: build-versions' "$workflow" || fail "workflow does not derive versions from Make: $workflow"
  for target in print-node-version print-pnpm-version print-rust-version print-go-version; do
    grep -Fq "make --no-print-directory -s $target" "$workflow" || fail "workflow does not read $target: $workflow"
  done
  grep -Fq 'node-version: ${{ steps.build-versions.outputs.node }}' "$workflow" || fail "workflow Node setup is not a Make projection: $workflow"
  grep -Fq 'version: ${{ steps.build-versions.outputs.pnpm }}' "$workflow" || fail "workflow pnpm setup is not a Make projection: $workflow"
  grep -Fq 'toolchain: ${{ steps.build-versions.outputs.rust }}' "$workflow" || fail "workflow Rust setup is not a Make projection: $workflow"
  grep -Fq 'go-version: ${{ steps.build-versions.outputs.go }}' "$workflow" || fail "workflow Go setup is not a Make projection: $workflow"
done

grep -Fq 'make verify' "$root/.github/workflows/verify.yml" || fail 'verify workflow does not call make verify'
grep -Fq 'make verify' "$root/.github/workflows/release.yml" || fail 'release workflow does not call make verify'

printf 'BUILD_ENTRYPOINT_READY node=%s pnpm=%s rust=%s go=%s\n' "$node_owner" "$pnpm_owner" "$rust_owner" "$go_owner"
