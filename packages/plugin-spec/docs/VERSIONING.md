# Versioning

This is the normative versioning specification for Soksak plugins, sidecars, kits, contracts,
specs, releases, registries, settings, and installed records.

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
  "spec": { "id": "soksak-spec", "version": "0.0.3" },
  "source": {
    "repository": "https://github.com/soksak-ai/soksak-spec",
    "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "artifacts": [
    {
      "target": "any",
      "format": "tgz",
      "manifest": "spec.json",
      "url": "https://github.com/soksak-ai/soksak-spec/releases/download/v0.0.3/soksak-ai-plugin-spec-0.0.3.tgz",
      "size": 12345,
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  ],
  "reports": []
}
```

This `soksak-spec@0.0.3` package may still validate `plugin.json`, `sidecar.json`, and runtime
interfaces at `0.0.1`. A package correction is not evidence that those contracts changed.

## 4. Plugin and sidecar interfaces

<!-- rule:plugin-sidecar-interface -->

A plugin names the interface it needs, not a provider repository. Settings select a provider.
The selected sidecar must provide the same interface ID at an accepted version.

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
  "sidecars": [
    {
      "name": "terminal",
      "interface": {
        "id": "soksak-spec-sidecar-terminal",
        "requirement": "0.0.1"
      }
    }
  ]
}
```

<!-- example:terminal-sidecar-valid:valid-sidecar -->
```json
{
  "id": "terminal-provider",
  "version": "0.0.1",
  "interface": {
    "id": "soksak-spec-sidecar-terminal",
    "version": "0.0.1"
  },
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
- Release builds reject npm `file:`, Cargo `path`, Go `replace`, sibling source paths, and
  lockfiles changed by installation. These describe local topology, not portable release inputs.

## 6. Development paths

<!-- rule:development-source -->

A development path changes where Soksak reads one plugin, sidecar, kit, contract, or spec and
excludes only that item from managed updates. It does not disable validation.

<!-- example:development-path-valid:settings-fragment -->
```json
{
  "sidecars": {
    "terminal-provider": {
      "development": {
        "path": "/absolute/development/terminal-provider"
      }
    }
  }
}
```

The development manifest still passes identity, version, application requirement where
applicable, interface, permission, and path checks. A separate `development: true` flag is not
stored beside the path.

## 7. Releases and installed content

<!-- rule:release-install-separation -->

A release records what was published. It does not restate runtime relationships or build
dependencies.

<!-- example:plugin-release-valid:release -->
```json
{
  "plugin": { "id": "example-plugin", "version": "0.0.1" },
  "source": {
    "repository": "https://github.com/soksak-ai/example-plugin",
    "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "artifacts": [
    {
      "target": "any",
      "format": "tgz",
      "manifest": "plugin.json",
      "url": "https://github.com/soksak-ai/example-plugin/releases/download/v0.0.1/example-plugin-0.0.1.tgz",
      "size": 12345,
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  ],
  "reports": []
}
```

The registry publishes exact releases and verified descriptors. Settings record user choices.
The Core-owned installed record stores the exact version, target, absolute path, source commit,
manifest digest, and artifact digest. These facts are not copied into each other.

The installer downloads separately, checks size and SHA-256 before extraction, validates the
manifest and requirements, and replaces content and its record in one transaction. Any error
leaves the existing installation unchanged.

## 8. Conflicts and updates

<!-- rule:conflict-policy -->

One installation selects one version for a given ID. Requirements with no intersection fail
without a fallback or compatibility layer. The error names every consumer and requirement.

```text
VERSION_REQUIREMENT_CONFLICT
terminal-view@2.0.0 requires terminal-contract >=2.0.0 <3.0.0
other-terminal@1.5.0 requires terminal-contract >=1.6.0 <2.0.0
The installed state was not changed.
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
| Activation, provider, development path | Settings |
| Installed bytes | Core-owned installed record |

There is no public unit, dependency scope, installation profile, dependency closure, composition
graph, execution graph, or deployment graph. Temporary local validation data is not a stored
contract or user concept.
