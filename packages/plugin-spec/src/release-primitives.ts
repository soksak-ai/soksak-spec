// Public release primitives shared by plugin, sidecar, kit, registry, and conformance formats.
// Boundaries import these exact values and do not restate their grammar.

export {
  MAX_SEMVER_LENGTH,
  MAX_DEPENDENCY_CLAUSES,
  MAX_DEPENDENCY_RANGE_LENGTH,
  STRICT_SEMVER_PATTERN,
  STRICT_SEMVER_RE,
  isStrictSemver,
  isDependencyRange,
} from "./semver.js";

export const RELEASE_KINDS = ["contract", "kit", "plugin", "sidecar", "spec"] as const;
export type ReleaseKind = (typeof RELEASE_KINDS)[number];

// Component identity is flat because registry identity is qualified separately.
export const COMPONENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;
// Bare filename inside a release directory: no separator, not "." or "..". Same pattern as
// release.schema.json $defs.file. Every release asset name is validated by this grammar.
export const RELEASE_FILE_RE = /^(?!\.\.?$)[A-Za-z0-9._-]+$/;

export const SHA256_RE = /^[a-f0-9]{64}$/;
export const GIT_COMMIT_RE = /^[a-f0-9]{40}$/;

// Every release is published under this GitHub organization: source.repository is
// https://github.com/<GITHUB_ORG>/<id> and the release directory is derived from it.
export const GITHUB_ORG = "soksak-ai";

export const ANY_TARGET = "any" as const;
export const RUST_SIDECAR_TARGETS = [
  "aarch64-apple-darwin",
  "aarch64-pc-windows-msvc",
  "aarch64-unknown-linux-gnu",
  "aarch64-unknown-linux-musl",
  "x86_64-apple-darwin",
  "x86_64-pc-windows-msvc",
  "x86_64-unknown-linux-gnu",
  "x86_64-unknown-linux-musl",
] as const;
export const ARTIFACT_TARGETS = [ANY_TARGET, ...RUST_SIDECAR_TARGETS] as const;
export type RustSidecarTarget = (typeof RUST_SIDECAR_TARGETS)[number];
export type ArtifactTarget = (typeof ARTIFACT_TARGETS)[number];

// The 0.0.1 baseline enacts one archive format (gzip-compressed POSIX tar) with two conventional
// filename suffixes. ZIP remains invalid until its extractor enforces the same
// regular-file, portable-path, collision, and size invariants.
export const ARTIFACT_FORMATS = ["tar.gz", "tgz"] as const;
export type ArtifactFormat = (typeof ARTIFACT_FORMATS)[number];

export function isReleaseKind(value: unknown): value is ReleaseKind {
  return typeof value === "string" && (RELEASE_KINDS as readonly string[]).includes(value);
}

export function isArtifactTarget(value: unknown): value is ArtifactTarget {
  return typeof value === "string" && (ARTIFACT_TARGETS as readonly string[]).includes(value);
}

export function isRustSidecarTarget(value: unknown): value is RustSidecarTarget {
  return typeof value === "string" && (RUST_SIDECAR_TARGETS as readonly string[]).includes(value);
}

export function isArtifactFormat(value: unknown): value is ArtifactFormat {
  return typeof value === "string" && (ARTIFACT_FORMATS as readonly string[]).includes(value);
}

export const PORTABLE_ARCHIVE_PATH_MAX_BYTES = 512;
export const PORTABLE_ARCHIVE_SEGMENT_MAX_BYTES = 255;

function isWindowsReservedPathSegment(segment: string): boolean {
  const stem = segment.split(".", 1)[0].toUpperCase();
  return ["CON", "PRN", "AUX", "NUL"].includes(stem) || /^(?:COM|LPT)[1-9]$/.test(stem);
}

export function isSafeRelativeArtifactPath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > PORTABLE_ARCHIVE_PATH_MAX_BYTES ||
    value.startsWith("/") ||
    !/^[\x20-\x7e]+$/.test(value)
  ) {
    return false;
  }
  const parts = value.split("/");
  return parts.every((part) =>
    part !== "" &&
    part !== "." &&
    part !== ".." &&
    part.length <= PORTABLE_ARCHIVE_SEGMENT_MAX_BYTES &&
    !part.endsWith(" ") &&
    !part.endsWith(".") &&
    !/[<>:"\\|?*]/.test(part) &&
    !isWindowsReservedPathSegment(part)
  );
}
