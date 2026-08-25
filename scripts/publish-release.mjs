#!/usr/bin/env node
// Publishes the spec's own release: the asset set of artifacts/ is collected from the bare file
// names in release.json by the canonical collector; the workspace owner metadata binds the release
// identity to this repository and version.
import { lstatSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseReleaseManifest, releaseIdentity } from "../packages/plugin-spec/dist/spec.js";
import { collectCanonicalReleaseAssets } from "../packages/plugin-spec/release-template/publish-canonical-release.mjs";
import { GitHubApi, publishImmutableRelease } from "../packages/plugin-spec/release-template/publish-release.mjs";

export { GitHubApi, publishImmutableRelease };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readRegularFile(filename, label) {
  const stat = lstatSync(filename);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label}: regular file required`);
  return readFileSync(filename);
}

function readOwnerConfiguration() {
  const workspace = JSON.parse(readRegularFile(join(root, "package.json"), "workspace package").toString("utf8"));
  const owner = workspace.soksakRelease;
  if (
    owner === null || typeof owner !== "object" || Array.isArray(owner) ||
    !owner.spec || typeof owner.spec !== "object" || owner.spec.id !== "soksak-spec" || owner.spec.version !== workspace.version ||
    typeof owner.repository !== "string" ||
    owner.manifest !== "release.json"
  ) {
    throw new Error("workspace release owner metadata is invalid");
  }
  return owner;
}

export function collectReleaseAssets({ repository, commit, artifacts, manifest }) {
  const owner = readOwnerConfiguration();
  if (owner.repository !== `https://github.com/${repository}` || basename(manifest) !== owner.manifest) {
    throw new Error("release owner does not match the requested repository or manifest");
  }
  const parsed = parseReleaseManifest(JSON.parse(readRegularFile(manifest, "release manifest").toString("utf8")));
  if (!parsed.ok) throw new Error(`release manifest is invalid:\n${parsed.errors.join("\n")}`);
  const identity = releaseIdentity(parsed.value);
  if (identity.kind !== "spec" || identity.id !== owner.spec.id || identity.version !== owner.spec.version) {
    throw new Error("release manifest identity is invalid");
  }
  return collectCanonicalReleaseAssets({ repository, commit, artifacts, manifest });
}

function parseOptions(argv) {
  const allowed = new Set(["repository", "commit", "artifacts", "manifest"]);
  if (argv.length !== allowed.size * 2) {
    throw new Error("usage: publish-release.mjs --repository <owner/name> --commit <sha> --artifacts <absolute> --manifest <absolute>");
  }
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const key = flag.startsWith("--") ? flag.slice(2) : "";
    if (!allowed.has(key) || values[key] !== undefined || typeof argv[index + 1] !== "string") {
      throw new Error("invalid or duplicate publication option");
    }
    values[key] = argv[index + 1];
  }
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseOptions(process.argv.slice(2));
    const release = collectReleaseAssets(options);
    const api = new GitHubApi({ repository: options.repository, token: process.env.SOKSAK_RELEASE_TOKEN });
    const result = await publishImmutableRelease({ repository: options.repository, commit: options.commit, ...release, api });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
