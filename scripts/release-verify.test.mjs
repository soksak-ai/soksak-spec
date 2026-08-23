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
    archiveName: "soksak-ai-plugin-spec-0.0.14.tgz",
    archiveDigest: digest,
    archiveSize: 81840,
    identity: specReleaseIdentity(workspace, pluginSpec),
  });
  assert.deepEqual(release.spec, { id: "soksak-spec", version: "0.0.14" });
  assert.equal(release.source.repository, "https://github.com/soksak-ai/soksak-spec");
  assert.equal(release.source.commit, commit);
  assert.equal(release.artifacts[0].sha256, digest);
  assert.equal(release.artifacts[0].size, 81840);
  assert.equal(release.artifacts[0].manifest, "spec.json");
  assert.equal(release.reportFiles.length, 2);
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
