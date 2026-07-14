import { describe, expect, it } from "vitest";
import {
  PLATFORM_RELEASE_SPEC,
  parsePlatformReleaseManifest,
} from "../src/spec.js";

const commit = "a".repeat(40);
const digest = "1".repeat(64);
const repository = "https://github.com/soksak-ai/soksak-spec";
const releaseTag = "soksak-spec-v0.0.1";

function validRelease() {
  return {
    spec: PLATFORM_RELEASE_SPEC,
    kind: "spec",
    id: "soksak-spec",
    version: "0.0.1",
    source: { repository, commit },
    releaseTag,
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

describe("spec and SDK owner release manifest", () => {
  it("binds every developer package to one exact source commit and release", () => {
    expect(parsePlatformReleaseManifest(validRelease())).toEqual({
      ok: true,
      value: validRelease(),
    });
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
