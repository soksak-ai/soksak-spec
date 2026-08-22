import { describe, expect, it } from "vitest";
import {
  conformanceClaimKey,
  parseConformanceReport,
  requiredConformanceClaims,
  verifyConformanceReport,
} from "../src/conformanceWire.js";
import { parseReleaseManifest } from "../src/release.js";
import { pluginRelease, sidecarRelease } from "./releaseFixture.js";

const WEATHER = { id: "soksak-spec-plugin-weather", version: "0.0.1" };

function report(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject: { plugin: { id: "weather-plugin", version: "0.0.1" } },
    claim: { release: true },
    result: "passed",
    validator: { name: "soksak-conformance", version: "0.0.1" },
    artifacts: [{ target: "any", sha256: "1".repeat(64) }],
    ...over,
  };
}

describe("conformance contract applicability", () => {
  it("keeps exact platform schema ids separate from domain provider evidence", () => {
    expect(parseConformanceReport(report({ claim: { manifest: true } })).ok).toBe(true);
    expect(parseConformanceReport(report({ claim: { contract: WEATHER } })).ok).toBe(true);
    expect(parseConformanceReport(report({ claim: { contract: `${WEATHER.id}@0.0.1` } })).ok).toBe(false);
  });

  it("accepts domain evidence only when the owner declares that exact provider", () => {
    const release = parseReleaseManifest(pluginRelease());
    const parsed = parseConformanceReport(report({ claim: { contract: WEATHER } }));
    expect(release.ok && parsed.ok).toBe(true);
    if (!release.ok || !parsed.ok) return;
    expect(verifyConformanceReport(parsed.value, release.value, [WEATHER])).toEqual({ ok: true });
    expect(verifyConformanceReport(parsed.value, release.value, [])).toEqual({
      ok: false,
      errors: ["conformance domain contract is not declared by the plugin or sidecar manifest"],
    });
  });

  it("accepts a sidecar domain contract declared by the sidecar manifest", () => {
    const release = parseReleaseManifest(sidecarRelease());
    expect(release.ok).toBe(true);
    if (!release.ok) return;
    const contract = { id: "soksak-spec-sidecar-weather", version: "0.0.1" };
    const parsed = parseConformanceReport(report({
      subject: { sidecar: { id: "weather-sidecar", version: "0.0.1" } },
      claim: { contract },
      artifacts: release.value.artifacts.map(({ target, sha256 }) => ({ target, sha256 })),
    }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(verifyConformanceReport(parsed.value, release.value, [contract])).toEqual({ ok: true });
  });

  it("has collision-free keys for platform and object contracts", () => {
    expect(conformanceClaimKey({ release: true })).toBe("release");
    expect(conformanceClaimKey({ manifest: true })).toBe("manifest");
    expect(conformanceClaimKey({ contract: WEATHER })).toBe("contract\u0000soksak-spec-plugin-weather\u00000.0.1");
  });
});

describe("common report binding", () => {
  it("requires the release and plugin manifest schemas", () => {
    expect(requiredConformanceClaims("plugin")).toEqual([{ manifest: true }, { release: true }]);
  });

  it("binds explicit identity and artifact matrix", () => {
    const release = parseReleaseManifest(pluginRelease());
    const parsed = parseConformanceReport(report());
    expect(release.ok && parsed.ok).toBe(true);
    if (!release.ok || !parsed.ok) return;
    expect(verifyConformanceReport(parsed.value, release.value)).toEqual({ ok: true });
    const generic = report();
    generic.subject = { kind: "plugin", id: "weather-plugin", version: "0.0.1" };
    expect(parseConformanceReport(generic).ok).toBe(false);
  });

  it("accepts a patch-version release subject without changing contract versions", () => {
    const parsed = parseConformanceReport(report({
      subject: { spec: { id: "soksak-spec", version: "0.0.2" } },
      validator: { name: "soksak-conformance", version: "0.0.2" },
    }));
    expect(parsed).toMatchObject({
      ok: true,
      value: { subject: { spec: { version: "0.0.2" } } },
    });
    expect(parseConformanceReport(report({
      subject: { spec: { id: "soksak-spec", version: "latest" } },
    })).ok).toBe(false);
  });
});
