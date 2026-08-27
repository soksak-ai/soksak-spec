#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { RELEASE_FILE_RE } from "../dist/release-primitives.js";
import { verifyComponentBuildReceipt } from "../dist/componentBuildReceipt.js";
import { parseReleaseManifest, releaseIdentity } from "../dist/release.js";
import { GitHubApi, publishImmutableRelease } from "./publish-release.mjs";
import { isEntryModule } from "./entry.mjs";

const COMMIT_RE = /^[a-f0-9]{40}$/;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

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
  const receiptReference = parsed.value.evidence.find(({ file }) => file === "component-build-receipt.json");
  if (!receiptReference) throw new Error("component build receipt is required for publication");
  const receiptBytes = regularFile(join(directory, receiptReference.file), "component build receipt");
  if (receiptBytes.length !== receiptReference.size || digest(receiptBytes) !== receiptReference.sha256) {
    throw new Error("component build receipt metadata mismatch");
  }
  let receipt;
  try { receipt = JSON.parse(receiptBytes.toString("utf8")); }
  catch { throw new Error("component build receipt must be JSON"); }
  verifyComponentBuildReceipt({ receipt, release: parsed.value });
  const repositoryURL = `https://github.com/${repository}`;
  if (parsed.value.source.repository !== repositoryURL || parsed.value.source.commit !== commit || identity.id !== repository.split("/")[1]) {
    throw new Error("release identity does not match repository and commit");
  }
  // release.json records bare file names; each names one asset of the release directory.
  const expected = new Map([["release.json", null]]);
  for (const metadata of [parsed.value.manifest, ...parsed.value.evidence]) {
    const name = metadata.file;
    if (!RELEASE_FILE_RE.test(name)) throw new Error("unsafe release metadata name");
    const bytes = regularFile(join(directory, name), `release metadata ${name}`);
    if (bytes.length !== metadata.size || digest(bytes) !== metadata.sha256) throw new Error(`release metadata mismatch: ${name}`);
    expected.set(name, null);
  }
  for (const artifact of parsed.value.artifacts) {
    const name = artifact.file;
    if (!RELEASE_FILE_RE.test(name)) throw new Error("unsafe release artifact name");
    const bytes = regularFile(join(directory, name), `release artifact ${name}`);
    if (bytes.length !== artifact.size || digest(bytes) !== artifact.sha256) throw new Error(`release artifact digest mismatch: ${name}`);
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

if (isEntryModule(import.meta.url)) {
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
