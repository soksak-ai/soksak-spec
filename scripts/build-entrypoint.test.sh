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

for target in preflight prepare build verify; do
  grep -Eq "^${target}:" "$root/Makefile" || fail "Makefile target is missing: $target"
done

for workflow in "$root/.github/workflows/verify.yml" "$root/.github/workflows/release.yml"; do
  grep -Fq 'node-version-file: .node-version' "$workflow" || fail "workflow does not select .node-version: $workflow"
  grep -Eq 'run: make verify|run: \|' "$workflow" || fail "workflow does not expose a Make command block: $workflow"
done

grep -Fq 'make verify' "$root/.github/workflows/verify.yml" || fail 'verify workflow does not call make verify'
grep -Fq 'make verify' "$root/.github/workflows/release.yml" || fail 'release workflow does not call make verify'

printf 'BUILD_ENTRYPOINT_READY node=%s\n' "$node_owner"
