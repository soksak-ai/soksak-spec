import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { collectCanonicalReleaseAssets } from "../release-template/publish-canonical-release.mjs";
import { GITHUB_ORG } from "../src/release-primitives.js";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function attachReceipt(directory: string, release: Record<string, any>): void {
  const receipt = {
    schema: "soksak-component-build-receipt-v1",
    subject: { kind: release.kind, id: release.id, version: release.version },
    source: release.source,
    manifest: release.manifest,
    spec: { kind: "spec", id: "soksak-spec", version: "0.0.37", target: "any", file: "soksak-soksak-spec-0.0.37.tgz", size: 133010, sha256: "e".repeat(64) },
    tooling: { kind: "kit", id: "soksak-sdk", version: "0.0.7", target: "any", file: "soksak-sdk-0.0.7-any.tgz", size: 100380, sha256: "f".repeat(64) },
    command: "make verify",
    artifacts: release.artifacts.map(({ target, sha256 }: { target: string; sha256: string }) => ({
      target, sha256, execution: { mode: "native", platform: "linux", architecture: "x64" }, tools: { node: "26.7.0" },
    })),
  };
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const file = "component-build-receipt.json";
  fs.writeFileSync(path.join(directory, file), bytes);
  release.evidence.push({ file, size: bytes.length, sha256: sha256(bytes) });
  release.evidence.sort((left: { file: string }, right: { file: string }) => left.file.localeCompare(right.file));
}

function fixture(withReceipt = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "portable-publish-"));
  const repository = `${GITHUB_ORG}/soksak-kit-example`;
  const commit = "a".repeat(40);
  const archiveName = "soksak-kit-example-0.0.1-any.tgz";
  const archive = Buffer.from("archive");
  const manifestName = "kit.json";
  const manifestBytes = Buffer.from("{}\n");
  fs.writeFileSync(path.join(directory, manifestName), manifestBytes);
  const reportNames = ["conformance-manifest.json", "conformance-release.json"];
  const evidence = reportNames.map((name) => {
    const bytes = Buffer.from(`${name}\n`);
    fs.writeFileSync(path.join(directory, name), bytes);
    return { file: name, size: bytes.length, sha256: sha256(bytes) };
  });
  fs.writeFileSync(path.join(directory, archiveName), archive);
  const release = {
    kind: "kit", id: "soksak-kit-example", version: "0.0.1",
    manifest: { file: manifestName, size: manifestBytes.length, sha256: sha256(manifestBytes) },
    source: { repository: `https://github.com/${repository}`, commit },
    artifacts: [{ target: "any", file: archiveName, sha256: sha256(archive), size: archive.length, format: "tgz", manifest: "kit.json" }],
    evidence,
  };
  if (withReceipt) attachReceipt(directory, release);
  const manifest = path.join(directory, "release.json");
  fs.writeFileSync(manifest, `${JSON.stringify(release, null, 2)}\n`);
  return { directory, repository, commit, manifest, archiveName, archive };
}

describe("canonical release asset collection", () => {
  it("refuses publication without a verified component build receipt", () => {
    const value = fixture(false);
    expect(() => collectCanonicalReleaseAssets({
      repository: value.repository, commit: value.commit, artifacts: value.directory, manifest: value.manifest,
    })).toThrow(/component build receipt.*required/i);
    fs.rmSync(value.directory, { recursive: true, force: true });
  });

  it("maps the bare file names of release.json onto the release asset set of one immutable tag", () => {
    const value = fixture();
    const result = collectCanonicalReleaseAssets({ repository: value.repository, commit: value.commit, artifacts: value.directory, manifest: value.manifest });
    expect(result.tag).toBe("v0.0.1");
    expect(result.assets.map(({ name }) => name)).toEqual([
      "component-build-receipt.json", "conformance-manifest.json", "conformance-release.json", "kit.json", "release.json", value.archiveName,
    ].sort());
    const archive = result.assets.find(({ name }) => name === value.archiveName);
    expect(archive).toMatchObject({ size: value.archive.length, digest: `sha256:${sha256(value.archive)}`, contentType: "application/gzip" });
    fs.rmSync(value.directory, { recursive: true, force: true });
  });

  it("collects a canonical sidecar target matrix without checksum shadow assets", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-publish-"));
    const repository = `${GITHUB_ORG}/soksak-sidecar-example`;
    const commit = "b".repeat(40);
    const artifacts = ["aarch64-unknown-linux-gnu", "x86_64-pc-windows-msvc"].map((target) => {
      const name = `soksak-sidecar-example-0.0.1-${target}.tar.gz`;
      const bytes = Buffer.from(target);
      fs.writeFileSync(path.join(directory, name), bytes);
      return { target, file: name, sha256: sha256(bytes), size: bytes.length, format: "tar.gz", manifest: "sidecar.json" };
    });
    const sidecarManifest = Buffer.from("{}\n");
    fs.writeFileSync(path.join(directory, "sidecar.json"), sidecarManifest);
    const evidence = ["conformance-interface.json", "conformance-release.json", "conformance-sidecar.json"].map((name) => {
      const bytes = Buffer.from(name);
      fs.writeFileSync(path.join(directory, name), bytes);
      return { file: name, size: bytes.length, sha256: sha256(bytes) };
    });
    const release = { kind: "sidecar", id: "soksak-sidecar-example", version: "0.0.1", manifest: { file: "sidecar.json", size: sidecarManifest.length, sha256: sha256(sidecarManifest) }, source: { repository: `https://github.com/${repository}`, commit }, artifacts, evidence };
    attachReceipt(directory, release);
    const manifest = path.join(directory, "release.json");
    fs.writeFileSync(manifest, `${JSON.stringify(release, null, 2)}\n`);
    const result = collectCanonicalReleaseAssets({ repository, commit, artifacts: directory, manifest });
    expect(result.assets).toHaveLength(8);
    fs.writeFileSync(path.join(directory, `${artifacts[0].file}.sha256`), artifacts[0].sha256);
    expect(() => collectCanonicalReleaseAssets({ repository, commit, artifacts: directory, manifest })).toThrow(/asset set/);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("fails closed on changed bytes and undeclared files", () => {
    const value = fixture();
    fs.writeFileSync(path.join(value.directory, value.archiveName), "changed");
    expect(() => collectCanonicalReleaseAssets({ repository: value.repository, commit: value.commit, artifacts: value.directory, manifest: value.manifest })).toThrow(/digest/);
    fs.rmSync(value.directory, { recursive: true, force: true });

    const extra = fixture();
    fs.writeFileSync(path.join(extra.directory, "extra.txt"), "no");
    expect(() => collectCanonicalReleaseAssets({ repository: extra.repository, commit: extra.commit, artifacts: extra.directory, manifest: extra.manifest })).toThrow(/asset set/);
    fs.rmSync(extra.directory, { recursive: true, force: true });
  });

  it("names release assets by the one file grammar of release-primitives", () => {
    const source = fs.readFileSync(new URL("../release-template/publish-canonical-release.mjs", import.meta.url), "utf8");
    expect(source).toMatch(/import \{[^}]*\bRELEASE_FILE_RE\b[^}]*\} from "\.\.\/dist\/release-primitives\.js"/);
    expect(source).not.toMatch(/ASSET_RE|ASSET_NAME_RE|\[A-Za-z0-9\]\[A-Za-z0-9\._-\]/);
  });
});
