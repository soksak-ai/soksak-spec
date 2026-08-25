// The sidecar audit reads release.json by file name: every download url is derived from the org, the
// id, the tag version, and the bare file name; the GitHub asset with that name must report the same
// size and digest as release.json, and the downloaded bytes must match.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createRegularFileArchive } from "../release-template/archive.mjs";
import { releaseURL } from "../release-template/resolve-release.mjs";
import { auditSidecarRepository } from "../release-template/sidecar/audit-releases.mjs";

const ID = "soksak-sidecar-example";
const VERSION = "0.0.1";
const REPOSITORY = `https://github.com/soksak-ai/${ID}`;
const API = `https://api.github.com/repos/soksak-ai/${ID}/releases?per_page=100&page=1`;
const RELEASE_URL = releaseURL(ID, VERSION, "release.json");
const TARGET = "aarch64-apple-darwin";
const ASSET = `${ID}-${VERSION}-${TARGET}.tar.gz`;
const ASSET_URL = releaseURL(ID, VERSION, ASSET);
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
    id: ID, version: VERSION,
    interface: { id: "soksak-spec-sidecar-example", version: VERSION },
    process: `dist/${ID}`,
  }));
  fs.writeFileSync(path.join(root, `dist/${ID}`), binary);
  return createRegularFileArchive({ root, files: ["sidecar.json", `dist/${ID}`] });
}

function requestFixture(binary: Buffer, options: { anotherRelease?: boolean; assetDigest?: string; malformedTag?: string } = {}) {
  const artifact = archive(binary);
  const release = Buffer.from(JSON.stringify({
    kind: "sidecar", id: ID, version: VERSION,
    source: { repository: REPOSITORY, commit: "a".repeat(40) },
    manifest: { file: "sidecar.json", size: 1, sha256: "b".repeat(64) },
    artifacts: [{ target: TARGET, file: ASSET, size: artifact.length, sha256: sha256(artifact), format: "tar.gz", manifest: "sidecar.json" }],
    evidence: [{ file: "conformance-release.json", size: 1, sha256: "c".repeat(64) }],
  }));
  const values = [{
    tag_name: `v${VERSION}`, draft: false, prerelease: false,
    assets: [
      { name: "release.json", size: release.length, digest: `sha256:${sha256(release)}` },
      { name: ASSET, size: artifact.length, digest: `sha256:${options.assetDigest ?? sha256(artifact)}` },
    ],
  }];
  if (options.anotherRelease) values.push({ tag_name: "v9.9.9", draft: false, prerelease: false, assets: [] });
  if (options.malformedTag) values.push({ tag_name: options.malformedTag, draft: false, prerelease: false, assets: [] });
  const releases = Buffer.from(JSON.stringify(values));
  const routes = new Map([[API, releases], [RELEASE_URL, release], [ASSET_URL, artifact]]);
  const requested: string[] = [];
  const request = async (url: string) => {
    requested.push(url);
    const body = routes.get(url);
    return body ? { status: 200, body } : { status: 404, body: Buffer.from("missing") };
  };
  return { request, requested };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("sidecar release audit", () => {
  it("audits every declared artifact by derived url, header, and digest", async () => {
    const { request, requested } = requestFixture(macho(0x0100000c));
    const report = await auditSidecarRepository({ repository: REPOSITORY, request });
    expect(report).toMatchObject({ repository: REPOSITORY, releases: 1, artifacts: 1, failures: [] });
    expect(requested).toEqual([API, RELEASE_URL, ASSET_URL]);
  });

  it("reports a historical release whose binary architecture contradicts its target", async () => {
    const report = await auditSidecarRepository({ repository: REPOSITORY, request: requestFixture(macho(0x01000007)).request });
    expect(report.releases).toBe(1);
    expect(report.artifacts).toBe(1);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toMatchObject({ tag: `v${VERSION}`, target: TARGET });
    expect(report.failures[0]?.error).toMatch(/binary target.*architecture x86_64.*want arm64/);
  });

  it("reports a GitHub asset whose digest differs from release.json", async () => {
    const report = await auditSidecarRepository({ repository: REPOSITORY, request: requestFixture(macho(0x0100000c), { assetDigest: "f".repeat(64) }).request });
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.error).toMatch(/GitHub asset/);
  });

  it("selects one exact current-fleet tag without auditing another release generation", async () => {
    const { request } = requestFixture(macho(0x0100000c), { anotherRelease: true });
    const report = await auditSidecarRepository({ repository: REPOSITORY, tag: `v${VERSION}`, request });
    expect(report).toMatchObject({ repository: REPOSITORY, releases: 1, artifacts: 1, failures: [] });
  });

  it("rejects a requested current-fleet tag that does not exist", async () => {
    await expect(auditSidecarRepository({
      repository: REPOSITORY, tag: "v8.8.8", request: requestFixture(macho(0x0100000c)).request,
    })).rejects.toThrow(/requested release tag does not exist/);
  });

  it("derives the version of every tag by the strict SemVer grammar after one leading v", async () => {
    for (const tag of ["01.0.0", "v01.0.0", "vv0.0.1", "v0.0.1.next"]) {
      await expect(auditSidecarRepository({ repository: REPOSITORY, tag, request: requestFixture(macho(0x0100000c)).request }), tag)
        .rejects.toThrow(/release tag must be v<version>/);
    }
    // A prerelease tag is inside the grammar; its absence is the only refusal.
    await expect(auditSidecarRepository({ repository: REPOSITORY, tag: "v0.0.1-rc.1", request: requestFixture(macho(0x0100000c)).request }))
      .rejects.toThrow(/requested release tag does not exist/);
    const { request, requested } = requestFixture(macho(0x0100000c), { malformedTag: "v01.0.0" });
    const report = await auditSidecarRepository({ repository: REPOSITORY, request });
    expect(report).toMatchObject({ releases: 2, artifacts: 1 });
    expect(report.failures).toEqual([{ tag: "v01.0.0", target: null, error: expect.stringMatching(/release tag must be v<version>/) }]);
    expect(requested).toEqual([API, RELEASE_URL, ASSET_URL]);
  });

  it("uses the component id and strict SemVer grammars of dist and restates neither", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "../release-template/sidecar/audit-releases.mjs"), "utf8");
    expect(source).toContain('import { COMPONENT_ID_RE, GITHUB_ORG, STRICT_SEMVER_RE } from "../../dist/release-primitives.js";');
    expect(source).not.toMatch(/\[a-z0-9\]|\[0-9\]/);
  });

  it("rejects a repository whose id is outside the component id grammar", async () => {
    for (const id of ["Upper", "under_score", `${ID}/extra`]) {
      await expect(auditSidecarRepository({
        repository: `https://github.com/soksak-ai/${id}`, request: requestFixture(macho(0x0100000c)).request,
      }), id).rejects.toThrow(/soksak-ai/);
    }
  });

  it("rejects a repository outside the org", async () => {
    await expect(auditSidecarRepository({
      repository: `https://github.com/example/${ID}`, request: requestFixture(macho(0x0100000c)).request,
    })).rejects.toThrow(/soksak-ai/);
  });
});
