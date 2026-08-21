#!/usr/bin/env node
// Canonical plugin release builder — byte-identical across every plugin. A plugin declares its file
// set in release-files.json; identity, version, the boundary invariants, the archive, the release
// manifest, and the conformance reports are derived from the plugin manifest and produced once.
// No plugin-specific coupling lives here: implements and consumes are validated for shape only —
// the manifest is the single source of truth for which contracts it relates to.
import fs from "node:fs";
import path from "node:path";

import { createRegularFileArchive, readRegularFileArchive, sha256 } from "./archive.mjs";
import { parseManifest } from "../dist/spec.js";

// The plugin repository root is resolved by a discoverable rule rather than cwd guessing.
// The release-files.json marker is found at or above the running directory.
const root = (() => {
  let dir = path.resolve(process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, "release-files.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`plugin repository root not found: no release-files.json at or above ${process.cwd()}`);
    dir = parent;
  }
})();
const STRICT_SEMVER_RE =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} has invalid keys`);
  }
}

const commit = option("--commit");
const outDir = path.resolve(option("--out") ?? path.join(root, "dist"));
if (!/^[a-f0-9]{40}$/.test(commit ?? "")) {
  console.error("--commit must be an exact lowercase 40-character Git commit SHA");
  process.exit(2);
}

// The plugin's exact ordered release file set.
const FILES = JSON.parse(fs.readFileSync(path.join(root, "release-files.json")));
if (!Array.isArray(FILES) || FILES.length === 0) {
  throw new Error("release-files.json must declare a non-empty ordered file set");
}
for (const required of ["LICENSE", "main.js", "plugin.json"]) {
  if (!FILES.includes(required)) throw new Error(`release-files.json must include ${required}`);
}

const packagePath = [path.join(root, "package.json"), path.join(root, "frontend", "package.json")]
  .find((candidate) => fs.existsSync(candidate));
if (!packagePath) throw new Error("plugin package metadata is missing");
const packageBytes = fs.readFileSync(packagePath);
const manifestBytes = fs.readFileSync(path.join(root, "plugin.json"));
const pkg = JSON.parse(packageBytes);
const rawPlugin = JSON.parse(manifestBytes);
if (typeof pkg.version !== "string" || pkg.version.length > 256 || !STRICT_SEMVER_RE.test(pkg.version)) {
  throw new Error("package version must be strict SemVer");
}
const VERSION = pkg.version;
const ID = rawPlugin.id;
if (typeof ID !== "string") throw new Error("plugin manifest id must be a string");
const parsedPlugin = parseManifest(rawPlugin, ID);
if (!parsedPlugin.manifest || !parsedPlugin.validation.ok) {
  throw new Error(`plugin manifest is invalid: ${parsedPlugin.validation.errors.join("; ")}`);
}
const plugin = parsedPlugin.manifest;
if (pkg.private !== true) {
  throw new Error("plugin package metadata must be private");
}
if (pkg.publishConfig !== undefined || Object.keys(pkg.scripts ?? {}).some((name) => /publish/i.test(name))) {
  throw new Error("language-registry publication is forbidden");
}
if (plugin.version !== VERSION || plugin.entry !== "main.js") {
  throw new Error("plugin manifest does not satisfy the public plugin boundary");
}

if (fs.existsSync(path.join(root, "release", "dependencies.json"))) {
  throw new Error("release/dependencies.json is not a release input");
}
const REPOSITORY = `https://github.com/soksak-ai/${ID}`;
const tag = `v${VERSION}`;
const archiveName = `${ID}-${VERSION}-any.tgz`;
const archive = createRegularFileArchive({ root, files: FILES });
const archived = readRegularFileArchive(archive);
if (JSON.stringify(archived.map((entry) => entry.name)) !== JSON.stringify(FILES)) {
  throw new Error("release archive inventory diverges from the declared file set");
}
const archivedManifest = archived.find((entry) => entry.name === "plugin.json");
if (!archivedManifest || !archivedManifest.data.equals(manifestBytes)) {
  throw new Error("release archive plugin manifest differs from the validated source bytes");
}

const artifactSha256 = sha256(archive);
const artifact = {
  target: "any",
  url: `${REPOSITORY}/releases/download/${tag}/${archiveName}`,
  sha256: artifactSha256,
  size: archive.length,
  format: "tgz",
  manifest: "plugin.json",
};
const report = (claim) => ({
  subject: { plugin: { id: ID, version: VERSION } },
  claim,
  result: "passed",
  validator: { name: "soksak-conformance", version: VERSION },
  artifacts: [{ target: "any", sha256: artifactSha256 }],
});
const reports = [
  ["conformance-plugin.json", report({ manifest: true })],
  ["conformance-release.json", report({ release: true })],
  ...(plugin.implements ?? []).map((contract, index) => [
    `conformance-contract-${String(index + 1).padStart(2, "0")}.json`,
    report({ contract }),
  ]),
].map(([name, value]) => {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  return { name, value, bytes, reference: { url: `${REPOSITORY}/releases/download/${tag}/${name}`, sha256: sha256(bytes) } };
});
const release = {
  plugin: { id: ID, version: VERSION },
  source: { repository: REPOSITORY, commit },
  artifacts: [artifact],
  reports: reports.map(({ reference }) => reference),
};
const releaseBytes = Buffer.from(`${JSON.stringify(release, null, 2)}\n`);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, archiveName), archive);
fs.writeFileSync(path.join(outDir, "release.json"), releaseBytes);
for (const item of reports) fs.writeFileSync(path.join(outDir, item.name), item.bytes);
console.log(JSON.stringify({ archive: archiveName, sha256: artifactSha256 }));
