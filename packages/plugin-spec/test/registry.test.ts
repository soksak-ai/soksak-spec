import { createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalRegistryPayload,
  certifyRegistryIndex,
  parseSignedRegistryIndex,
  type RegistryPublicKey,
} from "../src/registry.js";
import { contractRelease, kitRelease, pluginRelease, sidecarRelease, specRelease } from "./releaseFixture.js";

const AT = Date.parse("2026-08-22T00:00:00Z");

function unsigned(sequence = 1): Record<string, unknown> {
  return {
    id: "official",
    sequence,
    plugins: [pluginRelease()],
    sidecars: [sidecarRelease()],
    kits: [kitRelease()],
    contracts: [contractRelease()],
    specs: [specRelease()],
    issuedAt: "2026-08-21T00:00:00Z",
    expiresAt: "2026-09-21T00:00:00Z",
    algorithm: "ed25519",
    keyId: "fixture-key",
  };
}

function signer() {
  const pair = generateKeyPairSync("ed25519");
  const raw = (pair.publicKey.export({ type: "spki", format: "der" }) as Buffer).subarray(-32);
  const publicKey: RegistryPublicKey = { algorithm: "ed25519", keyId: "fixture-key", value: raw.toString("base64") };
  const signed = (payload: Record<string, unknown>) => ({
    ...payload,
    signature: sign(null, canonicalRegistryPayload(payload), pair.privateKey).toString("base64"),
  });
  return { pair, publicKey, signed };
}

function trust(publicKey: RegistryPublicKey, highWater?: { sequence: number; digest: string }) {
  return { expectedRegistryId: "official", expectedKeyId: "fixture-key", publicKey, now: AT, highWater };
}

describe("signed plugin registry", () => {
  it("parses all five direct release arrays", () => {
    const parsed = parseSignedRegistryIndex(signer().signed(unsigned()));
    expect(parsed, JSON.stringify(parsed)).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.value.plugins[0].plugin.id).toBe("weather-plugin");
    expect(parsed.value.sidecars[0].sidecar.id).toBe("weather-sidecar");
    expect(parsed.value.kits[0].kit.id).toBe("terminal-common");
    expect(parsed.value.contracts[0].contract.id).toBe("terminal-contract");
    expect(parsed.value.specs[0].spec.id).toBe("soksak-spec");
  });

  it("rejects the old combined release array and generic release identities", () => {
    const oldArray = ["un", "its"].join("");
    const oldRegistryId = ["registry", "Id"].join("");
    const old = {
      [oldRegistryId]: "official", sequence: 1,
      [oldArray]: [], issuedAt: "2026-08-21T00:00:00Z", expiresAt: "2026-09-21T00:00:00Z",
      algorithm: "ed25519", keyId: "fixture-key", signature: Buffer.alloc(64).toString("base64"),
    };
    expect(parseSignedRegistryIndex(old).ok).toBe(false);
    const generic = unsigned() as any;
    generic.plugins[0] = { kind: "plugin", id: "weather-plugin", version: "0.0.1" };
    generic.signature = Buffer.alloc(64).toString("base64");
    expect(parseSignedRegistryIndex(generic).ok).toBe(false);
  });

  it("certifies canonical bytes, identity, time, and high-water continuity", async () => {
    const { pair, publicKey, signed } = signer();
    const raw = signed(unsigned(2));
    const payload = canonicalRegistryPayload(raw);
    expect(verify(null, payload, pair.publicKey, Buffer.from(raw.signature, "base64"))).toBe(true);
    const first = await certifyRegistryIndex(raw, trust(publicKey));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const unchanged = await certifyRegistryIndex(raw, trust(publicKey, first.value.highWater));
    expect(unchanged.ok && unchanged.value.continuity).toBe("unchanged");
    const advanced = await certifyRegistryIndex(signed(unsigned(3)), trust(publicKey, first.value.highWater));
    expect(advanced.ok && advanced.value.continuity).toBe("advance");
    expect((await certifyRegistryIndex(signed(unsigned(1)), trust(publicKey, first.value.highWater))).ok).toBe(false);
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKey.value, "base64")]);
    expect(createPublicKey({ key: spki, format: "der", type: "spki" })).toBeTruthy();
  });

  it("rejects install profiles", () => {
    const value = unsigned();
    value.profiles = [];
    expect(parseSignedRegistryIndex({ ...value, signature: Buffer.alloc(64).toString("base64") }).ok).toBe(false);
  });
});
