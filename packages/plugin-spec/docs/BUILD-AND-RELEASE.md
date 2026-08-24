# Build and release entrypoints

This document defines the shared build and release boundary. It does not define a private
toolchain installer and does not serialize a developer workstation into source.

## Rules

- **BR1 — One local entrypoint.** Every source repository exposes `make preflight`,
  `make prepare`, `make build`, and `make verify` when those operations exist. A repository
  may keep language-specific task files behind that boundary, but they are not a second public
  entrypoint.
- **BR2 — Declarative owners.** Tool versions live in `.node-version`, `packageManager`,
  `go.mod`, and `rust-toolchain.toml`. External build sources, exact commits, tool requirements,
  and target outputs live in `build-dependencies.json`. The Makefile owns commands only and does
  not copy this metadata.
- **BR3 — Injected environment.** Source must not contain an installed executable path,
  workspace-relative repository discovery, injected `PATH`, symlink, cache location, or a
  fallback tool. A clean CI job injects the declared versions. A developer's selected local
  environment may contain other tools; `make preflight` checks only the addressed executables
  and rejects a mismatch before any product command. It never searches for or installs another
  copy. A package manager that delegates from a bootstrap executable is judged by the effective
  version returned in the addressed repository, not by the bootstrap package's own version.
- **BR4 — Read-only preflight.** Preflight reports the required and actual version, operating
  system, and architecture. It never installs, deletes, repairs, or selects a tool. An invalid
  environment is a precondition failure, not a product RED.
- **BR5 — Idempotent preparation.** `make prepare` materializes only repository-owned
  dependencies from the canonical lockfile. Repeating it with unchanged inputs produces the
  same dependency state. It does not delete caches, rewrite owner metadata, or force an install
  outside the repository boundary.
- **BR6 — One command graph.** Local development and GitHub Actions call the same Make target.
  Workflow YAML owns runner selection, credentials, artifact transport, and publication; it
  does not reimplement the repository build.
- **BR7 — Native build axes.** A native artifact is built and executed on the matching native
  runner. Darwin arm64 and x86_64 thin artifacts are built separately; a universal artifact is
  composed only from those tested thin artifacts. Linux arm64/x86_64 and Windows x86_64 use
  their addressed native jobs.
- **BR8 — Tested bytes are released.** Publication downloads the exact artifacts produced by
  required build and system jobs, validates their digests and target headers, and publishes
  those bytes without rebuilding. A failed dependency cannot create a tag or release asset.
- **BR9 — Repository ownership.** A repository's Makefile verifies only its implementation and
  boundary. Contract fixtures are defined by the contract owner and run by each implementation.
  The product composition repository verifies multiple real components together.
- **BR10 — Candidate artifacts are sealed, not published.** Before release, each component owner
  seals its own candidate output with `candidate-artifact.json`. The envelope binds one canonical
  `release.json`, every local release asset, build evidence, source commit, component identity,
  byte size and SHA-256. Actions may upload that directory without creating a tag or release. A
  product workflow downloads and verifies those bytes; it never builds sibling source. Extra,
  missing or changed files invalidate the entire artifact.

## Command boundary

```sh
make preflight
make prepare
make verify
make build
```

`make` is the durable command name. The command must work from a clean checkout without a
workspace sibling, a remembered shell export, or a machine-specific path. If a required tool is
not selected, preflight stops and names the mismatch; it never searches for another copy.

GitHub Actions inject tools from the declarative owners and invoke the same targets.
Release-only targets may accept an explicit target triple and staging directory, but publication
credentials and GitHub release mutation stay in Actions.

After the repository-owned build and canonical release packager have produced one flat output
directory, seal and verify it with the public release-template commands:

```sh
node <plugin-spec>/release-template/seal-candidate-artifact.mjs \
  --directory <absolute-output-directory> \
  --evidence <optional-build-evidence.json>
node <plugin-spec>/release-template/verify-candidate-artifact.mjs \
  --directory <absolute-output-directory>
```

`candidate-build.json` is discovered automatically for Node candidates. Other build evidence is
named explicitly. Neither command uploads or publishes anything.
