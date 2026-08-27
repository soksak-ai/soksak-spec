import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { collectReleaseAssets } from "./publish-release.mjs";

const repository = "soksak-ai/soksak-spec";
const commit = "a".repeat(40);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixture() {
  const version = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")).version;
  const directory = mkdtempSync(join(tmpdir(), "soksak-spec-publish-"));
  const archiveName = `soksak-soksak-spec-${version}.tgz`;
  const archive = Buffer.from(`spec-${version}`);
  const tag = `v${version}`;
  const manifestName = "release.json";
  const specManifest = Buffer.from('{}\n');
  writeFileSync(join(directory, "spec.json"), specManifest);
  const evidence = ["conformance-manifest.json", "conformance-release.json"].map((name) => {
    const bytes = Buffer.from(name);
    writeFileSync(join(directory, name), bytes);
    return { file: name, size: bytes.length, sha256: sha256(bytes) };
  });
  // release.json names every file by bare name; the tag is derived from the version.
  const manifest = {
    kind: "spec", id: "soksak-spec", version,
    manifest: { file: "spec.json", size: specManifest.length, sha256: sha256(specManifest) },
    source: { repository: `https://github.com/${repository}`, commit },
    artifacts: [{ target: "any", file: archiveName, size: archive.length, sha256: sha256(archive), format: "tgz", manifest: "spec.json" }],
    evidence,
  };
  const receipt = Buffer.from(`${JSON.stringify({
    schema: "soksak-component-build-receipt-v1",
    subject: { kind: manifest.kind, id: manifest.id, version: manifest.version },
    source: manifest.source,
    manifest: manifest.manifest,
    spec: { kind: "spec", id: "soksak-spec", version: "0.0.36", target: "any", file: "soksak-soksak-spec-0.0.36.tgz", size: 133017, sha256: "e".repeat(64) },
    tooling: { kind: "kit", id: "soksak-sdk", version: "0.0.7", target: "any", file: "soksak-sdk-0.0.7-any.tgz", size: 100380, sha256: "f".repeat(64) },
    command: "make verify",
    artifacts: manifest.artifacts.map(({ target, sha256 }) => ({
      target, sha256, execution: { mode: "native", platform: "linux", architecture: "x64" }, tools: { node: "26.7.0" },
    })),
  }, null, 2)}\n`);
  writeFileSync(join(directory, "component-build-receipt.json"), receipt);
  manifest.evidence.push({ file: "component-build-receipt.json", size: receipt.length, sha256: sha256(receipt) });
  manifest.evidence.sort((left, right) => left.file.localeCompare(right.file));
  writeFileSync(join(directory, archiveName), archive);
  writeFileSync(join(directory, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
  return { directory, archiveName, manifestName, tag };
}

test("release assets and tag are derived from the verified owner manifest", (context) => {
  const value = fixture();
  context.after(() => rmSync(value.directory, { recursive: true, force: true }));
  const result = collectReleaseAssets({
    repository,
    commit,
    artifacts: value.directory,
    manifest: join(value.directory, value.manifestName),
  });
  assert.equal(result.tag, value.tag);
  assert.deepEqual(result.assets.map(({ name }) => name), ["component-build-receipt.json", "conformance-manifest.json", "conformance-release.json", value.manifestName, value.archiveName, "spec.json"]);
});

test("asset collection rejects a release whose version differs from the workspace", (context) => {
  const value = fixture();
  context.after(() => rmSync(value.directory, { recursive: true, force: true }));
  const manifestPath = join(value.directory, value.manifestName);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, version: "0.0.1" }, null, 2)}\n`);
  assert.throws(() => collectReleaseAssets({
    repository,
    commit,
    artifacts: value.directory,
    manifest: manifestPath,
  }), /identity/);
});

test("asset collection fails closed on undeclared or changed files", (context) => {
  const value = fixture();
  context.after(() => rmSync(value.directory, { recursive: true, force: true }));
  writeFileSync(join(value.directory, "undeclared.txt"), "no");
  assert.throws(() => collectReleaseAssets({
    repository,
    commit,
    artifacts: value.directory,
    manifest: join(value.directory, value.manifestName),
  }), /declared release asset set/);
});
