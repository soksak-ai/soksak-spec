import { generateKeyPairSync, sign, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalRegistryPayload, certifyRegistry, parseRegistry, type RegistryPublicKey } from "../src/registry.js";

const AT = Date.parse("2026-08-22T00:00:00Z");
const plugin = (id = "weather-plugin", version = "0.0.1") => ({ id, version, url: `https://github.com/example/${id}/releases/download/v${version}/release.json`, size: 1234, sha256: "a".repeat(64) });
function unsigned(sequence = 1) { return { id: "official", sequence, issuedAt: "2026-08-21T00:00:00Z", expiresAt: "2026-09-21T00:00:00Z", plugins: [plugin()] }; }
function signer() {
  const pair = generateKeyPairSync("ed25519"); const raw = (pair.publicKey.export({ type: "spki", format: "der" }) as Buffer).subarray(-32);
  const publicKey: RegistryPublicKey = { algorithm: "ed25519", keyId: "fixture-key", value: raw.toString("base64") };
  const signed = (value: ReturnType<typeof unsigned>) => ({ ...value, signature: { algorithm: "ed25519", keyId: "fixture-key", value: sign(null, canonicalRegistryPayload(value), pair.privateKey).toString("base64") } });
  return { pair, publicKey, signed };
}
function trust(publicKey: RegistryPublicKey, highWater?: { sequence: number; digest: string }) { return { expectedRegistryId: "official", expectedKeyId: "fixture-key", publicKey, now: AT, highWater }; }

describe("authenticated plugin registry", () => {
  it("contains plugins and direct runtime dependencies only", () => {
    const value = unsigned();
    value.plugins[0] = { ...plugin(), runtimeDependencies: { sidecars: [plugin("weather-sidecar")] } } as never;
    expect(parseRegistry(signer().signed(value))).toMatchObject({ ok: true });
    expect(parseRegistry({ ...signer().signed(unsigned()), sidecars: [], kits: [], contracts: [], specs: [] }).ok).toBe(false);
    expect(parseRegistry({ ...signer().signed(unsigned()), installs: {} }).ok).toBe(false);
  });
  it("requires one current release for each plugin id", () => {
    const value = unsigned(); value.plugins = [plugin(), plugin("weather-plugin", "0.0.2")];
    expect(parseRegistry({ ...value, signature: { algorithm: "ed25519", keyId: "fixture-key", value: Buffer.alloc(64).toString("base64") } }).ok).toBe(false);
  });
  it("certifies identity, canonical bytes, time, and continuity", async () => {
    const { pair, publicKey, signed } = signer(); const raw = signed(unsigned(2)); const payload = canonicalRegistryPayload(raw);
    expect(verify(null, payload, pair.publicKey, Buffer.from(raw.signature.value, "base64"))).toBe(true);
    const first = await certifyRegistry(raw, trust(publicKey)); expect(first.ok).toBe(true); if (!first.ok) return;
    expect((await certifyRegistry(raw, trust(publicKey, first.value.highWater))).ok).toBe(true);
    expect((await certifyRegistry(signed(unsigned(1)), trust(publicKey, first.value.highWater))).ok).toBe(false);
  });
  it("rejects unsigned and malformed signatures", () => {
    expect(parseRegistry(unsigned()).ok).toBe(false);
    expect(parseRegistry({ ...unsigned(), signature: { algorithm: "ed25519", keyId: "fixture-key", value: "invalid" } }).ok).toBe(false);
  });
});
