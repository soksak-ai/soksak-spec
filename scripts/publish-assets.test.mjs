import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { collectReleaseAssets } from "./publish-release.mjs";

const repository = "soksak-ai/soksak-spec";
const commit = "a".repeat(40);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixture(version = "0.0.1") {
  const directory = mkdtempSync(join(tmpdir(), "soksak-spec-publish-"));
  const archiveName = `soksak-ai-plugin-spec-${version}.tgz`;
  const archive = Buffer.from(`spec-${version}`);
  const tag = `soksak-spec-v${version}`;
  const manifestName = "soksak-spec-release.json";
  const manifest = {
    spec: "soksak-spec-platform-release@0.0.1",
    kind: "spec",
    id: "soksak-spec",
    version,
    source: { repository: `https://github.com/${repository}`, commit },
    releaseTag: tag,
    dependencies: [],
    packages: [
      {
        ecosystem: "javascript",
        name: "@soksak-ai/plugin-spec",
        version,
        artifact: {
          url: `https://github.com/${repository}/releases/download/${tag}/${archiveName}`,
          sha256: sha256(archive),
          format: "tgz",
        },
      },
      { ecosystem: "rust", name: "soksak-spec-contract", version },
      { ecosystem: "rust", name: "soksak-spec-service", version },
      { ecosystem: "rust", name: "soksak-spec-socket", version },
    ],
  };
  writeFileSync(join(directory, archiveName), archive);
  writeFileSync(join(directory, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
  return { directory, archiveName, manifestName, tag };
}

test("release assets and tag are derived from the verified owner manifest", (context) => {
  const value = fixture("0.8.6");
  context.after(() => rmSync(value.directory, { recursive: true, force: true }));
  const result = collectReleaseAssets({
    repository,
    commit,
    artifacts: value.directory,
    manifest: join(value.directory, value.manifestName),
  });
  assert.equal(result.tag, value.tag);
  assert.deepEqual(result.assets.map(({ name }) => name), [value.archiveName, value.manifestName]);
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
