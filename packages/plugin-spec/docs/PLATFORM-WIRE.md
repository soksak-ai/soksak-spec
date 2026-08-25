# soksak public platform wire 0.0.1

This document is normative for the public JSON boundaries exported by
`@soksak-ai/plugin-spec`. The TypeScript parsers enforce the full rules; the JSON Schemas
are the language-neutral structural form; the checked-in corpus fixes canonical bytes and
cryptographic results.

## 1. Ownership is not aggregation

A plugin, sidecar, kit, contract, or spec is independently released. Its own repository has final
responsibility for its implementation, kind-specific manifest or protocol, documentation,
tests, source commit, dependency closure, artifacts, and release history. Creating a new
plugin does not require a change to `soksak-spec` or to the core.

`soksak-spec` owns only the common platform boundary: component identity grammar, owner release
envelope, signed registry projection, portable conformance evidence, and validation tools.
A domain contract is split into `soksak-contract-<domain>` only after two or more independent
implementations genuinely share that domain protocol. It is never split merely to collect
files in one place.

A registry owns plugin discovery and trust continuity. It does not own component source or select
runtime dependencies.

```text
plugins[]
signature
```

Each plugin entry is one exact release reference `{ id, version, size, sha256 }`. Runtime
dependencies are read from that release's `release.json`; the index does not copy them. See
[PLUGIN-DISTRIBUTION.md](PLUGIN-DISTRIBUTION.md).

## 2. Identity and immutable transport

- A release has one flat `kind`, `id`, and `version`.
- Each identity `id` is flat, at most 128 ASCII characters, and matches
  `^[a-z0-9][a-z0-9-]{0,127}$`.
- Every 0.0.1 identity reference has exact version `0.0.1`.
- The organization binding is the rule. The organization is the one exported constant
  `GITHUB_ORG` = `soksak-ai`; every builder derives `source.repository` from it, so
  `source.repository` equals `https://github.com/soksak-ai/<id>` and the release directory is
  derived from that value. A release under another organization is invalid.
  `source.commit` is one lowercase 40-character commit SHA.
- Distribution uses immutable GitHub Release assets plus lowercase SHA-256. A branch,
  `latest`, git checkout, npm/crates registry lookup, or guessed filesystem path is not an
  installation source.
- The 0.0.1 release tag is exactly `v0.0.1`. Every archive,
  every install artifact, manifest, and evidence file must be assets of that repository and tag.

The package itself is `private: true`; its deterministic tarball is a GitHub Release asset.
This contract does not prohibit a future mature library from additionally publishing to a
language registry. Such publication is an extra distribution channel, never a prerequisite
for soksak installation.

## 3. Owner release manifest

`release.schema.json` defines the sole release document. A release owns:

- one flat `kind`, `id`, and `version`;
- exact source repository and commit;
- exact plugin and sidecar runtime release references;
- the complete artifact matrix;
- SHA-256, archive format, and kind-specific manifest name for every artifact;
- generated conformance evidence file name, size, and SHA-256.

Every `file` value in a release (`release.json`, the manifest, each artifact, and each evidence
file) is one bare name under the one release file grammar, exported by the package as
`RELEASE_FILE_RE` = `^(?!\.\.?$)[A-Za-z0-9._-]+$`. `.` and `..` are excluded by the grammar; a
path separator, a leading `/`, and a non-ASCII byte are excluded by the character class. Builders
and publishers import this pattern; no second file-name pattern exists.

Plugin, kit, contract, and spec releases contain exactly one portable `any` artifact with
`plugin.json`, `kit.json`, `contract.json`, or `spec.json`. A sidecar uses canonical native target triples and every archive declares
`sidecar.json`. The manifest inside the verified archive owns process/library paths and the exact
sidecar interface. Installers open only that kind-specific manifest and reject links.

`plugin.json.runtimeDependencies` is intent: exact `{ id, version }` plugin and sidecar references.
`release.json.runtimeDependencies` is fact: `{ id, version, size, sha256 }` composed by the release
builder through the release resolver, never copied from the manifest. Kit, contract, spec, and
language dependencies remain in standard build manifests and lockfiles.

Dependencies are resolved only through the exact identity, size, and digest declared by the parent
release; the location is derived from kind, id, and version. No match is a hard failure. It must not
retry another registry, a package registry, or a git branch. A release consumer detects dependency
cycles and fails with the cycle path; it never drops an edge to make the graph installable.

A resolver receives the full reference `{ kind, id, version, size, sha256 }`. The GitHub resolver
bounds a read with a reference by `size`: a declared content length above `size` is refused before
the body is read, and a body that grows past `size` is cancelled. A root read without a reference
is bounded by `MAX_RELEASE_DOCUMENT_BYTES` (1 MiB). The local-store resolver reads the whole file.
One verifier compares the bytes with `size` and `sha256` after every read; a mismatch is a hard
failure.

## 4. Schemas, runtime contracts, and evidence

JSON Schema files identify document structures through their own `$id`. Payloads do not repeat a
schema name. Parser selection comes from the API or declared manifest filename. `spec` is reserved
for an installed spec identity object, `protocol` for runtime framing, and `format` for archive
serialization. See [SCHEMA-AND-IDENTITY.md](SCHEMA-AND-IDENTITY.md).

Runtime declaration contracts describe independently implemented behavior:

```text
soksak-spec-plugin-<domain>
soksak-spec-sidecar-<domain>
soksak-spec-service[-<domain>]
```

The id is version-free. A provider and conformance report carry exact evidence as
`{ "id": "soksak-spec-plugin-<domain>", "version": "0.0.1" }`; a consumer,
`service.interface` and `viewContract` carry explicit requirement objects. Distribution references
use exact component IDs and versions instead of provider selection.

Conformance evidence names one direct claim: `{release:true}`, `{manifest:true}`, or
`{contract:{id,version}}`. A domain contract claim is valid only when that plugin or sidecar
manifest declared the same provider. The report binds
every `(target, artifact SHA-256)` in the release matrix. Only a
`passed` result can be indexed. Every release requires release and manifest claims. A sidecar additionally requires evidence for
its declared runtime interface. Plugin-kind evidence includes the exact runtime-dependency
projection rule in §3. Release evidence is an audit surface; it does not add
a runtime dependency, command, or call surface.

An evidence producer tests the bytes named by the release: it downloads each artifact,
verifies its SHA-256, extracts it with traversal/link rejection, opens the declared
kind-specific manifest, and runs the relevant conformance suite. It must not certify a convenient local
working copy as though it were the release artifact. `soksak-validate conformance` checks
the supplied report/owner documents for authoring and audit; trust for installation exists
only after the registry operator has independently produced or accepted that evidence and
signed its exact digest into a certified index.

## 5. Signed registry certification

The registry document is signed with Ed25519. Trust configuration pins the expected
registry `id`, expected `keyId`, and the 32-byte public key independently of the downloaded
index. Shape validation alone never makes an index trusted.

The signature input is the registry payload with `signature` omitted, serialized using RFC
8785 JSON Canonicalization Scheme (JCS). The 0.0.1 schema permits only safe integers and ASCII
object keys, so independent JCS implementations produce the checked-in
`registry-canonical.json` bytes. `registry-canonical.sha256` and the RFC 8032 Ed25519 fixture
are the cross-language golden.

Certification is one fail-closed boundary:

1. Strictly parse the index and public key.
2. Require the pinned registry id and key id.
3. Verify Ed25519 over the canonical payload.
4. Require `issuedAt <= now < expiresAt`.
5. Compare the persisted per-registry high-water `(sequence, digest)`:
   - no state: `initial`;
   - same sequence and digest: `unchanged`;
   - greater sequence: `advance`;
   - smaller sequence: rollback failure;
   - same sequence with another digest: equivocation failure.
6. Persist the returned high-water only after the whole certification succeeds.

Downstream code receives `CertifiedRegistry`, not a structurally parsed document. Plugin installation
then verifies exact release identities, runtime dependency references, required evidence, and every artifact digest
before extraction.

## 6. Portable files and CLI

The schemas are:

- `schema/release.schema.json`
- `schema/conformance-report.schema.json`
- `schema/registry-index.schema.json`
- `schema/registry-public-key.schema.json`

The corpus is under `test/fixtures/platform-wire/`. Consumers in another language should
first reproduce the canonical registry bytes/digest/signature, then accept every valid
plugin/sidecar/kit/contract/spec fixture and reject mutations of identity, file name, digest, target, manifest,
unknown fields, continuity, and evidence coverage.

The installed GitHub Release package provides:

```text
soksak-validate plugin <plugin.json>
soksak-validate release <release.json>
soksak-validate conformance <report.json> --release <release.json> [--plugin-manifest <plugin.json> | --sidecar-manifest <sidecar.json>]
soksak-validate registry <registry.json> --public-key <key.json> --registry-id <id> --key-id <id>
```

Registry mode performs cryptographic certification; it never reports success from schema
parsing alone. `--at` exists for deterministic fixtures and audits; normal execution uses
the current clock. `--high-water` supplies persisted continuity state.
