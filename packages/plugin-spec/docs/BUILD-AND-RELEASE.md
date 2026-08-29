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
  not copy this metadata. A Node package projects `.node-version` into `engines.node` for consumers
  and `devEngines.runtime` for direct pnpm entrypoints; tests require every projection to equal the
  owner.
- **BR3 — Injected environment.** Source must not contain an installed executable path,
  workspace-relative repository discovery, injected `PATH`, symlink, cache location, or a
  fallback tool. A clean CI job injects the declared versions. A developer's selected local
  environment may contain other tools; `make preflight` checks only the addressed executables
  and rejects a mismatch before any product command. It never searches for or installs another
  copy. A package manager that delegates from a bootstrap executable is judged by the effective
  version returned in the addressed repository, not by the bootstrap package's own version. A
  direct pnpm command under a mismatched runtime fails before dependency resolution. pnpm never
  performs an implicit install before a script: an out-of-date dependency tree is a refusal, and
  `make prepare` is the one materialization entrypoint.
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
- **BR10 — Unpublished dependencies come from the addressed local store.** A local build takes
  `--store` and resolves every runtime dependency from `<store>/<kind-plural>/<id>/<version>/`;
  its build inputs come from the package manager's committed manifest and lockfile. A product
  workflow verifies released bytes; it never builds sibling source.
- **BR11 — Local releases use the public release shape.** A local release contains the same
  `release.json`, source commit, manifests, evidence, target artifacts, sizes, and SHA-256 values as
  a GitHub Release. The shape contains no location. The store maps a release directory to files:
  every bare `file` name in `release.json` is a regular file inside
  `<store>/<kind-plural>/<id>/<version>/`. Every bare `file` name matches the one release file
  grammar in [PLATFORM-WIRE.md](PLATFORM-WIRE.md) §3.
- **BR12 — Every published version is immutable in both transports.** A published GitHub Release
  never changes. In the local store, `<store>/<kind-plural>/<id>/<version>/` is one write-once
  release transaction. Publishing identical release bytes returns `unchanged`; different bytes fail
  with `LOCAL_RELEASE_VERSION_CONFLICT`, regardless of source commit. A different source commit at
  the same id/version is `LOCAL_RELEASE_VERSION_CONFLICT`; it never replaces or deletes the old
  directory. A new source commit requires a new version. Partial replacement is always invalid.
- **BR13 — Installation is shared; transport is not identity.** Local and registry installs share
  one closure resolver, target selector, validator, extractor, consent summary, progress stream,
  and atomic environment commit. A release reference is `{ id, version, size, sha256 }` and has no
  location. The GitHub resolver fetches
  `https://github.com/soksak-ai/<id>/releases/download/v<version>/release.json`, the local-store
  resolver reads `<store>/<kind-plural>/<id>/<version>/release.json`, and a verifier compares the
  size and SHA-256 of the bytes with the reference. A resolver receives the full reference. The
  GitHub resolver bounds a read with a reference by the reference `size` and a root read without a
  reference by `MAX_RELEASE_DOCUMENT_BYTES` (1 MiB); the local-store resolver reads the whole file.
  The one verifier runs after every read. A local file is eligible only under the explicitly
  addressed store and only when its name, size, and SHA-256 equal `release.json`. `file:`, `link:`,
  and `workspace:` locators are forbidden in committed source manifests and lockfiles. Generated
  release documents contain no location at all.
- **BR14 — Build evidence is not execution evidence.** An owner toolchain or maintained Docker
  cross-builder may build every target it supports. Cross-build success proves the target archive
  and native header, not execution on that operating system. Native, emulated, VM, and cross-build
  evidence name their environment and never substitute for one another.
- **BR15 — GitHub Actions authorizes publication.** Actions builds the full matrix from the exact
  main commit with the same owner commands, assembles one complete release, and publishes the tested
  bytes without rebuilding in the publish job. Local GREEN is development evidence; the required
  Actions matrix is publication evidence.
- **BR16 — Local verification spends first.** Development iterations run owner gates, maintained
  Docker cross-builds, local release-store verification, and installed-product tests locally. An
  Actions run begins only for native evidence unavailable locally or for the final publication.
  A failed run is not rerun without a source or declared-environment change.
<!-- rule:component-tooling-receipt -->
- **BR17 — One Component Tooling receipt.** Plugin, Sidecar, Kit, Contract, and Spec builds run the
  same public `make verify` boundary through the exact `soksak-sdk` Kit release. The
  build emits `component-build-receipt.json` with schema `soksak-component-build-receipt-v1` and
  binds the component identity, source commit, manifest bytes, exact Spec and tooling release
  references, and every artifact digest to that target's execution mode/platform/architecture and
  exact tool versions. A multi-target Sidecar never projects one publish job onto the whole matrix.
  Local and Actions builds of the same source use the same command and receipt grammar.
<!-- rule:sdk-not-release-identity -->
- **BR18 — SDK dependency is not release identity.** An author SDK may help a Plugin or Sidecar
  implement the public contract, but a dependency package name does not prove artifact behavior.
  Kit, Contract, and Spec use the common tooling without an invented SDK. Publication verifies the
  receipt, manifest, artifact bytes, and conformance claims; it neither requires nor trusts an SDK
  dependency merely because it appears in source metadata.

## Component and state ownership

Plugin and Sidecar releases become runtime installations. Kit releases carry reusable build
implementation, Contract releases carry shared type or protocol inputs, and Spec releases carry
platform schemas and validators. Kit, Contract, and Spec identities remain visible in release
references; Core does not record them as runtime processes.

`environment.json` records only Plugin and Sidecar runtime selections. Each record contains the
exact version, materialized path, source (`local`, `registry`, or `development`), and artifact
SHA-256. A `development` record references a source directory, reads its version from the manifest
there, and records an empty artifact SHA-256 and no registry. A Sidecar also records its target; a
Sidecar additionally records the exact absolute process materialized from the build's project name
and the manifest's `processRole`; a Plugin records its enabled state. `release.json` retains
repository, source commit, dependency identity, size, and digest. `environment.json` is owned and
validated by the Go module; the TypeScript package exports nothing for it.

## Local release store

The workspace development repository owns `local/releases`. Component repositories never discover
that directory, and Core never derives it from a sibling checkout. A caller supplies its absolute
path when inspecting or installing a local release.

```text
local/releases/
├── plugins/<id>/<version>/
├── sidecars/<id>/<version>/
├── kits/<id>/<version>/
├── contracts/<id>/<version>/
└── specs/<id>/<version>/
```

Each version directory is the flat GitHub Release asset set. Sidecar targets remain artifact fields
and filename segments, not additional store directories. The store walk considers only directories:
a regular file such as `.DS_Store` under `<kind-plural>/` or `<kind-plural>/<id>/` is not a store
entry and is ignored; a symbolic link, FIFO, socket, or device there is refused as
`LOCAL_RELEASE_INVALID`. One publisher runs per store at a time: the publisher holds the directory
`<store>/.publish-lock` for its duration and a second publisher is refused as `LOCAL_RELEASE_BUSY`. The publisher verifies the source output, copies it to the sibling directory
`<version>~next.<pid>`, verifies the copy, and renames that directory into place. A replacement is
two renames in this order: `<version>` to `<version>~previous.<pid>`, then `<version>~next.<pid>`
to `<version>`; `<version>~previous.<pid>` is removed last. `~` is outside the SemVer grammar, so a
staging directory never collides with a stored version. A failed publication exposes no final
directory. A leftover `<version>~previous.<pid>` or `<version>~next.<pid>` directory is an
interrupted replacement: `publish`, `verify`, `list`, `inspect`, and `delete` walk the whole store
at entry and refuse with `LOCAL_RELEASE_REPLACEMENT_INTERRUPTED` naming that path, and no store
operation repairs it. The operator removes the leftover directory.

Location is derived by convention and appears in no document. A published release directory is
`https://github.com/soksak-ai/<id>/releases/download/v<version>/`; a local release directory is
`<store>/<kind-plural>/<id>/<version>/`. Both hold `release.json`, the manifest file, the
artifacts, and the evidence under the bare file names that `release.json` records.

`publish`, `list`, `inspect`, `verify`, and `delete` are the complete store operations. `delete`
addresses one exact kind, id, and version. It removes no installed component and stops no process.

`verify` checks every stored release and every `runtimeDependencies` reference in the store: each
reference resolves to a stored release whose `release.json` has the referenced size and SHA-256. A
reference that resolves to different bytes or to no stored release fails with
`LOCAL_RELEASE_DEPENDENCY_MISMATCH` naming the dependent release and the referenced identity.

## Build, install, and publish

1. The owner repository verifies its exact commit. Build inputs come from the committed package
   manifest and lockfile; owner manifests and lockfiles remain unchanged.
2. The canonical builder creates one flat release output. Portable components produce `any`; a
   Sidecar produces every requested target supported by the selected native or Docker toolchain.
   The Sidecar builder's optional `--target <declared-target>` selects one local development target;
   omitting it remains the publication boundary and requires the repository's complete target matrix.
   The exact Component Tooling release writes `component-build-receipt.json` after `make verify`
   and before publication; its artifact matrix is the matrix the release records.
   A Plugin owner verifier builds and compares two base candidates before exposing either one. If
   the addressed final output is absent, the verified directory is published by one rename. A
   repeated equal base, including a final output that already carries the canonical Component
   Tooling receipt, is `unchanged`. Different bytes fail while preserving the completed output.
   Verification never recursively deletes the addressed final output.
3. The local publisher validates and atomically stores the output. Same `source.commit` and same
   bytes return `unchanged`; any different bytes at the same version fail with
   `LOCAL_RELEASE_VERSION_CONFLICT` under BR12, regardless of source commit.
4. A local build resolves its runtime dependencies from the addressed store only: each
   `{ id, version }` intent is read from `<store>/<kind-plural>/<id>/<version>/release.json` and
   recorded as `{ id, version, size, sha256 }`. A published build resolves from GitHub only. An
   intent has no `size`: the builder's read is a root read without a reference, bounded by
   `MAX_RELEASE_DOCUMENT_BYTES` (1 MiB) from GitHub and unbounded from the local store. A
   dependency absent from the selected location fails the build. The installer compares the bytes
   of each dependency's `release.json` with the size and SHA-256 of the reference that names it;
   the read is bounded by the reference `size` (BR13), and a mismatch fails installation.
5. The shared installer selects the host target, verifies and extracts the closure, then commits the
   directories and `environment.json` atomically. Equal version and digest are idempotent. Equal
   version and target with a different digest fail with `VERSION_ARTIFACT_CONFLICT`.
6. Actions repeats the owner build on main for the required matrix. The publish job downloads,
   verifies, assembles, and publishes those outputs. It contains no build command.

## Acceptance gates

Completion requires all of these gates to remain GREEN: local-store transaction safety; all five
release kinds; local and registry transport parity; digest-conflict refusal; Sidecar in-use refusal;
event-driven install progress; cross-build versus native evidence; publish-job no-rebuild; and exact
English/Korean command and error-code parity. The Component Tooling receipt and every byte it binds
are also required. A later failure invalidates completion.

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

GitHub Actions inject tools from the declarative owners and invoke the same targets. The selected
local environment invokes those same targets; direct pnpm entrypoints enforce the same declarations
but do not select or install a tool.
Release-only targets may accept an explicit target triple and staging directory, but publication
credentials and GitHub release mutation stay in Actions.

```sh
soksak-sdk package <kind-specific-options>
soksak-sdk attest <release-and-execution-options>
soksak-local-release publish --store <absolute-store> --release <absolute-release-directory>
soksak-local-release verify --store <absolute-store>
soksak-local-release inspect --store <absolute-store> --kind plugin --id <id> --version <version>
soksak-local-release delete --store <absolute-store> --kind plugin --id <id> --version <version>
```

Component Tooling owns build, kind-specific packaging, and attestation. The Spec local-release
command never clones or builds an owner repository. It accepts only a release whose exact build
receipt is already attached, validates the complete asset set, and mutates the addressed store
atomically. Runtime dependencies are resolved from that `--store` only.

For a Plugin with runtime dependencies, the owner passes the absolute store to the verified release
command. That command forwards the same store to both independent candidate generations before
comparing their bytes. Omitting the store selects published GitHub releases; a failed local lookup
is never retried against GitHub.
