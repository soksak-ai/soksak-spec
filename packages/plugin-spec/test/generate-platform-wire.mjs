#!/usr/bin/env node
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GITHUB_ORG } from "../dist/release-primitives.js";
import { canonicalRegistryPayload } from "../dist/registry.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "fixtures/platform-wire");
const seed = Buffer.from("0f4d3c2b1a09182736455463728190abcdef0123456789abcdef0123456789ab", "hex");
const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
const publicDer = createPublicKey(privateKey).export({ type: "spki", format: "der" });
const publicRaw = Buffer.from(publicDer).subarray(-32);

const component = (kind, id, repository, commit, artifacts, evidenceNames) => {
  const version = "0.0.1";
  const manifestBytes = Buffer.from(`fixture ${kind} manifest\n`);
  return { kind, id, version, manifest: { file: `${kind}.json`, size: manifestBytes.length, sha256: createHash("sha256").update(manifestBytes).digest("hex") }, source: { repository, commit }, artifacts, evidence: evidenceNames.map((name, index) => ({ file: name, size: 12345, sha256: String(index + 8).repeat(64).slice(0, 64) })) };
};
const artifact = (target, name, manifest, sha) => ({ target, file: name, size: 12345, sha256: sha, format: name.endsWith(".tgz") ? "tgz" : "tar.gz", manifest });
// source.repository is bound to the org: https://github.com/<GITHUB_ORG>/<id>.
const repository = (id) => `https://github.com/${GITHUB_ORG}/${id}`;
const values = {
  "release-plugin.json": component("plugin", "weather-plugin", repository("weather-plugin"), "a".repeat(40), [artifact("any", "weather-plugin-0.0.1.tgz", "plugin.json", "1".repeat(64))], ["plugin-kind.conformance.json", "plugin-release.conformance.json"]),
  "release-sidecar.json": component("sidecar", "weather-sidecar", repository("weather-sidecar"), "b".repeat(40), [artifact("aarch64-apple-darwin", "weather-sidecar-aarch64-apple-darwin.tar.gz", "sidecar.json", "2".repeat(64)), artifact("x86_64-unknown-linux-gnu", "weather-sidecar-x86_64-unknown-linux-gnu.tar.gz", "sidecar.json", "3".repeat(64))], ["sidecar-interface.conformance.json", "sidecar-kind.conformance.json", "sidecar-release.conformance.json"]),
};
for (const [kind, id, name, letter] of [["kit", "terminal-common", "release-kit.json", "c"], ["contract", "terminal-contract", "release-contract.json", "d"], ["spec", "soksak-spec", "release-spec.json", "e"]]) {
  values[name] = component(kind, id, repository(id), letter.repeat(40), [artifact("any", `${id}-0.0.1.tgz`, `${kind}.json`, "7".repeat(64))], [`${kind}-release.conformance.json`]);
}
for (const [name, value] of Object.entries(values)) writeFileSync(join(root, name), JSON.stringify(value, null, 2) + "\n");
const pluginRelease = values["release-plugin.json"];
// The index entry pins the checked-in release-plugin.json bytes.
const pluginReleaseBytes = Buffer.from(JSON.stringify(pluginRelease, null, 2) + "\n");
const signingEnvelope = {
  id: "fixture",
  sequence: 42,
  plugins: [{ id: pluginRelease.id, version: pluginRelease.version, size: pluginReleaseBytes.length, sha256: createHash("sha256").update(pluginReleaseBytes).digest("hex") }],
  issuedAt: "2026-07-14T00:00:00Z",
  expiresAt: "2026-07-15T00:00:00Z",
};
const canonical = canonicalRegistryPayload(signingEnvelope);
const signed = { ...signingEnvelope, signature: { algorithm: "ed25519", keyId: "fixture-2026", value: sign(null, canonical, privateKey).toString("base64") } };
writeFileSync(join(root, "registry.json"), JSON.stringify(signed, null, 2) + "\n");
writeFileSync(join(root, "registry-canonical.json"), Buffer.concat([Buffer.from(canonical), Buffer.from("\n")]));
writeFileSync(join(root, "registry-canonical.sha256"), createHash("sha256").update(canonical).digest("hex") + "\n");
writeFileSync(join(root, "registry-public-key.json"), JSON.stringify({
  algorithm: "ed25519", keyId: "fixture-2026", value: publicRaw.toString("base64"),
}, null, 2) + "\n");
