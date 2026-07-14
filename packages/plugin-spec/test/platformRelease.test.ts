import { describe, expect, it } from "vitest";
import {
  PLATFORM_RELEASE_SPEC,
  parsePlatformReleaseManifest,
} from "../src/spec.js";

const commit = "a".repeat(40);
const digest = "1".repeat(64);
const repository = "https://github.com/soksak-ai/soksak-spec";
const releaseTag = "soksak-spec-v0.0.1";

function specDependency() {
  return {
    kind: "spec",
    id: "soksak-spec",
    version: "0.0.1",
    manifest: {
      url: `${repository}/releases/download/${releaseTag}/soksak-spec-release.json`,
      sha256: digest,
    },
  };
}

function validRelease() {
  return {
    spec: PLATFORM_RELEASE_SPEC,
    kind: "spec",
    id: "soksak-spec",
    version: "0.0.1",
    source: { repository, commit },
    releaseTag,
    dependencies: [],
    packages: [
      {
        ecosystem: "javascript",
        name: "@soksak-ai/plugin-spec",
        version: "0.0.1",
        artifact: {
          url: `${repository}/releases/download/${releaseTag}/soksak-ai-plugin-spec-0.0.1.tgz`,
          sha256: digest,
          format: "tgz",
        },
      },
      { ecosystem: "rust", name: "soksak-spec-contract", version: "0.0.1" },
      { ecosystem: "rust", name: "soksak-spec-service", version: "0.0.1" },
      { ecosystem: "rust", name: "soksak-spec-socket", version: "0.0.1" },
    ],
  };
}

function validSdkRelease() {
  const sdkRepository = "https://github.com/soksak-ai/soksak-plugin-sdk";
  const sdkReleaseTag = "soksak-plugin-sdk-v0.0.1";
  return {
    spec: PLATFORM_RELEASE_SPEC,
    kind: "sdk",
    id: "soksak-plugin-sdk",
    version: "0.0.1",
    source: { repository: sdkRepository, commit },
    releaseTag: sdkReleaseTag,
    dependencies: [specDependency()],
    packages: [{
      ecosystem: "javascript",
      name: "@soksak-ai/plugin-api",
      version: "0.0.1",
      artifact: {
        url: `${sdkRepository}/releases/download/${sdkReleaseTag}/soksak-ai-plugin-api-0.0.1.tgz`,
        sha256: digest,
        format: "tgz",
      },
    }],
  };
}

describe("spec and SDK owner release manifest", () => {
  it("binds every developer package to one exact source commit and release", () => {
    expect(parsePlatformReleaseManifest(validRelease())).toEqual({
      ok: true,
      value: validRelease(),
    });
  });

  it("binds an SDK to the exact owner manifest of its platform dependencies", () => {
    expect(parsePlatformReleaseManifest(validSdkRelease())).toEqual({
      ok: true,
      value: validSdkRelease(),
    });

    const floating = validSdkRelease();
    floating.dependencies[0].manifest.url =
      "https://github.com/soksak-ai/soksak-spec/releases/latest/download/soksak-spec-release.json";
    const parsed = parsePlatformReleaseManifest(floating);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors).toContain(
        "platformRelease.dependencies[0].manifest.url: canonical versioned GitHub Release manifest URL required",
      );
    }
  });

  it("rejects self-dependencies and non-canonical dependency order", () => {
    const self = validSdkRelease();
    self.dependencies[0] = {
      ...self.dependencies[0],
      kind: "sdk",
      id: self.id,
    };
    const selfParsed = parsePlatformReleaseManifest(self);
    expect(selfParsed.ok).toBe(false);
    if (!selfParsed.ok) {
      expect(selfParsed.errors).toContain(
        "platformRelease.dependencies[0]: self dependency forbidden",
      );
    }

    const duplicate = validSdkRelease();
    duplicate.dependencies.push(specDependency());
    const duplicateParsed = parsePlatformReleaseManifest(duplicate);
    expect(duplicateParsed.ok).toBe(false);
    if (!duplicateParsed.ok) {
      expect(duplicateParsed.errors).toContain(
        "platformRelease.dependencies: duplicate kind/id forbidden",
      );
    }
  });

  it("keeps install-unit kinds outside the developer package release wire", () => {
    const release = validRelease();
    release.kind = "plugin";
    const parsed = parsePlatformReleaseManifest(release);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors).toContain("platformRelease.kind: spec|sdk required");
  });

  it("rejects package version drift and assets outside the owner release", () => {
    const drift = validRelease();
    drift.packages[0].version = "0.0.2";
    const drifted = parsePlatformReleaseManifest(drift);
    expect(drifted.ok).toBe(false);
    if (!drifted.ok) {
      expect(drifted.errors).toContain(
        "platformRelease.packages[0].version: must equal platformRelease.version",
      );
    }

    const escaped = validRelease();
    escaped.packages[0].artifact.url =
      "https://github.com/other/spec/releases/download/soksak-spec-v0.0.1/spec.tgz";
    const parsed = parsePlatformReleaseManifest(escaped);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors).toContain(
        "platformRelease.packages[0].artifact.url: canonical same-repository GitHub Release asset URL required",
      );
    }
  });

  it("requires a sorted, duplicate-free package inventory", () => {
    const unsorted = validRelease();
    unsorted.packages.reverse();
    const parsed = parsePlatformReleaseManifest(unsorted);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors).toContain(
        "platformRelease.packages: entries must be sorted by ecosystem and name",
      );
    }

    const duplicate = validRelease();
    duplicate.packages.push({ ...duplicate.packages.at(-1) });
    const duplicated = parsePlatformReleaseManifest(duplicate);
    expect(duplicated.ok).toBe(false);
    if (!duplicated.ok) {
      expect(duplicated.errors).toContain(
        "platformRelease.packages: duplicate ecosystem/name forbidden",
      );
    }
  });

  it("does not accept legacy string versions or floating source refs", () => {
    const legacy = validRelease();
    legacy.source.commit = "main";
    const parsed = parsePlatformReleaseManifest(legacy);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors).toContain(
        "platformRelease.source.commit: exact lowercase 40-character Git commit required",
      );
    }
  });
});
