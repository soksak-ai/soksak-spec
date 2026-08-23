import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { canonicalRegistryPayload, parseRegistry, type RegistryPlugin } from "./registry.js";
import { parseReleaseManifest, type ReleaseDocument } from "./release.js";
import type { ReleaseReference } from "./distribution.js";

export interface ReadReleaseResult { bytes: Uint8Array; value: unknown }
export type ReadRelease = (reference: ReleaseReference) => Promise<ReadReleaseResult>;
interface UnsignedRegistry { id: string; sequence: number; issuedAt: string; expiresAt: string; plugins: RegistryPlugin[] }

function digest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function referenceKey(reference: ReleaseReference): string { return `${reference.id}@${reference.version}`; }
function assertReferenceBytes(reference: ReleaseReference, bytes: Uint8Array, verifyBytes: boolean): void {
  if (!verifyBytes) return;
  if (bytes.byteLength !== reference.size) throw new Error(`release size mismatch: ${referenceKey(reference)}`);
  if (digest(bytes) !== reference.sha256) throw new Error(`release digest mismatch: ${referenceKey(reference)}`);
}
async function visit(reference: ReleaseReference, expectedKind: "plugin" | "sidecar", read: ReadRelease, verifyBytes: boolean, active: Set<string>, done: Map<string, ReleaseDocument>): Promise<ReleaseDocument> {
  const key = referenceKey(reference);
  if (active.has(key)) throw new Error(`runtime dependency cycle: ${[...active, key].join(" -> ")}`);
  const existing = done.get(key); if (existing) return existing;
  active.add(key);
  const result = await read(reference); assertReferenceBytes(reference, result.bytes, verifyBytes);
  const parsed = parseReleaseManifest(result.value); if (!parsed.ok) throw new Error(`invalid release ${key}: ${parsed.errors.join("; ")}`);
  if (parsed.value.kind !== expectedKind) throw new Error(`release kind mismatch: ${key} is ${parsed.value.kind}, expected ${expectedKind}`);
  if (parsed.value.id !== reference.id || parsed.value.version !== reference.version) throw new Error(`release identity mismatch: ${key}`);
  for (const dependency of parsed.value.runtimeDependencies?.plugins ?? []) await visit(dependency, "plugin", read, verifyBytes, active, done);
  for (const dependency of parsed.value.runtimeDependencies?.sidecars ?? []) await visit(dependency, "sidecar", read, verifyBytes, active, done);
  active.delete(key); done.set(key, parsed.value); return parsed.value;
}
export async function verifyReleaseClosure(plugins: ReleaseReference[], read: ReadRelease, verifyBytes = true): Promise<void> {
  const done = new Map<string, ReleaseDocument>();
  for (const plugin of plugins) await visit(plugin, "plugin", read, verifyBytes, new Set(), done);
}
export async function buildRegistry(input: { id: string; sequence: number; issuedAt: string; expiresAt: string; plugins: ReleaseReference[]; read: ReadRelease; verifyBytes?: boolean }): Promise<UnsignedRegistry> {
  const plugins = [...input.plugins].sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(plugins.map((plugin) => plugin.id)).size !== plugins.length) throw new Error("one current release per plugin id required");
  const projected: RegistryPlugin[] = []; const done = new Map<string, ReleaseDocument>();
  for (const plugin of plugins) {
    const release = await visit(plugin, "plugin", input.read, input.verifyBytes ?? true, new Set(), done);
    projected.push({ ...plugin, ...(release.runtimeDependencies ? { runtimeDependencies: release.runtimeDependencies } : {}) });
  }
  return { id: input.id, sequence: input.sequence, issuedAt: input.issuedAt, expiresAt: input.expiresAt, plugins: projected };
}
export function authenticateRegistry(registry: UnsignedRegistry, seedBase64: string) {
  const seed = Buffer.from(seedBase64, "base64"); if (seed.length !== 32) throw new Error("registry signing seed must contain 32 bytes");
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
  const publicDer = createPublicKey(privateKey).export({ type: "spki", format: "der" }) as Buffer;
  const keyId = createHash("sha256").update(publicDer.subarray(-32)).digest("hex").slice(0, 32);
  const placeholder = { ...registry, signature: { algorithm: "ed25519" as const, keyId, value: Buffer.alloc(64).toString("base64") } };
  const value = { ...registry, signature: { algorithm: "ed25519" as const, keyId, value: sign(null, canonicalRegistryPayload(placeholder), privateKey).toString("base64") } };
  const parsed = parseRegistry(value); if (!parsed.ok) throw new Error(`authenticated registry is invalid: ${parsed.errors.join("; ")}`);
  return value;
}
