#!/usr/bin/env node
// Audits every published release of one sidecar repository in the org. release.json names each file
// by bare name; the download url is derived from the org, the id, the tag version, and that name.
// The GitHub asset with that name must report the same size and digest as release.json, and the
// downloaded bytes must match before the archive is opened.
import crypto from "node:crypto";

import { parseReleaseManifest } from "../../dist/release.js";
import { COMPONENT_ID_RE, GITHUB_ORG, STRICT_SEMVER_RE } from "../../dist/release-primitives.js";
import { releaseURL } from "../resolve-release.mjs";
import { assertNativeBinaryTarget } from "./native-binary.mjs";
import { readSidecarReleaseArchive } from "./archive.mjs";
import { isEntryModule } from "../entry.mjs";

const REPOSITORY_PREFIX = `https://github.com/${GITHUB_ORG}/`;

// A sidecar repository is https://github.com/<GITHUB_ORG>/<id> with <id> in the component id grammar.
function repositoryId(repository) {
  const id = typeof repository === "string" && repository.startsWith(REPOSITORY_PREFIX) ? repository.slice(REPOSITORY_PREFIX.length) : "";
  if (!COMPONENT_ID_RE.test(id)) throw new Error(`sidecar repository must be ${REPOSITORY_PREFIX}<id>`);
  return id;
}

// A release tag is one leading v followed by a version in the strict SemVer grammar.
function tagVersion(tag) {
  const version = typeof tag === "string" && tag.startsWith("v") ? tag.slice(1) : "";
  if (!STRICT_SEMVER_RE.test(version)) throw new Error("release tag must be v<version>");
  return version;
}

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

// The GitHub asset named by one release.json entry must state the same size and digest.
function assertAssetMatches(assets, reference, label) {
  const asset = assets.get(reference.file);
  if (!asset || asset.size !== reference.size || asset.digest !== `sha256:${reference.sha256}`) {
    throw new Error(`GitHub asset does not match ${label} in release.json: ${reference.file}`);
  }
}

async function readRelease({ request, assets, id, version }) {
  const url = releaseURL(id, version, "release.json");
  const bytes = await required(request, url);
  assertAssetMatches(assets, { file: "release.json", size: bytes.length, sha256: digest(bytes) }, "release.json");
  const parsed = parseReleaseManifest(JSON.parse(bytes.toString("utf8")));
  if (!parsed.ok) throw new Error(`release.json is invalid: ${parsed.errors.join("; ")}`);
  const release = parsed.value;
  if (release.kind !== "sidecar" || release.id !== id || release.version !== version) {
    throw new Error("release.json identity does not match its GitHub release");
  }
  return release;
}

async function auditArtifact({ request, id, version, artifact, assets }) {
  if (artifact.format !== "tar.gz") throw new Error("release artifact format is not tar.gz");
  assertAssetMatches(assets, artifact, "artifact");
  const bytes = await required(request, releaseURL(id, version, artifact.file));
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
  const id = repositoryId(repository);
  if (tag !== undefined) tagVersion(tag);
  const releases = [];
  for (let page = 1; ; page += 1) {
    const url = `https://api.github.com/repos/${GITHUB_ORG}/${id}/releases?per_page=100&page=${page}`;
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
      const version = tagVersion(tag);
      const assets = assetMap(release);
      const value = await readRelease({ request, assets, id, version });
      for (const artifact of value.artifacts) {
        report.artifacts += 1;
        try {
          await auditArtifact({ request, id, version, artifact, assets });
        } catch (error) {
          report.failures.push({ tag, target: artifact.target, error: error instanceof Error ? error.message : String(error) });
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

if (isEntryModule(import.meta.url)) {
  try {
    const report = await auditSidecarRepository(auditOptions(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.failures.length > 0) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
