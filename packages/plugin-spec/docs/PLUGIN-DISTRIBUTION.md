# Plugin distribution

This document is the canonical distribution contract. Soksak exposes plugins to users; sidecars
are exact runtime dependencies of a plugin. Kits, contracts, specs, and language libraries are
build inputs and are never separate install products.

## Owner inputs

The owner writes `plugin.json` and standard build manifests with lockfiles. Build dependencies stay
in `package.json`, `Cargo.toml`, or `go.mod`. A separately installed component uses one flat
reference in `plugin.json.runtimeDependencies`:

```json
{
  "id": "soksak-plugin-terminal-xterm",
  "version": "0.0.18",
  "runtimeDependencies": {
    "sidecars": [{
      "id": "soksak-sidecar-pty",
      "version": "0.0.6",
      "url": "https://github.com/soksak-ai/soksak-sidecar-pty/releases/download/v0.0.6/release.json",
      "size": 1234,
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }]
  }
}
```

The array location states the kind. There is no role, provider alias, interface copy, range,
`latest`, or fallback. An absent dependency section is omitted rather than represented by empty
arrays. Changing a reference requires a new plugin version.

A service declaration contains its service interface and optional subscriptions only. A v1 service
plugin has exactly one `runtimeDependencies.sidecars` reference; that common release reference is
the service executable. `service.sidecar` and partial `{id, version}` component references do not
exist.

## Automated owner release

The canonical builder verifies locked build inputs, produces self-contained artifacts, validates
the complete runtime dependency chain, and writes `release.json`. Plugin and sidecar releases use
the same flat shape. `manifest`, `artifacts`, their sizes and digests, and `evidence` are generated
outputs. `evidence` records conformance; it is not installed.

```json
{
  "kind": "plugin",
  "id": "soksak-plugin-terminal-xterm",
  "version": "0.0.18",
  "manifest": {
    "url": "https://github.com/soksak-ai/soksak-plugin-terminal-xterm/releases/download/v0.0.18/plugin.json",
    "size": 4096,
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "source": {
    "repository": "https://github.com/soksak-ai/soksak-plugin-terminal-xterm",
    "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "artifacts": [{
    "target": "any",
    "url": "https://github.com/soksak-ai/soksak-plugin-terminal-xterm/releases/download/v0.0.18/soksak-plugin-terminal-xterm-0.0.18-any.tgz",
    "size": 94578,
    "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "format": "tgz",
    "manifest": "plugin.json"
  }],
  "runtimeDependencies": {
    "sidecars": [{
      "id": "soksak-sidecar-pty",
      "version": "0.0.6",
      "url": "https://github.com/soksak-ai/soksak-sidecar-pty/releases/download/v0.0.6/release.json",
      "size": 1234,
      "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    }]
  },
  "evidence": [{
    "url": "https://github.com/soksak-ai/soksak-plugin-terminal-xterm/releases/download/v0.0.18/conformance-release.json",
    "size": 512,
    "sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
  }]
}
```

## Registry contribution and release

One pull request adds or replaces one `plugins/<id>.json` file. It contains only the plugin release
reference:

```json
{
  "id": "soksak-plugin-terminal-xterm",
  "version": "0.0.18",
  "url": "https://github.com/soksak-ai/soksak-plugin-terminal-xterm/releases/download/v0.0.18/release.json",
  "size": 2048,
  "sha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
}
```

The registry workflow validates every immutable release and publishes an authenticated
`registry.json`. It projects only each plugin's direct runtime dependencies; transitive
dependencies remain in their own hash-pinned releases. There are no `installs`, `packages`,
independent sidecar arrays, or build-dependency catalogues.
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
    "url": "https://github.com/soksak-ai/soksak-plugin-terminal-xterm/releases/download/v0.0.18/release.json",
    "size": 2048,
    "sha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "runtimeDependencies": {
      "sidecars": [{
        "id": "soksak-sidecar-pty",
        "version": "0.0.6",
        "url": "https://github.com/soksak-ai/soksak-sidecar-pty/releases/download/v0.0.6/release.json",
        "size": 1234,
        "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      }]
    }
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
read from the plugin's immutable runtime dependencies.

An installed plugin shows Update only when the registry version is greater. Equal or lower is
Installed. A development source never receives a managed update.
