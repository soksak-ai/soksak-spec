import { describe, expect, it } from "vitest";
import { parseDependencyIntent, parseReleaseReference, parseRuntimeDependencies, parseRuntimeDependencyIntents } from "../src/distribution.js";

const intent = (id = "soksak-sidecar-pty", version = "0.0.5") => ({ id, version });
const reference = (id = "soksak-sidecar-pty", version = "0.0.5") => ({ id, version, size: 1234, sha256: "a".repeat(64) });
const URL = "https://github.com/soksak-ai/soksak-sidecar-pty/releases/download/v0.0.5/release.json";

describe("dependency intents (plugin.json)", () => {
  it("names only id and exact version", () => {
    expect(parseDependencyIntent(intent())).toEqual({ ok: true, value: intent() });
    expect(parseRuntimeDependencyIntents({ sidecars: [intent()] })).toEqual({ ok: true, value: { sidecars: [intent()] } });
    expect(parseRuntimeDependencyIntents({ plugins: [intent("soksak-plugin-provider", "1.2.0")] })).toMatchObject({ ok: true });
  });
  it("rejects location and integrity fields, ranges, latest, wrappers, empty groups, duplicates, and unsorted entries", () => {
    for (const extra of [{ url: URL }, { size: 1 }, { sha256: "a".repeat(64) }]) {
      expect(parseDependencyIntent({ ...intent(), ...extra }).ok, JSON.stringify(extra)).toBe(false);
    }
    expect(parseDependencyIntent({ ...intent(), version: "^0.0.5" }).ok).toBe(false);
    expect(parseDependencyIntent({ ...intent(), version: "latest" }).ok).toBe(false);
    expect(parseDependencyIntent({ release: intent() }).ok).toBe(false);
    expect(parseRuntimeDependencyIntents({}).ok).toBe(false);
    expect(parseRuntimeDependencyIntents({ sidecars: [] }).ok).toBe(false);
    expect(parseRuntimeDependencyIntents({ sidecars: [intent(), intent()] }).ok).toBe(false);
    expect(parseRuntimeDependencyIntents({ plugins: [intent("b"), intent("a")] }).ok).toBe(false);
  });
});

describe("release references (release.json, registry index)", () => {
  it("names id, exact version, and the size and digest of that release.json", () => {
    expect(parseReleaseReference(reference())).toEqual({ ok: true, value: reference() });
    expect(parseRuntimeDependencies({ sidecars: [reference()] })).toEqual({ ok: true, value: { sidecars: [reference()] } });
    expect(parseRuntimeDependencies({ plugins: [reference("soksak-plugin-provider", "1.2.0")] })).toMatchObject({ ok: true });
  });
  it("rejects a url, missing integrity, ranges, wrappers, empty groups, duplicates, and unsorted entries", () => {
    expect(parseReleaseReference({ ...reference(), url: URL }).ok).toBe(false);
    expect(parseReleaseReference(intent()).ok).toBe(false);
    expect(parseReleaseReference({ ...reference(), version: "^0.0.5" }).ok).toBe(false);
    expect(parseReleaseReference({ ...reference(), version: "latest" }).ok).toBe(false);
    expect(parseReleaseReference({ ...reference(), size: 0 }).ok).toBe(false);
    expect(parseReleaseReference({ ...reference(), sha256: "A".repeat(64) }).ok).toBe(false);
    expect(parseReleaseReference({ release: reference() }).ok).toBe(false);
    expect(parseRuntimeDependencies({}).ok).toBe(false);
    expect(parseRuntimeDependencies({ sidecars: [] }).ok).toBe(false);
    expect(parseRuntimeDependencies({ sidecars: [reference(), reference()] }).ok).toBe(false);
    expect(parseRuntimeDependencies({ plugins: [reference("b"), reference("a")] }).ok).toBe(false);
  });
});
