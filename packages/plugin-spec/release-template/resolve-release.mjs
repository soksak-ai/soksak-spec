// Release location derivation and resolution. No document records a location: a release directory
// is derived from kind, id, and version. The published directory is
// https://github.com/<GITHUB_ORG>/<id>/releases/download/v<version>/; the local directory is
// <store>/<kind>s/<id>/<version>/. Every file inside is addressed by its bare name. A resolver's
// read(reference) returns the bytes of release.json for one release reference
// { kind, id, version, size, sha256 }; size and sha256 are absent only for a root read without a
// reference. The GitHub resolver bounds a read with a reference by reference.size and a root read
// without a reference by MAX_RELEASE_DOCUMENT_BYTES; the local-store resolver reads the whole file.
// The caller verifies the bytes with verifyReference from dist/release.js after the read.
import fs from "node:fs";
import path from "node:path";

import { COMPONENT_ID_RE, GITHUB_ORG, STRICT_SEMVER_RE } from "../dist/release-primitives.js";

export const KIND_DIRECTORY = Object.freeze({
  plugin: "plugins",
  sidecar: "sidecars",
  kit: "kits",
  contract: "contracts",
  spec: "specs",
});
// The GitHub resolver bounds a root read without a reference by this many bytes.
export const MAX_RELEASE_DOCUMENT_BYTES = 1_048_576;

export function releaseURL(id, version, file) {
  return `https://github.com/${GITHUB_ORG}/${id}/releases/download/v${version}/${file}`;
}

// The directory is joined from validated segments only: kind by the kind enum, id by the component
// id grammar, version by the strict SemVer grammar.
export function releaseDirectory(store, kind, id, version) {
  if (typeof store !== "string" || !path.isAbsolute(store)) throw new Error("LOCAL_RELEASE_INVALID: store must be absolute");
  const directoryName = KIND_DIRECTORY[kind];
  if (!directoryName) throw new Error(`LOCAL_RELEASE_INVALID: unsupported kind ${kind}`);
  if (typeof id !== "string" || !COMPONENT_ID_RE.test(id)) throw new Error("LOCAL_RELEASE_INVALID: component id is invalid");
  if (typeof version !== "string" || !STRICT_SEMVER_RE.test(version)) throw new Error("LOCAL_RELEASE_INVALID: component version is invalid");
  return path.join(path.resolve(store), directoryName, id, version);
}

export class UnresolvedReleaseError extends Error {
  constructor(id, version, location) {
    super(`unresolved release ${id}@${version}: ${location}`);
    this.name = "UnresolvedReleaseError";
  }
}

function readRegularFile(file) {
  const info = fs.lstatSync(file);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`regular file required: ${file}`);
  return fs.readFileSync(file);
}

// Reads at most `bound` bytes: a declared content-length above the bound is refused before the body
// is read; a body that grows past the bound is cancelled.
async function readBounded(response, bound, url) {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > bound) throw new Error(`GET ${url}: content length exceeds ${bound} bytes`);
  if (!response.body) throw new Error(`GET ${url}: response body missing`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > bound) {
      await reader.cancel();
      throw new Error(`GET ${url}: response exceeds ${bound} bytes`);
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks, size);
}

// The published location depends on id and version only; kind is part of the identity and unused
// here. A read with a reference is bounded by reference.size; a root read without a reference is
// bounded by MAX_RELEASE_DOCUMENT_BYTES.
export function githubResolver(fetchImpl = fetch) {
  return {
    kind: "github",
    async read({ id, version, size = MAX_RELEASE_DOCUMENT_BYTES }) {
      const url = releaseURL(id, version, "release.json");
      const response = await fetchImpl(url);
      if (response.status === 404) throw new UnresolvedReleaseError(id, version, url);
      if (!response.ok) throw new Error(`GET ${url}: ${response.status}`);
      return { bytes: await readBounded(response, size, url), url };
    },
  };
}

// The local read has no bound: the whole file is read, and the caller's verifier compares its size
// and sha256 with the reference after the read.
export function localStoreResolver(store) {
  if (typeof store !== "string" || !path.isAbsolute(store)) throw new Error("store must be absolute");
  return {
    kind: "local-store",
    async read({ kind, id, version }) {
      const file = path.join(releaseDirectory(store, kind, id, version), "release.json");
      if (!fs.existsSync(file)) throw new UnresolvedReleaseError(id, version, file);
      return { bytes: readRegularFile(file), path: file };
    },
  };
}

// The builders' --store option: an absolute local store selects the local resolver; no option
// selects the GitHub resolver.
export function releaseResolver(store) {
  if (store === undefined) return githubResolver();
  if (typeof store !== "string" || !path.isAbsolute(store)) throw new Error("--store must be an absolute local store directory");
  return localStoreResolver(store);
}
