#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  ID, INTERFACE, REPOSITORY, SIDECAR, TAG, VERSION,
  assertBaseline, assertCommit, assertNativeBinaryTarget, assertNoLinkPath, assertTag, ensureEmptyDirectory, jsonBytes,
  parseOptions, readRegularFile, readSidecarReleaseArchive, readTargetMatrix, releaseAssetName, releaseIdentity, sha256, writeRegularFile,
} from "./release-contract.mjs";

// --emit-summary is an additive boolean flag: the core release.build handler passes it to read the
// manifest + per-target digests off stdout instead of re-hashing in TS. Stripped before the strict
// --name value parser; without it stdout stays silent. The sidecar root is discovered by release-contract,
// so no repository-root argument is carried here.
const rawArgs = process.argv.slice(2);
const emitSummary = rawArgs.includes("--emit-summary");
const options = parseOptions(rawArgs.filter((arg) => arg !== "--emit-summary"), ["commit", "tag", "artifacts", "out"]);
assertBaseline();
assertCommit(options.commit);
assertTag(options.tag);
const artifactsDir = assertNoLinkPath(options.artifacts, "directory");
const out = ensureEmptyDirectory(options.out);
const expectedNames = [];
const artifacts = readTargetMatrix().map(({ target }) => {
  const asset = releaseAssetName(target);
  const checksumName = `${asset}.sha256`;
  expectedNames.push(asset, checksumName);
  const bytes = readRegularFile(path.join(artifactsDir, asset));
  const digest = sha256(bytes);
  const archived = readSidecarReleaseArchive(bytes);
  const archivedManifest = archived.find((entry) => entry.name === "sidecar.json");
  if (!archivedManifest) throw new Error(`${asset}: archive has no sidecar.json`);
  const manifest = JSON.parse(archivedManifest.data.toString("utf8"));
  const process = `dist/${ID}${target.includes("windows") ? ".exe" : ""}`;
  if (
    manifest.id !== ID || manifest.version !== VERSION ||
    JSON.stringify(manifest.interface) !== JSON.stringify(INTERFACE) || manifest.process !== process
  ) throw new Error(`${asset}: archive sidecar manifest differs from the release identity`);
  const archivedProcess = archived.find((entry) => entry.name === process);
  if (!archivedProcess) throw new Error(`${asset}: archive has no declared sidecar process`);
  assertNativeBinaryTarget(archivedProcess.data, target);
  // The .sha256 sidecar asset ships alongside the archive; it must state exactly
  // the digest of these archive bytes ("<hex>  <asset>", sha256sum/shasum shape).
  const stated = readRegularFile(path.join(artifactsDir, checksumName)).toString("utf8").trim()
    .match(/^([0-9a-f]{64})\s+\*?(\S+)$/);
  if (!stated || stated[1] !== digest || stated[2] !== asset) {
    throw new Error(`${checksumName}: must state the exact digest of ${asset}`);
  }
  return {
    target,
    url: `${REPOSITORY}/releases/download/${TAG}/${asset}`,
    sha256: digest,
    size: bytes.length,
    format: "tar.gz",
    manifest: "sidecar.json",
  };
});
const actualNames = fs.readdirSync(artifactsDir).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
expectedNames.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) throw new Error("artifact directory must contain exactly the declared release matrix");

const evidence = artifacts.map(({ target, sha256: digest }) => ({ target, sha256: digest }));
const report = (claim) => ({
  subject: { sidecar: { id: ID, version: VERSION } },
  claim,
  result: "passed",
  validator: { name: "soksak-validate", version: VERSION },
  artifacts: evidence,
});
const evidenceFiles = [
  ["conformance-interface.json", report({ contract: INTERFACE })],
  ["conformance-release.json", report({ release: true })],
  ["conformance-sidecar.json", report({ manifest: true })],
].map(([name, value]) => {
  const bytes = jsonBytes(value);
  return { name, bytes, reference: { url: `${REPOSITORY}/releases/download/${TAG}/${name}`, size: bytes.length, sha256: sha256(bytes) } };
});
const manifestBytes = jsonBytes(SIDECAR);
const release = {
  ...releaseIdentity(options.commit),
  manifest: { url: `${REPOSITORY}/releases/download/${TAG}/sidecar.json`, size: manifestBytes.length, sha256: sha256(manifestBytes) },
  artifacts,
  evidence: evidenceFiles.map(({ reference }) => reference),
};
const releaseBytes = jsonBytes(release);
writeRegularFile(path.join(out, "sidecar.json"), manifestBytes);
writeRegularFile(path.join(out, "release.json"), releaseBytes);
for (const item of evidenceFiles) writeRegularFile(path.join(out, item.name), item.bytes);

// The one machine-readable line — a sentinel prefix so the caller extracts it regardless of any
// other output. Carries exactly what the handler would otherwise re-derive from the written files.
if (emitSummary) {
  process.stdout.write(`@@RELEASE_SUMMARY@@ ${JSON.stringify({ releaseJson: release, matrix: artifacts })}\n`);
}
