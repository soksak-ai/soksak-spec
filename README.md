# soksak-spec

Public platform contracts shared by the private soksak core and independently
released plugins, sidecars, kits, registries, and developer tooling.

This repository owns only platform-wide boundaries:

- `@soksak-ai/plugin-spec`: plugin, release, conformance, and signed-registry
  schemas plus the headless validator.
- `soksak-spec-contract`: canonical provider `{id, version}` and consumer
  `{id, requirement}` references.
- `soksak-spec-service`: the common plugin-service handshake and frame set.
- `soksak-spec-socket`: generic protocol compatibility judgment.

Plugin-specific and sidecar-specific payloads remain with their owning repositories.
A domain contract moves to a separate `soksak-contract-*` repository only
when multiple independent implementations actually share it. The private PTY
protocol is not part of this repository.

## Distribution

- Rust consumers use `git+https://github.com/soksak-ai/soksak-spec.git` pinned
  to an exact 40-character commit.
- JavaScript consumers declare `"@soksak-ai/plugin-spec": "<version>"` and
  install it from a package registry named on the make command line
  (`make prepare REGISTRY=http://host:port/`). The lockfile records the
  archive integrity only, so the same lockfile resolves from a local registry
  and from `https://registry.npmjs.org`.
- `make publish REGISTRY=http://host:port/` runs the owner proof and publishes
  the single verified archive from `artifacts/`. The GitHub Release for the
  same commit carries the same archive bytes.
- Branch names, `latest`, floating tags, and unverified archives are not
  dependency pins.

## Verification

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm test
```

`pnpm test` builds the public package, runs all TypeScript and Rust tests,
checks the repository boundary, produces the release assets twice, and proves
that the two byte streams are identical.
