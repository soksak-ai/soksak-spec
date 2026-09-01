import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export { assertNativeBinaryTarget } from "./native-binary.mjs";
export { readSidecarReleaseArchive } from "./archive.mjs";

// ROOT is the sidecar repository root, resolved by a discoverable rule rather than cwd guessing
// The sidecar.json identity marker is discovered at or above the working directory.
export function findSidecarRoot(startDir = process.cwd(), marker = "sidecar.json") {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, marker))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`sidecar repository root not found: no ${marker} at or above ${path.resolve(startDir)}`);
    dir = parent;
  }
}
export const ROOT = findSidecarRoot();
// This module is vendored byte-identical into sidecar repositories with no access to dist/, so the
// component id grammar, the strict SemVer grammar, the release file grammar, and the GitHub
// organization are restated here. The three regex sources equal COMPONENT_ID_RE.source,
// STRICT_SEMVER_RE.source, and RELEASE_FILE_RE.source of dist/release-primitives.js exactly,
// including the SemVer length bound; the org equals GITHUB_ORG.
const COMPONENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;
const SEMVER = /^(?=.{1,256}$)(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const RELEASE_FILE_RE = /^(?!\.\.?$)[A-Za-z0-9._-]+$/;
const GITHUB_ORG = "soksak-ai";

// Every file name the release document records or the builder writes satisfies the release file
// grammar.
function releaseFileName(name) {
  if (!RELEASE_FILE_RE.test(name)) throw new Error(`release file name is invalid: ${name}`);
  return name;
}

export function parseSidecarManifest(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("sidecar manifest must be an object");
  const keys = Object.keys(raw).sort();
  const allowed = ["id", "interface", "process", "processRole", "runtimeDependencies", "version"];
  if (keys.some((key) => !allowed.includes(key))) throw new Error("sidecar manifest keys are closed");
  if (typeof raw.id !== "string" || !COMPONENT_ID_RE.test(raw.id) || typeof raw.version !== "string" || !SEMVER.test(raw.version)) throw new Error("invalid sidecar identity");
  if (raw.process !== `dist/${raw.id}` && raw.process !== `dist/${raw.id}.exe`) throw new Error("sidecar process path must match its platform executable");
  if (typeof raw.processRole !== "string" || !/^sidecar(?:-[a-z0-9]+)+$/.test(raw.processRole)) throw new Error("sidecar process role must be project-independent");
  if (!Array.isArray(raw.interface) || raw.interface.length === 0)
    throw new Error("interface providers must be a non-empty array");
  const seen = new Set();
  for (const entry of raw.interface) {
    if (
      !entry || typeof entry !== "object" || Array.isArray(entry) ||
      JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(["id", "version"]) ||
      !/^soksak-spec-sidecar-[a-z0-9][a-z0-9-]*$/.test(entry.id) ||
      typeof entry.version !== "string" || !SEMVER.test(entry.version) || seen.has(entry.id)
    ) throw new Error("interface provider must match the sidecar version");
    seen.add(entry.id);
  }
  let runtimeDependencies;
  if (raw.runtimeDependencies !== undefined) {
    const groups = raw.runtimeDependencies;
    if (!groups || typeof groups !== "object" || Array.isArray(groups)) throw new Error("sidecar runtimeDependencies must be an object");
    const groupNames = Object.keys(groups).sort();
    if (groupNames.some((group) => group !== "plugins" && group !== "sidecars") || groupNames.length === 0) throw new Error("sidecar runtimeDependencies groups are invalid");
    runtimeDependencies = {};
    for (const group of groupNames) {
      const entries = groups[group];
      if (!Array.isArray(entries) || entries.length === 0) throw new Error(`sidecar runtimeDependencies.${group} must be a non-empty array`);
      const refs = entries.map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
            JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(["id", "version"]) ||
            typeof entry.id !== "string" || !COMPONENT_ID_RE.test(entry.id) ||
            typeof entry.version !== "string" || !SEMVER.test(entry.version)) {
          throw new Error(`sidecar runtimeDependencies.${group} entry is invalid`);
        }
        return Object.freeze({ id: entry.id, version: entry.version });
      });
      const names = refs.map((entry) => `${entry.id}@${entry.version}`);
      if (new Set(names).size !== names.length || names.some((name, index) => name !== [...names].sort()[index])) throw new Error(`sidecar runtimeDependencies.${group} must be sorted and unique`);
      runtimeDependencies[group] = Object.freeze(refs);
    }
    runtimeDependencies = Object.freeze(runtimeDependencies);
  }
  return Object.freeze({ ...raw, interface: Object.freeze(raw.interface.map((entry) => Object.freeze({ ...entry }))), ...(runtimeDependencies ? { runtimeDependencies } : {}) });
}

export function readSidecarManifest(filename = path.join(ROOT, "sidecar.json")) {
  return parseSidecarManifest(JSON.parse(fs.readFileSync(filename, "utf8")));
}

export const SIDECAR = readSidecarManifest();
export const ID = SIDECAR.id;
export const VERSION = SIDECAR.version;
export const TAG = `v${VERSION}`;
export const REPOSITORY = `https://github.com/${GITHUB_ORG}/${ID}`;
// The primary contract is the first entry; the conformance-interface report
// attests exactly the conformance run it binds, which covers the primary.
export const INTERFACE = SIDECAR.interface[0];
export const INTERFACES = SIDECAR.interface;
export function releaseAssetName(target, sidecar = SIDECAR) {
  return releaseFileName(`${sidecar.id}-${sidecar.version}-${target}.tar.gz`);
}

export function releaseIdentity(commit, sidecar = SIDECAR) {
  assertCommit(commit);
  return { kind: "sidecar", id: sidecar.id, version: sidecar.version, source: { repository: REPOSITORY, commit } };
}

export function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

// Sidecar builders are vendored as a standalone five-file set. Resolve each manifest intent here
// rather than importing the source checkout or an SDK path. A local store is the deterministic
// release path; CI may omit it and resolve the immutable GitHub release document.
export async function composeRuntimeDependencies(intents, store) {
  if (intents === undefined) return undefined;
  if (store !== undefined && (!path.isAbsolute(store) || fs.existsSync(store) && fs.lstatSync(store).isSymbolicLink())) {
    throw new Error("--store must be an absolute regular local release store");
  }
  const groups = {};
  for (const [kind, entries] of [["plugins", intents.plugins], ["sidecars", intents.sidecars]]) {
    if (!entries) continue;
    const directory = kind === "plugins" ? "plugins" : "sidecars";
    groups[kind] = [];
    for (const { id, version } of entries) {
      const file = store
        ? path.join(store, directory, id, version, "release.json")
        : `https://github.com/${GITHUB_ORG}/${id}/releases/download/v${version}/release.json`;
      let bytes;
      try {
        if (store) {
          const stat = fs.lstatSync(file);
          if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(file) !== file) throw new Error("regular release.json required");
          bytes = fs.readFileSync(file);
        } else {
          const response = await fetch(file);
          if (!response.ok) throw new Error(`GET ${file}: ${response.status}`);
          bytes = Buffer.from(await response.arrayBuffer());
        }
        const release = JSON.parse(bytes.toString("utf8"));
        if (!release || release.kind !== (kind === "plugins" ? "plugin" : "sidecar") || release.id !== id || release.version !== version) {
          throw new Error("resolved release identity differs from the declared intent");
        }
      } catch (error) {
        throw new Error(`runtime dependency ${kind} ${id}@${version}: ${error instanceof Error ? error.message : String(error)}`);
      }
      groups[kind].push({ id, version, size: bytes.length, sha256: sha256(bytes) });
    }
  }
  return groups;
}

export function parseOptions(argv, required, optional = []) {
  const wanted = new Set([...required, ...optional]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new Error("options must be --name value pairs");
    const name = flag.slice(2);
    if (!wanted.has(name)) throw new Error(`unknown option: ${flag}`);
    if (values.has(name)) throw new Error(`duplicate option: ${flag}`);
    values.set(name, value);
  }
  for (const name of required) {
    if (!values.has(name) || values.get(name) === "") throw new Error(`--${name} is required`);
  }
  return Object.fromEntries(values);
}

export function assertCommit(commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("source commit must be an exact lowercase 40-character Git SHA");
}

export function assertTag(tag) {
  if (tag !== TAG) throw new Error(`release tag must equal ${TAG}`);
}

export function readTargetMatrix() {
  const matrix = JSON.parse(fs.readFileSync(path.join(ROOT, "release", "targets.json"), "utf8"));
  if (!Array.isArray(matrix) || matrix.length === 0) throw new Error("release matrix must contain at least one target");
  let previous = "";
  const seen = new Set();
  for (const [index, entry] of matrix.entries()) {
    if (
      !entry || typeof entry !== "object" || Array.isArray(entry) ||
      JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(["runner", "target"])
    ) throw new Error(`release target ${index} must contain only runner and target`);
    if (!/^(?:aarch64|x86_64)-(?:apple-darwin|pc-windows-msvc|unknown-linux-(?:gnu|musl))$/.test(entry.target)) {
      throw new Error(`unsupported release target: ${entry.target}`);
    }
    if (typeof entry.runner !== "string" || entry.runner.length === 0) throw new Error(`runner required for ${entry.target}`);
    if (seen.has(entry.target)) throw new Error(`duplicate release target: ${entry.target}`);
    if (previous && Buffer.compare(Buffer.from(previous), Buffer.from(entry.target)) >= 0) {
      throw new Error("release targets must be bytewise sorted");
    }
    previous = entry.target;
    seen.add(entry.target);
  }
  return matrix;
}

export function targetEntry(target) {
  const entry = readTargetMatrix().find((candidate) => candidate.target === target);
  if (!entry) throw new Error(`target is not declared: ${target}`);
  return entry;
}

export function binaryName(target) {
  targetEntry(target);
  return `${ID}${target.includes("windows") ? ".exe" : ""}`;
}

export function assertNoLinkPath(input, kind) {
  const absolute = path.resolve(input);
  const parsed = path.parse(absolute);
  let cursor = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) break;
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error(`symbolic links are forbidden: ${cursor}`);
  }
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error(`symbolic links are forbidden: ${absolute}`);
  if (kind === "file" && !stat.isFile()) throw new Error(`regular file required: ${absolute}`);
  if (kind === "directory" && !stat.isDirectory()) throw new Error(`regular directory required: ${absolute}`);
  return absolute;
}

export function readRegularFile(input) {
  const absolute = assertNoLinkPath(input, "file");
  const before = fs.lstatSync(absolute);
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const after = fs.fstatSync(fd);
    // Match the opened handle to the lstat'd file by inode only. On Windows,
    // lstat reports dev 0 while fstat reports the real volume id, so a dev
    // comparison always fails there; the inode is stable across lstat/fstat on
    // every OS and still changes when the file is swapped under the path.
    if (!after.isFile() || before.ino !== after.ino) {
      throw new Error(`regular file changed while opening: ${absolute}`);
    }
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export function ensureEmptyDirectory(input) {
  const absolute = path.resolve(input);
  if (fs.existsSync(absolute)) {
    assertNoLinkPath(absolute, "directory");
    if (fs.readdirSync(absolute).length !== 0) throw new Error(`output directory must be empty: ${absolute}`);
  } else {
    fs.mkdirSync(absolute, { recursive: true });
    assertNoLinkPath(absolute, "directory");
  }
  return absolute;
}

export function writeRegularFile(filename, bytes, mode = 0o644) {
  const absolute = path.resolve(filename);
  releaseFileName(path.basename(absolute));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  if (fs.existsSync(absolute) && !fs.lstatSync(absolute).isFile()) throw new Error(`regular output file required: ${absolute}`);
  const fd = fs.openSync(absolute, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), mode);
  try {
    fs.writeFileSync(fd, bytes);
    if (process.platform !== "win32") fs.fchmodSync(fd, mode);
  } finally {
    fs.closeSync(fd);
  }
}

export function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

export function assertBaseline() {
  const cargoPath = path.join(ROOT, "Cargo.toml");
  const goModPath = path.join(ROOT, "go.mod");
  if (fs.existsSync(cargoPath)) {
    const cargo = fs.readFileSync(cargoPath, "utf8");
    if (!cargo.includes(`name = "${ID}"`) || !cargo.includes(`version = "${VERSION}"`) || !cargo.includes("publish = false")) {
      throw new Error("Cargo package must match private release metadata");
    }
    return;
  }
  if (fs.existsSync(goModPath)) {
    const goMod = fs.readFileSync(goModPath, "utf8");
    if (!goMod.split(/\r?\n/).includes(`module github.com/${GITHUB_ORG}/${ID}`)) throw new Error("Go module must match sidecar identity");
    return;
  }
  throw new Error("sidecar repository must declare Cargo.toml or go.mod");
}
