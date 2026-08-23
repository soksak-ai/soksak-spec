import { describe, expect, it } from "vitest";
import { parseReleaseManifest } from "../src/release.js";
import { contractRelease, kitRelease, pluginRelease, sidecarRelease, specRelease } from "./releaseFixture.js";

describe("flat component release documents", () => {
  it("uses one kind, id, and version shape for every component", () => {
    for (const [kind, raw] of [["plugin", pluginRelease()], ["sidecar", sidecarRelease()], ["kit", kitRelease()], ["contract", contractRelease()], ["spec", specRelease()]] as const) {
      expect(parseReleaseManifest(raw)).toMatchObject({ ok: true, value: { kind, version: "0.0.1" } });
    }
  });
  it("accepts exact runtime dependencies only for plugins and sidecars", () => {
    const dependency = { id: "weather-sidecar", version: "0.0.1", url: "https://github.com/example/weather-sidecar/releases/download/v0.0.1/release.json", size: 123, sha256: "a".repeat(64) };
    expect(parseReleaseManifest(pluginRelease({ runtimeDependencies: { sidecars: [dependency] } })).ok).toBe(true);
    expect(parseReleaseManifest(kitRelease({ runtimeDependencies: { sidecars: [dependency] } })).ok).toBe(false);
  });
  it("rejects legacy nested identities, reports, ranges, and missing sizes", () => {
    expect(parseReleaseManifest({ ...pluginRelease(), plugin: { id: "weather-plugin", version: "0.0.1" } }).ok).toBe(false);
    const reports = pluginRelease(); reports.reports = reports.evidence; delete reports.evidence;
    expect(parseReleaseManifest(reports).ok).toBe(false);
    expect(parseReleaseManifest(pluginRelease({ version: "latest" })).ok).toBe(false);
    const missing = pluginRelease(); delete (missing.manifest as Record<string, unknown>).size;
    expect(parseReleaseManifest(missing).ok).toBe(false);
  });
});
