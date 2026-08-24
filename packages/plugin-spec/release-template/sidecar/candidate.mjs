import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { parseReleaseManifest } from "../../dist/release.js";
import { parseSidecarManifest as parsePublicSidecarManifest } from "../../dist/sidecar.js";
import { assertNativeBinaryTarget } from "./native-binary.mjs";
import { readSidecarReleaseArchive } from "./archive.mjs";

const TARGET = /^(?:aarch64|x86_64)-(?:apple-darwin|pc-windows-msvc|unknown-linux-(?:gnu|musl))$/;
const COMMIT = /^[0-9a-f]{40}$/;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function regularDirectory(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error(`${label} must be absolute`);
  const directory = fs.realpathSync(value);
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} must be a regular directory`);
  return directory;
}

function emptyDirectory(value, label) {
  const directory = regularDirectory(value, label);
  if (fs.readdirSync(directory).length !== 0) throw new Error(`${label} must be empty`);
  return directory;
}

function regularFile(file, label) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || fs.realpathSync(file) !== file) {
    throw new Error(`${label} must be a regular file with no symbolic path`);
  }
  return fs.readFileSync(file);
}

function copyTree(source, output) {
  fs.mkdirSync(output, { recursive: true });
  for (const name of fs.readdirSync(source).sort()) {
    const from = path.join(source, name);
    const to = path.join(output, name);
    const info = fs.lstatSync(from);
    if (info.isSymbolicLink()) throw new Error(`candidate stage contains a symbolic link: ${from}`);
    if (info.isDirectory()) copyTree(from, to);
    else if (info.isFile() && fs.realpathSync(from) === from) fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    else throw new Error(`candidate stage contains a non-regular entry: ${from}`);
  }
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function parseSidecarManifest(raw, label) {
  const parsed = parsePublicSidecarManifest(raw);
  if (!parsed.ok) throw new Error(`${label} is invalid: ${parsed.errors.join("; ")}`);
  return parsed.value;
}

function write(output, name, bytes) {
  fs.writeFileSync(path.join(output, name), bytes, { flag: "wx", mode: 0o644 });
}

export function stageSidecarCandidatePackage({ source: sourceValue, stage: stageValue, target, output: outputValue }) {
  if (!TARGET.test(target ?? "")) throw new Error(`unsupported sidecar candidate target: ${target}`);
  const source = regularDirectory(sourceValue, "sidecar source");
  const stage = regularDirectory(stageValue, "sidecar owner stage");
  const output = emptyDirectory(outputValue, "sidecar candidate package");
  if (source === stage || source === output || stage === output) throw new Error("sidecar candidate directories must be distinct");

  const sourceManifest = parseSidecarManifest(JSON.parse(regularFile(path.join(source, "sidecar.json"), "source sidecar manifest").toString("utf8")), "source sidecar manifest");
  const stagedManifestBytes = regularFile(path.join(stage, "sidecar.json"), "staged sidecar manifest");
  const stagedManifest = parseSidecarManifest(JSON.parse(stagedManifestBytes.toString("utf8")), "staged sidecar manifest");
  const expectedProcess = `dist/${sourceManifest.id}${target.includes("windows") ? ".exe" : ""}`;
  if (stagedManifest.id !== sourceManifest.id || stagedManifest.version !== sourceManifest.version ||
      JSON.stringify(stagedManifest.interface) !== JSON.stringify(sourceManifest.interface) ||
      stagedManifest.process !== expectedProcess) {
    throw new Error("staged sidecar identity differs from source or target");
  }
  const stagedProcess = path.join(stage, path.basename(expectedProcess));
  assertNativeBinaryTarget(regularFile(stagedProcess, "staged sidecar process"), target);

  write(output, "sidecar.json", stagedManifestBytes);
  const runtime = path.join(output, "dist");
  fs.mkdirSync(runtime);
  for (const name of fs.readdirSync(stage).sort()) {
    if (name === "sidecar.json") continue;
    const from = path.join(stage, name);
    const to = path.join(runtime, name);
    const info = fs.lstatSync(from);
    if (info.isSymbolicLink()) throw new Error(`candidate stage contains a symbolic link: ${from}`);
    if (info.isDirectory()) copyTree(from, to);
    else if (info.isFile() && fs.realpathSync(from) === from) fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    else throw new Error(`candidate stage contains a non-regular entry: ${from}`);
  }

  const licenseNames = fs.readdirSync(source).filter((name) =>
    name === "LICENSE" || name.startsWith("LICENSE.") || name === "THIRD-PARTY-NOTICES").sort();
  if (licenseNames.length === 0) throw new Error("sidecar candidate has no source license");
  for (const name of licenseNames) write(output, name, regularFile(path.join(source, name), `source ${name}`));

  const dependencyRoot = path.join(source, "target", "build-dependencies");
  const receipts = [];
  if (fs.existsSync(dependencyRoot)) {
    for (const dependency of fs.readdirSync(dependencyRoot).sort()) {
      const receipt = path.join(dependencyRoot, dependency, "receipts", `${target}.json`);
      if (!fs.existsSync(receipt)) continue;
      const receiptOutput = path.join(output, "build-dependency-receipts");
      fs.mkdirSync(receiptOutput, { recursive: true });
      write(receiptOutput, `${dependency}.json`, regularFile(receipt, `build receipt ${dependency}`));
      receipts.push(dependency);
    }
  }
  return { id: sourceManifest.id, version: sourceManifest.version, target, receipts };
}

export function buildSidecarCandidate({ source: sourceValue, sourceCommit, target, artifact: artifactValue, output: outputValue }) {
  if (!COMMIT.test(sourceCommit ?? "") || !TARGET.test(target ?? "")) {
    throw new Error("sidecar candidate source commit or target is invalid");
  }
  const source = regularDirectory(sourceValue, "sidecar source");
  const output = emptyDirectory(outputValue, "sidecar candidate output");
  const sourceManifest = parseSidecarManifest(JSON.parse(regularFile(path.join(source, "sidecar.json"), "source sidecar manifest").toString("utf8")), "source sidecar manifest");
  const artifact = path.resolve(artifactValue);
  const archiveName = `${sourceManifest.id}-${sourceManifest.version}-${target}.tar.gz`;
  if (path.basename(artifact) !== archiveName) throw new Error(`sidecar candidate archive must be named ${archiveName}`);
  const archive = regularFile(artifact, "sidecar candidate archive");
  const entries = readSidecarReleaseArchive(archive);
  const manifestEntry = entries.find((entry) => entry.name === "sidecar.json");
  if (!manifestEntry) throw new Error("sidecar candidate archive has no manifest");
  const manifest = parseSidecarManifest(JSON.parse(manifestEntry.data.toString("utf8")), "archived sidecar manifest");
  const expectedProcess = `dist/${sourceManifest.id}${target.includes("windows") ? ".exe" : ""}`;
  if (manifest.id !== sourceManifest.id || manifest.version !== sourceManifest.version ||
      JSON.stringify(manifest.interface) !== JSON.stringify(sourceManifest.interface) || manifest.process !== expectedProcess) {
    throw new Error("sidecar candidate archive identity differs from source or target");
  }
  const process = entries.find((entry) => entry.name === expectedProcess);
  if (!process) throw new Error("sidecar candidate archive has no declared process");
  assertNativeBinaryTarget(process.data, target);

  const repository = `https://github.com/soksak-ai/${manifest.id}`;
  const tag = `v${manifest.version}`;
  const archiveDigest = sha256(archive);
  const artifactReference = {
    target,
    url: `${repository}/releases/download/${tag}/${archiveName}`,
    sha256: archiveDigest,
    size: archive.length,
    format: "tar.gz",
    manifest: "sidecar.json",
  };
  const report = (claim) => ({
    subject: { sidecar: { id: manifest.id, version: manifest.version } },
    claim,
    result: "passed",
    validator: { name: "soksak-validate", version: manifest.version },
    artifacts: [{ target, sha256: archiveDigest }],
  });
  const evidence = [
    ["conformance-interface.json", report({ contract: manifest.interface })],
    ["conformance-release.json", report({ release: true })],
    ["conformance-sidecar.json", report({ manifest: true })],
  ].map(([name, value]) => {
    const bytes = jsonBytes(value);
    return { name, bytes, reference: { url: `${repository}/releases/download/${tag}/${name}`, size: bytes.length, sha256: sha256(bytes) } };
  });
  const manifestBytes = manifestEntry.data;
  const release = {
    kind: "sidecar",
    id: manifest.id,
    version: manifest.version,
    manifest: { url: `${repository}/releases/download/${tag}/sidecar.json`, size: manifestBytes.length, sha256: sha256(manifestBytes) },
    source: { repository, commit: sourceCommit },
    artifacts: [artifactReference],
    evidence: evidence.map(({ reference }) => reference),
  };
  const parsed = parseReleaseManifest(release);
  if (!parsed.ok) throw new Error(`sidecar candidate release is invalid: ${parsed.errors.join("; ")}`);
  fs.copyFileSync(artifact, path.join(output, archiveName), fs.constants.COPYFILE_EXCL);
  write(output, "sidecar.json", manifestBytes);
  write(output, "release.json", jsonBytes(release));
  for (const item of evidence) write(output, item.name, item.bytes);
  const result = { sourceCommit, target, archive: archiveName, sha256: archiveDigest, size: archive.length };
  write(output, "sidecar-candidate-build.json", jsonBytes(result));
  return result;
}
