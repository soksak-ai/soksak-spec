import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { publishImmutableRelease } from "./publish-release.mjs";

const repository = "soksak-ai/soksak-spec";
const commit = "a".repeat(40);
const tag = "soksak-spec-v0.9.7";

function localAsset(name, value, contentType) {
  const bytes = Buffer.from(value);
  return {
    name,
    bytes,
    size: bytes.length,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    contentType,
  };
}

const assets = [
  localAsset("soksak-ai-plugin-spec-0.9.7.tgz", "archive", "application/gzip"),
  localAsset("soksak-spec-release.json", "{}\n", "application/json"),
];

class MemoryApi {
  constructor({ tagCommit = null, release = null, remoteAssets = [] } = {}) {
    this.tagCommit = tagCommit;
    this.release = release;
    this.remoteAssets = [...remoteAssets];
    this.calls = [];
  }
  async assertImmutable() { this.calls.push("immutable"); }
  async getTagCommit() { this.calls.push("get-tag"); return this.tagCommit; }
  async createTag(_tag, source) { this.calls.push("create-tag"); this.tagCommit = source; }
  async getRelease() { this.calls.push("get-release"); return this.release; }
  async createDraft() {
    this.calls.push("create-draft");
    this.release = { id: 7, tag_name: tag, name: tag, draft: true, prerelease: false, immutable: false };
    return this.release;
  }
  async listAssets() { this.calls.push("list-assets"); return [...this.remoteAssets]; }
  async uploadAsset(_release, asset) {
    this.calls.push(`upload:${asset.name}`);
    const uploaded = { name: asset.name, size: asset.size, digest: asset.digest, state: "uploaded" };
    this.remoteAssets.push(uploaded);
    return uploaded;
  }
  async publishDraft() {
    this.calls.push("publish-draft");
    this.release = { ...this.release, draft: false, immutable: true };
  }
}

test("publication creates the tag only after validation and resumes through an immutable release", async () => {
  const api = new MemoryApi();
  const result = await publishImmutableRelease({ repository, commit, tag, prerelease: false, assets, api });
  assert.equal(result.state, "published");
  assert.deepEqual(api.calls, [
    "immutable", "get-tag", "create-tag", "get-release", "create-draft", "list-assets",
    `upload:${assets[0].name}`, `upload:${assets[1].name}`, "list-assets", "publish-draft",
    "get-release", "get-tag", "list-assets", "immutable",
  ]);
});

test("an exact immutable publication is idempotent and a draft resumes missing assets", async () => {
  const exactRemote = assets.map(({ name, size, digest }) => ({ name, size, digest, state: "uploaded" }));
  const published = new MemoryApi({
    tagCommit: commit,
    release: { id: 7, tag_name: tag, name: tag, draft: false, prerelease: false, immutable: true },
    remoteAssets: exactRemote,
  });
  assert.equal((await publishImmutableRelease({ repository, commit, tag, prerelease: false, assets, api: published })).state, "already-published");
  assert.equal(published.calls.some((call) => call.startsWith("upload:")), false);

  const draft = new MemoryApi({
    tagCommit: commit,
    release: { id: 7, tag_name: tag, name: tag, draft: true, prerelease: false, immutable: false },
    remoteAssets: exactRemote.slice(0, 1),
  });
  await publishImmutableRelease({ repository, commit, tag, prerelease: false, assets, api: draft });
  assert.deepEqual(draft.calls.filter((call) => call.startsWith("upload:")), [`upload:${assets[1].name}`]);
});

test("remote identity or bytes mismatch fails without delete-and-replace reconciliation", async () => {
  const wrongTag = new MemoryApi({ tagCommit: "b".repeat(40) });
  await assert.rejects(
    publishImmutableRelease({ repository, commit, tag, prerelease: false, assets, api: wrongTag }),
    /different commit/,
  );

  const wrongAsset = new MemoryApi({
    tagCommit: commit,
    release: { id: 7, tag_name: tag, name: tag, draft: true, prerelease: false, immutable: false },
    remoteAssets: [{ name: assets[0].name, size: assets[0].size, digest: `sha256:${"f".repeat(64)}`, state: "uploaded" }],
  });
  await assert.rejects(
    publishImmutableRelease({ repository, commit, tag, prerelease: false, assets, api: wrongAsset }),
    /digest mismatch/,
  );
  assert.equal(wrongAsset.calls.some((call) => call.startsWith("upload:")), false);
});
