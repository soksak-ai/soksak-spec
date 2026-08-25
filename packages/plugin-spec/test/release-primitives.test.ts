import { describe, expect, it } from "vitest";
import { parseManifest, PLUGIN_ID_RE, PROGRAM_PLATFORMS } from "../src/spec.js";
import * as primitives from "../src/release-primitives.js";
import {
  ANY_TARGET,
  RUST_SIDECAR_TARGETS,
  STRICT_SEMVER_RE,
  COMPONENT_ID_RE,
  GITHUB_ORG,
  RELEASE_KINDS,
  ARTIFACT_TARGETS,
  isSafeRelativeArtifactPath,
  isDependencyRange,
} from "../src/release-primitives.js";

describe("public plugin, sidecar, and kit identity source", () => {
  it("uses one flat, third-party-friendly id grammar for plugin, sidecar, and kit", () => {
    expect(RELEASE_KINDS).toEqual(["contract", "kit", "plugin", "sidecar", "spec"]);
    for (const id of ["weather", "third-party-plugin", "[redacted]"]) {
      expect(COMPONENT_ID_RE.test(id), id).toBe(true);
    }
    for (const id of ["io.github.example/plugin/weather", "io.github.example", "Bad", "bad_id", "-bad"]) {
      expect(COMPONENT_ID_RE.test(id), id).toBe(false);
    }
    expect(COMPONENT_ID_RE.test(`a${"b".repeat(127)}`)).toBe(true);
    expect(COMPONENT_ID_RE.test(`a${"b".repeat(128)}`)).toBe(false);
    expect(PLUGIN_ID_RE).toBe(COMPONENT_ID_RE);
  });

  it("defines strict SemVer and dependency ranges once", () => {
    for (const version of ["0.1.0", "1.2.3-alpha.1", "2.0.0+build.7"]) {
      expect(STRICT_SEMVER_RE.test(version), version).toBe(true);
    }
    for (const version of ["01.0.0", "1.02.0", "1.0.0-01", "1.0", "v1.0.0"]) {
      expect(STRICT_SEMVER_RE.test(version), version).toBe(false);
    }
    for (const range of ["1.2.3", "^1.2.3", "~1.2.3", ">=1.0.0 <2.0.0", "=1.2.3-alpha.1"]) {
      expect(isDependencyRange(range), range).toBe(true);
    }
    for (const range of ["*", "latest", "1.x", "^01.0.0", ">=1.0.0 || <2.0.0", ""]) {
      expect(isDependencyRange(range), range).toBe(false);
    }
  });

  it("uses canonical Rust target triples and reserves any for portable artifacts", () => {
    expect(ANY_TARGET).toBe("any");
    expect(ARTIFACT_TARGETS).toContain("aarch64-apple-darwin");
    expect(ARTIFACT_TARGETS).toContain("x86_64-unknown-linux-gnu");
    expect(ARTIFACT_TARGETS).toContain("x86_64-pc-windows-msvc");
    expect(RUST_SIDECAR_TARGETS).not.toContain("any");
    expect(ARTIFACT_TARGETS).not.toContain("darwin-aarch64");
    expect(PROGRAM_PLATFORMS).toEqual(["darwin", "linux", "win32"]);
  });

  it("accepts only explicit lexical relative paths", () => {
    for (const path of ["plugin.json", "bin/weather-service", "lib/libweather.dylib", "package/package.json"]) {
      expect(isSafeRelativeArtifactPath(path), path).toBe(true);
    }
    for (const path of [
      "",
      "/tmp/plugin.json",
      "../plugin.json",
      "dist/../plugin.json",
      "dist//plugin.json",
      "C:\\plugin.json",
      "./plugin.json",
      "한글/plugin.json",
      "safe:name/plugin.json",
      "CON/plugin.json",
      "docs/con.txt",
      "trail./plugin.json",
      `a${"b".repeat(512)}`,
      `${"a".repeat(256)}/plugin.json`,
    ]) {
      expect(isSafeRelativeArtifactPath(path), path).toBe(false);
    }
  });

  it("defines the GitHub org once and exports exactly the release primitives", () => {
    expect(GITHUB_ORG).toBe("soksak-ai");
    expect(Object.keys(primitives).sort()).toEqual([
      "ANY_TARGET",
      "ARTIFACT_FORMATS",
      "ARTIFACT_TARGETS",
      "COMPONENT_ID_RE",
      "GITHUB_ORG",
      "GIT_COMMIT_RE",
      "MAX_DEPENDENCY_CLAUSES",
      "MAX_DEPENDENCY_RANGE_LENGTH",
      "MAX_SEMVER_LENGTH",
      "PORTABLE_ARCHIVE_PATH_MAX_BYTES",
      "PORTABLE_ARCHIVE_SEGMENT_MAX_BYTES",
      "RELEASE_FILE_RE",
      "RELEASE_KINDS",
      "RUST_SIDECAR_TARGETS",
      "SHA256_RE",
      "STRICT_SEMVER_PATTERN",
      "STRICT_SEMVER_RE",
      "isArtifactFormat",
      "isArtifactTarget",
      "isDependencyRange",
      "isReleaseKind",
      "isRustSidecarTarget",
      "isSafeRelativeArtifactPath",
      "isStrictSemver",
    ]);
  });

  it("keeps source identity solely in the owner release manifest", () => {
    const raw = {
      id: "weather",
      name: "Weather",
      version: "1.0.0",
      appVersionRequirement: "0.0.1",
      description: "Weather plugin",
      repo: "https://github.com/example/weather",
      permissions: [],
      contributes: {},
    };
    expect(parseManifest(raw, "weather").validation.ok).toBe(false);
  });

  it("uses exact immutable plugin runtime dependencies", () => {
    const manifest = (version: string) => ({
      id: "weather",
      name: "Weather",
      version: "1.0.0",
      appVersionRequirement: "0.0.1",
      description: "Weather plugin",
      runtimeDependencies: { plugins: [{ id: "weather-data", version }] },
      permissions: [],
      contributes: {},
    });
    expect(parseManifest(manifest("0.0.1"), "weather").validation.ok).toBe(true);
    expect(parseManifest(manifest(">=0.0.1 <1.0.0"), "weather").validation.ok).toBe(false);
  });

  it("keeps location and integrity out of manifest runtime dependencies", () => {
    const manifest = (dependency: Record<string, unknown>) => ({
      id: "weather",
      name: "Weather",
      version: "1.0.0",
      appVersionRequirement: "0.0.1",
      description: "Weather plugin",
      runtimeDependencies: { plugins: [dependency] },
      permissions: [],
      contributes: {},
    });
    expect(parseManifest(manifest({ id: "weather-data", version: "0.0.1", size: 1, sha256: "a".repeat(64) }), "weather").validation.ok).toBe(false);
    expect(parseManifest(manifest({ id: "weather-data", version: "0.0.1", url: "https://github.com/soksak-ai/weather-data/releases/download/v0.0.1/release.json" }), "weather").validation.ok).toBe(false);
  });

  it("keeps sidecar artifact location solely in the owner release manifest", () => {
    const raw = {
      id: "weather",
      name: "Weather",
      version: "1.0.0",
      description: "Weather plugin",
      permissions: ["sidecar"],
      sidecars: [{
        name: "weather-engine",
        interface: { id: "soksak-spec-sidecar-weather", requirement: "0.0.1" },
        reach: {
          fetch: {
            url: { darwin: "https://example.invalid/weather.tgz" },
            sha256: { darwin: "a".repeat(64) },
          },
        },
      }],
      contributes: {},
    };
    expect(parseManifest(raw, "weather").validation.ok).toBe(false);
  });
});
