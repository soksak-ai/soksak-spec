import { describe, expect, it } from "vitest";
import { parseReleaseReference, parseRuntimeDependencies } from "../src/distribution.js";

const reference = (id = "soksak-sidecar-pty", version = "0.0.5") => ({
  id, version,
  url: `https://github.com/soksak-ai/${id}/releases/download/v${version}/release.json`,
  size: 1234, sha256: "a".repeat(64),
});

describe("distribution references", () => {
  it("uses one flat exact reference for plugins and sidecars", () => {
    expect(parseReleaseReference(reference())).toMatchObject({ ok: true });
    expect(parseRuntimeDependencies({ sidecars: [reference()] })).toMatchObject({ ok: true });
    expect(parseRuntimeDependencies({ plugins: [reference("soksak-plugin-provider", "1.2.0")] })).toMatchObject({ ok: true });
  });
  it("rejects ranges, latest, wrappers, mismatched URLs, empty arrays, and duplicates", () => {
    expect(parseReleaseReference({ ...reference(), version: "^0.0.5" }).ok).toBe(false);
    expect(parseReleaseReference({ ...reference(), version: "latest" }).ok).toBe(false);
    expect(parseReleaseReference({ release: reference() }).ok).toBe(false);
    expect(parseReleaseReference({ ...reference(), url: reference("other").url }).ok).toBe(false);
    expect(parseRuntimeDependencies({ sidecars: [] }).ok).toBe(false);
    expect(parseRuntimeDependencies({ sidecars: [reference(), reference()] }).ok).toBe(false);
  });
});
