# Schema metadata and payload identity

This rule applies to every public Soksak JSON boundary.

## One owner for each fact

- JSON Schema files own document structure. Their `$schema` and `$id` fields are schema metadata.
- Payloads do not repeat the schema name or version. A parser is selected by the API, command, or
  declared manifest filename that reads the payload.
- `spec` is reserved for the exact identity of an installed spec repository:
  `{ "spec": { "id": "soksak-spec", "version": "0.0.1" } }`.
- `protocol` is reserved for runtime framing and handshake versions.
- `format` is reserved for serialization formats such as `tar.gz` and `tgz`.

## Direct component kinds

Releases and dependencies name `plugin`, `sidecar`, `kit`, `contract`, or `spec` directly. A
release contains exactly one of these identity fields. Registries keep separate `plugins`,
`sidecars`, `kits`, `contracts`, and `specs` arrays. Settings use the same direct arrays.

The following designs are forbidden:

- a generic `unit` kind or identifier;
- a generic `{kind, id, version}` component identity;
- payload fields that repeat a schema identifier;
- aliases, compatibility readers, migrations, or fallback field names;
- using `schema`, `spec`, or `format` to avoid a naming collision without separating ownership.

## Change rule

A public boundary change updates its parser, JSON Schema, canonical corpus, validator, owner
template, consumer tests, and this documentation in one verified change. Tests must reject the old
shape rather than accept both.
