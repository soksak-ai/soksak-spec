import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createRegularFileArchive } from "../release-template/archive.mjs";
import { auditSidecarRepository } from "../release-template/sidecar/audit-releases.mjs";

const REPOSITORY = "https://github.com/soksak-ai/soksak-sidecar-example";
const API = "https://api.github.com/repos/soksak-ai/soksak-sidecar-example/releases?per_page=100&page=1";
const RELEASE_URL = `${REPOSITORY}/releases/download/v0.0.1/release.json`;
const TARGET = "aarch64-apple-darwin";
const ASSET = `soksak-sidecar-example-0.0.1-${TARGET}.tar.gz`;
const ASSET_URL = `${REPOSITORY}/releases/download/v0.0.1/${ASSET}`;
const roots: string[] = [];

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function macho(cpu: number): Buffer {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(cpu, 4);
  return bytes;
}

function archive(binary: Buffer): Buffer {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "sidecar-audit-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "dist"));
  fs.writeFileSync(path.join(root, "sidecar.json"), JSON.stringify({
    id: "soksak-sidecar-example", version: "0.0.1",
    interface: { id: "soksak-spec-sidecar-example", version: "0.0.1" },
    process: "dist/soksak-sidecar-example",
  }));
  fs.writeFileSync(path.join(root, "dist/soksak-sidecar-example"), binary);
  return createRegularFileArchive({ root, files: ["sidecar.json", "dist/soksak-sidecar-example"] });
}

function requestFixture(binary: Buffer, includeAnotherRelease = false) {
  const artifact = archive(binary);
  const release = Buffer.from(JSON.stringify({
    kind: "sidecar", id: "soksak-sidecar-example", version: "0.0.1",
    source: { repository: REPOSITORY, commit: "a".repeat(40) },
    manifest: { url: `${REPOSITORY}/releases/download/v0.0.1/sidecar.json`, size: 1, sha256: "b".repeat(64) },
    artifacts: [{ target: TARGET, url: ASSET_URL, size: artifact.length, sha256: sha256(artifact), format: "tar.gz", manifest: "sidecar.json" }],
    evidence: [{ url: `${REPOSITORY}/releases/download/v0.0.1/conformance.json`, size: 1, sha256: "c".repeat(64) }],
  }));
  const values = [{
    tag_name: "v0.0.1", draft: false, prerelease: false,
    assets: [
      { name: "release.json", size: release.length, digest: `sha256:${sha256(release)}`, browser_download_url: RELEASE_URL },
      { name: ASSET, size: artifact.length, digest: `sha256:${sha256(artifact)}`, browser_download_url: ASSET_URL },
    ],
  }];
  if (includeAnotherRelease) values.push({ tag_name: "v9.9.9", draft: false, prerelease: false, assets: [] });
  const releases = Buffer.from(JSON.stringify(values));
  const routes = new Map([[API, releases], [RELEASE_URL, release], [ASSET_URL, artifact]]);
  return async (url: string) => {
    const body = routes.get(url);
    return body ? { status: 200, body } : { status: 404, body: Buffer.from("missing") };
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("sidecar release audit", () => {
  it("audits every declared artifact header and digest", async () => {
    const report = await auditSidecarRepository({ repository: REPOSITORY, request: requestFixture(macho(0x0100000c)) });
    expect(report).toMatchObject({ repository: REPOSITORY, releases: 1, artifacts: 1, failures: [] });
  });

  it("reports a historical release whose binary architecture contradicts its target", async () => {
    const report = await auditSidecarRepository({ repository: REPOSITORY, request: requestFixture(macho(0x01000007)) });
    expect(report.releases).toBe(1);
    expect(report.artifacts).toBe(1);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toMatchObject({ tag: "v0.0.1", target: TARGET });
    expect(report.failures[0]?.error).toMatch(/binary target.*architecture x86_64.*want arm64/);
  });

  it("selects one exact current-fleet tag without auditing another release generation", async () => {
    const request = requestFixture(macho(0x0100000c), true);
    const report = await auditSidecarRepository({ repository: REPOSITORY, tag: "v0.0.1", request });
    expect(report).toMatchObject({ repository: REPOSITORY, releases: 1, artifacts: 1, failures: [] });
  });

  it("rejects a requested current-fleet tag that does not exist", async () => {
    await expect(auditSidecarRepository({
      repository: REPOSITORY, tag: "v8.8.8", request: requestFixture(macho(0x0100000c)),
    })).rejects.toThrow(/requested release tag does not exist/);
  });
});
