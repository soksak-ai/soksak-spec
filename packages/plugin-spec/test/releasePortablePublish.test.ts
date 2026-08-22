import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { collectPortableReleaseAssets } from "../release-template/publish-portable-release.mjs";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "portable-publish-"));
  const repository = "soksak-ai/soksak-kit-example";
  const commit = "a".repeat(40);
  const archiveName = "soksak-kit-example-0.0.1-any.tgz";
  const archive = Buffer.from("archive");
  const reportNames = ["conformance-manifest.json", "conformance-release.json"];
  const reports = reportNames.map((name) => {
    const bytes = Buffer.from(`${name}\n`);
    fs.writeFileSync(path.join(directory, name), bytes);
    return { url: `https://github.com/${repository}/releases/download/v0.0.1/${name}`, sha256: sha256(bytes) };
  });
  fs.writeFileSync(path.join(directory, archiveName), archive);
  const release = {
    kit: { id: "soksak-kit-example", version: "0.0.1" },
    source: { repository: `https://github.com/${repository}`, commit },
    artifacts: [{ target: "any", url: `https://github.com/${repository}/releases/download/v0.0.1/${archiveName}`, sha256: sha256(archive), size: archive.length, format: "tgz", manifest: "kit.json" }],
    reports,
  };
  const manifest = path.join(directory, "release.json");
  fs.writeFileSync(manifest, `${JSON.stringify(release, null, 2)}\n`);
  return { directory, repository, commit, manifest, archiveName };
}

describe("portable release asset collection", () => {
  it("binds canonical release bytes to one immutable tag", () => {
    const value = fixture();
    const result = collectPortableReleaseAssets({ repository: value.repository, commit: value.commit, artifacts: value.directory, manifest: value.manifest });
    expect(result.tag).toBe("v0.0.1");
    expect(result.assets.map(({ name }) => name)).toEqual([
      "conformance-manifest.json", "conformance-release.json", "release.json", value.archiveName,
    ].sort());
    fs.rmSync(value.directory, { recursive: true, force: true });
  });

  it("fails closed on changed bytes and undeclared files", () => {
    const value = fixture();
    fs.writeFileSync(path.join(value.directory, value.archiveName), "changed");
    expect(() => collectPortableReleaseAssets({ repository: value.repository, commit: value.commit, artifacts: value.directory, manifest: value.manifest })).toThrow(/digest/);
    fs.rmSync(value.directory, { recursive: true, force: true });

    const extra = fixture();
    fs.writeFileSync(path.join(extra.directory, "extra.txt"), "no");
    expect(() => collectPortableReleaseAssets({ repository: extra.repository, commit: extra.commit, artifacts: extra.directory, manifest: extra.manifest })).toThrow(/asset set/);
    fs.rmSync(extra.directory, { recursive: true, force: true });
  });
});
