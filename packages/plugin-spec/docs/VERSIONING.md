# Versioning

This is the normative versioning specification for Soksak plugins, sidecars, kits, contracts,
specs, releases, registries, and local environments.

[한국어 번역](VERSIONING.ko.md)

The examples in this document are executable fixtures. Fields, identifiers, versions, commands,
and error codes in the Korean translation must remain identical to this document.

## 1. Version roles

<!-- rule:version-roles -->

Soksak has one application version, not a second compatibility version. `appVersion` is the
exact version of the running application. `appVersionRequirement` is the condition accepted by
one plugin release. A plugin's own `version` identifies the plugin release.

<!-- example:plugin-valid:valid-plugin -->
```json
{
  "id": "example-plugin",
  "name": "Example",
  "version": "0.0.1",
  "appVersionRequirement": "0.0.1",
  "description": "Versioning example",
  "permissions": []
}
```

For this manifest, `appVersion: "0.0.1"` is accepted and `appVersion: "0.0.2"` is rejected
with `APP_VERSION_UNSUPPORTED`. Installation and loading use the same check.

`minAppVersion`, `appCompatibility`, `soksakCompatibility`, `requiresSoksak`, and
`engines` are not aliases.

<!-- example:plugin-obsolete-minimum:invalid-plugin -->
```json
{
  "id": "example-plugin",
  "name": "Example",
  "version": "0.0.1",
  "minAppVersion": "0.0.1",
  "description": "Obsolete version field",
  "permissions": []
}
```

Expected error: `MANIFEST_UNKNOWN_FIELD`. A minimum cannot express an incompatible upper
boundary.

## 2. Identities and requirements

<!-- rule:identity-requirement -->

An owner or provider reports an exact `{id, version}`. A consumer reports an
`{id, requirement}`. The ID never contains a version.

<!-- example:provider-valid:valid-provider -->
```json
{ "id": "soksak-spec-sidecar-terminal", "version": "0.0.1" }
```

<!-- example:consumer-valid:valid-requirement -->
```json
{ "id": "soksak-spec-sidecar-terminal", "requirement": "0.0.1" }
```

<!-- example:consumer-provider-shape:invalid-requirement -->
```json
{ "id": "soksak-spec-sidecar-terminal", "version": "0.0.1" }
```

Expected error: `REQUIREMENT_FIELD_REQUIRED`. `range` is not an alias for `requirement`.

<!-- example:consumer-wildcard:invalid-requirement -->
```json
{ "id": "soksak-spec-sidecar-terminal", "requirement": "*" }
```

Expected error: `REQUIREMENT_UNBOUNDED`. Empty requirements, `*`, `x`, `latest`, branches,
Git URLs, and other package locators do not prove compatibility.

## 3. The 0.0.1 component policy

<!-- rule:baseline-policy -->

Every application, plugin, sidecar, kit, contract, and runtime interface currently remains
`0.0.1`. Every owner manifest declares the exact requirement `0.0.1`. This is a product policy
above SemVer grammar.

<!-- example:plugin-unproved-range:invalid-plugin -->
```json
{
  "id": "example-plugin",
  "name": "Example",
  "version": "0.0.1",
  "appVersionRequirement": ">=0.0.1 <1.0.0",
  "description": "Unproved compatibility",
  "permissions": []
}
```

Expected error: `BASELINE_REQUIREMENT_NOT_EXACT`. A future release may declare a bounded range
only after cross-version tests cover the claimed line. A failing test never justifies widening a
requirement.

SemVer prereleases such as `0.0.2-dev.1` are syntactically valid. The 0.0.1 registry does not
publish or automatically select prereleases. SemVer compares prerelease identifiers by numeric
and lexical rules; it does not know a dev, alpha, beta, and rc workflow.

<!-- rule:immutable-release-correction -->

Published bytes are immutable. A corrected package uses the next patch version; it never replaces
an existing tag or asset. The package/spec release version identifies those published bytes and
does not silently change the component and runtime-interface versions validated by the package.

<!-- example:spec-correction-release:release -->
```json
{
  "kind": "spec",
  "id": "soksak-spec",
  "version": "0.0.9",
  "manifest": {
    "file": "spec.json",
    "size": 256,
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "source": {
    "repository": "https://github.com/soksak-ai/soksak-spec",
    "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "artifacts": [
    {
      "target": "any",
      "format": "tgz",
      "manifest": "spec.json",
      "file": "soksak-soksak-spec-0.0.9.tgz",
      "size": 12345,
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  ],
  "evidence": [{
    "file": "conformance-release.json",
    "size": 512,
    "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  }]
}
```

This `soksak-spec@0.0.9` package may still validate `plugin.json`, `sidecar.json`, and runtime
interfaces at `0.0.1`. A package correction is not evidence that those contracts changed.

## 4. Plugin and sidecar interfaces

<!-- rule:plugin-sidecar-interface -->

A plugin names the exact sidecar release it installs by `{ id, version }`. The builder resolves that
reference to `{ id, version, size, sha256 }` in `release.json`. The sidecar manifest and conformance
evidence own the provided interface; there is no provider selection or fallback at install time.

<!-- example:terminal-plugin-valid:valid-plugin -->
```json
{
  "id": "terminal-view",
  "name": "Terminal",
  "version": "0.0.1",
  "appVersionRequirement": "0.0.1",
  "description": "Terminal view",
  "permissions": ["sidecar"],
  "implements": [
    { "id": "soksak-spec-plugin-terminal", "version": "0.0.1" }
  ],
  "runtimeDependencies": {
    "sidecars": [
      { "id": "terminal-provider", "version": "0.0.1" }
    ]
  }
}
```

<!-- example:terminal-sidecar-valid:valid-sidecar -->
```json
{
  "id": "terminal-provider",
  "version": "0.0.1",
  "processRole": "sidecar-terminal-provider",
  "interface": [{
    "id": "soksak-spec-sidecar-terminal",
    "version": "0.0.1"
  }],
  "process": "dist/terminal-provider"
}
```

Sidecars do not declare an application version requirement. They communicate through versioned
interfaces. A direct dependency on an internal Core function indicates a missing public protocol.

## 5. External packages

<!-- rule:package-manager-ownership -->

External libraries are owned by their package manager, not repeated in `plugin.json`. The
package manifest states author intent; the lock or checksum records exact selected content.

<!-- example:node-package-valid:package-json -->
```json
{
  "dependencies": { "@xterm/xterm": "^5.5.0" },
  "devDependencies": {
    "typescript": "5.9.3",
    "vitest": "3.2.4"
  }
}
```

- Node releases use a committed lockfile and a frozen install.
- Rust releases use `Cargo.toml` and `Cargo.lock`; Git dependencies use a full `rev`.
- Go releases use `go.mod` and `go.sum`.
- Release builds reject npm `file:`, `link:`, `workspace:`, `portal:`, `catalog:`, absolute and
  parent-relative paths, Cargo `path`, Go `replace`, sibling source paths, and lockfiles changed by
  installation. These describe local topology, not portable release inputs.

## 6. Development paths

<!-- rule:development-source -->

A development record changes where Soksak reads one plugin or sidecar and excludes only that
record from managed updates. It applies to plugin and sidecar records only; `environment.json`
models those two kinds. It does not disable validation. The record keeps the `artifactSha256`
key with an empty string value and declares no `registry`.

<!-- example:development-path-valid:settings-fragment -->
```json
{
  "sidecars": {
    "terminal-provider": {
      "version": "0.0.1",
      "path": "/absolute/development/terminal-provider",
      "artifactSha256": "",
      "source": "development",
      "target": "aarch64-apple-darwin"
    }
  }
}
```

The development manifest still passes identity, version, application requirement where
applicable, interface, permission, and path checks. Source is one closed value; no second
development flag or installed document duplicates it.

## 7. Releases and installed content

<!-- rule:release-install-separation -->

A release records published bytes and projects exact runtime dependencies as
`{ id, version, size, sha256 }` references, where `size` and `sha256` are of the dependency's
`release.json`. Every file of the release is a bare `file` name in the release directory under
the one release file grammar in [PLATFORM-WIRE.md](PLATFORM-WIRE.md) §3. The
directory is derived from `kind`, `id`, and `version` and appears in no document: a published
release is `https://github.com/soksak-ai/<id>/releases/download/v<version>/`, a local release is
`<store>/<kind-plural>/<id>/<version>/`. `source.repository` is bound to the organization: it equals
`https://github.com/soksak-ai/<id>`. Build dependencies remain solely in the language package
manifest and lockfile.

<!-- example:plugin-release-valid:release -->
```json
{
  "kind": "plugin",
  "id": "example-plugin",
  "version": "0.0.1",
  "manifest": {
    "file": "plugin.json",
    "size": 256,
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "source": {
    "repository": "https://github.com/soksak-ai/example-plugin",
    "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "artifacts": [
    {
      "target": "any",
      "format": "tgz",
      "manifest": "plugin.json",
      "file": "example-plugin-0.0.1.tgz",
      "size": 12345,
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  ],
  "evidence": [{
    "file": "conformance-release.json",
    "size": 512,
    "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  }]
}
```

The registry index publishes one `{ id, version, size, sha256 }` reference per plugin. Each
`release.json` records the source commit, artifact file names, sizes, digests, and runtime
dependency references. `environment.json` is the single local state: exact selected version,
registry ID, absolute materialized path, source kind, target where applicable, plugin activation,
and exact installed component identities. A Sidecar record also names its absolute materialized
process. The process must be a regular file inside that component path. It does not copy repository,
commit, or digest facts out of the registry.

The installer downloads into a transaction directory, checks size and SHA-256 before extraction,
validates every manifest and requirement, moves all content into place, and atomically replaces
`environment.json`. The write lock exists only for the transaction; there is no persistent lock
document. Any error leaves the existing environment unchanged.

`environment.json` is the only local runtime discovery surface. A repository never discovers
another repository through `../`, an injected repository root, a workspace checkout path, PATH,
or a symbolic link. Build-time relationships use package dependencies. Runtime relationships use
component IDs resolved through the environment. Remote bytes are read through release references.
Tests use the same public interfaces and do not invent a sibling-source topology.

A Sidecar release declares a project-independent `processRole` such as
`sidecar-terminal-alacritty` and a canonical artifact entry such as
`dist/soksak-sidecar-terminal-alacritty`. The installer receives the project's declared name,
materializes the executable as `<project>-<processRole>` inside the staged component, and records
that exact absolute path in `environment.json`. Core executes only that recorded path. A wrapper,
symbolic link, `argv[0]` substitution, or in-process display-name override is not the process-name
contract.

## 8. Conflicts and updates

<!-- rule:conflict-policy -->

One installation selects one version for a given ID. Requirements with no intersection fail
without a fallback or compatibility layer. The error names every consumer and requirement.

```text
VERSION_REQUIREMENT_CONFLICT
terminal-view@2.0.0 requires terminal-contract >=2.0.0 <3.0.0
other-terminal@1.5.0 requires terminal-contract >=1.6.0 <2.0.0
The environment was not changed.
```

A major version marks an intentionally incompatible public change. A requirement is widened only
after compatibility tests, never to make a failing implementation pass.

## 9. Ownership

<!-- rule:ownership-summary -->

| Fact | Owner |
| --- | --- |
| Plugin release version | `plugin.json` |
| Running Soksak version | Runtime `appVersion` |
| Accepted Soksak versions | Plugin `appVersionRequirement` |
| Provided interface version | Provider manifest `version` |
| Accepted interface versions | Consumer manifest `requirement` |
| External source dependencies | Package manifest and lock/checksum |
| Published bytes | Release descriptor and attestation |
| Discoverable releases | Registry |
| Selected version, local path, source kind, activation | `environment.json` |
| Source commit, artifact file names, digests, dependency references | `release.json` |
| Release location | Derived from `kind`, `id`, and `version` |

The registry is the current plugin catalogue, not release history. Its plugins array holds one
current release per plugin id. Sidecars appear only as exact runtime dependencies of a plugin. Git
history and immutable owner releases retain older versions.

There is no public unit, dependency scope, installation profile, dependency closure, composition
graph, execution graph, or deployment graph. Temporary local validation data is not a stored
contract or user concept.
