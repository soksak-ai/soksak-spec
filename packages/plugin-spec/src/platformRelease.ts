// Developer-facing platform package release. This wire is separate from the
// plugin/sidecar/kit install manifest: registries install runtime units, while
// spec and SDK consumers pin developer packages directly to owner-controlled
// GitHub Release bytes or an exact source commit.

import type { PlatformParseResult, UnitSourceReference } from "./release.js";
import {
  GIT_COMMIT_RE,
  PLATFORM_RELEASE_SPEC,
  SHA256_RE,
  UNIT_ID_RE,
  githubReleaseAssetBelongsTo,
  isStrictSemver,
  parseCanonicalGithubRepository,
  parseCanonicalGithubReleaseAssetUrl,
  releaseTagForUnit,
} from "./unit.js";
import { checkKnownKeys, isRecord } from "./util.js";

export { PLATFORM_RELEASE_SPEC } from "./unit.js";
export const PLATFORM_RELEASE_KINDS = ["spec", "sdk"] as const;
export type PlatformReleaseKind = (typeof PLATFORM_RELEASE_KINDS)[number];
export const PLATFORM_PACKAGE_ECOSYSTEMS = ["javascript", "rust"] as const;
export type PlatformPackageEcosystem = (typeof PLATFORM_PACKAGE_ECOSYSTEMS)[number];

const JAVASCRIPT_PACKAGE_RE =
  /^(?:@[a-z0-9][a-z0-9._-]{0,126}\/[a-z0-9][a-z0-9._-]{0,126}|[a-z0-9][a-z0-9._-]{0,126})$/;
const RUST_PACKAGE_RE = /^[a-z0-9][a-z0-9_-]{0,127}$/;

export interface PlatformJavascriptArtifact {
  url: string;
  sha256: string;
  format: "tgz";
}

export interface PlatformJavascriptPackage {
  ecosystem: "javascript";
  name: string;
  version: string;
  artifact: PlatformJavascriptArtifact;
}

export interface PlatformRustPackage {
  ecosystem: "rust";
  name: string;
  version: string;
}

export type PlatformReleasePackage =
  | PlatformJavascriptPackage
  | PlatformRustPackage;

export interface PlatformReleaseManifestReference {
  url: string;
  sha256: string;
}

export interface PlatformReleaseDependency {
  kind: PlatformReleaseKind;
  id: string;
  version: string;
  manifest: PlatformReleaseManifestReference;
}

export interface PlatformReleaseManifest {
  spec: typeof PLATFORM_RELEASE_SPEC;
  kind: PlatformReleaseKind;
  id: string;
  version: string;
  source: UnitSourceReference;
  releaseTag: string;
  dependencies: PlatformReleaseDependency[];
  packages: PlatformReleasePackage[];
}

function strictObject(
  raw: unknown,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
  errors: string[],
): Record<string, unknown> | null {
  if (!isRecord(raw)) {
    errors.push(`${label}: object required`);
    return null;
  }
  checkKnownKeys(raw, allowed, label, errors);
  for (const key of required) if (!(key in raw)) errors.push(`${label}.${key}: required`);
  return raw;
}

function parseSource(raw: unknown, errors: string[]): UnitSourceReference | null {
  const before = errors.length;
  const source = strictObject(
    raw,
    ["commit", "repository"],
    ["commit", "repository"],
    "platformRelease.source",
    errors,
  );
  if (!source) return null;
  const repository = typeof source.repository === "string" ? source.repository : "";
  const commit = typeof source.commit === "string" ? source.commit : "";
  if (!parseCanonicalGithubRepository(repository)) {
    errors.push("platformRelease.source.repository: canonical GitHub repository URL required");
  }
  if (!GIT_COMMIT_RE.test(commit)) {
    errors.push(
      "platformRelease.source.commit: exact lowercase 40-character Git commit required",
    );
  }
  return errors.length === before ? { repository, commit } : null;
}

function parseJavascriptPackage(
  value: Record<string, unknown>,
  label: string,
  owner: { repository: string; releaseTag: string; version: string },
  errors: string[],
): PlatformJavascriptPackage | null {
  const before = errors.length;
  checkKnownKeys(value, ["artifact", "ecosystem", "name", "version"], label, errors);
  if (typeof value.name !== "string" || !JAVASCRIPT_PACKAGE_RE.test(value.name)) {
    errors.push(`${label}.name: canonical JavaScript package name required`);
  }
  if (value.version !== owner.version) {
    errors.push(`${label}.version: must equal platformRelease.version`);
  }
  const artifact = strictObject(
    value.artifact,
    ["format", "sha256", "url"],
    ["format", "sha256", "url"],
    `${label}.artifact`,
    errors,
  );
  let parsedArtifact: PlatformJavascriptArtifact | null = null;
  if (artifact) {
    const url = typeof artifact.url === "string" ? artifact.url : "";
    const sha256 = typeof artifact.sha256 === "string" ? artifact.sha256 : "";
    if (!githubReleaseAssetBelongsTo(url, owner.repository, owner.releaseTag)) {
      errors.push(
        `${label}.artifact.url: canonical same-repository GitHub Release asset URL required`,
      );
    }
    if (!url.endsWith(".tgz")) errors.push(`${label}.artifact.url: .tgz asset required`);
    if (!SHA256_RE.test(sha256)) errors.push(`${label}.artifact.sha256: exact lowercase SHA-256 required`);
    if (artifact.format !== "tgz") errors.push(`${label}.artifact.format: tgz required`);
    if (errors.length === before) parsedArtifact = { url, sha256, format: "tgz" };
  }
  if (errors.length !== before || !parsedArtifact) return null;
  return {
    ecosystem: "javascript",
    name: value.name as string,
    version: owner.version,
    artifact: parsedArtifact,
  };
}

function parseRustPackage(
  value: Record<string, unknown>,
  label: string,
  version: string,
  errors: string[],
): PlatformRustPackage | null {
  const before = errors.length;
  checkKnownKeys(value, ["ecosystem", "name", "version"], label, errors);
  if (typeof value.name !== "string" || !RUST_PACKAGE_RE.test(value.name)) {
    errors.push(`${label}.name: canonical Rust package name required`);
  }
  if (value.version !== version) errors.push(`${label}.version: must equal platformRelease.version`);
  return errors.length === before
    ? { ecosystem: "rust", name: value.name as string, version }
    : null;
}

function parseDependency(
  raw: unknown,
  index: number,
  owner: { kind: PlatformReleaseKind; id: string },
  errors: string[],
): PlatformReleaseDependency | null {
  const label = `platformRelease.dependencies[${index}]`;
  const before = errors.length;
  const value = strictObject(
    raw,
    ["id", "kind", "manifest", "version"],
    ["id", "kind", "manifest", "version"],
    label,
    errors,
  );
  if (!value) return null;
  const kind = typeof value.kind === "string" &&
    (PLATFORM_RELEASE_KINDS as readonly string[]).includes(value.kind)
    ? value.kind as PlatformReleaseKind
    : null;
  if (!kind) errors.push(`${label}.kind: spec|sdk required`);
  const id = typeof value.id === "string" ? value.id : "";
  if (!UNIT_ID_RE.test(id)) errors.push(`${label}.id: flat unit id required`);
  const version = typeof value.version === "string" ? value.version : "";
  if (!isStrictSemver(version)) errors.push(`${label}.version: strict SemVer required`);
  if (kind === owner.kind && id === owner.id) errors.push(`${label}: self dependency forbidden`);

  const manifest = strictObject(
    value.manifest,
    ["sha256", "url"],
    ["sha256", "url"],
    `${label}.manifest`,
    errors,
  );
  let parsedManifest: PlatformReleaseManifestReference | null = null;
  if (manifest) {
    const url = typeof manifest.url === "string" ? manifest.url : "";
    const sha256 = typeof manifest.sha256 === "string" ? manifest.sha256 : "";
    const asset = parseCanonicalGithubReleaseAssetUrl(url);
    if (
      !asset ||
      !releaseTagForUnit(id, version, asset.releaseTag) ||
      asset.asset !== `${id}-release.json`
    ) {
      errors.push(
        `${label}.manifest.url: canonical versioned GitHub Release manifest URL required`,
      );
    }
    if (!SHA256_RE.test(sha256)) {
      errors.push(`${label}.manifest.sha256: exact lowercase SHA-256 required`);
    }
    if (errors.length === before) parsedManifest = { url, sha256 };
  }
  if (errors.length !== before || !kind || !parsedManifest) return null;
  return { kind, id, version, manifest: parsedManifest };
}

export function parsePlatformReleaseManifest(
  raw: unknown,
): PlatformParseResult<PlatformReleaseManifest> {
  const errors: string[] = [];
  const value = strictObject(
    raw,
    ["dependencies", "id", "kind", "packages", "releaseTag", "source", "spec", "version"],
    ["dependencies", "id", "kind", "packages", "releaseTag", "source", "spec", "version"],
    "platformRelease",
    errors,
  );
  if (!value) return { ok: false, errors };

  if (value.spec !== PLATFORM_RELEASE_SPEC) {
    errors.push(`platformRelease.spec: ${PLATFORM_RELEASE_SPEC} required`);
  }
  const kind = typeof value.kind === "string" &&
    (PLATFORM_RELEASE_KINDS as readonly string[]).includes(value.kind)
    ? value.kind as PlatformReleaseKind
    : null;
  if (!kind) errors.push("platformRelease.kind: spec|sdk required");
  const id = typeof value.id === "string" ? value.id : "";
  if (!UNIT_ID_RE.test(id)) errors.push("platformRelease.id: flat unit id required");
  const version = typeof value.version === "string" ? value.version : "";
  if (!isStrictSemver(version)) errors.push("platformRelease.version: strict SemVer required");
  const releaseTag = typeof value.releaseTag === "string" ? value.releaseTag : "";
  if (!releaseTagForUnit(id, version, releaseTag)) {
    errors.push("platformRelease.releaseTag: v<version> or <id>-v<version> required");
  }
  const source = parseSource(value.source, errors);

  const dependencies: PlatformReleaseDependency[] = [];
  if (!Array.isArray(value.dependencies)) {
    errors.push("platformRelease.dependencies: array required");
  } else if (kind) {
    value.dependencies.forEach((rawDependency, index) => {
      const dependency = parseDependency(rawDependency, index, { kind, id }, errors);
      if (dependency) dependencies.push(dependency);
    });
    const keys = dependencies.map((item) => `${item.kind}\u0000${item.id}`);
    if (new Set(keys).size !== keys.length) {
      errors.push("platformRelease.dependencies: duplicate kind/id forbidden");
    }
    const sorted = [...keys].sort();
    if (keys.some((key, index) => key !== sorted[index])) {
      errors.push("platformRelease.dependencies: entries must be sorted by kind and id");
    }
  }

  const packages: PlatformReleasePackage[] = [];
  if (!Array.isArray(value.packages) || value.packages.length === 0) {
    errors.push("platformRelease.packages: non-empty array required");
  } else if (source) {
    value.packages.forEach((rawPackage, index) => {
      const label = `platformRelease.packages[${index}]`;
      if (!isRecord(rawPackage)) {
        errors.push(`${label}: object required`);
        return;
      }
      const parsed = rawPackage.ecosystem === "javascript"
        ? parseJavascriptPackage(
          rawPackage,
          label,
          { repository: source.repository, releaseTag, version },
          errors,
        )
        : rawPackage.ecosystem === "rust"
          ? parseRustPackage(rawPackage, label, version, errors)
          : null;
      if (parsed) packages.push(parsed);
      else if (rawPackage.ecosystem !== "javascript" && rawPackage.ecosystem !== "rust") {
        errors.push(`${label}.ecosystem: javascript|rust required`);
      }
    });
    const keys = packages.map((item) => `${item.ecosystem}\u0000${item.name}`);
    if (new Set(keys).size !== keys.length) {
      errors.push("platformRelease.packages: duplicate ecosystem/name forbidden");
    }
    const sorted = [...keys].sort();
    if (keys.some((key, index) => key !== sorted[index])) {
      errors.push("platformRelease.packages: entries must be sorted by ecosystem and name");
    }
  }

  if (errors.length > 0 || !kind || !source) return { ok: false, errors };
  return {
    ok: true,
    value: {
      spec: PLATFORM_RELEASE_SPEC,
      kind,
      id,
      version,
      source,
      releaseTag,
      dependencies,
      packages,
    },
  };
}
