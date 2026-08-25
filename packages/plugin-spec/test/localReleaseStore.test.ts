import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  deleteLocalRelease,
  inspectLocalRelease,
  publishLocalRelease,
  verifyLocalReleaseStore,
} from "../release-template/local-release-store.mjs";

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

function releaseFixture(root: string, content = "archive") {
  const directory = fs.mkdtempSync(path.join(root, "release-"));
  const repository = "https://github.com/soksak-ai/soksak-plugin-example";
  const version = "0.0.1";
  const tag = `v${version}`;
  const archiveName = `soksak-plugin-example-${version}-any.tgz`;
  const archive = Buffer.from(content);
  const manifest = Buffer.from('{"id":"soksak-plugin-example","version":"0.0.1"}\n');
  const evidence = Buffer.from('{"result":"passed"}\n');
  fs.writeFileSync(path.join(directory, archiveName), archive);
  fs.writeFileSync(path.join(directory, "plugin.json"), manifest);
  fs.writeFileSync(path.join(directory, "conformance-release.json"), evidence);
  fs.writeFileSync(path.join(directory, "release.json"), `${JSON.stringify({
    kind: "plugin", id: "soksak-plugin-example", version,
    manifest: { url: `${repository}/releases/download/${tag}/plugin.json`, size: manifest.length, sha256: sha256(manifest) },
    source: { repository, commit: "a".repeat(40) },
    artifacts: [{ target: "any", url: `${repository}/releases/download/${tag}/${archiveName}`, size: archive.length, sha256: sha256(archive), format: "tgz", manifest: "plugin.json" }],
    evidence: [{ url: `${repository}/releases/download/${tag}/conformance-release.json`, size: evidence.length, sha256: sha256(evidence) }],
  }, null, 2)}\n`);
  return directory;
}

describe("canonical local release store", () => {
  it("publishes atomically and treats identical bytes as idempotent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "local-release-store-"));
    const store = path.join(root, "releases");
    const release = releaseFixture(root);
    const first = publishLocalRelease({ store, release });
    const second = publishLocalRelease({ store, release });
    expect(first).toMatchObject({ state: "published", kind: "plugin", id: "soksak-plugin-example", version: "0.0.1" });
    expect(second).toMatchObject({ state: "unchanged", directory: first.directory });
    expect(inspectLocalRelease({ store, kind: "plugin", id: "soksak-plugin-example", version: "0.0.1" })).toMatchObject({ digest: first.digest });
    expect(verifyLocalReleaseStore({ store })).toMatchObject({ releases: 1 });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("refuses different bytes at one version until the whole release is deleted", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "local-release-store-"));
    const store = path.join(root, "releases");
    const first = releaseFixture(root, "first");
    const changed = releaseFixture(root, "changed");
    publishLocalRelease({ store, release: first });
    expect(() => publishLocalRelease({ store, release: changed })).toThrow(/LOCAL_RELEASE_VERSION_CONFLICT/);
    expect(deleteLocalRelease({ store, kind: "plugin", id: "soksak-plugin-example", version: "0.0.1" })).toMatchObject({ state: "deleted" });
    expect(publishLocalRelease({ store, release: changed })).toMatchObject({ state: "published" });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects partial mutation and undeclared files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "local-release-store-"));
    const store = path.join(root, "releases");
    const release = releaseFixture(root);
    const published = publishLocalRelease({ store, release });
    fs.writeFileSync(path.join(published.directory, "extra"), "no");
    expect(() => verifyLocalReleaseStore({ store })).toThrow(/LOCAL_RELEASE_CORRUPT/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
