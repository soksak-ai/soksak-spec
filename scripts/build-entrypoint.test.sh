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

for target in preflight prepare build verify release publish; do
  grep -Eq "^${target}:" "$root/Makefile" || fail "Makefile target is missing: $target"
done
grep -Eq '^[A-Z0-9_]*(VERSION|REPOSITORY|COMMIT|TARGETS)[[:space:]]*:=' "$root/Makefile" && fail 'Makefile duplicates declarative build metadata'
grep -Eq '^publish: require-registry release$' "$root/Makefile" || fail 'publish must require a command-line REGISTRY and the release'
grep -Eq '^	set -- artifacts/\*\.tgz;' "$root/Makefile" || fail 'publish must publish the single verified archive from artifacts/'
out=$(make -f "$root/Makefile" -C "$root" publish 2>&1); [ $? -eq 2 ] && printf '%s\n' "$out" | grep -q 'REGISTRY' || fail 'make publish without REGISTRY must be refused'
out=$(REGISTRY=http://127.0.0.1:4873 make -f "$root/Makefile" -C "$root" publish 2>&1); [ $? -eq 2 ] && printf '%s\n' "$out" | grep -q 'environment' || fail 'REGISTRY from the environment must be refused'
out=$(make -f "$root/Makefile" -C "$root" publish REGISTRY=localhost:4873 2>&1); [ $? -eq 2 ] && printf '%s\n' "$out" | grep -q 'absolute URL' || fail 'REGISTRY without a scheme must be refused'

for workflow in "$root/.github/workflows/verify.yml" "$root/.github/workflows/release.yml"; do
  grep -Eq 'node-version-file: (source/)?[.]node-version' "$workflow" || fail "workflow does not inject the Node owner: $workflow"
  grep -Eq 'package_json_file: (source/)?package[.]json' "$workflow" || fail "workflow does not inject the pnpm owner: $workflow"
  grep -Fq 'rust-toolchain.toml' "$workflow" || fail "workflow does not inject the Rust owner: $workflow"
  grep -Eq 'go-version-file: (source/)?go/platformspec/go[.]mod' "$workflow" || fail "workflow does not inject the Go owner: $workflow"
done

grep -Fq 'make verify' "$root/.github/workflows/verify.yml" || fail 'verify workflow does not call make verify'
grep -Fq 'make verify' "$root/.github/workflows/release.yml" || fail 'release workflow does not call make verify'

printf 'BUILD_ENTRYPOINT_READY node=%s\n' "$node_owner"
