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
- **BR11 — Local releases use the public release shape.** A local release contains the same
  `release.json`, source commit, manifests, evidence, target artifacts, sizes, and SHA-256 values as
  a GitHub Release. Local paths never appear in those documents. The local store maps public asset
  URLs to regular files without changing the release document.
- **BR12 — One local version directory is one release transaction.** While
  `local/releases/<kind-plural>/<id>/<version>` exists, its bytes are immutable. Republishing equal
  bytes is idempotent. Different bytes fail with `LOCAL_RELEASE_VERSION_CONFLICT`. Reusing an
  unpublished version requires deleting the complete version directory and rebuilding every local
  dependent that named the old size or digest. Partial replacement is always invalid.
- **BR13 — Installation is shared; transport is not identity.** Local and registry installs share
  one closure resolver, target selector, validator, extractor, consent summary, progress stream,
  and atomic environment commit. HTTPS and local-store reads are transports for exact release
  references. A local file is eligible only under the explicitly addressed store and only when its
  name, size, and SHA-256 equal `release.json`. Raw source paths and `file:` URLs are forbidden.
- **BR14 — Build evidence is not execution evidence.** An owner toolchain or maintained Docker
  cross-builder may build every target it supports. Cross-build success proves the target archive
  and native header, not execution on that operating system. Native, emulated, VM, and cross-build
  evidence name their environment and never substitute for one another.
- **BR15 — GitHub Actions authorizes publication.** Actions builds the full matrix from the exact
  main commit with the same owner commands, assembles one complete release, and publishes the tested
  bytes without rebuilding in the publish job. Local GREEN is development evidence; the required
  Actions matrix is publication evidence.

## Component and state ownership

Plugin and Sidecar releases become runtime installations. Kit releases carry reusable build
implementation, Contract releases carry shared type or protocol inputs, and Spec releases carry
platform schemas and validators. Kit, Contract, and Spec identities remain visible in release
references and candidate build receipts; Core does not record them as runtime processes.

`environment.json` records only Plugin and Sidecar runtime selections. Each record contains the
exact version, materialized path, source (`local` or `registry`), and artifact SHA-256. A Sidecar
also records its target; a Plugin also records its enabled state. Release and build receipts retain
repository, source commit, dependency URL, size, and digest.

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
and filename segments, not additional store directories. The publisher verifies the source output,
copies it to a private sibling directory, verifies the copy, and atomically renames that directory.
A failed publication exposes no final directory.

`publish`, `list`, `inspect`, `verify`, and `delete` are the complete store operations. `delete`
addresses one exact kind, id, and version. It removes no installed component and stops no process.

## Build, install, and publish

1. The owner repository verifies its exact commit. Unpublished build dependencies enter only the
   canonical isolated candidate materializer; owner manifests and lockfiles remain unchanged.
2. The canonical builder creates one flat release output. Portable components produce `any`; a
   Sidecar produces every requested target supported by the selected native or Docker toolchain.
3. The local publisher validates and atomically stores the output. Equal bytes return `unchanged`;
   different bytes at the same version are rejected.
4. The local resolver reads an explicit Plugin or Sidecar root. A locally present dependency must
   exactly match the parent URL, size, and SHA-256 or installation fails. An absent local dependency
   may use its exact HTTPS reference.
5. The shared installer selects the host target, verifies and extracts the closure, then commits the
   directories and `environment.json` atomically. Equal version and digest are idempotent. Equal
   version and target with a different digest fail with `VERSION_ARTIFACT_CONFLICT`.
6. Actions repeats the owner build on main for the required matrix. The publish job downloads,
   verifies, assembles, and publishes those outputs. It contains no build command.

## Acceptance gates

Completion requires all of these gates to remain GREEN: local-store transaction safety; all five
release kinds; local and registry transport parity; digest-conflict refusal; Sidecar in-use refusal;
event-driven install progress; cross-build versus native evidence; publish-job no-rebuild; and exact
English/Korean command and error-code parity. A later failure invalidates completion.

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

```sh
soksak-local-release publish --store <absolute-store> --release <absolute-release-directory>
soksak-local-release verify --store <absolute-store>
soksak-local-release inspect --store <absolute-store> --kind plugin --id <id> --version <version>
soksak-local-release delete --store <absolute-store> --kind plugin --id <id> --version <version>
```
