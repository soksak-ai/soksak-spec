import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { collectCanonicalReleaseAssets } from "../release-template/publish-canonical-release.mjs";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "portable-publish-"));
  const repository = "soksak-ai/soksak-kit-example";
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
    return { url: `https://github.com/${repository}/releases/download/v0.0.1/${name}`, size: bytes.length, sha256: sha256(bytes) };
  });
  fs.writeFileSync(path.join(directory, archiveName), archive);
  const release = {
    kind: "kit", id: "soksak-kit-example", version: "0.0.1",
    manifest: { url: `https://github.com/${repository}/releases/download/v0.0.1/${manifestName}`, size: manifestBytes.length, sha256: sha256(manifestBytes) },
    source: { repository: `https://github.com/${repository}`, commit },
    artifacts: [{ target: "any", url: `https://github.com/${repository}/releases/download/v0.0.1/${archiveName}`, sha256: sha256(archive), size: archive.length, format: "tgz", manifest: "kit.json" }],
    evidence,
  };
  const manifest = path.join(directory, "release.json");
  fs.writeFileSync(manifest, `${JSON.stringify(release, null, 2)}\n`);
  return { directory, repository, commit, manifest, archiveName };
}

describe("canonical release asset collection", () => {
  it("binds canonical release bytes to one immutable tag", () => {
    const value = fixture();
    const result = collectCanonicalReleaseAssets({ repository: value.repository, commit: value.commit, artifacts: value.directory, manifest: value.manifest });
    expect(result.tag).toBe("v0.0.1");
    expect(result.assets.map(({ name }) => name)).toEqual([
      "conformance-manifest.json", "conformance-release.json", "kit.json", "release.json", value.archiveName,
    ].sort());
    fs.rmSync(value.directory, { recursive: true, force: true });
  });

  it("collects a canonical sidecar target matrix without checksum shadow assets", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sidecar-publish-"));
    const repository = "soksak-ai/soksak-sidecar-example";
    const commit = "b".repeat(40);
    const artifacts = ["aarch64-unknown-linux-gnu", "x86_64-pc-windows-msvc"].map((target) => {
      const name = `soksak-sidecar-example-0.0.1-${target}.tar.gz`;
      const bytes = Buffer.from(target);
      fs.writeFileSync(path.join(directory, name), bytes);
      return { target, url: `https://github.com/${repository}/releases/download/v0.0.1/${name}`, sha256: sha256(bytes), size: bytes.length, format: "tar.gz", manifest: "sidecar.json" };
    });
    const sidecarManifest = Buffer.from("{}\n");
    fs.writeFileSync(path.join(directory, "sidecar.json"), sidecarManifest);
    const evidence = ["conformance-interface.json", "conformance-release.json", "conformance-sidecar.json"].map((name) => {
      const bytes = Buffer.from(name);
      fs.writeFileSync(path.join(directory, name), bytes);
      return { url: `https://github.com/${repository}/releases/download/v0.0.1/${name}`, size: bytes.length, sha256: sha256(bytes) };
    });
    const manifest = path.join(directory, "release.json");
    fs.writeFileSync(manifest, `${JSON.stringify({ kind: "sidecar", id: "soksak-sidecar-example", version: "0.0.1", manifest: { url: `https://github.com/${repository}/releases/download/v0.0.1/sidecar.json`, size: sidecarManifest.length, sha256: sha256(sidecarManifest) }, source: { repository: `https://github.com/${repository}`, commit }, artifacts, evidence }, null, 2)}\n`);
    const result = collectCanonicalReleaseAssets({ repository, commit, artifacts: directory, manifest });
    expect(result.assets).toHaveLength(7);
    fs.writeFileSync(path.join(directory, `${path.basename(new URL(artifacts[0].url).pathname)}.sha256`), artifacts[0].sha256);
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
});
