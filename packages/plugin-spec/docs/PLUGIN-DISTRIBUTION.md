# Plugin distribution

This document is the canonical distribution contract. Soksak exposes plugins to users; sidecars
are exact runtime dependencies of a plugin. Kits, contracts, specs, and language libraries are
build inputs and are never separate install products.

## Owner inputs

The owner writes `plugin.json` and standard build manifests with lockfiles. Build dependencies stay
in `package.json`, `Cargo.toml`, or `go.mod`. A separately installed component is one
`{ id, version }` reference in `plugin.json.runtimeDependencies`. The manifest is intent: it has
no `url`, `size`, or `sha256`, and the manifest validator rejects those keys as unknown.

```json
{
  "id": "soksak-plugin-terminal-xterm",
  "version": "0.0.18",
  "runtimeDependencies": {
    "sidecars": [{ "id": "soksak-sidecar-pty", "version": "0.0.6" }]
  }
}
```

The array location states the kind. There is no role, provider alias, interface copy, range,
`latest`, or fallback. An absent dependency section is omitted rather than represented by empty
arrays. Changing a reference requires a new plugin version.

A service declaration contains its service interface and optional subscriptions only. A v1 service
plugin has exactly one `runtimeDependencies.sidecars` reference; that reference is the service
executable. `service.sidecar` does not exist.

## Automated owner release

The canonical builder verifies locked build inputs, produces self-contained artifacts, resolves
every runtime dependency through the release resolver, and writes `release.json`. Plugin and
sidecar releases use the same flat shape. `manifest`, `artifacts`, their sizes and digests,
`runtimeDependencies`, and `evidence` are generated outputs. `evidence` records conformance; it is
not installed.

`release.json` contains no location. Every file in the same release directory is a bare `file`
name under the one release file grammar in [PLATFORM-WIRE.md](PLATFORM-WIRE.md) §3; the builder
and both publishers import that pattern and define no second one. Every reference to another release is `{ id, version, size, sha256 }` where `size` and
`sha256` are of that release's `release.json`; the builder composes it from the resolver and never
copies it from the manifest. `source.repository` is bound to the organization: it equals
`https://github.com/soksak-ai/<id>`. The release directory is derived from the identity: a published
release is `https://github.com/soksak-ai/<id>/releases/download/v<version>/`, a local release is
`<store>/<kind-plural>/<id>/<version>/`. A local build with `--store` reads the local one; a
published build reads GitHub.

```json
{
  "kind": "plugin",
  "id": "soksak-plugin-terminal-xterm",
  "version": "0.0.18",
  "manifest": {
    "file": "plugin.json",
    "size": 4096,
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "source": {
    "repository": "https://github.com/soksak-ai/soksak-plugin-terminal-xterm",
    "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "artifacts": [{
    "target": "any",
    "file": "soksak-plugin-terminal-xterm-0.0.18-any.tgz",
    "size": 94578,
    "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "format": "tgz",
    "manifest": "plugin.json"
  }],
  "runtimeDependencies": {
    "sidecars": [{
      "id": "soksak-sidecar-pty",
      "version": "0.0.6",
      "size": 1234,
      "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    }]
  },
  "evidence": [{
    "file": "conformance-release.json",
    "size": 512,
    "sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  }]
}
```

## Registry contribution and release

One pull request adds or replaces one `plugins/<id>.json` file. It contains only `{ id, version }`:

```json
{ "id": "soksak-plugin-terminal-xterm", "version": "0.0.18" }
```

`registry-build` resolves `size` and `sha256` by fetching the derived
`https://github.com/soksak-ai/<id>/releases/download/v<version>/release.json`. A root entry
without a reference is read under the fixed 1 MiB bound; every dependency in the closure is read
with its full reference `{ kind, id, version, size, sha256 }`, at most `size` bytes, and the one
verifier compares the bytes with `size` and `sha256` after the read. The registry
workflow validates every immutable release and publishes an authenticated `registry.json`. Each
index entry is the release reference `{ id, version, size, sha256 }`. The index does not copy
`runtimeDependencies`; consumers walk the closure through each `release.json`. There are no
`installs`, `packages`, independent sidecar arrays, or build-dependency catalogues.

Publication gate: `registry-verify` rejects the pull request when any release in the closure is not
resolvable at its derived https url (404) or when the fetched bytes differ from the size and SHA-256
of the reference that names it.
The packaged CLI provides `registry-verify`, `registry-build`, and `registry-authenticate`; the
registry repository contains no separate parser or signer implementation.

```json
{
  "id": "official",
  "sequence": 11,
  "issuedAt": "2026-08-24T00:00:00Z",
  "expiresAt": "2026-11-24T00:00:00Z",
  "plugins": [{
    "id": "soksak-plugin-terminal-xterm",
    "version": "0.0.18",
    "size": 2048,
    "sha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  }],
  "signature": { "algorithm": "ed25519", "keyId": "official-2026", "value": "..." }
}
```

The trusted public key is embedded in Core, never obtained from the registry. Core verifies the
signature, identity, expiry, sequence, rollback, equivocation, every release reference, and every
artifact before use.

## User consent and installation

Core resolves direct and transitive metadata before downloading executable artifacts. The consent
surface shows permissions and every additional component by ID and version. Details expose kind,
repository, platform artifact, size, digest, manifest, interface, and evidence. After consent Core
stages the complete closure and commits files plus `environment.json` atomically. Any failure leaves
the previous environment unchanged.
`environment.json` records installed components, not plugin role bindings. Exact relationships are
read from the plugin's immutable runtime dependencies. A Sidecar record does include the exact
project-materialized process path because runtime discovery must not reconstruct or guess it.

An installed plugin shows Update only when the registry version is greater. Equal or lower is
Installed. A development source never receives a managed update.
