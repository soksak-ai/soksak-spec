#!/usr/bin/env node
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalRegistryPayload } from "../dist/registry.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "fixtures/platform-wire");
const read = (name) => JSON.parse(readFileSync(join(root, name), "utf8"));
const seed = Buffer.from("0f4d3c2b1a09182736455463728190abcdef0123456789abcdef0123456789ab", "hex");
const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
const publicDer = createPublicKey(privateKey).export({ type: "spki", format: "der" });
const publicRaw = Buffer.from(publicDer).subarray(-32);

const signingEnvelope = {
  spec: "soksak-spec-registry@0.0.1",
  id: "fixture",
  sequence: 42,
  plugins: [read("release-plugin.json")],
  sidecars: [read("release-sidecar.json")],
  kits: [read("release-kit.json")],
  profiles: [{ id: "weather", plugin: { id: "weather-plugin", version: "0.0.1" }, bindings: [] }],
  issuedAt: "2026-07-14T00:00:00Z",
  expiresAt: "2026-07-15T00:00:00Z",
  algorithm: "ed25519",
  keyId: "fixture-2026",
};
const canonical = canonicalRegistryPayload(signingEnvelope);
const signed = { ...signingEnvelope, signature: sign(null, canonical, privateKey).toString("base64") };
writeFileSync(join(root, "registry-signed.json"), JSON.stringify(signed, null, 2) + "\n");
writeFileSync(join(root, "registry-canonical.json"), Buffer.concat([Buffer.from(canonical), Buffer.from("\n")]));
writeFileSync(join(root, "registry-canonical.sha256"), createHash("sha256").update(canonical).digest("hex") + "\n");
writeFileSync(join(root, "registry-public-key.json"), JSON.stringify({
  algorithm: "ed25519", keyId: "fixture-2026", value: publicRaw.toString("base64"),
}, null, 2) + "\n");
