#!/usr/bin/env node
import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { assertNativeBinaryTarget } from "./native-binary.mjs";
import { readSidecarReleaseArchive } from "./archive.mjs";

const REPOSITORY = /^https:\/\/github[.]com\/([A-Za-z0-9-]+)\/([a-z0-9][a-z0-9-]*)$/;

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function githubRequest(url) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "soksak-release-audit" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  return { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
}

async function required(request, url) {
  const response = await request(url);
  if (!response || response.status !== 200 || !Buffer.isBuffer(response.body)) {
    throw new Error(`HTTP ${response?.status ?? "missing"}: ${url}`);
  }
  return response.body;
}

function assetMap(release) {
  if (!Array.isArray(release.assets)) throw new Error("GitHub release assets are missing");
  const result = new Map();
  for (const asset of release.assets) {
    if (!asset || typeof asset.name !== "string" || result.has(asset.name)) throw new Error("GitHub release asset names are invalid");
    result.set(asset.name, asset);
  }
  return result;
}

function validateReleaseIdentity(value, repository, id, tag) {
  const version = tag.startsWith("v") ? tag.slice(1) : "";
  if (!value || value.kind !== "sidecar" || value.id !== id || value.version !== version ||
      value.source?.repository !== repository || !/^[0-9a-f]{40}$/.test(value.source?.commit ?? "") ||
      !Array.isArray(value.artifacts) || value.artifacts.length === 0) {
    throw new Error("release.json identity does not match its GitHub release");
  }
  return version;
}

async function auditArtifact({ request, repository, id, version, artifact, assets }) {
  if (!artifact || typeof artifact.target !== "string" || typeof artifact.url !== "string" ||
      !Number.isSafeInteger(artifact.size) || artifact.size < 1 || !/^[0-9a-f]{64}$/.test(artifact.sha256 ?? "") ||
      artifact.format !== "tar.gz" || artifact.manifest !== "sidecar.json") {
    throw new Error("release artifact metadata is invalid");
  }
  const expectedPrefix = `${repository}/releases/download/v${version}/`;
  if (!artifact.url.startsWith(expectedPrefix)) throw new Error("release artifact URL is not canonical");
  const name = path.posix.basename(new URL(artifact.url).pathname);
  const asset = assets.get(name);
  if (!asset || asset.browser_download_url !== artifact.url || asset.size !== artifact.size) {
    throw new Error("GitHub asset does not match release artifact metadata");
  }
  if (asset.digest && asset.digest !== `sha256:${artifact.sha256}`) throw new Error("GitHub asset digest differs from release.json");
  const bytes = await required(request, artifact.url);
  if (bytes.length !== artifact.size || digest(bytes) !== artifact.sha256) throw new Error("downloaded artifact bytes differ from release.json");
  const archived = readSidecarReleaseArchive(bytes);
  const manifestEntry = archived.find((entry) => entry.name === "sidecar.json");
  if (!manifestEntry) throw new Error("archive has no sidecar.json");
  const manifest = JSON.parse(manifestEntry.data.toString("utf8"));
  const process = `dist/${id}${artifact.target.includes("windows") ? ".exe" : ""}`;
  if (manifest.id !== id || manifest.version !== version || manifest.process !== process) {
    throw new Error("archived sidecar identity differs from release.json");
  }
  const executable = archived.find((entry) => entry.name === process);
  if (!executable) throw new Error("archive has no declared sidecar process");
  assertNativeBinaryTarget(executable.data, artifact.target);
}

export async function auditSidecarRepository({ repository, tag, request = githubRequest }) {
  const match = REPOSITORY.exec(repository);
  if (!match) throw new Error("canonical GitHub sidecar repository URL required");
  if (tag !== undefined && !/^v(?:0|[1-9][0-9]*)[.](?:0|[1-9][0-9]*)[.](?:0|[1-9][0-9]*)$/.test(tag)) {
    throw new Error("requested release tag must be an exact stable version");
  }
  const [, owner, id] = match;
  const releases = [];
  for (let page = 1; ; page += 1) {
    const url = `https://api.github.com/repos/${owner}/${id}/releases?per_page=100&page=${page}`;
    const values = JSON.parse((await required(request, url)).toString("utf8"));
    if (!Array.isArray(values)) throw new Error("GitHub releases response must be an array");
    releases.push(...values.filter((release) => !release.draft));
    if (values.length < 100) break;
  }

  const selected = tag === undefined ? releases : releases.filter((release) => release.tag_name === tag);
  if (tag !== undefined && selected.length !== 1) throw new Error(`requested release tag does not exist: ${tag}`);
  const report = { schema: "soksak-sidecar-release-audit-v1", repository, releases: selected.length, artifacts: 0, failures: [] };
  for (const release of selected) {
    const tag = typeof release.tag_name === "string" ? release.tag_name : "unknown";
    try {
      const assets = assetMap(release);
      const manifestAsset = assets.get("release.json");
      if (!manifestAsset || typeof manifestAsset.browser_download_url !== "string") throw new Error("GitHub release has no release.json asset");
      const releaseBytes = await required(request, manifestAsset.browser_download_url);
      if (manifestAsset.size !== releaseBytes.length ||
          (manifestAsset.digest && manifestAsset.digest !== `sha256:${digest(releaseBytes)}`)) {
        throw new Error("release.json asset bytes differ from GitHub metadata");
      }
      const value = JSON.parse(releaseBytes.toString("utf8"));
      const version = validateReleaseIdentity(value, repository, id, tag);
      const seen = new Set();
      for (const artifact of value.artifacts) {
        report.artifacts += 1;
        const target = typeof artifact?.target === "string" ? artifact.target : "unknown";
        if (seen.has(target)) {
          report.failures.push({ tag, target, error: "duplicate release artifact target" });
          continue;
        }
        seen.add(target);
        try {
          await auditArtifact({ request, repository, id, version, artifact, assets });
        } catch (error) {
          report.failures.push({ tag, target, error: error instanceof Error ? error.message : String(error) });
        }
      }
    } catch (error) {
      report.failures.push({ tag, target: null, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return report;
}

function auditOptions(argv) {
  if (argv.length < 2 || argv.length % 2 !== 0) throw new Error("usage: audit-releases.mjs --repository <canonical-github-url> [--tag <exact-tag>]");
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if ((name !== "--repository" && name !== "--tag") || !value || values[name]) {
      throw new Error("usage: audit-releases.mjs --repository <canonical-github-url> [--tag <exact-tag>]");
    }
    values[name] = value;
  }
  if (!values["--repository"]) throw new Error("--repository is required");
  return { repository: values["--repository"], tag: values["--tag"] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await auditSidecarRepository(auditOptions(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.failures.length > 0) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
