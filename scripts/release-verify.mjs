#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  cpSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseReleaseManifest, releaseIdentity } from "../packages/plugin-spec/dist/spec.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STRICT_SEMVER_RE = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const RUST_CRATES = ["soksak-spec-contract", "soksak-spec-service", "soksak-spec-socket"];


function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  return result.stdout.trim();
}

function tryRun(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function canonicalizeGzipPlatform(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 10 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8) {
    throw new Error("package archive must use gzip");
  }
  if (bytes[3] !== 0) throw new Error("package gzip header extensions are forbidden");
  const canonical = Buffer.from(bytes);
  canonical[9] = 255;
  return canonical;
}

function strictSemver(value, label) {
  if (typeof value !== "string" || value.length > 256 || !STRICT_SEMVER_RE.test(value)) {
    throw new Error(`${label}: strict SemVer required`);
  }
  return value;
}

function packageArchiveName(name, version) {
  return `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
}

export function specReleaseIdentity(workspace, pluginSpec) {
  const release = workspace?.soksakRelease;
  if (
    release === null || typeof release !== "object" || Array.isArray(release) ||
    !release.spec || typeof release.spec !== "object" || release.spec.id !== "soksak-spec" || release.spec.version !== workspace.version ||
    typeof release.repository !== "string" ||
    release.manifest !== "release.json"
  ) {
    throw new Error("workspace soksakRelease metadata is invalid");
  }
  const version = strictSemver(workspace.version, "workspace.version");
  if (pluginSpec?.version !== version || typeof pluginSpec?.name !== "string") {
    throw new Error("workspace and plugin-spec versions must both equal the same SemVer");
  }
  return {
    id: release.spec.id,
    repository: release.repository,
    manifest: release.manifest,
    version,
    packageName: pluginSpec.name,
  };
}

export function projectPackageToolchain(workspace, pluginSpec) {
  if (!/^\d+\.\d+\.\d+$/.test(workspace?.engines?.node ?? "")) {
    throw new Error("workspace Node toolchain must be exact");
  }
  return {
    ...pluginSpec,
    engines: { node: workspace.engines.node },
  };
}

export function resolveSourceCommit(explicit, checkoutHead = tryRun(
  "git",
  ["rev-parse", "--verify", "HEAD"],
)) {
  if (
    explicit !== undefined &&
    (typeof explicit !== "string" || !/^[a-f0-9]{40}$/.test(explicit))
  ) {
    throw new Error("--source-commit requires an exact lowercase 40-character commit");
  }
  if (checkoutHead !== null && !/^[a-f0-9]{40}$/.test(checkoutHead)) {
    throw new Error("checkout HEAD is not an exact lowercase 40-character commit");
  }
  if (explicit !== undefined && checkoutHead !== null && explicit !== checkoutHead) {
    throw new Error("--source-commit does not equal checkout HEAD");
  }
  const commit = checkoutHead ?? explicit;
  if (!commit) throw new Error("source commit is unavailable");
  return commit;
}

export function validateArchiveEntries(verbose, names) {
  const nonRegular = verbose.find((line) => line.length > 0 && !line.startsWith("-"));
  if (nonRegular) throw new Error(`non-regular archive entry: ${nonRegular}`);
  if (names.length === 0) throw new Error("empty archive");
  if (new Set(names).size !== names.length) throw new Error("duplicate archive entry");
  for (const name of names) {
    const segments = name.split("/");
    if (
      !name.startsWith("package/") ||
      name.startsWith("/") ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      throw new Error(`unsafe archive path: ${name}`);
    }
  }
  return names;
}

function parseArgs(argv) {
  if (argv.length === 0) return {};
  if (argv.length === 2 && argv[0] === "--source-commit") {
    return { sourceCommit: argv[1] };
  }
  throw new Error("usage: release-verify.mjs [--source-commit <40-character-sha>]");
}

function assertCleanCheckoutIfCommitted(head) {
  if (head === null) return;
  const status = run("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status !== "") throw new Error(`release source checkout is dirty:\n${status}`);
}

function exactCargoVersion(path, expected) {
  const source = readFileSync(join(root, path), "utf8");
  const version = source.match(/^version\s*=\s*"([^"]+)"$/m)?.[1];
  if (version !== expected) {
    throw new Error(`${path}: version ${version ?? "missing"} != ${expected}`);
  }
  if (!/^publish\s*=\s*false$/m.test(source)) {
    throw new Error(`${path}: publish = false required`);
  }
}

function packOnce(destination, workspace) {
  mkdirSync(destination, { recursive: true });
  const source = join(root, "packages/plugin-spec");
  const staging = join(dirname(destination), `${basename(destination)}-source`);
  rmSync(staging, { recursive: true, force: true });
  cpSync(source, staging, {
    recursive: true,
    preserveTimestamps: true,
    filter: (path) => path !== join(source, "node_modules") && !path.startsWith(`${join(source, "node_modules")}/`),
  });
  const manifestPath = join(staging, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  writeFileSync(manifestPath, `${JSON.stringify(projectPackageToolchain(workspace, manifest), null, 2)}\n`);
  try {
    run("pnpm", ["pack", "--pack-destination", destination], { cwd: staging });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  const archives = readdirSync(destination).filter((name) => name.endsWith(".tgz"));
  if (archives.length !== 1) {
    throw new Error(`expected one plugin-spec archive, found: ${archives.join(", ")}`);
  }
  const archive = join(destination, archives[0]);
  writeFileSync(archive, canonicalizeGzipPlatform(readFileSync(archive)));
  return archive;
}

function verifyArchive(path, identity, workspace) {
  const verbose = run("tar", ["-tvzf", path]).split("\n").filter(Boolean);
  const names = run("tar", ["-tzf", path]).split("\n").filter(Boolean);
  validateArchiveEntries(verbose, names);
  const packed = JSON.parse(run("tar", ["-xOzf", path, "package/package.json"]));
  if (
    packed.name !== identity.packageName ||
    packed.version !== identity.version ||
    packed.private !== true ||
    packed.publishConfig !== undefined ||
    packed.engines?.node !== workspace.engines.node
  ) {
    throw new Error(`packed plugin-spec identity, toolchain, or publication policy is invalid: ${JSON.stringify({
      actual: { name: packed.name, version: packed.version, private: packed.private, publishConfig: packed.publishConfig, engines: packed.engines, packageManager: packed.packageManager },
      expected: { name: identity.packageName, version: identity.version, private: true, engines: { node: workspace.engines.node } },
    })}`);
  }
  for (const required of [
    "package/release-template/build-portable-release.mjs",
    "package/release-template/publish-canonical-release.mjs",
    "package/release-template/verify-plugin-release.mjs",
  ]) {
    if (!names.includes(required)) throw new Error(`packed plugin-spec is missing ${required}`);
  }
  return { names, packed };
}

export function buildPlatformRelease({ commit, archiveName, archiveDigest, archiveSize, identity, manifestBytes }) {
  const version = strictSemver(identity?.version, "release identity version");
  const releaseTag = `v${version}`;
  const repository = identity.repository;
  const artifact = {
    target: "any",
    url: `${repository}/releases/download/${releaseTag}/${archiveName}`,
    sha256: archiveDigest,
    size: archiveSize,
    format: "tgz",
    manifest: "spec.json",
  };
  const report = (claim) => ({
    subject: { spec: { id: identity.id, version } }, claim, result: "passed",
    validator: { name: "soksak-conformance", version },
    artifacts: [{ target: "any", sha256: archiveDigest }],
  });
  const evidenceFiles = [
    ["conformance-manifest.json", report({ manifest: true })],
    ["conformance-release.json", report({ release: true })],
  ].map(([name, value]) => {
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    return { name, bytes, reference: { url: `${repository}/releases/download/${releaseTag}/${name}`, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } };
  });
  return {
    kind: "spec", id: identity.id, version,
    manifest: { url: `${repository}/releases/download/${releaseTag}/spec.json`, size: manifestBytes.length, sha256: createHash("sha256").update(manifestBytes).digest("hex") },
    source: { repository: identity.repository, commit },
    artifacts: [artifact],
    evidence: evidenceFiles.map(({ reference }) => reference),
    evidenceFiles,
  };
}

export function verifyRelease(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const checkoutHead = tryRun("git", ["rev-parse", "--verify", "HEAD"]);
  const commit = resolveSourceCommit(options.sourceCommit, checkoutHead);
  assertCleanCheckoutIfCommitted(checkoutHead);

  const workspace = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const pluginSpec = JSON.parse(
    readFileSync(join(root, "packages/plugin-spec/package.json"), "utf8"),
  );
  const identity = specReleaseIdentity(workspace, pluginSpec);
  for (const crate of RUST_CRATES) {
    exactCargoVersion(`crates/${crate}/Cargo.toml`, identity.version);
  }

  run("pnpm", ["build"]);
  const artifacts = join(root, "artifacts");
  const work = join(artifacts, ".work");
  rmSync(artifacts, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    const first = packOnce(join(work, "first"), workspace);
    const second = packOnce(join(work, "second"), workspace);
    const firstBytes = readFileSync(first);
    const secondBytes = readFileSync(second);
    if (!firstBytes.equals(secondBytes)) {
      throw new Error("plugin-spec archive is not byte-reproducible");
    }
    const { names } = verifyArchive(first, identity, workspace);
    verifyArchive(second, identity, workspace);

    const archiveName = basename(first);
    if (archiveName !== packageArchiveName(identity.packageName, identity.version)) {
      throw new Error(`unexpected archive name: ${archiveName}`);
    }
    const archiveDigest = sha256(first);
    const specManifestBytes = readFileSync(join(root, "packages/plugin-spec/spec.json"));
    const built = buildPlatformRelease({ commit, archiveName, archiveDigest, archiveSize: firstBytes.length, identity, manifestBytes: specManifestBytes });
    const { evidenceFiles, ...manifest } = built;
    const parsed = parseReleaseManifest(manifest);
    if (!parsed.ok) {
      throw new Error(`generated platform release is invalid:\n${parsed.errors.join("\n")}`);
    }

    const finalArchive = join(artifacts, archiveName);
    const manifestPath = join(artifacts, identity.manifest);
    copyFileSync(first, finalArchive);
    writeFileSync(join(artifacts, "spec.json"), specManifestBytes);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    for (const item of evidenceFiles) writeFileSync(join(artifacts, item.name), item.bytes);
    if (sha256(finalArchive) !== archiveDigest) {
      throw new Error("copied release archive digest changed");
    }
    return {
      archive: finalArchive,
      archiveDigest,
      entries: names.length,
      manifest: manifestPath,
      sourceCommit: commit,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = verifyRelease();
  console.log(JSON.stringify(result));
}
