import { describe, expect, it } from "vitest";
import { parseSidecarManifest } from "../src/sidecar.js";

const manifest = () => ({
  id: "soksak-sidecar-terminal-vt100", version: "0.0.1",
  interface: { id: "soksak-spec-sidecar-terminal", version: "0.0.1" },
  process: "dist/soksak-sidecar-terminal-vt100",
});

describe("sidecar manifest", () => {
  it("parses exact sidecar identity, interface, and process", () => {
    expect(parseSidecarManifest(manifest())).toMatchObject({ ok: true });
  });
  it("rejects unknown fields and mismatched process paths", () => {
    expect(parseSidecarManifest({ ...manifest(), extra: true }).ok).toBe(false);
    expect(parseSidecarManifest({ ...manifest(), process: "dist/other" }).ok).toBe(false);
  });
});
