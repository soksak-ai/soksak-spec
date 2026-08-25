import { createHash } from "node:crypto";
import { parseRuntimeDependencies, type ReleaseReference, type RuntimeDependencies } from "./distribution.js";
import { ARTIFACT_FORMATS, COMPONENT_ID_RE, GIT_COMMIT_RE, GITHUB_ORG, RELEASE_FILE_RE, RUST_SIDECAR_TARGETS, SHA256_RE, STRICT_SEMVER_RE, type ArtifactFormat, type ReleaseKind, type RustSidecarTarget } from "./release-primitives.js";
import { checkKnownKeys, isRecord } from "./util.js";

export type PlatformParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };
export interface ExactReference { id: string; version: string }
export interface ReleaseSource { repository: string; commit: string }
// A file inside the release directory, named by bare filename. The directory is derived from
// kind, id, and version by the resolver; no document names a location.
export interface IntegrityReference { file: string; size: number; sha256: string }
export interface ReleaseArtifact extends IntegrityReference { target: "any" | RustSidecarTarget; format: ArtifactFormat; manifest: "plugin.json" | "sidecar.json" | "kit.json" | "contract.json" | "spec.json" }
export interface ReleaseDocument extends ExactReference { kind: ReleaseKind; manifest: IntegrityReference; source: ReleaseSource; artifacts: ReleaseArtifact[]; runtimeDependencies?: RuntimeDependencies; evidence: IntegrityReference[] }
export type PluginRelease = ReleaseDocument & { kind: "plugin" };
export type SidecarRelease = ReleaseDocument & { kind: "sidecar" };
export type KitRelease = ReleaseDocument & { kind: "kit" };
export type ContractRelease = ReleaseDocument & { kind: "contract" };
export type SpecRelease = ReleaseDocument & { kind: "spec" };
export interface ReleaseIdentity extends ExactReference { kind: ReleaseKind }
export function releaseIdentity(release: ReleaseDocument): ReleaseIdentity { return { kind: release.kind, id: release.id, version: release.version }; }

// source.repository is bound to the org and the component id; no other owner or name is accepted.
function expectedRepository(id: string): string { return `https://github.com/${GITHUB_ORG}/${id}`; }
const RELEASE_KINDS: readonly ReleaseKind[] = ["plugin", "sidecar", "kit", "contract", "spec"];

function strict(raw: unknown, allowed: readonly string[], required: readonly string[], label: string, errors: string[]): Record<string, unknown> | null {
  if (!isRecord(raw)) { errors.push(`${label}: object required`); return null; }
  checkKnownKeys(raw, allowed, label, errors);
  for (const key of required) if (!(key in raw)) errors.push(`${label}.${key}: required`);
  return raw;
}
function sortedUnique(values: string[], label: string, errors: string[]): void {
  if (new Set(values).size !== values.length) errors.push(`${label}: duplicate entries forbidden`);
  const sorted = [...values].sort();
  if (values.some((value, index) => value !== sorted[index])) errors.push(`${label}: entries must be sorted`);
}
function checkFile(value: Record<string, unknown>, label: string, errors: string[]): void {
  if (typeof value.file !== "string" || !RELEASE_FILE_RE.test(value.file)) errors.push(`${label}.file: bare filename required`);
  if (!Number.isSafeInteger(value.size) || (value.size as number) <= 0) errors.push(`${label}.size: positive safe integer required`);
  if (typeof value.sha256 !== "string" || !SHA256_RE.test(value.sha256)) errors.push(`${label}.sha256: exact SHA-256 required`);
}
function parseIntegrity(raw: unknown, label: string, errors: string[]): IntegrityReference | null {
  const before = errors.length;
  const value = strict(raw, ["file", "sha256", "size"], ["file", "sha256", "size"], label, errors);
  if (!value) return null;
  checkFile(value, label, errors);
  return errors.length === before ? { file: value.file as string, size: value.size as number, sha256: value.sha256 as string } : null;
}
function expectedManifest(kind: ReleaseKind): ReleaseArtifact["manifest"] { return `${kind}.json` as ReleaseArtifact["manifest"]; }
function parseArtifacts(raw: unknown, kind: ReleaseKind, errors: string[]): ReleaseArtifact[] {
  const output: ReleaseArtifact[] = [];
  if (!Array.isArray(raw) || raw.length === 0) { errors.push("release.artifacts: non-empty array required"); return output; }
  raw.forEach((item, index) => {
    const label = `release.artifacts[${index}]`;
    const before = errors.length;
    const value = strict(item, ["file", "format", "manifest", "sha256", "size", "target"], ["file", "format", "manifest", "sha256", "size", "target"], label, errors);
    if (!value) return;
    checkFile(value, label, errors);
    if (!(ARTIFACT_FORMATS as readonly unknown[]).includes(value.format)) errors.push(`${label}.format: tar.gz|tgz required`);
    if (value.manifest !== expectedManifest(kind)) errors.push(`${label}.manifest: ${expectedManifest(kind)} required`);
    if (kind === "sidecar") { if (!(RUST_SIDECAR_TARGETS as readonly unknown[]).includes(value.target)) errors.push(`${label}.target: native target required`); } else if (value.target !== "any") errors.push(`${label}.target: any required for ${kind}`);
    if (errors.length === before) output.push({ file: value.file as string, size: value.size as number, sha256: value.sha256 as string, target: value.target as ReleaseArtifact["target"], format: value.format as ArtifactFormat, manifest: value.manifest as ReleaseArtifact["manifest"] });
  });
  sortedUnique(output.map((item) => item.target), "release.artifacts", errors);
  if (kind !== "sidecar" && output.length !== 1) errors.push(`release.artifacts: ${kind} requires one any artifact`);
  return output;
}

export function parseReleaseManifest(raw: unknown): PlatformParseResult<ReleaseDocument> {
  const errors: string[] = [];
  const value = strict(raw, ["artifacts", "evidence", "id", "kind", "manifest", "runtimeDependencies", "source", "version"], ["artifacts", "evidence", "id", "kind", "manifest", "source", "version"], "release", errors);
  if (!value) return { ok: false, errors };
  if (!(RELEASE_KINDS as readonly unknown[]).includes(value.kind)) errors.push("release.kind: plugin|sidecar|kit|contract|spec required");
  if (typeof value.id !== "string" || !COMPONENT_ID_RE.test(value.id)) errors.push("release.id: component id required");
  if (typeof value.version !== "string" || !STRICT_SEMVER_RE.test(value.version)) errors.push("release.version: exact strict SemVer required");
  const kind = value.kind as ReleaseKind; const version = value.version as string;
  const sourceValue = strict(value.source, ["commit", "repository"], ["commit", "repository"], "release.source", errors);
  if (!sourceValue || sourceValue.repository !== expectedRepository(value.id as string)) errors.push(`release.source.repository: ${expectedRepository(value.id as string)} required`);
  if (!sourceValue || typeof sourceValue.commit !== "string" || !GIT_COMMIT_RE.test(sourceValue.commit)) errors.push("release.source.commit: exact commit required");
  if (!sourceValue || errors.some((error) => error.startsWith("release.kind") || error.startsWith("release.version") || error.startsWith("release.source"))) return { ok: false, errors };
  const source = { repository: sourceValue.repository as string, commit: sourceValue.commit as string };
  const manifest = parseIntegrity(value.manifest, "release.manifest", errors);
  if (manifest && manifest.file !== expectedManifest(kind)) errors.push(`release.manifest.file: ${expectedManifest(kind)} required`);
  const artifacts = parseArtifacts(value.artifacts, kind, errors);
  const evidence: IntegrityReference[] = [];
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) errors.push("release.evidence: non-empty array required");
  else value.evidence.forEach((item, index) => { const parsed = parseIntegrity(item, `release.evidence[${index}]`, errors); if (parsed) evidence.push(parsed); });
  sortedUnique(evidence.map((item) => item.file), "release.evidence", errors);
  let runtimeDependencies: RuntimeDependencies | undefined;
  if (value.runtimeDependencies !== undefined) { const parsed = parseRuntimeDependencies(value.runtimeDependencies, "release.runtimeDependencies"); if (parsed.ok) runtimeDependencies = parsed.value; else errors.push(...parsed.errors); }
  if (kind !== "plugin" && kind !== "sidecar" && runtimeDependencies) errors.push(`release.runtimeDependencies: forbidden for ${kind}`);
  if (errors.length || !manifest) return { ok: false, errors };
  return { ok: true, value: { kind, id: value.id as string, version, manifest, source, artifacts, ...(runtimeDependencies ? { runtimeDependencies } : {}), evidence } };
}

// The bytes of a release.json against the reference that pins it: size, then sha256.
export function verifyReference(bytes: Uint8Array, reference: ReleaseReference): void {
  const key = `${reference.id}@${reference.version}`;
  if (bytes.byteLength !== reference.size) throw new Error(`release size mismatch: ${key}`);
  if (createHash("sha256").update(bytes).digest("hex") !== reference.sha256) throw new Error(`release digest mismatch: ${key}`);
}
