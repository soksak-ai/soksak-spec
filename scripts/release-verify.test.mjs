import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  buildPlatformRelease,
  canonicalizeGzipPlatform,
  projectPackageToolchain,
  resolveSourceCommit,
  specReleaseIdentity,
  validateArchiveEntries,
} from "./release-verify.mjs";
import { GITHUB_ORG, MAX_SEMVER_LENGTH } from "../packages/plugin-spec/dist/release-primitives.js";

const root = join(import.meta.dirname, "..");
const commit = "a".repeat(40);
const digest = "1".repeat(64);

function metadata() {
  const workspace = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const pluginSpec = JSON.parse(readFileSync(join(root, "packages/plugin-spec/package.json"), "utf8"));
  return { workspace, pluginSpec };
}

test("source commit is exact and cannot disagree with the checkout", () => {
  assert.equal(resolveSourceCommit(commit, null), commit);
  assert.equal(resolveSourceCommit(undefined, commit), commit);
  assert.equal(resolveSourceCommit(commit, commit), commit);
  assert.throws(
    () => resolveSourceCommit("main", null),
    /exact lowercase 40-character commit/,
  );
  assert.throws(
    () => resolveSourceCommit("b".repeat(40), commit),
    /does not equal checkout HEAD/,
  );
  assert.throws(
    () => resolveSourceCommit(undefined, null),
    /source commit is unavailable/,
  );
});

test("spec release projects the derived owner identity", () => {
  const { workspace, pluginSpec } = metadata();
  const release = buildPlatformRelease({
    commit,
    archiveName: "soksak-ai-plugin-spec-0.0.33.tgz",
    archiveDigest: digest,
    archiveSize: 81840,
    identity: specReleaseIdentity(workspace, pluginSpec),
    manifestBytes: Buffer.from('{}\n'),
  });
  assert.deepEqual({ kind: release.kind, id: release.id, version: release.version }, { kind: "spec", id: "soksak-spec", version: "0.0.33" });
  assert.equal(release.source.repository, "https://github.com/soksak-ai/soksak-spec");
  assert.equal(release.source.commit, commit);
  assert.equal(release.artifacts[0].sha256, digest);
  assert.equal(release.artifacts[0].size, 81840);
  assert.equal(release.artifacts[0].manifest, "spec.json");
  assert.equal(release.evidenceFiles.length, 2);
});

test("spec release names every file by bare name; the location is derived by the reader", () => {
  const { workspace, pluginSpec } = metadata();
  const { evidenceFiles, ...release } = buildPlatformRelease({
    commit,
    archiveName: "soksak-ai-plugin-spec-0.0.33.tgz",
    archiveDigest: digest,
    archiveSize: 81840,
    identity: specReleaseIdentity(workspace, pluginSpec),
    manifestBytes: Buffer.from('{}\n'),
  });
  assert.equal(release.artifacts[0].file, "soksak-ai-plugin-spec-0.0.33.tgz");
  assert.equal(release.manifest.file, "spec.json");
  assert.deepEqual(release.evidence.map(({ file }) => file), ["conformance-manifest.json", "conformance-release.json"]);
  assert.deepEqual(evidenceFiles.map(({ name }) => name), ["conformance-manifest.json", "conformance-release.json"]);
  assert.deepEqual(Object.keys(release.manifest).sort(), ["file", "sha256", "size"]);
  for (const artifact of release.artifacts) assert.deepEqual(Object.keys(artifact).sort(), ["file", "format", "manifest", "sha256", "size", "target"]);
  for (const item of release.evidence) assert.deepEqual(Object.keys(item).sort(), ["file", "sha256", "size"]);
});

test("spec release repository is derived from the org and the spec id; the workspace must restate it exactly", () => {
  const { workspace, pluginSpec } = metadata();
  assert.equal(specReleaseIdentity(workspace, pluginSpec).repository, `https://github.com/${GITHUB_ORG}/soksak-spec`);
  for (const repository of ["https://github.com/example/soksak-spec", `https://github.com/${GITHUB_ORG}/other`, `https://github.com/${GITHUB_ORG}/soksak-spec/`]) {
    assert.throws(
      () => specReleaseIdentity({ ...workspace, soksakRelease: { ...workspace.soksakRelease, repository } }, pluginSpec),
      /soksakRelease\.repository must equal/,
    );
  }
});

test("spec release takes the strict SemVer grammar and its length bound from the spec package", () => {
  const source = readFileSync(join(root, "scripts/release-verify.mjs"), "utf8");
  assert.match(source, /import \{[^}]*\bSTRICT_SEMVER_RE\b[^}]*\} from "\.\.\/packages\/plugin-spec\/dist\/spec\.js"/);
  const { workspace, pluginSpec } = metadata();
  const identity = specReleaseIdentity(workspace, pluginSpec);
  const build = (version) => buildPlatformRelease({
    commit,
    archiveName: `soksak-ai-plugin-spec-${version}.tgz`,
    archiveDigest: digest,
    archiveSize: 1,
    identity: { ...identity, version },
    manifestBytes: Buffer.from("{}\n"),
  });
  assert.equal(build("1.2.3-rc.1").version, "1.2.3-rc.1");
  assert.throws(() => build(`1.0.0-${"a".repeat(MAX_SEMVER_LENGTH)}`), /strict SemVer required/);
  assert.throws(() => build("v1.0.0"), /strict SemVer required/);
});

test("spec release identity rejects mismatched versions", () => {
  const { workspace, pluginSpec } = metadata();
  const mismatchedWorkspace = {
    ...workspace,
    version: "0.0.1",
    soksakRelease: {
      ...workspace.soksakRelease,
      spec: { ...workspace.soksakRelease.spec, version: "0.0.1" },
    },
  };
  assert.throws(
    () => specReleaseIdentity(mismatchedWorkspace, pluginSpec),
    /must both equal/,
  );
});

test("the public package projects the workspace toolchain owner", () => {
  const { workspace, pluginSpec } = metadata();
  const projected = projectPackageToolchain(workspace, pluginSpec);
  assert.deepEqual(projected.engines, { node: "26.7.0" });
  assert.equal(projected.packageManager, undefined);
  assert.equal(pluginSpec.engines, undefined);
  assert.throws(
    () => projectPackageToolchain({ ...workspace, engines: { node: "latest" } }, pluginSpec),
    /Node toolchain must be exact/,
  );
});

test("package gzip bytes do not retain the build host platform", () => {
  const mac = Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 19, 1]);
  const linux = Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3, 1]);
  assert.deepEqual(canonicalizeGzipPlatform(mac), canonicalizeGzipPlatform(linux));
  assert.equal(canonicalizeGzipPlatform(mac)[9], 255);
  assert.throws(() => canonicalizeGzipPlatform(Buffer.from("not gzip")), /must use gzip/);
  const extended = Buffer.from(mac);
  extended[3] = 2;
  assert.throws(() => canonicalizeGzipPlatform(extended), /extensions are forbidden/);
});

test("release archives contain only unique portable regular files", () => {
  assert.deepEqual(
    validateArchiveEntries(
      [
        "-rw-r--r--  0 0 0 10 Jan  1 00:00 package/package.json",
        "-rw-r--r--  0 0 0 20 Jan  1 00:00 package/dist/spec.js",
      ],
      ["package/package.json", "package/dist/spec.js"],
    ),
    ["package/package.json", "package/dist/spec.js"],
  );
  assert.throws(
    () => validateArchiveEntries(
      ["lrwxr-xr-x  0 0 0 0 Jan  1 00:00 package/link -> target"],
      ["package/link"],
    ),
    /non-regular archive entry/,
  );
  assert.throws(
    () => validateArchiveEntries(
      ["-rw-r--r--  0 0 0 1 Jan  1 00:00 package\/..\/escape"],
      ["package/../escape"],
    ),
    /unsafe archive path/,
  );
  assert.throws(
    () => validateArchiveEntries(
      [
        "-rw-r--r--  0 0 0 1 Jan  1 00:00 package/a",
        "-rw-r--r--  0 0 0 1 Jan  1 00:00 package/a",
      ],
      ["package/a", "package/a"],
    ),
    /duplicate archive entry/,
  );
});
