#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseReleaseManifest, releaseIdentity } from "../dist/release.js";
import { GitHubApi, publishImmutableRelease } from "./publish-release.mjs";

const COMMIT_RE = /^[a-f0-9]{40}$/;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ASSET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function regularFile(filename, label) {
  const stat = lstatSync(filename);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label}: regular file required`);
  return readFileSync(filename);
}

function describeAsset(filename) {
  const name = basename(filename);
  const bytes = regularFile(filename, `release asset ${name}`);
  return {
    name, bytes, size: bytes.length, digest: `sha256:${digest(bytes)}`,
    contentType: name.endsWith(".json") ? "application/json" : "application/gzip",
  };
}

export function collectCanonicalReleaseAssets({ repository, commit, artifacts, manifest }) {
  if (!REPOSITORY_RE.test(repository) || !COMMIT_RE.test(commit)) throw new Error("repository and exact commit are required");
  if (!isAbsolute(artifacts) || !isAbsolute(manifest)) throw new Error("artifact and manifest paths must be absolute");
  const directory = resolve(artifacts);
  const manifestPath = resolve(manifest);
  if (dirname(manifestPath) !== directory || basename(manifestPath) !== "release.json") throw new Error("release.json must be inside the artifact directory");
  const parsed = parseReleaseManifest(JSON.parse(regularFile(manifestPath, "release manifest")));
  if (!parsed.ok) throw new Error(`release manifest is invalid: ${parsed.errors.join("; ")}`);
  const identity = releaseIdentity(parsed.value);
  const repositoryURL = `https://github.com/${repository}`;
  if (parsed.value.source.repository !== repositoryURL || parsed.value.source.commit !== commit || identity.id !== repository.split("/")[1]) {
    throw new Error("release identity does not match repository and commit");
  }
  const expected = new Map([["release.json", null]]);
  for (const artifact of parsed.value.artifacts) {
    const name = basename(new URL(artifact.url).pathname);
    if (!ASSET_RE.test(name)) throw new Error("unsafe release artifact name");
    const bytes = regularFile(join(directory, name), `release artifact ${name}`);
    if (bytes.length !== artifact.size || digest(bytes) !== artifact.sha256) throw new Error(`release artifact digest mismatch: ${name}`);
    expected.set(name, null);
  }
  for (const report of parsed.value.reports) {
    const name = basename(new URL(report.url).pathname);
    if (!/^conformance-[a-z0-9-]+\.json$/.test(name)) throw new Error("invalid conformance report name");
    const bytes = regularFile(join(directory, name), `conformance report ${name}`);
    if (digest(bytes) !== report.sha256) throw new Error(`conformance report digest mismatch: ${name}`);
    expected.set(name, null);
  }
  const actual = readdirSync(directory, { withFileTypes: true }).map((entry) => {
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("artifact input must contain only regular files");
    return entry.name;
  }).sort();
  const names = [...expected.keys()].sort();
  if (JSON.stringify(actual) !== JSON.stringify(names)) throw new Error("artifact input does not equal the declared release asset set");
  return {
    assets: names.map((name) => describeAsset(join(directory, name))),
    prerelease: identity.version.includes("-"), tag: `v${identity.version}`,
  };
}

function options(argv) {
  const allowed = new Set(["repository", "commit", "artifacts", "manifest"]);
  if (argv.length !== allowed.size * 2) throw new Error("four named publication options are required");
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index].replace(/^--/, "");
    if (!allowed.has(key) || values[key] !== undefined) throw new Error("invalid publication option");
    values[key] = argv[index + 1];
  }
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const input = options(process.argv.slice(2));
    const release = collectCanonicalReleaseAssets(input);
    const api = new GitHubApi({ repository: input.repository, token: process.env.SOKSAK_RELEASE_TOKEN });
    const result = await publishImmutableRelease({ repository: input.repository, commit: input.commit, ...release, api });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
