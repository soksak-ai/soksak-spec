import { createHash, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { authenticateRegistry, buildRegistry, verifyReleaseClosure, type ReadRelease } from "../src/registryPublication.js";
import { parseRegistry } from "../src/registry.js";
import type { ReleaseReference } from "../src/distribution.js";
import type { ReleaseIdentity } from "../src/release.js";
import { pluginRelease, sidecarRelease } from "./releaseFixture.js";

// A local store: release.json bytes addressed by kind, id, and version. The read receives the full
// reference { kind, id, version, size, sha256 }; the caller verifies the bytes against it after the read.
function store(documents: Record<string, unknown>[]) {
  const bytes = new Map<string, Uint8Array>();
  for (const document of documents) bytes.set(`${document.kind}/${document.id}/${document.version}`, new TextEncoder().encode(JSON.stringify(document)));
  const calls: (ReleaseIdentity & ReleaseReference)[] = [];
  const read: ReadRelease = async (reference) => {
    calls.push(reference);
    const found = bytes.get(`${reference.kind}/${reference.id}/${reference.version}`);
    if (!found) throw new Error(`missing release ${reference.kind}/${reference.id}/${reference.version}`);
    return found;
  };
  const ref = (kind: string, id: string, version = "0.0.1") => {
    const found = bytes.get(`${kind}/${id}/${version}`)!;
    return { id, version, size: found.byteLength, sha256: createHash("sha256").update(found).digest("hex") };
  };
  return { read, ref, calls };
}

describe("registry publication", () => {
  it("verifies the complete closure through release.json bytes and projects release references only", async () => {
    const sidecar = sidecarRelease({ id: "weather-sidecar" });
    const sidecarBytes = new TextEncoder().encode(JSON.stringify(sidecar));
    const plugin = pluginRelease({ runtimeDependencies: { sidecars: [{ id: "weather-sidecar", version: "0.0.1", size: sidecarBytes.byteLength, sha256: createHash("sha256").update(sidecarBytes).digest("hex") }] } });
    const { read, ref, calls } = store([plugin, sidecar]);
    await expect(verifyReleaseClosure([ref("plugin", "weather-plugin")], read)).resolves.toBeUndefined();
    expect(calls).toEqual([{ kind: "plugin", ...ref("plugin", "weather-plugin") }, { kind: "sidecar", ...ref("sidecar", "weather-sidecar") }]);
    const registry = await buildRegistry({ id: "official", sequence: 3, issuedAt: "2026-08-24T00:00:00Z", expiresAt: "2026-09-24T00:00:00Z", plugins: [ref("plugin", "weather-plugin")], read });
    expect(registry.plugins).toEqual([ref("plugin", "weather-plugin")]);
    expect(registry.plugins[0]).not.toHaveProperty("runtimeDependencies");
    expect(registry.plugins[0]).not.toHaveProperty("url");
  });
  it("rejects release.json bytes whose size or digest differ from the reference", async () => {
    const { read, ref } = store([pluginRelease()]);
    await expect(verifyReleaseClosure([{ ...ref("plugin", "weather-plugin"), size: ref("plugin", "weather-plugin").size + 1 }], read)).rejects.toThrow(/size/);
    await expect(verifyReleaseClosure([{ ...ref("plugin", "weather-plugin"), sha256: "b".repeat(64) }], read)).rejects.toThrow(/digest/);
  });
  it("verifies a second reference to a visited release against the cached bytes and refuses a different digest by name", async () => {
    const sidecar = sidecarRelease({ id: "weather-sidecar" });
    const sidecarBytes = new TextEncoder().encode(JSON.stringify(sidecar));
    const pin = { id: "weather-sidecar", version: "0.0.1", size: sidecarBytes.byteLength, sha256: createHash("sha256").update(sidecarBytes).digest("hex") };
    const first = pluginRelease({ runtimeDependencies: { sidecars: [pin] } });
    const second = pluginRelease({ id: "other-plugin", runtimeDependencies: { sidecars: [{ ...pin, sha256: "c".repeat(64) }] } });
    const { read, ref, calls } = store([first, second, sidecar]);
    await expect(verifyReleaseClosure([ref("plugin", "weather-plugin"), ref("plugin", "other-plugin")], read)).rejects.toThrow(/digest mismatch: weather-sidecar@0\.0\.1/);
    expect(calls.filter((call) => call.id === "weather-sidecar")).toHaveLength(1);
    const agreeing = pluginRelease({ id: "other-plugin", runtimeDependencies: { sidecars: [pin] } });
    const same = store([first, agreeing, sidecar]);
    await expect(verifyReleaseClosure([same.ref("plugin", "weather-plugin"), same.ref("plugin", "other-plugin")], same.read)).resolves.toBeUndefined();
    expect(same.calls.filter((call) => call.id === "weather-sidecar")).toHaveLength(1);
  });
  it("rejects kind mismatches, identity mismatches, and non-JSON bytes", async () => {
    const asPlugin = store([{ ...sidecarRelease(), kind: "plugin" }]);
    await expect(verifyReleaseClosure([asPlugin.ref("plugin", "weather-sidecar")], asPlugin.read)).rejects.toThrow(/kind|identity|invalid release/);
    const renamed = store([pluginRelease({ id: "other-plugin" })]);
    const renamedBytes = new TextEncoder().encode(JSON.stringify(pluginRelease({ id: "other-plugin" })));
    await expect(verifyReleaseClosure([{ ...renamed.ref("plugin", "other-plugin"), id: "weather-plugin" }], async () => renamedBytes)).rejects.toThrow(/identity/);
    const text = new TextEncoder().encode("not json");
    await expect(verifyReleaseClosure([{ id: "weather-plugin", version: "0.0.1", size: text.byteLength, sha256: createHash("sha256").update(text).digest("hex") }], async () => text)).rejects.toThrow(/JSON/);
  });
  it("authenticates the registry with a client-independent Ed25519 key", () => {
    const pair = generateKeyPairSync("ed25519");
    const privateDer = pair.privateKey.export({ type: "pkcs8", format: "der" }) as Buffer;
    const seed = privateDer.subarray(-32).toString("base64");
    const value = authenticateRegistry({ id: "official", sequence: 1, issuedAt: "2026-08-24T00:00:00Z", expiresAt: "2026-09-24T00:00:00Z", plugins: [] }, seed);
    expect(parseRegistry(value)).toMatchObject({ ok: true });
    expect(value.signature.keyId).toMatch(/^[a-f0-9]{32}$/);
  });
  it("publishes only an authenticated registry through immutable releases", () => {
    const source = readFileSync(new URL("../bin/validate.mjs", import.meta.url), "utf8");
    expect(source).toContain("registry-publish");
    expect(source).toContain("publishImmutableRelease");
    expect(source).toContain("registry-${registry.value.sequence}");
  });
});
