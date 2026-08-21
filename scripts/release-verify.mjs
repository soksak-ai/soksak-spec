#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
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
import { parseSpecReleaseManifest, SPEC_RELEASE_SPEC } from "./spec-release.mjs";
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
    release.kind !== "spec" ||
    typeof release.id !== "string" || !/^soksak-[a-z0-9-]+$/.test(release.id) ||
    typeof release.repository !== "string" ||
    typeof release.manifest !== "string" || release.manifest !== `${release.id}-release.json`
  ) {
    throw new Error("workspace soksakRelease metadata is invalid");
  }
  const version = strictSemver(workspace.version, "workspace.version");
  if (pluginSpec?.version !== version || typeof pluginSpec?.name !== "string") {
    throw new Error("workspace and plugin-spec versions must both equal the same SemVer");
  }
  return {
    kind: release.kind,
    id: release.id,
    repository: release.repository,
    manifest: release.manifest,
    version,
    packageName: pluginSpec.name,
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

function packOnce(destination) {
  mkdirSync(destination, { recursive: true });
  run("pnpm", [
    "--filter",
    "@soksak-ai/plugin-spec",
    "pack",
    "--pack-destination",
    destination,
  ]);
  const archives = readdirSync(destination).filter((name) => name.endsWith(".tgz"));
  if (archives.length !== 1) {
    throw new Error(`expected one plugin-spec archive, found: ${archives.join(", ")}`);
  }
  return join(destination, archives[0]);
}

function verifyArchive(path, identity) {
  const verbose = run("tar", ["-tvzf", path]).split("\n").filter(Boolean);
  const names = run("tar", ["-tzf", path]).split("\n").filter(Boolean);
  validateArchiveEntries(verbose, names);
  const packed = JSON.parse(run("tar", ["-xOzf", path, "package/package.json"]));
  if (
    packed.name !== identity.packageName ||
    packed.version !== identity.version ||
    packed.private !== true ||
    packed.publishConfig !== undefined
  ) {
    throw new Error("packed plugin-spec identity, version, or publication policy is invalid");
  }
  return { names, packed };
}

export function buildPlatformRelease({ commit, archiveName, archiveDigest, identity }) {
  const version = strictSemver(identity?.version, "release identity version");
  const releaseTag = `${identity.id}-v${version}`;
  return {
    spec: SPEC_RELEASE_SPEC,
    kind: identity.kind,
    id: identity.id,
    version,
    source: { repository: identity.repository, commit },
    releaseTag,
    dependencies: [],
    packages: [
      {
        ecosystem: "javascript",
        name: identity.packageName,
        version,
        artifact: {
          url: `${identity.repository}/releases/download/${releaseTag}/${archiveName}`,
          sha256: archiveDigest,
          format: "tgz",
        },
      },
      ...RUST_CRATES.map((name) => ({ ecosystem: "rust", name, version })),
    ],
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
    const first = packOnce(join(work, "first"));
    const second = packOnce(join(work, "second"));
    const firstBytes = readFileSync(first);
    const secondBytes = readFileSync(second);
    if (!firstBytes.equals(secondBytes)) {
      throw new Error("plugin-spec archive is not byte-reproducible");
    }
    const { names } = verifyArchive(first, identity);
    verifyArchive(second, identity);

    const archiveName = basename(first);
    if (archiveName !== packageArchiveName(identity.packageName, identity.version)) {
      throw new Error(`unexpected archive name: ${archiveName}`);
    }
    const archiveDigest = sha256(first);
    const manifest = buildPlatformRelease({ commit, archiveName, archiveDigest, identity });
    const parsed = parseSpecReleaseManifest(manifest);
    if (!parsed.ok) {
      throw new Error(`generated platform release is invalid:\n${parsed.errors.join("\n")}`);
    }

    const finalArchive = join(artifacts, archiveName);
    const manifestPath = join(artifacts, identity.manifest);
    copyFileSync(first, finalArchive);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
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
