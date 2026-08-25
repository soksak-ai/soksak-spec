#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

import { createRegularFileArchive, readRegularFileArchive, sha256 } from "./archive.mjs";
import { assertNoLocalPackageDependencies } from "./package-dependencies.mjs";
import { assertNoLocalCargoDependencies } from "./cargo-dependencies.mjs";
import { COMPONENT_ID_RE, GITHUB_ORG, RELEASE_FILE_RE, STRICT_SEMVER_RE } from "../dist/release-primitives.js";
import { parseConformanceReport } from "../dist/conformanceWire.js";
import { parseReleaseManifest } from "../dist/release.js";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function discoverRoot() {
  let directory = path.resolve(process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(directory, "release-files.json"))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error("portable component root not found");
    directory = parent;
  }
}

function exactIdentity(root) {
  const manifests = ["contract", "kit"].filter((kind) => fs.existsSync(path.join(root, `${kind}.json`)));
  if (manifests.length !== 1) throw new Error("exactly one contract.json or kit.json is required");
  const kind = manifests[0];
  const manifestName = `${kind}.json`;
  const raw = JSON.parse(fs.readFileSync(path.join(root, manifestName), "utf8"));
  if (
    !raw || typeof raw !== "object" || Array.isArray(raw) ||
    JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify(["id", "version"]) ||
    typeof raw.id !== "string" || !COMPONENT_ID_RE.test(raw.id) ||
    typeof raw.version !== "string" || !STRICT_SEMVER_RE.test(raw.version)
  ) throw new Error(`${manifestName} has an invalid exact identity`);
  return { kind, manifestName, id: raw.id, version: raw.version };
}

const root = discoverRoot();
const commit = option("--commit");
const out = path.resolve(option("--out") ?? path.join(root, "dist-release"));
if (!/^[a-f0-9]{40}$/.test(commit ?? "")) throw new Error("--commit must be an exact lowercase 40-character Git commit SHA");
if (fs.existsSync(out) && fs.readdirSync(out).length !== 0) throw new Error("release output directory must be empty");
fs.mkdirSync(out, { recursive: true });

const identity = exactIdentity(root);
const repository = `https://github.com/${GITHUB_ORG}/${identity.id}`;
const hasJavaScript = fs.existsSync(path.join(root, "package.json"));
const hasCargo = fs.existsSync(path.join(root, "Cargo.toml"));
if (hasJavaScript === hasCargo) throw new Error("exactly one package.json or Cargo.toml is required");
if (hasJavaScript) {
  assertNoLocalPackageDependencies(path.join(root, "package.json"));
  const packageMetadata = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (packageMetadata.private !== true || packageMetadata.version !== identity.version) {
    throw new Error("private package version must equal portable component version");
  }
  if (packageMetadata.name !== `@soksak/${identity.id}`) throw new Error("package name must equal portable component id");
  if (packageMetadata.publishConfig !== undefined || Object.keys(packageMetadata.scripts ?? {}).some((name) => /publish/i.test(name))) {
    throw new Error("language-registry publication is forbidden");
  }
  if (packageMetadata.repository?.url !== `git+${repository}.git`) throw new Error("package repository does not equal portable component repository");
} else {
  assertNoLocalCargoDependencies(root);
  const cargo = fs.readFileSync(path.join(root, "Cargo.toml"), "utf8");
  const field = (name) => {
    const matches = [...cargo.matchAll(new RegExp(`^${name}\\s*=\\s*\"([^\"]+)\"$`, "gm"))];
    if (matches.length !== 1) throw new Error(`Cargo.toml must declare one package ${name}`);
    return matches[0][1];
  };
  if (field("name") !== identity.id || field("version") !== identity.version || field("repository") !== repository) {
    throw new Error("Cargo package identity does not equal portable component identity");
  }
  if (!/^publish\s*=\s*false$/m.test(cargo)) throw new Error("Cargo registry publication is forbidden");
}

const files = JSON.parse(fs.readFileSync(path.join(root, "release-files.json"), "utf8"));
if (!Array.isArray(files) || files.length === 0 || new Set(files).size !== files.length) throw new Error("release-files.json must declare unique files");
for (const required of ["LICENSE", identity.manifestName]) {
  if (!files.includes(required)) throw new Error(`release-files.json must include ${required}`);
}
if (hasJavaScript && !files.includes("package.json")) {
  throw new Error("JavaScript portable releases must include package.json");
}
if (hasJavaScript) {
  const packageMetadata = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const exportTargets = (value) => {
    if (typeof value === "string") return [value];
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    return Object.values(value).flatMap(exportTargets);
  };
  const exported = exportTargets(packageMetadata.exports?.["."]);
  if (exported.length === 0 || exported.some((target) => !target.startsWith("./") || !files.includes(target.slice(2)))) {
    throw new Error("JavaScript portable release export must name a declared file");
  }
}
const prefix = hasJavaScript ? "package/" : "";
const archive = createRegularFileArchive({ root, files, prefix });
const archived = readRegularFileArchive(archive);
if (JSON.stringify(archived.map(({ name }) => name)) !== JSON.stringify(files.map((name) => `${prefix}${name}`).sort())) {
  throw new Error("release archive inventory diverges from declared files");
}
const archivedManifest = archived.find(({ name }) => name === `${prefix}${identity.manifestName}`);
if (!archivedManifest || !archivedManifest.data.equals(fs.readFileSync(path.join(root, identity.manifestName)))) {
  throw new Error("archived component manifest differs from source");
}

const digest = sha256(archive);
const archiveName = `${identity.id}-${identity.version}-any.tgz`;
const artifact = {
  target: "any", file: archiveName,
  sha256: digest, size: archive.length, format: "tgz", manifest: identity.manifestName,
};
const subject = { [identity.kind]: { id: identity.id, version: identity.version } };
const report = (claim) => ({
  subject, claim, result: "passed",
  validator: { name: "soksak-conformance", version: identity.version },
  artifacts: [{ target: "any", sha256: digest }],
});
const evidenceFiles = [
  ["conformance-manifest.json", report({ manifest: true })],
  ["conformance-release.json", report({ release: true })],
].map(([name, value]) => {
  if (!parseConformanceReport(value).ok) throw new Error(`${name} is invalid`);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  return { name, bytes, reference: { file: name, size: bytes.length, sha256: sha256(bytes) } };
});
const release = {
  kind: identity.kind, id: identity.id, version: identity.version,
  manifest: { file: identity.manifestName, size: archivedManifest.data.length, sha256: sha256(archivedManifest.data) },
  source: { repository, commit }, artifacts: [artifact], evidence: evidenceFiles.map(({ reference }) => reference),
};
// Every emitted file name satisfies the release file grammar before any byte is written.
const outputs = [
  [archiveName, archive],
  [identity.manifestName, archivedManifest.data],
  ["release.json", Buffer.from(`${JSON.stringify(release, null, 2)}\n`)],
  ...evidenceFiles.map(({ name, bytes }) => [name, bytes]),
];
for (const [name] of outputs) {
  if (!RELEASE_FILE_RE.test(name)) throw new Error(`release file name is invalid: ${name}`);
}
if (!parseReleaseManifest(release).ok) throw new Error("generated release manifest is invalid");

for (const [name, bytes] of outputs) fs.writeFileSync(path.join(out, name), bytes);
process.stdout.write(`${JSON.stringify({ archive: archiveName, sha256: digest })}\n`);
