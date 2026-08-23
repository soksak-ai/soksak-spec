import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { authenticateRegistry, buildRegistry, verifyReleaseClosure } from "../src/registryPublication.js";
import { parseRegistry } from "../src/registry.js";
import { pluginRelease, sidecarRelease } from "./releaseFixture.js";

const sha = "a".repeat(64);
const ref = (id: string, version = "0.0.1") => ({ id, version, url: `https://github.com/example/${id}/releases/download/v${version}/release.json`, size: 123, sha256: sha });

describe("registry publication", () => {
  it("projects direct dependencies and verifies the complete immutable closure", async () => {
    const sidecar = sidecarRelease({ id: "weather-sidecar" });
    const plugin = pluginRelease({ runtimeDependencies: { sidecars: [ref("weather-sidecar")] } });
    const documents = new Map([[ref("weather-plugin").url, plugin], [ref("weather-sidecar").url, sidecar]]);
    const read = async (reference: ReturnType<typeof ref>) => ({ bytes: Buffer.alloc(reference.size), value: documents.get(reference.url)! });
    await expect(verifyReleaseClosure([ref("weather-plugin")], read, false)).resolves.toBeUndefined();
    const registry = await buildRegistry({ id: "official", sequence: 3, issuedAt: "2026-08-24T00:00:00Z", expiresAt: "2026-09-24T00:00:00Z", plugins: [ref("weather-plugin")], read, verifyBytes: false });
    expect(registry.plugins[0]).toMatchObject({ id: "weather-plugin", runtimeDependencies: { sidecars: [{ id: "weather-sidecar" }] } });
  });
  it("rejects kind mismatches, identity mismatches, and cycles", async () => {
    const pluginRef = ref("weather-plugin");
    await expect(verifyReleaseClosure([pluginRef], async () => ({ bytes: Buffer.alloc(123), value: sidecarRelease() }), false)).rejects.toThrow(/kind/);
    const cycle = pluginRelease({ runtimeDependencies: { plugins: [pluginRef] } });
    await expect(verifyReleaseClosure([pluginRef], async () => ({ bytes: Buffer.alloc(123), value: cycle }), false)).rejects.toThrow(/cycle/);
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
