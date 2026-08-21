import {
  dependencyIdentity,
  parseReleaseManifest,
  releaseIdentity,
  type PlatformParseResult,
  type PluginRelease,
  type ReleaseDependency,
  type ReleaseDocument,
  type ReleaseIdentity,
  type SidecarRelease,
  type KitRelease,
  type ContractRelease,
  type SpecRelease,
} from "./release.js";
import { SHA256_RE } from "./release-primitives.js";
import { checkKnownKeys, isRecord } from "./util.js";

export interface RegistryProfile {
  id: string;
  plugin: { id: string; version: string };
  bindings: unknown[];
}

export interface RegistryPayload {
  id: string;
  sequence: number;
  plugins: PluginRelease[];
  sidecars: SidecarRelease[];
  kits: KitRelease[];
  contracts: ContractRelease[];
  specs: SpecRelease[];
  profiles: RegistryProfile[];
}

export interface SignedRegistryIndex extends RegistryPayload {
  issuedAt: string;
  expiresAt: string;
  algorithm: "ed25519";
  keyId: string;
  signature: string;
}

export interface RegistryPublicKey { algorithm: "ed25519"; keyId: string; value: string }
export interface RegistryHighWater { sequence: number; digest: string }
export type RegistryContinuity = "initial" | "unchanged" | "advance";
export interface CertifiedRegistryIndex {
  readonly index: SignedRegistryIndex;
  readonly digest: string;
  readonly continuity: RegistryContinuity;
  readonly highWater: RegistryHighWater;
}

const REGISTRY_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const KEY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UTC_SECONDS_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;

function strictObject(raw: unknown, allowed: readonly string[], required: readonly string[], label: string, errors: string[]): Record<string, unknown> | null {
  if (!isRecord(raw)) { errors.push(label + ": object required"); return null; }
  checkKnownKeys(raw, allowed, label, errors);
  for (const key of required) if (!(key in raw)) errors.push(label + "." + key + ": required");
  return raw;
}

function sortedUnique(values: string[], label: string, errors: string[]): void {
  if (new Set(values).size !== values.length) errors.push(label + ": duplicate entries forbidden");
  const sorted = [...values].sort();
  if (values.some((value, index) => value !== sorted[index])) errors.push(label + ": entries must be sorted");
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && UTC_SECONDS_RE.test(value) && Number.isFinite(Date.parse(value));
}

function canonicalBase64(value: unknown, bytes: number): value is string {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  try { const decoded = atob(value); return decoded.length === bytes && btoa(decoded) === value; } catch { return false; }
}

function identityKey(identity: ReleaseIdentity): string {
  return identity.kind + ":" + identity.id + "@" + identity.version;
}

export function registryReleases(registry: RegistryPayload): ReleaseDocument[] {
  return [...registry.plugins, ...registry.sidecars, ...registry.kits, ...registry.contracts, ...registry.specs];
}

function parseReleaseArray<T extends ReleaseDocument>(raw: unknown, label: string, kind: ReleaseIdentity["kind"], errors: string[]): T[] {
  const result: T[] = [];
  if (!Array.isArray(raw)) { errors.push(label + ": array required"); return result; }
  raw.forEach((item, index) => {
    const parsed = parseReleaseManifest(item);
    if (!parsed.ok) { errors.push(...parsed.errors.map((error) => label + "[" + index + "]: " + error)); return; }
    if (releaseIdentity(parsed.value).kind !== kind) { errors.push(label + "[" + index + "]: " + kind + " release required"); return; }
    result.push(parsed.value as T);
  });
  sortedUnique(result.map((release) => identityKey(releaseIdentity(release))), label, errors);
  return result;
}

function parseProfile(raw: unknown, index: number, errors: string[]): RegistryProfile | null {
  const label = "registry.profiles[" + index + "]";
  const value = strictObject(raw, ["bindings", "id", "plugin"], ["bindings", "id", "plugin"], label, errors);
  if (!value) return null;
  if (typeof value.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value.id)) errors.push(label + ".id: profile id required");
  const plugin = strictObject(value.plugin, ["id", "version"], ["id", "version"], label + ".plugin", errors);
  if (!plugin || typeof plugin.id !== "string" || plugin.version !== "0.0.1") errors.push(label + ".plugin: exact plugin reference required");
  if (!Array.isArray(value.bindings)) errors.push(label + ".bindings: array required");
  if (!plugin || !Array.isArray(value.bindings) || typeof value.id !== "string") return null;
  return { id: value.id, plugin: { id: plugin.id as string, version: "0.0.1" }, bindings: value.bindings };
}

export function parseRegistryPayload(raw: unknown): PlatformParseResult<RegistryPayload> {
  const errors: string[] = [];
  const value = strictObject(raw, ["contracts", "id", "kits", "plugins", "profiles", "sequence", "sidecars", "specs"], ["contracts", "id", "kits", "plugins", "profiles", "sequence", "sidecars", "specs"], "registry", errors);
  if (!value) return { ok: false, errors };
  if (typeof value.id !== "string" || !REGISTRY_ID_RE.test(value.id)) errors.push("registry.id: registry id required");
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) errors.push("registry.sequence: positive integer required");
  const plugins = parseReleaseArray<PluginRelease>(value.plugins, "registry.plugins", "plugin", errors);
  const sidecars = parseReleaseArray<SidecarRelease>(value.sidecars, "registry.sidecars", "sidecar", errors);
  const kits = parseReleaseArray<KitRelease>(value.kits, "registry.kits", "kit", errors);
  const contracts = parseReleaseArray<ContractRelease>(value.contracts, "registry.contracts", "contract", errors);
  const specs = parseReleaseArray<SpecRelease>(value.specs, "registry.specs", "spec", errors);
  const profiles: RegistryProfile[] = [];
  if (!Array.isArray(value.profiles)) errors.push("registry.profiles: array required");
  else value.profiles.forEach((item, index) => { const profile = parseProfile(item, index, errors); if (profile) profiles.push(profile); });
  sortedUnique(profiles.map((profile) => profile.id), "registry.profiles", errors);
  const index = new Map(registryReleases({ id: value.id as string, sequence: value.sequence as number, plugins, sidecars, kits, contracts, specs, profiles }).map((release) => [identityKey(releaseIdentity(release)), release]));
  for (const release of index.values()) for (const dependency of release.dependencies) if (!index.has(identityKey(dependencyIdentity(dependency)))) errors.push("registry dependency absent: " + identityKey(dependencyIdentity(dependency)));
  for (const profile of profiles) if (!index.has("plugin:" + profile.plugin.id + "@" + profile.plugin.version)) errors.push("registry profile plugin absent: " + profile.id);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { id: value.id as string, sequence: value.sequence as number, plugins, sidecars, kits, contracts, specs, profiles } };
}

export function parseSignedRegistryIndex(raw: unknown): PlatformParseResult<SignedRegistryIndex> {
  const errors: string[] = [];
  const value = strictObject(raw, ["algorithm", "contracts", "expiresAt", "id", "issuedAt", "keyId", "kits", "plugins", "profiles", "sequence", "sidecars", "signature", "specs"], ["algorithm", "contracts", "expiresAt", "id", "issuedAt", "keyId", "kits", "plugins", "profiles", "sequence", "sidecars", "signature", "specs"], "registry", errors);
  if (!value) return { ok: false, errors };
  const payload = parseRegistryPayload({
    id: value.id, sequence: value.sequence,
    plugins: value.plugins, sidecars: value.sidecars, kits: value.kits, contracts: value.contracts, specs: value.specs, profiles: value.profiles,
  });
  if (!payload.ok) errors.push(...payload.errors);
  if (!validTimestamp(value.issuedAt)) errors.push("registry.issuedAt: canonical timestamp required");
  if (!validTimestamp(value.expiresAt) || (validTimestamp(value.issuedAt) && Date.parse(value.expiresAt as string) <= Date.parse(value.issuedAt))) errors.push("registry.expiresAt: later canonical timestamp required");
  if (value.algorithm !== "ed25519") errors.push("registry.algorithm: ed25519 required");
  if (typeof value.keyId !== "string" || !KEY_ID_RE.test(value.keyId)) errors.push("registry.keyId: key id required");
  if (!canonicalBase64(value.signature, 64)) errors.push("registry.signature: Ed25519 signature required");
  return errors.length > 0 || !payload.ok ? { ok: false, errors } : { ok: true, value: { ...payload.value, issuedAt: value.issuedAt as string, expiresAt: value.expiresAt as string, algorithm: "ed25519", keyId: value.keyId as string, signature: value.signature as string } };
}

export function parseRegistryPublicKey(raw: unknown): PlatformParseResult<RegistryPublicKey> {
  const errors: string[] = [];
  const value = strictObject(raw, ["algorithm", "keyId", "value"], ["algorithm", "keyId", "value"], "registry public key", errors);
  if (!value) return { ok: false, errors };
  if (value.algorithm !== "ed25519") errors.push("registry public key.algorithm: ed25519 required");
  if (typeof value.keyId !== "string" || !KEY_ID_RE.test(value.keyId)) errors.push("registry public key.keyId: key id required");
  if (!canonicalBase64(value.value, 32)) errors.push("registry public key.value: Ed25519 public key required");
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { algorithm: "ed25519", keyId: value.keyId as string, value: value.value as string } };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (isRecord(value)) return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  throw new Error("registry canonical payload contains a non-JSON value");
}

export function canonicalRegistryPayload(raw: unknown): Uint8Array {
  if (!isRecord(raw)) throw new Error("invalid registry payload: object required");
  const source = { ...raw };
  delete source.signature;
  const registry = parseRegistryPayload({
    id: source.id, sequence: source.sequence,
    plugins: source.plugins, sidecars: source.sidecars, kits: source.kits, contracts: source.contracts, specs: source.specs, profiles: source.profiles,
  });
  if (!registry.ok) throw new Error("invalid registry payload: " + registry.errors.join("; "));
  if (!validTimestamp(source.issuedAt) || !validTimestamp(source.expiresAt) || source.algorithm !== "ed25519" || typeof source.keyId !== "string" || !KEY_ID_RE.test(source.keyId)) {
    throw new Error("invalid registry signing envelope");
  }
  const value = registry.value;
  const registryPayload: RegistryPayload = { id: value.id, sequence: value.sequence, plugins: value.plugins, sidecars: value.sidecars, kits: value.kits, contracts: value.contracts, specs: value.specs, profiles: value.profiles };
  const payload = { registry: registryPayload, issuedAt: source.issuedAt, expiresAt: source.expiresAt, algorithm: "ed25519", keyId: source.keyId };
  return new TextEncoder().encode(canonicalJson(payload));
}

function base64Bytes(value: string): Uint8Array { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
async function digestHex(bytes: Uint8Array): Promise<string> { const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function verifyEd25519(payload: Uint8Array, signature: string, key: RegistryPublicKey): Promise<boolean> {
  try {
    const imported = await crypto.subtle.importKey("raw", base64Bytes(key.value) as BufferSource, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, imported, base64Bytes(signature) as BufferSource, payload as BufferSource);
  } catch { return false; }
}

const certifiedRegistries = new WeakSet<object>();
export interface RegistryTrustPolicy { expectedRegistryId: string; expectedKeyId: string; publicKey: RegistryPublicKey; now: number; highWater?: RegistryHighWater }
export type RegistryCertificationResult = { ok: true; value: CertifiedRegistryIndex } | { ok: false; code: string; errors: string[] };
export async function certifyRegistryIndex(raw: unknown, policy: RegistryTrustPolicy): Promise<RegistryCertificationResult> {
  const parsed = parseSignedRegistryIndex(raw);
  if (!parsed.ok) return { ok: false, code: "INVALID_INDEX", errors: parsed.errors };
  const key = parseRegistryPublicKey(policy.publicKey);
  if (!key.ok || parsed.value.id !== policy.expectedRegistryId || parsed.value.keyId !== policy.expectedKeyId || key.value.keyId !== policy.expectedKeyId) return { ok: false, code: "TRUST_MISMATCH", errors: ["registry identity or key mismatch"] };
  const payload = canonicalRegistryPayload(parsed.value);
  if (!await verifyEd25519(payload, parsed.value.signature, key.value)) return { ok: false, code: "INVALID_SIGNATURE", errors: ["registry signature is invalid"] };
  if (!Number.isFinite(policy.now) || policy.now < Date.parse(parsed.value.issuedAt) || policy.now >= Date.parse(parsed.value.expiresAt)) return { ok: false, code: "NOT_CURRENT", errors: ["registry is not current"] };
  const digest = await digestHex(payload);
  let continuity: RegistryContinuity = "initial";
  if (policy.highWater) {
    if (parsed.value.sequence < policy.highWater.sequence) return { ok: false, code: "ROLLBACK", errors: ["registry sequence rollback"] };
    if (parsed.value.sequence === policy.highWater.sequence) {
      if (digest !== policy.highWater.digest) return { ok: false, code: "EQUIVOCATION", errors: ["registry sequence equivocation"] };
      continuity = "unchanged";
    } else continuity = "advance";
  }
  const certified = Object.freeze({ index: parsed.value, digest, continuity, highWater: { sequence: parsed.value.sequence, digest } });
  certifiedRegistries.add(certified);
  return { ok: true, value: certified };
}

export type RegistryDependencyResolutionResult = { ok: true; value: ReleaseDocument } | { ok: false; errors: string[] };
export function resolveRegistryDependency(certified: CertifiedRegistryIndex, dependency: ReleaseDependency): RegistryDependencyResolutionResult {
  if (!certifiedRegistries.has(certified as object)) return { ok: false, errors: ["uncertified registry index"] };
  const wanted = identityKey(dependencyIdentity(dependency));
  const release = registryReleases(certified.index).find((candidate) => identityKey(releaseIdentity(candidate)) === wanted);
  return release ? { ok: true, value: release } : { ok: false, errors: ["dependency absent from origin registry: " + wanted] };
}
