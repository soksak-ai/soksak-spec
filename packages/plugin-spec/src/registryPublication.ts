import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { canonicalRegistryPayload, parseRegistry } from "./registry.js";
import { parseReleaseManifest, verifyReference, type ReleaseDocument, type ReleaseIdentity } from "./release.js";
import type { ReleaseReference } from "./distribution.js";

// Resolver interface: the bytes of release.json for one release reference { kind, id, version,
// size, sha256 }. The reader derives the release directory and bounds the read by size; this
// module verifies the bytes against the reference after the read.
export type ReadRelease = (reference: ReleaseIdentity & ReleaseReference) => Promise<Uint8Array>;
interface UnsignedRegistry { id: string; sequence: number; issuedAt: string; expiresAt: string; plugins: ReleaseReference[] }

function referenceKey(reference: ReleaseReference): string { return `${reference.id}@${reference.version}`; }
function decode(bytes: Uint8Array, key: string): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new Error(`invalid release ${key}: JSON required`); }
}
// A visited release keeps its bytes: every later reference to it is verified against those bytes
// (size and sha256) and its kind before reuse; a reference with a different digest refuses by name.
interface Visited { document: ReleaseDocument; bytes: Uint8Array }
async function visit(reference: ReleaseReference, kind: "plugin" | "sidecar", read: ReadRelease, active: Set<string>, done: Map<string, Visited>): Promise<ReleaseDocument> {
  const key = referenceKey(reference);
  if (active.has(key)) throw new Error(`runtime dependency cycle: ${[...active, key].join(" -> ")}`);
  const existing = done.get(key);
  if (existing) {
    verifyReference(existing.bytes, reference);
    if (existing.document.kind !== kind) throw new Error(`release kind mismatch: ${key} is ${existing.document.kind}, expected ${kind}`);
    return existing.document;
  }
  active.add(key);
  const bytes = await read({ kind, id: reference.id, version: reference.version, size: reference.size, sha256: reference.sha256 });
  verifyReference(bytes, reference);
  const parsed = parseReleaseManifest(decode(bytes, key)); if (!parsed.ok) throw new Error(`invalid release ${key}: ${parsed.errors.join("; ")}`);
  if (parsed.value.kind !== kind) throw new Error(`release kind mismatch: ${key} is ${parsed.value.kind}, expected ${kind}`);
  if (parsed.value.id !== reference.id || parsed.value.version !== reference.version) throw new Error(`release identity mismatch: ${key}`);
  for (const dependency of parsed.value.runtimeDependencies?.plugins ?? []) await visit(dependency, "plugin", read, active, done);
  for (const dependency of parsed.value.runtimeDependencies?.sidecars ?? []) await visit(dependency, "sidecar", read, active, done);
  active.delete(key); done.set(key, { document: parsed.value, bytes }); return parsed.value;
}
export async function verifyReleaseClosure(plugins: ReleaseReference[], read: ReadRelease): Promise<void> {
  const done = new Map<string, Visited>();
  for (const plugin of plugins) await visit(plugin, "plugin", read, new Set(), done);
}
export async function buildRegistry(input: { id: string; sequence: number; issuedAt: string; expiresAt: string; plugins: ReleaseReference[]; read: ReadRelease }): Promise<UnsignedRegistry> {
  const plugins = [...input.plugins].sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(plugins.map((plugin) => plugin.id)).size !== plugins.length) throw new Error("one current release per plugin id required");
  await verifyReleaseClosure(plugins, input.read);
  return { id: input.id, sequence: input.sequence, issuedAt: input.issuedAt, expiresAt: input.expiresAt, plugins: plugins.map((plugin) => ({ id: plugin.id, version: plugin.version, size: plugin.size, sha256: plugin.sha256 })) };
}
export function authenticateRegistry(registry: UnsignedRegistry, seedBase64: string) {
  const seed = Buffer.from(seedBase64, "base64"); if (seed.length !== 32) throw new Error("registry signing seed must contain 32 bytes");
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
  const publicDer = createPublicKey(privateKey).export({ type: "spki", format: "der" }) as Buffer;
  const keyId = createHash("sha256").update(publicDer.subarray(-32)).digest("hex").slice(0, 32);
  const placeholder = { ...registry, signature: { algorithm: "ed25519" as const, keyId, value: Buffer.alloc(64).toString("base64") } };
  const payload = canonicalRegistryPayload(placeholder);
  const signature = sign(null, payload, privateKey);
  if (!verify(null, payload, createPublicKey(privateKey), signature)) throw new Error("registry signature self-verification failed");
  const value = { ...registry, signature: { algorithm: "ed25519" as const, keyId, value: signature.toString("base64") } };
  const parsed = parseRegistry(value); if (!parsed.ok) throw new Error(`authenticated registry is invalid: ${parsed.errors.join("; ")}`);
  return value;
}
