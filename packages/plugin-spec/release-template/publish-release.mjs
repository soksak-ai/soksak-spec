// Owner-immutable GitHub release publication. The asset set of one release directory is collected by
// publish-canonical-release.mjs from the bare file names in release.json; this module uploads that
// set under one tag and confirms the sealed release.
import { createHash } from "node:crypto";

import { RELEASE_FILE_RE } from "../dist/release-primitives.js";

const API_VERSION = "2026-03-10";
const COMMIT_RE = /^[a-f0-9]{40}$/;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function validateAsset(asset) {
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) throw new Error("release asset must be an object");
  if (typeof asset.name !== "string" || !RELEASE_FILE_RE.test(asset.name)) throw new Error(`unsafe release asset name: ${asset.name}`);
  if (!Buffer.isBuffer(asset.bytes) || asset.bytes.length === 0) throw new Error(`release asset must contain bytes: ${asset.name}`);
  if (asset.size !== asset.bytes.length) throw new Error(`release asset size mismatch: ${asset.name}`);
  if (!DIGEST_RE.test(asset.digest) || asset.digest !== digest(asset.bytes)) throw new Error(`release asset digest mismatch: ${asset.name}`);
  if (asset.contentType !== "application/gzip" && asset.contentType !== "application/json") {
    throw new Error(`release asset content type is not allowed: ${asset.name}`);
  }
}

function validateRelease(release, tag, prerelease) {
  if (
    !release || !Number.isSafeInteger(release.id) || release.id <= 0 ||
    release.tag_name !== tag || release.name !== tag ||
    typeof release.draft !== "boolean" || release.prerelease !== prerelease
  ) {
    throw new Error(`remote release identity mismatch: ${tag}`);
  }
}

function compareRemoteAssets(expected, remote, allowMissing) {
  const expectedByName = new Map(expected.map((asset) => [asset.name, asset]));
  const remoteByName = new Map();
  for (const asset of remote) {
    if (!asset || typeof asset.name !== "string" || remoteByName.has(asset.name)) {
      throw new Error(`duplicate or invalid remote release asset: ${asset?.name ?? "unknown"}`);
    }
    remoteByName.set(asset.name, asset);
    const local = expectedByName.get(asset.name);
    if (!local) throw new Error(`undeclared remote release asset: ${asset.name}`);
    if (asset.state !== "uploaded") throw new Error(`remote asset is not uploaded: ${asset.name}`);
    if (asset.size !== local.size) throw new Error(`remote asset size mismatch: ${asset.name}`);
    if (asset.digest !== local.digest) throw new Error(`remote asset digest mismatch: ${asset.name}`);
  }
  const missing = expected.filter((asset) => !remoteByName.has(asset.name));
  if (!allowMissing && missing.length > 0) {
    throw new Error(`remote release is missing assets: ${missing.map(({ name }) => name).join(",")}`);
  }
  return missing;
}

const DEFAULT_SETTLE_ATTEMPTS = 12;
const defaultSleep = (ms) => new Promise((settle) => setTimeout(settle, ms));

// Publishing a draft under owner-immutable enforcement seals the release ASYNCHRONOUSLY on GitHub's
// side — the release read immediately after PATCH draft:false transiently reports a mid-seal identity
// before it settles. Re-read until the release is in a coherent terminal state (valid identity, no
// longer a draft, immutable stamped, tag still pinned, every declared asset present). This is what
// separates a real, complete publication from a mid-seal transient.
async function confirmSealed({ api, tag, commit, prerelease, assets }) {
  const release = await api.getRelease(tag);
  if (release === null) throw new Error(`published release is not visible: ${tag}`);
  validateRelease(release, tag, prerelease);
  if (release.draft || release.immutable !== true) throw new Error("published release is not immutable");
  if (await api.getTagCommit(tag) !== commit) throw new Error(`tag ${tag} changed during publication`);
  compareRemoteAssets(assets, await api.listAssets(release), false);
  await api.assertImmutable();
  return release;
}

// Fails closed: a release that never settles exhausts the attempts and the last seal error wins.
async function pollUntilSealed(action, attempts, sleep) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await sleep(Math.min(2 ** attempt, 8) * 1_000);
    }
  }
  throw lastError;
}

export async function publishImmutableRelease({
  repository, commit, tag, prerelease, assets, api,
  settleAttempts = DEFAULT_SETTLE_ATTEMPTS, sleep = defaultSleep,
}) {
  if (!REPOSITORY_RE.test(repository)) throw new Error("repository must be an owner/name slug");
  if (!COMMIT_RE.test(commit)) throw new Error("commit must be an exact lowercase 40-character SHA");
  // The tag is one bare segment of the download url, the same grammar as a release file name.
  if (typeof tag !== "string" || !RELEASE_FILE_RE.test(tag) || typeof prerelease !== "boolean") throw new Error("release tag or prerelease identity is invalid");
  if (!Array.isArray(assets) || assets.length === 0) throw new Error("release assets are required");
  const seen = new Set();
  for (const asset of assets) {
    validateAsset(asset);
    if (seen.has(asset.name)) throw new Error(`duplicate local release asset: ${asset.name}`);
    seen.add(asset.name);
  }

  await api.assertImmutable();
  const currentTagCommit = await api.getTagCommit(tag);
  if (currentTagCommit === null) await api.createTag(tag, commit);
  else if (currentTagCommit !== commit) throw new Error(`tag ${tag} points to a different commit`);

  let release = await api.getRelease(tag);
  if (release === null) release = await api.createDraft(tag, commit, prerelease);
  validateRelease(release, tag, prerelease);
  let remoteAssets = await api.listAssets(release);
  const missing = compareRemoteAssets(assets, remoteAssets, release.draft);
  if (!release.draft) {
    if (release.immutable !== true) throw new Error("published release is not immutable");
    return { state: "already-published", tag, commit, assets: assets.length };
  }
  for (const asset of missing) {
    const uploaded = await api.uploadAsset(release, asset);
    compareRemoteAssets([asset], [uploaded], false);
  }
  remoteAssets = await api.listAssets(release);
  compareRemoteAssets(assets, remoteAssets, false);
  await api.publishDraft(release, prerelease);
  await pollUntilSealed(() => confirmSealed({ api, tag, commit, prerelease, assets }), settleAttempts, sleep);
  return { state: "published", tag, commit, assets: assets.length };
}

export class GitHubApi {
  constructor({ repository, token, fetchImpl = globalThis.fetch }) {
    if (!REPOSITORY_RE.test(repository)) throw new Error("repository must be an owner/name slug");
    if (!token) throw new Error("short-lived release GitHub App token is required");
    if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");
    this.repository = repository;
    this.token = token;
    this.fetch = fetchImpl;
    this.apiRoot = `https://api.github.com/repos/${repository}`;
  }

  async request(method, url, { body, contentType = "application/json", allow404 = false } = {}) {
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${this.token}`,
      "X-GitHub-Api-Version": API_VERSION,
    };
    let payload;
    if (body !== undefined) {
      headers["Content-Type"] = contentType;
      payload = Buffer.isBuffer(body) ? body : JSON.stringify(body);
    }
    const response = await this.fetch(url, { method, headers, body: payload, redirect: "error" });
    if (allow404 && response.status === 404) return null;
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 2_000);
      throw new Error(`GitHub API ${method} ${url} failed ${response.status}: ${detail}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async assertImmutable() {
    const settings = await this.request("GET", `${this.apiRoot}/immutable-releases`, { allow404: true });
    if (settings?.enabled !== true || settings.enforced_by_owner !== true) {
      throw new Error("owner-enforced immutable releases must be enabled before tagging");
    }
    return settings;
  }

  async getTagCommit(tag) {
    let value = await this.request("GET", `${this.apiRoot}/git/ref/tags/${encodeURIComponent(tag)}`, { allow404: true });
    if (value === null) return null;
    const seen = new Set();
    for (let depth = 0; depth < 8; depth += 1) {
      const object = value.object;
      if (!object || !COMMIT_RE.test(object.sha)) throw new Error(`invalid tag object: ${tag}`);
      if (object.type === "commit") return object.sha;
      if (object.type !== "tag" || seen.has(object.sha)) throw new Error(`invalid annotated tag chain: ${tag}`);
      seen.add(object.sha);
      value = await this.request("GET", `${this.apiRoot}/git/tags/${object.sha}`);
    }
    throw new Error(`annotated tag chain is too deep: ${tag}`);
  }

  async createTag(tag, commit) {
    return this.request("POST", `${this.apiRoot}/git/refs`, { body: { ref: `refs/tags/${tag}`, sha: commit } });
  }

  async listPaginated(url, label) {
    const items = [];
    for (let page = 1; page <= 1_000; page += 1) {
      const pageItems = await this.request("GET", `${url}${url.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      if (!Array.isArray(pageItems) || pageItems.length > 100) throw new Error(`${label} response is invalid`);
      items.push(...pageItems);
      if (pageItems.length < 100) return items;
    }
    throw new Error(`${label} exceeds the bounded publication audit`);
  }

  async getRelease(tag) {
    const matches = (await this.listPaginated(`${this.apiRoot}/releases`, "GitHub release collection"))
      .filter((release) => release?.tag_name === tag);
    if (matches.length > 1) throw new Error(`duplicate remote releases for tag: ${tag}`);
    return matches[0] ?? null;
  }

  async createDraft(tag, commit, prerelease) {
    return this.request("POST", `${this.apiRoot}/releases`, {
      body: { tag_name: tag, target_commitish: commit, name: tag, body: "", draft: true, prerelease, generate_release_notes: false },
    });
  }

  async listAssets(release) {
    return this.listPaginated(`${this.apiRoot}/releases/${release.id}/assets`, "GitHub release asset collection");
  }

  async uploadAsset(release, asset) {
    const url = `https://uploads.github.com/repos/${this.repository}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`;
    return this.request("POST", url, { body: asset.bytes, contentType: asset.contentType });
  }

  async publishDraft(release, prerelease) {
    return this.request("PATCH", `${this.apiRoot}/releases/${release.id}`, {
      body: { draft: false, prerelease, make_latest: prerelease ? "false" : "true" },
    });
  }
}
