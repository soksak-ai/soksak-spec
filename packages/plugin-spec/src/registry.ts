import { parseReleaseReference, type ReleaseReference } from "./distribution.js";
import { checkKnownKeys, isRecord } from "./util.js";

// An index entry is one release reference; consumers walk the dependency closure through release.json.
export interface Registry {
  id: string; sequence: number; issuedAt: string; expiresAt: string; plugins: ReleaseReference[];
  signature: { algorithm: "ed25519"; keyId: string; value: string };
}
export interface RegistryPublicKey { algorithm: "ed25519"; keyId: string; value: string }
export interface RegistryHighWater { sequence: number; digest: string }
export type RegistryContinuity = "initial" | "unchanged" | "advance";
export interface CertifiedRegistry { readonly registry: Registry; readonly digest: string; readonly continuity: RegistryContinuity; readonly highWater: RegistryHighWater }
export interface RegistryTrustPolicy { expectedRegistryId: string; expectedKeyId: string; publicKey: RegistryPublicKey; now: number; highWater?: RegistryHighWater }
export type RegistryCertificationResult = { ok: true; value: CertifiedRegistry } | { ok: false; code: string; errors: string[] };

const REGISTRY_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const KEY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UTC_SECONDS_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;
function validTime(value: unknown): value is string { return typeof value === "string" && UTC_SECONDS_RE.test(value) && Number.isFinite(Date.parse(value)); }
function base64(value: unknown, bytes: number): value is string {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  try { const decoded = atob(value); return decoded.length === bytes && btoa(decoded) === value; } catch { return false; }
}
function parseSignature(raw: unknown, errors: string[]): Registry["signature"] | null {
  if (!isRecord(raw)) { errors.push("registry.signature: object required"); return null; }
  checkKnownKeys(raw, ["algorithm", "keyId", "value"], "registry.signature", errors);
  if (raw.algorithm !== "ed25519") errors.push("registry.signature.algorithm: ed25519 required");
  if (typeof raw.keyId !== "string" || !KEY_ID_RE.test(raw.keyId)) errors.push("registry.signature.keyId: key id required");
  if (!base64(raw.value, 64)) errors.push("registry.signature.value: Ed25519 signature required");
  return errors.length ? null : { algorithm: "ed25519", keyId: raw.keyId as string, value: raw.value as string };
}
export function parseRegistry(raw: unknown): { ok: true; value: Registry } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ["registry: object required"] };
  checkKnownKeys(raw, ["expiresAt", "id", "issuedAt", "plugins", "sequence", "signature"], "registry", errors);
  for (const key of ["expiresAt", "id", "issuedAt", "plugins", "sequence", "signature"]) if (!(key in raw)) errors.push(`registry.${key}: required`);
  if (typeof raw.id !== "string" || !REGISTRY_ID_RE.test(raw.id)) errors.push("registry.id: registry id required");
  if (!Number.isSafeInteger(raw.sequence) || (raw.sequence as number) < 1) errors.push("registry.sequence: positive integer required");
  if (!validTime(raw.issuedAt)) errors.push("registry.issuedAt: canonical timestamp required");
  if (!validTime(raw.expiresAt) || (validTime(raw.issuedAt) && Date.parse(raw.expiresAt as string) <= Date.parse(raw.issuedAt))) errors.push("registry.expiresAt: later canonical timestamp required");
  const plugins: ReleaseReference[] = [];
  if (!Array.isArray(raw.plugins)) errors.push("registry.plugins: array required");
  else raw.plugins.forEach((item, index) => {
    const reference = parseReleaseReference(item, `registry.plugins[${index}]`);
    if (reference.ok) plugins.push(reference.value); else errors.push(...reference.errors);
  });
  const keys = plugins.map((plugin) => plugin.id);
  if (new Set(keys).size !== keys.length) errors.push("registry.plugins: one current release per plugin id required");
  if (keys.some((key, index) => key !== [...keys].sort()[index])) errors.push("registry.plugins: sorted by id required");
  const signature = parseSignature(raw.signature, errors);
  if (errors.length || !signature) return { ok: false, errors };
  return { ok: true, value: { id: raw.id as string, sequence: raw.sequence as number, issuedAt: raw.issuedAt as string, expiresAt: raw.expiresAt as string, plugins, signature } };
}
export function parseRegistryPublicKey(raw: unknown): { ok: true; value: RegistryPublicKey } | { ok: false; errors: string[] } {
  const errors: string[] = []; if (!isRecord(raw)) return { ok: false, errors: ["registry public key: object required"] };
  checkKnownKeys(raw, ["algorithm", "keyId", "value"], "registry public key", errors);
  if (raw.algorithm !== "ed25519") errors.push("registry public key.algorithm: ed25519 required");
  if (typeof raw.keyId !== "string" || !KEY_ID_RE.test(raw.keyId)) errors.push("registry public key.keyId: key id required");
  if (!base64(raw.value, 32)) errors.push("registry public key.value: Ed25519 public key required");
  return errors.length ? { ok: false, errors } : { ok: true, value: { algorithm: "ed25519", keyId: raw.keyId as string, value: raw.value as string } };
}
function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  throw new Error("registry canonical payload contains a non-JSON value");
}
export function canonicalRegistryPayload(raw: unknown): Uint8Array {
  if (!isRecord(raw)) throw new Error("invalid registry: object required");
  const unsigned = { ...raw }; delete unsigned.signature;
  const candidate = { ...unsigned, signature: { algorithm: "ed25519", keyId: "placeholder", value: btoa(String.fromCharCode(...new Uint8Array(64))) } };
  const parsed = parseRegistry(candidate); if (!parsed.ok) throw new Error(`invalid registry: ${parsed.errors.join("; ")}`);
  return new TextEncoder().encode(canonical(unsigned));
}
function bytes(value: string): Uint8Array { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
async function digestHex(value: Uint8Array): Promise<string> { const digest = await crypto.subtle.digest("SHA-256", value as BufferSource); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function verify(payload: Uint8Array, signature: string, key: RegistryPublicKey): Promise<boolean> {
  try { const imported = await crypto.subtle.importKey("raw", bytes(key.value) as BufferSource, { name: "Ed25519" }, false, ["verify"]); return await crypto.subtle.verify({ name: "Ed25519" }, imported, bytes(signature) as BufferSource, payload as BufferSource); } catch { return false; }
}
export async function certifyRegistry(raw: unknown, policy: RegistryTrustPolicy): Promise<RegistryCertificationResult> {
  const parsed = parseRegistry(raw); if (!parsed.ok) return { ok: false, code: "INVALID_REGISTRY", errors: parsed.errors };
  const key = parseRegistryPublicKey(policy.publicKey);
  if (!key.ok || parsed.value.id !== policy.expectedRegistryId || parsed.value.signature.keyId !== policy.expectedKeyId || key.value.keyId !== policy.expectedKeyId) return { ok: false, code: "TRUST_MISMATCH", errors: ["registry identity or key mismatch"] };
  const payload = canonicalRegistryPayload(parsed.value);
  if (!await verify(payload, parsed.value.signature.value, key.value)) return { ok: false, code: "INVALID_SIGNATURE", errors: ["registry signature is invalid"] };
  if (!Number.isFinite(policy.now) || policy.now < Date.parse(parsed.value.issuedAt) || policy.now >= Date.parse(parsed.value.expiresAt)) return { ok: false, code: "NOT_CURRENT", errors: ["registry is not current"] };
  const digest = await digestHex(payload); let continuity: RegistryContinuity = "initial";
  if (policy.highWater) { if (parsed.value.sequence < policy.highWater.sequence) return { ok: false, code: "ROLLBACK", errors: ["registry sequence rollback"] }; if (parsed.value.sequence === policy.highWater.sequence) { if (digest !== policy.highWater.digest) return { ok: false, code: "EQUIVOCATION", errors: ["registry sequence equivocation"] }; continuity = "unchanged"; } else continuity = "advance"; }
  return { ok: true, value: Object.freeze({ registry: parsed.value, digest, continuity, highWater: { sequence: parsed.value.sequence, digest } }) };
}
