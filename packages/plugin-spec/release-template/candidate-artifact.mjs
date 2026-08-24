import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { parseReleaseManifest } from "../dist/release.js";

const CANDIDATE_MANIFEST = "candidate-artifact.json";
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} has invalid fields`);
  }
  return value;
}

function regularDirectory(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error("candidate artifact directory must be absolute");
  }
  const directory = fs.realpathSync(value);
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("candidate artifact directory must be a regular directory");
  }
  return directory;
}

function regularFiles(directory) {
  const files = [];
  for (const name of fs.readdirSync(directory).sort()) {
    if (name === CANDIDATE_MANIFEST) continue;
    if (name.includes("/") || name === "." || name === "..") {
      throw new Error(`candidate artifact path is invalid: ${name}`);
    }
    const file = path.join(directory, name);
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || fs.realpathSync(file) !== file) {
      throw new Error(`candidate artifact contains a non-regular file: ${name}`);
    }
    const bytes = fs.readFileSync(file);
    files.push({ path: name, size: bytes.length, sha256: digest(bytes) });
  }
  return files;
}

function readJSON(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function releaseDocument(directory) {
  const raw = readJSON(path.join(directory, "release.json"), "candidate release manifest");
  const parsed = parseReleaseManifest(raw);
  if (!parsed.ok) throw new Error(`candidate release manifest is invalid: ${parsed.errors.join("; ")}`);
  return parsed.value;
}

function assetName(url, label) {
  let name;
  try {
    name = path.posix.basename(new URL(url).pathname);
  } catch {
    throw new Error(`${label} URL is invalid`);
  }
  if (!name || name === "." || name === "..") throw new Error(`${label} URL has no asset name`);
  return name;
}

function matchingFile(files, name, expected, label) {
  const found = files.find((file) => file.path === name);
  if (!found) throw new Error(`${label} is absent from candidate artifact: ${name}`);
  if (found.size !== expected.size || found.sha256 !== expected.sha256) {
    throw new Error(`${label} bytes differ from release manifest: ${name}`);
  }
  return found;
}

function uniqueSortedNames(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value === "" || path.basename(value) !== value)) {
    throw new Error(`${label} must contain flat relative file names`);
  }
  const sorted = [...values].sort();
  if (new Set(sorted).size !== sorted.length) throw new Error(`${label} contains duplicates`);
  return sorted;
}

function requiredFiles(release, files, buildEvidence) {
  const required = new Set(["release.json", ...buildEvidence]);
  const manifestName = assetName(release.manifest.url, "component manifest");
  matchingFile(files, manifestName, release.manifest, "component manifest");
  required.add(manifestName);
  for (const [index, artifact] of release.artifacts.entries()) {
    const name = assetName(artifact.url, `release artifact ${index}`);
    matchingFile(files, name, artifact, `release artifact ${index}`);
    required.add(name);
  }
  for (const [index, evidence] of release.evidence.entries()) {
    const name = assetName(evidence.url, `release evidence ${index}`);
    matchingFile(files, name, evidence, `release evidence ${index}`);
    required.add(name);
  }
  const actual = files.map((file) => file.path).sort();
  const expected = [...required].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`candidate artifact contains undeclared files: actual=${actual.join(",")} expected=${expected.join(",")}`);
  }
}

function verifyNodeBuildEvidence(directory, release, files, buildEvidence) {
  if (!buildEvidence.includes("candidate-build.json")) return;
  const build = exactKeys(readJSON(path.join(directory, "candidate-build.json"), "candidate build evidence"), [
    "archive", "dependencies", "generated", "kind", "packagePath", "sha256", "sourceCommit",
  ], "candidate build evidence");
  if (!COMMIT.test(build.sourceCommit) || build.sourceCommit !== release.source.commit) {
    throw new Error("candidate build source commit differs from release source");
  }
  if (typeof build.archive !== "string" || path.basename(build.archive) !== build.archive ||
      typeof build.sha256 !== "string" || !SHA256.test(build.sha256)) {
    throw new Error("candidate build archive identity is invalid");
  }
  const archive = files.find((file) => file.path === build.archive);
  if (!archive || archive.sha256 !== build.sha256 ||
      !release.artifacts.some((artifact) => assetName(artifact.url, "release artifact") === build.archive && artifact.sha256 === build.sha256)) {
    throw new Error("candidate build archive differs from release artifact");
  }
  if (!Array.isArray(build.dependencies) || build.dependencies.some((dependency) =>
    !dependency || typeof dependency !== "object" || Array.isArray(dependency) ||
    JSON.stringify(Object.keys(dependency).sort()) !== JSON.stringify(["name", "sha256"]) ||
    typeof dependency.name !== "string" || dependency.name === "" ||
    typeof dependency.sha256 !== "string" || !SHA256.test(dependency.sha256))) {
    throw new Error("candidate build dependency evidence is invalid");
  }
}

function fileReference(files, name) {
  const found = files.find((file) => file.path === name);
  if (!found) throw new Error(`candidate artifact file is missing: ${name}`);
  return found;
}

function manifestFromDirectory(directory, evidence) {
  const files = regularFiles(directory);
  const release = releaseDocument(directory);
  const automatic = fs.existsSync(path.join(directory, "candidate-build.json")) ? ["candidate-build.json"] : [];
  const buildEvidence = uniqueSortedNames([...automatic, ...evidence], "candidate build evidence");
  for (const name of buildEvidence) fileReference(files, name);
  requiredFiles(release, files, buildEvidence);
  verifyNodeBuildEvidence(directory, release, files, buildEvidence);
  return {
    schema: "soksak-candidate-artifact-v1",
    component: { kind: release.kind, id: release.id, version: release.version },
    source: release.source,
    release: fileReference(files, "release.json"),
    buildEvidence: buildEvidence.map((name) => fileReference(files, name)),
    files,
  };
}

function parseFileReference(value, label) {
  const file = exactKeys(value, ["path", "sha256", "size"], label);
  if (typeof file.path !== "string" || path.basename(file.path) !== file.path ||
      !Number.isSafeInteger(file.size) || file.size <= 0 ||
      typeof file.sha256 !== "string" || !SHA256.test(file.sha256)) {
    throw new Error(`${label} is invalid`);
  }
  return { path: file.path, size: file.size, sha256: file.sha256 };
}

function parseCandidateManifest(raw) {
  const manifest = exactKeys(raw, ["buildEvidence", "component", "files", "release", "schema", "source"], "candidate artifact manifest");
  if (manifest.schema !== "soksak-candidate-artifact-v1") throw new Error("candidate artifact schema is invalid");
  const component = exactKeys(manifest.component, ["id", "kind", "version"], "candidate artifact component");
  const source = exactKeys(manifest.source, ["commit", "repository"], "candidate artifact source");
  if (!COMMIT.test(source.commit) || typeof source.repository !== "string" || source.repository === "") {
    throw new Error("candidate artifact source is invalid");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0 || !Array.isArray(manifest.buildEvidence)) {
    throw new Error("candidate artifact file inventory is invalid");
  }
  const files = manifest.files.map((file, index) => parseFileReference(file, `candidate artifact files[${index}]`));
  if (JSON.stringify(files.map((file) => file.path)) !== JSON.stringify([...files.map((file) => file.path)].sort()) ||
      new Set(files.map((file) => file.path)).size !== files.length) {
    throw new Error("candidate artifact files must be sorted and unique");
  }
  const buildEvidence = manifest.buildEvidence.map((file, index) => parseFileReference(file, `candidate artifact buildEvidence[${index}]`));
  return {
    schema: manifest.schema,
    component: { kind: component.kind, id: component.id, version: component.version },
    source: { repository: source.repository, commit: source.commit },
    release: parseFileReference(manifest.release, "candidate artifact release"),
    buildEvidence,
    files,
  };
}

export function sealCandidateArtifact({ directory: value, evidence = [] }) {
  const directory = regularDirectory(value);
  const manifest = manifestFromDirectory(directory, evidence);
  fs.writeFileSync(path.join(directory, CANDIDATE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return verifyCandidateArtifact({ directory });
}

export function verifyCandidateArtifact({ directory: value }) {
  const directory = regularDirectory(value);
  const manifest = parseCandidateManifest(readJSON(path.join(directory, CANDIDATE_MANIFEST), "candidate artifact manifest"));
  const actual = regularFiles(directory);
  if (JSON.stringify(actual.map((file) => file.path)) !== JSON.stringify(manifest.files.map((file) => file.path))) {
    throw new Error("candidate artifact inventory mismatch");
  }
  for (const expected of manifest.files) {
    const found = actual.find((file) => file.path === expected.path);
    if (!found || found.size !== expected.size || found.sha256 !== expected.sha256) {
      throw new Error(`candidate artifact file digest mismatch: ${expected.path}`);
    }
  }
  const release = releaseDocument(directory);
  if (release.kind !== manifest.component.kind || release.id !== manifest.component.id ||
      release.version !== manifest.component.version || release.source.repository !== manifest.source.repository ||
      release.source.commit !== manifest.source.commit) {
    throw new Error("candidate artifact identity differs from release manifest");
  }
  if (JSON.stringify(fileReference(actual, "release.json")) !== JSON.stringify(manifest.release)) {
    throw new Error("candidate artifact release reference mismatch");
  }
  const evidenceNames = manifest.buildEvidence.map((file) => file.path);
  requiredFiles(release, actual, evidenceNames);
  verifyNodeBuildEvidence(directory, release, actual, evidenceNames);
  return manifest;
}

export function createCandidateInputReceipt({
  directory: value,
  artifactName,
  artifactDigest,
  candidateManifestSHA256,
}) {
  const directory = regularDirectory(value);
  if (typeof artifactName !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(artifactName) ||
      typeof artifactDigest !== "string" || !SHA256.test(artifactDigest) ||
      typeof candidateManifestSHA256 !== "string" || !SHA256.test(candidateManifestSHA256)) {
    throw new Error("candidate input artifact identity is invalid");
  }
  const manifestFile = path.join(directory, CANDIDATE_MANIFEST);
  const actualManifestDigest = digest(fs.readFileSync(manifestFile));
  if (actualManifestDigest !== candidateManifestSHA256) {
    throw new Error("candidate manifest digest mismatch");
  }
  const manifest = verifyCandidateArtifact({ directory });
  return {
    schema: "soksak-candidate-input-receipt-v1",
    artifact: {
      name: artifactName,
      sha256: artifactDigest,
      candidateManifestSHA256,
    },
    component: manifest.component,
    source: manifest.source,
  };
}

export function prepareCandidatePackageInput({
  directory: value,
  artifactName,
  artifactDigest,
  candidateManifestSHA256,
  sourceCommit,
  kind,
  packageName,
}) {
  const directory = regularDirectory(value);
  const receipt = createCandidateInputReceipt({
    directory, artifactName, artifactDigest, candidateManifestSHA256,
  });
  if (!COMMIT.test(sourceCommit) || receipt.source.commit !== sourceCommit) {
    throw new Error("candidate package source commit mismatch");
  }
  if (!(["contract", "kit", "plugin"].includes(kind)) || receipt.component.kind !== kind) {
    throw new Error("candidate package kind mismatch");
  }
  const expectedPackage = `@soksak/${receipt.component.id}`;
  if (packageName !== expectedPackage) {
    throw new Error(`candidate package name mismatch: expected ${expectedPackage}`);
  }
  const release = releaseDocument(directory);
  const candidates = release.artifacts.filter((artifact) => artifact.target === "any");
  if (candidates.length !== 1) throw new Error("candidate package requires one any artifact");
  const artifact = candidates[0];
  const name = assetName(artifact.url, "candidate package artifact");
  const file = path.join(directory, name);
  const bytes = fs.readFileSync(file);
  if (bytes.length !== artifact.size || digest(bytes) !== artifact.sha256) {
    throw new Error("candidate package artifact digest mismatch");
  }
  return {
    receipt,
    dependency: { name: packageName, artifact: file, sha256: artifact.sha256 },
  };
}
