import { describe, expect, it } from "vitest";
import { parseReleaseManifest } from "../src/release.js";
import { contractRelease, kitRelease, pluginRelease, sidecarRelease, specRelease } from "./releaseFixture.js";

describe("plugin, sidecar, and kit release documents", () => {
  it("keeps each release identity explicit", () => {
    const plugin = parseReleaseManifest(pluginRelease());
    const sidecar = parseReleaseManifest(sidecarRelease());
    const kit = parseReleaseManifest(kitRelease());
    const contract = parseReleaseManifest(contractRelease());
    const spec = parseReleaseManifest(specRelease());
    expect(plugin, JSON.stringify(plugin)).toMatchObject({ ok: true });
    expect(sidecar, JSON.stringify(sidecar)).toMatchObject({ ok: true });
    expect(kit, JSON.stringify(kit)).toMatchObject({ ok: true });
    expect(contract, JSON.stringify(contract)).toMatchObject({ ok: true });
    expect(spec, JSON.stringify(spec)).toMatchObject({ ok: true });
    if (!plugin.ok || !sidecar.ok || !kit.ok || !contract.ok || !spec.ok) return;
    expect(plugin.value.plugin.id).toBe("weather-plugin");
    expect(sidecar.value.sidecar.id).toBe("weather-sidecar");
    expect(kit.value.kit.id).toBe("terminal-common");
    expect(contract.value.contract.id).toBe("terminal-contract");
    expect(spec.value.spec.id).toBe("soksak-spec");
  });

  it("rejects dependency and scope fields in release documents", () => {
    expect(parseReleaseManifest(pluginRelease({ dependencies: [] })).ok).toBe(false);
    expect(parseReleaseManifest(pluginRelease({ scope: "runtime" })).ok).toBe(false);
  });

  it("rejects generic kind and id release identities", () => {
    const generic = pluginRelease();
    delete generic.plugin;
    generic.kind = "plugin";
    generic.id = "weather-plugin";
    generic.version = "0.0.1";
    expect(parseReleaseManifest(generic).ok).toBe(false);
  });

  it("requires kind-specific manifests and target rules", () => {
    const wrongManifest = sidecarRelease();
    (wrongManifest.artifacts as any[])[0].manifest = "plugin.json";
    expect(parseReleaseManifest(wrongManifest).ok).toBe(false);
    const wrongTarget = pluginRelease();
    (wrongTarget.artifacts as any[])[0].target = "aarch64-apple-darwin";
    expect(parseReleaseManifest(wrongTarget).ok).toBe(false);
  });

  it("requires the artifact byte size", () => {
    const missing = pluginRelease();
    delete (missing.artifacts as Record<string, unknown>[])[0].size;
    expect(parseReleaseManifest(missing).ok).toBe(false);
  });

  it("accepts an exact patch release and binds every asset to its tag", () => {
    const release = specRelease();
    release.spec = { id: "soksak-spec", version: "0.0.2" };
    release.artifacts = [{
      ...(release.artifacts as Record<string, unknown>[])[0],
      url: "https://github.com/example/soksak-spec/releases/download/v0.0.2/soksak-spec-0.0.2.tgz",
    }];
    release.reports = [{
      ...(release.reports as Record<string, unknown>[])[0],
      url: "https://github.com/example/soksak-spec/releases/download/v0.0.2/soksak-spec-0.0.2.conformance.json",
    }];
    expect(parseReleaseManifest(release)).toMatchObject({
      ok: true,
      value: { spec: { id: "soksak-spec", version: "0.0.2" } },
    });

    (release.artifacts as Record<string, unknown>[])[0].url =
      "https://github.com/example/soksak-spec/releases/download/v0.0.1/soksak-spec-0.0.2.tgz";
    expect(parseReleaseManifest(release).ok).toBe(false);
  });

  it("rejects version ranges and non-semver release identities", () => {
    for (const version of ["^0.0.1", "latest", "0.0"]) {
      const release = specRelease();
      release.spec = { id: "soksak-spec", version };
      expect(parseReleaseManifest(release).ok, version).toBe(false);
    }
  });
});
