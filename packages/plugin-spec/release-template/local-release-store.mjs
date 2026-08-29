import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { parseReleaseManifest, verifyReference } from "../dist/release.js";
import { collectCanonicalReleaseAssets } from "./publish-canonical-release.mjs";
import { KIND_DIRECTORY, releaseDirectory } from "./resolve-release.mjs";

// A new version is copied under a non-SemVer staging name and renamed once. Existing versions are
// immutable, so there is no previous-version staging family and no replacement transaction.
const PUBLICATION_SUFFIX = `~next.${process.pid}`;
const PUBLICATION_LEFTOVER_RE = /~next\.[0-9]+$/;
// The runtimeDependencies group that pins a release of each dependency kind.
const DEPENDENCY_GROUP = Object.freeze({ plugin: "plugins", sidecar: "sidecars" });

function fail(code, detail) { throw new Error(`${code}: ${detail}`); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function releaseName(kind, id, version) { return `${kind}/${id}@${version}`; }

function regularDirectory(value, label, empty = false) {
  if (!path.isAbsolute(value)) fail("LOCAL_RELEASE_INVALID", `${label} must be absolute`);
  const resolved = path.resolve(value);
  const info = fs.lstatSync(resolved);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    fail("LOCAL_RELEASE_INVALID", `${label} must be a real directory`);
  }
  if (empty && fs.readdirSync(resolved).length !== 0) fail("LOCAL_RELEASE_INVALID", `${label} must be empty`);
  return fs.realpathSync(resolved);
}

function readRelease(directory) {
  let bytes; let raw;
  try { bytes = fs.readFileSync(path.join(directory, "release.json")); raw = JSON.parse(bytes.toString("utf8")); }
  catch (error) { fail("LOCAL_RELEASE_CORRUPT", `${directory}: release.json cannot be read: ${String(error)}`); }
  const parsed = parseReleaseManifest(raw);
  if (!parsed.ok) fail("LOCAL_RELEASE_CORRUPT", `${directory}: ${parsed.errors.join("; ")}`);
  return { release: parsed.value, bytes };
}

function canonical(directory) {
  const { release, bytes } = readRelease(directory);
  const repository = new URL(release.source.repository).pathname.replace(/^\//, "");
  let collected;
  try {
    collected = collectCanonicalReleaseAssets({
      repository, commit: release.source.commit, artifacts: directory, manifest: path.join(directory, "release.json"),
    });
  } catch (error) {
    fail("LOCAL_RELEASE_CORRUPT", `${directory}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const inventory = collected.assets.map(({ name, bytes: asset }) => ({ name, size: asset.length, sha256: sha256(asset) }));
  const digest = sha256(Buffer.from(`${JSON.stringify(inventory)}\n`));
  return { release, bytes, inventory, digest };
}

function copyRelease(source, destination) {
  fs.mkdirSync(destination, { recursive: false, mode: 0o755 });
  for (const name of fs.readdirSync(source).sort()) {
    const from = path.join(source, name);
    const info = fs.lstatSync(from);
    if (info.isSymbolicLink() || !info.isFile() || fs.realpathSync(from) !== from) {
      fail("LOCAL_RELEASE_INVALID", `release input is not a regular file: ${name}`);
    }
    fs.copyFileSync(from, path.join(destination, name), fs.constants.COPYFILE_EXCL);
  }
}

// The entries of one store directory, by name. Only directories are store entries: a regular file
// such as .DS_Store is ignored; a symbolic link, FIFO, socket, or device is refused by name.
function directoryEntries(directory) {
  const entries = [];
  for (const name of fs.readdirSync(directory).sort()) {
    const info = fs.lstatSync(path.join(directory, name));
    if (info.isFile()) continue;
    if (!info.isDirectory()) fail("LOCAL_RELEASE_INVALID", `store entry is not a directory: ${path.join(directory, name)}`);
    entries.push(name);
  }
  return entries;
}

// Every version directory of the store, from the layout <kind>s/<id>/<version>, by raw name.
// The walk considers only directories (see directoryEntries).
function* versionDirectories(root) {
  for (const [kind, directoryName] of Object.entries(KIND_DIRECTORY)) {
    const kindRoot = path.join(root, directoryName);
    if (!fs.existsSync(kindRoot)) continue;
    regularDirectory(kindRoot, `${kind} directory`);
    for (const id of directoryEntries(kindRoot)) {
      const idRoot = regularDirectory(path.join(kindRoot, id), "component directory");
      for (const version of directoryEntries(idRoot)) yield { kind, id, version, entry: path.join(idRoot, version) };
    }
  }
}

// Every store operation runs this at entry: a replacement leftover anywhere in the store refuses
// the operation before any release is read or written. An absent store holds nothing.
function assertNoPublicationLeftovers(store) {
  if (typeof store !== "string" || !path.isAbsolute(store)) fail("LOCAL_RELEASE_INVALID", "store must be absolute");
  if (!fs.existsSync(store)) return;
  for (const { version, entry } of versionDirectories(regularDirectory(store, "release store"))) {
    if (PUBLICATION_LEFTOVER_RE.test(version)) {
      fail("LOCAL_RELEASE_PUBLICATION_INTERRUPTED", `publication leftover exists: ${entry}`);
    }
  }
}

// Every stored release identity, with its directory joined from validated segments.
function* storedReleases(root) {
  for (const { kind, id, version } of versionDirectories(root)) {
    yield { kind, id, version, directory: releaseDirectory(root, kind, id, version) };
  }
}

// Every runtimeDependencies reference of every stored release resolves inside the store with the
// referenced size and sha256.
function verifyDependencies(states) {
  const stored = new Map(states.map((state) => [releaseName(state.release.kind, state.release.id, state.release.version), state]));
  for (const state of states) {
    const dependent = releaseName(state.release.kind, state.release.id, state.release.version);
    for (const [kind, group] of Object.entries(DEPENDENCY_GROUP)) {
      for (const reference of state.release.runtimeDependencies?.[group] ?? []) {
        const name = releaseName(kind, reference.id, reference.version);
        const dependency = stored.get(name);
        if (!dependency) fail("LOCAL_RELEASE_DEPENDENCY_MISMATCH", `${dependent} pins ${name}: absent from the store`);
        try { verifyReference(dependency.bytes, reference); }
        catch (error) { fail("LOCAL_RELEASE_DEPENDENCY_MISMATCH", `${dependent} pins ${name}: ${error instanceof Error ? error.message : String(error)}`); }
      }
    }
  }
}

// A version directory is keyed by the contract identity and its complete release bytes. Source
// commit is provenance only: equal bytes are idempotent, and any different bytes at one version are
// a conflict. A changed source commit must publish a new version.
// One publisher at a time per store: the lock directory refuses a second publisher by name.
function withStoreLock(store, action) {
  const lock = path.join(store, ".publish-lock");
  fs.mkdirSync(store, { recursive: true, mode: 0o755 });
  try { fs.mkdirSync(lock); }
  catch (error) {
    if (error && error.code === "EEXIST") fail("LOCAL_RELEASE_BUSY", `another publisher holds ${lock}`);
    throw error;
  }
  try { return action(); }
  finally { fs.rmdirSync(lock); }
}

export function publishLocalRelease(input) {
  assertNoPublicationLeftovers(input.store);
  return withStoreLock(path.resolve(input.store), () => publishLocked(input));
}

function publishLocked({ store, release: releaseInput }) {
  const source = regularDirectory(releaseInput, "release input");
  const sourceState = canonical(source);
  const { kind, id, version } = sourceState.release;
  const destination = releaseDirectory(store, kind, id, version);
  const next = `${destination}${PUBLICATION_SUFFIX}`;
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
  const exists = fs.existsSync(destination);
  if (exists) {
    const existing = canonical(regularDirectory(destination, "stored release"));
    if (existing.digest === sourceState.digest) return { state: "unchanged", kind, id, version, directory: destination, digest: existing.digest };
    fail("LOCAL_RELEASE_VERSION_CONFLICT", `${releaseName(kind, id, version)} already contains different release bytes`);
  }
  try {
    copyRelease(source, next);
    const copied = canonical(next);
    if (copied.digest !== sourceState.digest) fail("LOCAL_RELEASE_CORRUPT", "copied bytes changed before publication");
  } catch (error) {
    fs.rmSync(next, { recursive: true, force: true });
    throw error;
  }
  try {
    fs.renameSync(next, destination);
  } catch (error) {
    fs.rmSync(next, { recursive: true, force: true });
    throw error;
  }
  return { state: "published", kind, id, version, directory: destination, digest: sourceState.digest };
}

function inspect({ store, kind, id, version }) {
  const directory = releaseDirectory(store, kind, id, version);
  if (!fs.existsSync(directory)) fail("LOCAL_RELEASE_MISSING", releaseName(kind, id, version));
  const state = canonical(regularDirectory(directory, "stored release"));
  if (state.release.kind !== kind || state.release.id !== id || state.release.version !== version) {
    fail("LOCAL_RELEASE_CORRUPT", "directory identity differs from release.json");
  }
  return { directory, state };
}

export function inspectLocalRelease({ store, kind, id, version }) {
  assertNoPublicationLeftovers(store);
  const { directory, state } = inspect({ store, kind, id, version });
  return { kind, id, version, directory, digest: state.digest, assets: state.inventory };
}

export function verifyLocalReleaseStore({ store }) {
  assertNoPublicationLeftovers(store);
  if (!fs.existsSync(store)) return { releases: 0, entries: [] };
  const root = regularDirectory(store, "release store");
  const entries = []; const states = [];
  for (const { kind, id, version } of storedReleases(root)) {
    const { directory, state } = inspect({ store: root, kind, id, version });
    states.push(state);
    entries.push({ kind, id, version, directory, digest: state.digest, assets: state.inventory });
  }
  verifyDependencies(states);
  return { releases: entries.length, entries };
}
