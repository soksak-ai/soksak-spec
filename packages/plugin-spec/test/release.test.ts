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

  it("keeps dependency kinds explicit and versions exact", () => {
    const parsed = parseReleaseManifest(pluginRelease());
    expect(parsed, JSON.stringify(parsed)).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.value.dependencies).toEqual([
      { kit: { id: "terminal-common", version: "0.0.1" }, scope: "runtime" },
    ]);
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

  it("rejects dependency objects that name more or fewer than one kind", () => {
    const ambiguous = pluginRelease();
    ambiguous.dependencies = [{
      plugin: { id: "other", version: "0.0.1" },
      kit: { id: "terminal-common", version: "0.0.1" },
      scope: "runtime",
    }];
    expect(parseReleaseManifest(ambiguous).ok).toBe(false);
  });
});
