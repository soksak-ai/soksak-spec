import assert from "node:assert/strict";
import test from "node:test";

import { GitHubApi } from "./publish-release.mjs";

function reply(status, value = null) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return value; },
    async text() { return value === null ? "" : JSON.stringify(value); },
  };
}

test("GitHub adapter requires owner-enforced immutable releases before mutation", async () => {
  const calls = [];
  const api = new GitHubApi({
    repository: "soksak-ai/soksak-spec",
    token: "installation-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return reply(200, { enabled: true, enforced_by_owner: true });
    },
  });
  await api.assertImmutable();
  assert.equal(calls[0].options.headers["X-GitHub-Api-Version"], "2026-03-10");
  assert.equal(calls[0].options.redirect, "error");

  const locallyEnabled = new GitHubApi({
    repository: "soksak-ai/soksak-spec",
    token: "installation-token",
    fetchImpl: async () => reply(200, { enabled: true, enforced_by_owner: false }),
  });
  await assert.rejects(locallyEnabled.assertImmutable(), /owner-enforced/);
});

test("GitHub adapter peels tags and audits every asset page", async () => {
  const commit = "a".repeat(40);
  const annotated = "b".repeat(40);
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ name: `asset-${index}` }));
  const last = { name: "last" };
  const api = new GitHubApi({
    repository: "soksak-ai/soksak-spec",
    token: "installation-token",
    fetchImpl: async (url) => {
      if (url.endsWith("/git/ref/tags/soksak-spec-v0.9.7")) return reply(200, { object: { type: "tag", sha: annotated } });
      if (url.endsWith(`/git/tags/${annotated}`)) return reply(200, { object: { type: "commit", sha: commit } });
      if (url.endsWith("/releases/7/assets?per_page=100&page=1")) return reply(200, firstPage);
      if (url.endsWith("/releases/7/assets?per_page=100&page=2")) return reply(200, [last]);
      throw new Error(`unexpected URL: ${url}`);
    },
  });
  assert.equal(await api.getTagCommit("soksak-spec-v0.9.7"), commit);
  assert.deepEqual(await api.listAssets({ id: 7 }), [...firstPage, last]);
});

test("GitHub adapter creates a draft, uploads bytes, and publishes without replacing assets", async () => {
  const calls = [];
  const responses = [
    reply(201, {}),
    reply(201, { id: 7, draft: true }),
    reply(201, { name: "asset.tgz" }),
    reply(200, { id: 7, draft: false, immutable: true }),
  ];
  const api = new GitHubApi({
    repository: "soksak-ai/soksak-spec",
    token: "installation-token",
    fetchImpl: async (url, options) => { calls.push({ url, options }); return responses.shift(); },
  });
  const bytes = Buffer.from("archive");
  await api.createTag("soksak-spec-v0.9.7", "a".repeat(40));
  await api.createDraft("soksak-spec-v0.9.7", "a".repeat(40));
  await api.uploadAsset({ id: 7 }, { name: "asset.tgz", bytes, contentType: "application/gzip" });
  await api.publishDraft({ id: 7 }, false);
  assert.deepEqual(JSON.parse(calls[0].options.body), { ref: "refs/tags/soksak-spec-v0.9.7", sha: "a".repeat(40) });
  assert.equal(JSON.parse(calls[1].options.body).draft, true);
  assert.deepEqual(calls[2].options.body, bytes);
  assert.deepEqual(JSON.parse(calls[3].options.body), { draft: false, prerelease: false, make_latest: "true" });
});
