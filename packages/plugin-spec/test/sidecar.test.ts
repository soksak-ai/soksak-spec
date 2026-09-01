import { describe, expect, it } from "vitest";
import { parseSidecarManifest } from "../src/sidecar.js";

const manifest = () => ({
  id: "soksak-sidecar-terminal-vt100", version: "0.0.1",
  processRole: "sidecar-terminal-vt100",
  interface: [{ id: "soksak-spec-sidecar-terminal", version: "0.0.1" }],
  process: "dist/soksak-sidecar-terminal-vt100",
});

describe("sidecar manifest", () => {
  it("parses exact sidecar identity, interface, and process", () => {
    expect(parseSidecarManifest(manifest())).toMatchObject({ ok: true });
    expect(parseSidecarManifest({ ...manifest(), process: `${manifest().process}.exe` })).toMatchObject({ ok: true });
  });
  it("accepts exact runtime dependency intents for the sidecar closure", () => {
    expect(parseSidecarManifest({
      ...manifest(),
      runtimeDependencies: { sidecars: [{ id: "soksak-sidecar-pty", version: "0.0.22" }] },
    })).toMatchObject({ ok: true, value: { runtimeDependencies: { sidecars: [{ id: "soksak-sidecar-pty", version: "0.0.22" }] } } });
  });
  it("rejects unknown fields and mismatched process paths", () => {
    expect(parseSidecarManifest({ ...manifest(), extra: true }).ok).toBe(false);
    expect(parseSidecarManifest({ ...manifest(), process: "dist/other" }).ok).toBe(false);
    const { processRole: _processRole, ...withoutRole } = manifest();
    expect(parseSidecarManifest(withoutRole).ok).toBe(false);
  });
  it("keeps component patches independent from the interface version", () => {
    expect(parseSidecarManifest({ ...manifest(), version: "0.0.4" })).toMatchObject({ ok: true, value: { version: "0.0.4", interface: [{ version: "0.0.1" }] } });
    expect(parseSidecarManifest({ ...manifest(), version: "latest" }).ok).toBe(false);
  });
});
