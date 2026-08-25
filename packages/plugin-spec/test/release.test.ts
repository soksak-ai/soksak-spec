import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseReleaseManifest, verifyReference } from "../src/release.js";
import { contractRelease, kitRelease, pluginRelease, sidecarRelease, specRelease } from "./releaseFixture.js";

type Doc = Record<string, any>;
const URL = "https://github.com/soksak-ai/weather-plugin/releases/download/v0.0.1/plugin.json";

describe("flat component release documents", () => {
  it("uses one kind, id, and version shape for every component", () => {
    for (const [kind, raw] of [["plugin", pluginRelease()], ["sidecar", sidecarRelease()], ["kit", kitRelease()], ["contract", contractRelease()], ["spec", specRelease()]] as const) {
      expect(parseReleaseManifest(raw)).toMatchObject({ ok: true, value: { kind, version: "0.0.1" } });
    }
  });
  it("accepts exact runtime dependency references only for plugins and sidecars", () => {
    const dependency = { id: "weather-sidecar", version: "0.0.1", size: 123, sha256: "a".repeat(64) };
    expect(parseReleaseManifest(pluginRelease({ runtimeDependencies: { sidecars: [dependency] } }))).toMatchObject({ ok: true, value: { runtimeDependencies: { sidecars: [dependency] } } });
    expect(parseReleaseManifest(sidecarRelease({ runtimeDependencies: { sidecars: [dependency] } })).ok).toBe(true);
    expect(parseReleaseManifest(kitRelease({ runtimeDependencies: { sidecars: [dependency] } })).ok).toBe(false);
    expect(parseReleaseManifest(pluginRelease({ runtimeDependencies: { sidecars: [{ id: "weather-sidecar", version: "0.0.1" }] } })).ok).toBe(false);
    expect(parseReleaseManifest(pluginRelease({ runtimeDependencies: { sidecars: [{ ...dependency, url: URL }] } })).ok).toBe(false);
  });
  it("names manifest, artifacts, and evidence by bare filename inside the release directory", () => {
    expect(parseReleaseManifest(pluginRelease())).toMatchObject({ ok: true, value: {
      manifest: { file: "plugin.json", size: 12345 },
      artifacts: [{ target: "any", file: "weather-plugin-0.0.1.tgz", format: "tgz", manifest: "plugin.json" }],
      evidence: [{ file: "conformance-release.json" }],
    } });
    for (const file of ["", ".", "..", "sub/plugin.json", "../plugin.json", "/plugin.json", "plugin json", "plugin\\.json", URL]) {
      const artifact: Doc = pluginRelease(); artifact.artifacts[0].file = file;
      expect(parseReleaseManifest(artifact).ok, `artifact ${file}`).toBe(false);
      const evidence: Doc = pluginRelease(); evidence.evidence[0].file = file;
      expect(parseReleaseManifest(evidence).ok, `evidence ${file}`).toBe(false);
    }
  });
  it("binds source.repository to https://github.com/soksak-ai/<id>", () => {
    expect(parseReleaseManifest(pluginRelease())).toMatchObject({ ok: true, value: { source: { repository: "https://github.com/soksak-ai/weather-plugin" } } });
    for (const repository of [
      "https://github.com/example/weather-plugin",
      "https://github.com/soksak-ai/weather-sidecar",
      "https://github.com/soksak-ai/weather-plugin.git",
      "https://github.com/soksak-ai/weather-plugin/",
      "http://github.com/soksak-ai/weather-plugin",
      "https://github.com/Soksak-AI/weather-plugin",
    ]) {
      const result = parseReleaseManifest(pluginRelease({ source: { repository, commit: "a".repeat(40) } }));
      expect(result.ok, repository).toBe(false);
      if (!result.ok) expect(result.errors).toContain("release.source.repository: https://github.com/soksak-ai/weather-plugin required");
    }
  });
  it("verifies release bytes against a reference by size and sha256", () => {
    const bytes = new TextEncoder().encode(JSON.stringify(pluginRelease()));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const reference = { id: "weather-plugin", version: "0.0.1", size: bytes.byteLength, sha256 };
    expect(() => verifyReference(bytes, reference)).not.toThrow();
    expect(() => verifyReference(bytes, { ...reference, size: bytes.byteLength + 1 })).toThrow("release size mismatch: weather-plugin@0.0.1");
    expect(() => verifyReference(bytes, { ...reference, sha256: "0".repeat(64) })).toThrow("release digest mismatch: weather-plugin@0.0.1");
  });
  it("rejects a url on any file reference", () => {
    for (const section of ["manifest", "artifacts", "evidence"]) {
      const withUrl: Doc = pluginRelease();
      const target = section === "manifest" ? withUrl.manifest : withUrl[section][0];
      target.url = URL;
      expect(parseReleaseManifest(withUrl).ok, `${section} url`).toBe(false);
      delete target.file;
      expect(parseReleaseManifest(withUrl).ok, `${section} url without file`).toBe(false);
    }
  });
  it("requires the manifest file to be the kind-specific manifest name", () => {
    for (const [raw, wrong] of [[pluginRelease(), "sidecar.json"], [sidecarRelease(), "plugin.json"], [kitRelease(), "manifest.json"]] as const) {
      const value: Doc = raw; value.manifest.file = wrong;
      expect(parseReleaseManifest(value).ok, wrong).toBe(false);
    }
  });
  it("requires unique sorted evidence files", () => {
    const duplicate: Doc = pluginRelease(); duplicate.evidence = [duplicate.evidence[0], { ...duplicate.evidence[0] }];
    expect(parseReleaseManifest(duplicate).ok).toBe(false);
    const unsorted: Doc = pluginRelease(); unsorted.evidence = [{ ...unsorted.evidence[0], file: "b.json" }, { ...unsorted.evidence[0], file: "a.json" }];
    expect(parseReleaseManifest(unsorted).ok).toBe(false);
    const sorted: Doc = pluginRelease(); sorted.evidence = [{ ...sorted.evidence[0], file: "a.json" }, { ...sorted.evidence[0], file: "b.json" }];
    expect(parseReleaseManifest(sorted).ok).toBe(true);
  });
  it("rejects nested identities, reports, ranges, and missing sizes", () => {
    expect(parseReleaseManifest({ ...pluginRelease(), plugin: { id: "weather-plugin", version: "0.0.1" } }).ok).toBe(false);
    const reports = pluginRelease(); reports.reports = reports.evidence; delete reports.evidence;
    expect(parseReleaseManifest(reports).ok).toBe(false);
    expect(parseReleaseManifest(pluginRelease({ version: "latest" })).ok).toBe(false);
    const missing = pluginRelease(); delete (missing.manifest as Record<string, unknown>).size;
    expect(parseReleaseManifest(missing).ok).toBe(false);
  });
});
