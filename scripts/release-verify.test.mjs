import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  buildPlatformRelease,
  resolveSourceCommit,
  specReleaseIdentity,
  validateArchiveEntries,
} from "./release-verify.mjs";

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
    archiveName: "soksak-ai-plugin-spec-0.0.1.tgz",
    archiveDigest: digest,
    identity: specReleaseIdentity(workspace, pluginSpec),
  });
  assert.equal(release.version, "0.0.1");
  assert.equal(release.releaseTag, "soksak-spec-v0.0.1");
  assert.equal(release.source.repository, "https://github.com/soksak-ai/soksak-spec");
  assert.equal(release.source.commit, commit);
  assert.equal(release.packages[0].artifact.sha256, digest);
  assert.deepEqual(
    release.packages.slice(1).map((entry) => entry.name),
    ["soksak-spec-contract", "soksak-spec-service", "soksak-spec-socket"],
  );
});

test("spec release identity is derived from metadata for later product versions", () => {
  const { workspace, pluginSpec } = metadata();
  const release = buildPlatformRelease({
    commit,
    archiveName: "soksak-ai-plugin-spec-0.9.3.tgz",
    archiveDigest: digest,
    identity: specReleaseIdentity(
      { ...workspace, version: "0.9.3" },
      { ...pluginSpec, version: "0.9.3" },
    ),
  });
  assert.equal(release.version, "0.9.3");
  assert.equal(release.releaseTag, "soksak-spec-v0.9.3");
  assert.match(release.packages[0].artifact.url, /soksak-ai-plugin-spec-0\.9\.3\.tgz$/);
  for (const rust of release.packages.slice(1)) {
    assert.equal(rust.version, "0.9.3", "rust crates track the same product version");
  }
});

test("spec release identity rejects mismatched or non-SemVer versions", () => {
  const { workspace, pluginSpec } = metadata();
  assert.throws(
    () => specReleaseIdentity({ ...workspace, version: "0.0.1" }, { ...pluginSpec, version: "0.0.2" }),
    /must both equal/,
  );
  assert.throws(
    () => specReleaseIdentity({ ...workspace, version: "not-semver" }, { ...pluginSpec, version: "not-semver" }),
    /strict SemVer/,
  );
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
