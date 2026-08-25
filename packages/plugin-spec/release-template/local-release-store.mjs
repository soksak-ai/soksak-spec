import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { parseReleaseManifest } from "../dist/release.js";
import { collectCanonicalReleaseAssets } from "./publish-canonical-release.mjs";

const SEGMENT = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const KIND_DIRECTORY = {
  plugin: "plugins",
  sidecar: "sidecars",
  kit: "kits",
  contract: "contracts",
  spec: "specs",
};

function fail(code, detail) { throw new Error(`${code}: ${detail}`); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

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

function identitySegment(value, label) {
  if (typeof value !== "string" || !SEGMENT.test(value)) fail("LOCAL_RELEASE_INVALID", `${label} is invalid`);
  return value;
}

function readRelease(directory) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(directory, "release.json"), "utf8")); }
  catch (error) { fail("LOCAL_RELEASE_CORRUPT", `release.json cannot be read: ${String(error)}`); }
  const parsed = parseReleaseManifest(raw);
  if (!parsed.ok) fail("LOCAL_RELEASE_CORRUPT", parsed.errors.join("; "));
  return parsed.value;
}

function canonical(directory) {
  const release = readRelease(directory);
  const repository = new URL(release.source.repository).pathname.replace(/^\//, "");
  let collected;
  try {
    collected = collectCanonicalReleaseAssets({
      repository, commit: release.source.commit, artifacts: directory, manifest: path.join(directory, "release.json"),
    });
  } catch (error) {
    fail("LOCAL_RELEASE_CORRUPT", error instanceof Error ? error.message : String(error));
  }
  const inventory = collected.assets.map(({ name, bytes }) => ({ name, size: bytes.length, sha256: sha256(bytes) }));
  const digest = sha256(Buffer.from(`${JSON.stringify(inventory)}\n`));
  return { release, inventory, digest };
}

function releaseDirectory(store, kind, id, version) {
  const root = path.resolve(store);
  if (!path.isAbsolute(store)) fail("LOCAL_RELEASE_INVALID", "store must be absolute");
  const directoryName = KIND_DIRECTORY[kind];
  if (!directoryName) fail("LOCAL_RELEASE_INVALID", `unsupported kind ${kind}`);
  identitySegment(id, "component id");
  identitySegment(version, "component version");
  return path.join(root, directoryName, id, version);
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

export function publishLocalRelease({ store, release: releaseInput }) {
  const source = regularDirectory(releaseInput, "release input");
  const sourceState = canonical(source);
  const { kind, id, version } = sourceState.release;
  const destination = releaseDirectory(store, kind, id, version);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
  if (fs.existsSync(destination)) {
    const existing = canonical(regularDirectory(destination, "stored release"));
    if (existing.digest !== sourceState.digest) {
      fail("LOCAL_RELEASE_VERSION_CONFLICT", `${kind}/${id}@${version} already contains different bytes`);
    }
    return { state: "unchanged", kind, id, version, directory: destination, digest: existing.digest };
  }
  const temporary = `${destination}.next-${process.pid}-${Date.now()}`;
  try {
    copyRelease(source, temporary);
    const copied = canonical(temporary);
    if (copied.digest !== sourceState.digest) fail("LOCAL_RELEASE_CORRUPT", "copied bytes changed before publication");
    fs.renameSync(temporary, destination);
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  return { state: "published", kind, id, version, directory: destination, digest: sourceState.digest };
}

export function inspectLocalRelease({ store, kind, id, version }) {
  const directory = releaseDirectory(store, kind, id, version);
  if (!fs.existsSync(directory)) fail("LOCAL_RELEASE_MISSING", `${kind}/${id}@${version}`);
  const state = canonical(regularDirectory(directory, "stored release"));
  if (state.release.kind !== kind || state.release.id !== id || state.release.version !== version) {
    fail("LOCAL_RELEASE_CORRUPT", "directory identity differs from release.json");
  }
  return { kind, id, version, directory, digest: state.digest, assets: state.inventory };
}

export function deleteLocalRelease({ store, kind, id, version }) {
  const directory = releaseDirectory(store, kind, id, version);
  if (!fs.existsSync(directory)) return { state: "absent", kind, id, version, directory };
  inspectLocalRelease({ store, kind, id, version });
  fs.rmSync(directory, { recursive: true, force: false });
  return { state: "deleted", kind, id, version, directory };
}

export function verifyLocalReleaseStore({ store }) {
  if (!path.isAbsolute(store)) fail("LOCAL_RELEASE_INVALID", "store must be absolute");
  if (!fs.existsSync(store)) return { releases: 0, entries: [] };
  const root = regularDirectory(store, "release store");
  const entries = [];
  for (const [kind, directoryName] of Object.entries(KIND_DIRECTORY)) {
    const kindRoot = path.join(root, directoryName);
    if (!fs.existsSync(kindRoot)) continue;
    regularDirectory(kindRoot, `${kind} directory`);
    for (const id of fs.readdirSync(kindRoot).sort()) {
      identitySegment(id, "component id");
      const idRoot = regularDirectory(path.join(kindRoot, id), "component directory");
      for (const version of fs.readdirSync(idRoot).sort()) {
        identitySegment(version, "component version");
        entries.push(inspectLocalRelease({ store: root, kind, id, version }));
      }
    }
  }
  return { releases: entries.length, entries };
}
