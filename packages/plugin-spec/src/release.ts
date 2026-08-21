import {
  ARTIFACT_FORMATS,
  GIT_COMMIT_RE,
  RUST_SIDECAR_TARGETS,
  SHA256_RE,
  STRICT_SEMVER_RE,
  COMPONENT_ID_RE,
  type ArtifactFormat,
  type ReleaseKind,
  type RustSidecarTarget,
} from "./release-primitives.js";
import { checkKnownKeys, isRecord } from "./util.js";

export type PlatformParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

export interface ExactReference {
  id: string;
  version: string;
}

export interface ReleaseSource {
  repository: string;
  commit: string;
}

export interface IntegrityReference {
  url: string;
  sha256: string;
}

export interface ReleaseArtifact extends IntegrityReference {
  size: number;
  target: "any" | RustSidecarTarget;
  format: ArtifactFormat;
  manifest: "plugin.json" | "sidecar.json" | "kit.json" | "contract.json" | "spec.json";
}

interface ReleaseFields {
  source: ReleaseSource;
  artifacts: ReleaseArtifact[];
  reports: IntegrityReference[];
}

export interface PluginRelease extends ReleaseFields {
  plugin: ExactReference;
}

export interface SidecarRelease extends ReleaseFields {
  sidecar: ExactReference;
}

export interface KitRelease extends ReleaseFields {
  kit: ExactReference;
}
export interface ContractRelease extends ReleaseFields { contract: ExactReference }
export interface SpecRelease extends ReleaseFields { spec: ExactReference }

export type ReleaseDocument = PluginRelease | SidecarRelease | KitRelease | ContractRelease | SpecRelease;
export interface ReleaseIdentity extends ExactReference { kind: ReleaseKind }

export function releaseIdentity(release: ReleaseDocument): ReleaseIdentity {
  if ("plugin" in release) return { kind: "plugin", ...release.plugin };
  if ("sidecar" in release) return { kind: "sidecar", ...release.sidecar };
  if ("contract" in release) return { kind: "contract", ...release.contract };
  if ("spec" in release) return { kind: "spec", ...release.spec };
  return { kind: "kit", ...release.kit };
}

function strictObject(
  raw: unknown,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
  errors: string[],
): Record<string, unknown> | null {
  if (!isRecord(raw)) {
    errors.push(`${label}: object required`);
    return null;
  }
  checkKnownKeys(raw, allowed, label, errors);
  for (const key of required) if (!(key in raw)) errors.push(`${label}.${key}: required`);
  return raw;
}

function sortedUnique(values: string[], label: string, errors: string[]): void {
  if (new Set(values).size !== values.length) errors.push(`${label}: duplicate entries forbidden`);
  const sorted = [...values].sort();
  if (values.some((value, index) => value !== sorted[index])) errors.push(`${label}: entries must be sorted`);
}

function parseReference(raw: unknown, label: string, errors: string[]): ExactReference | null {
  const before = errors.length;
  const value = strictObject(raw, ["id", "version"], ["id", "version"], label, errors);
  if (!value) return null;
  if (typeof value.id !== "string" || !COMPONENT_ID_RE.test(value.id)) errors.push(`${label}.id: component id required`);
  if (value.version !== "0.0.1") errors.push(`${label}.version: exact 0.0.1 required`);
  return errors.length === before ? { id: value.id as string, version: "0.0.1" } : null;
}

const REPOSITORY_RE = /^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function parseSource(raw: unknown, errors: string[]): ReleaseSource | null {
  const before = errors.length;
  const value = strictObject(raw, ["commit", "repository"], ["commit", "repository"], "release.source", errors);
  if (!value) return null;
  if (typeof value.repository !== "string" || !REPOSITORY_RE.test(value.repository)) errors.push("release.source.repository: canonical GitHub repository required");
  if (typeof value.commit !== "string" || !GIT_COMMIT_RE.test(value.commit)) errors.push("release.source.commit: exact commit required");
  return errors.length === before ? { repository: value.repository as string, commit: value.commit as string } : null;
}

function releaseAssetBelongsTo(url: unknown, repository: string): url is string {
  return typeof url === "string" && url.startsWith(`${repository}/releases/download/v0.0.1/`) && !/[?#]/.test(url);
}

function parseIntegrity(raw: unknown, label: string, repository: string, errors: string[]): IntegrityReference | null {
  const before = errors.length;
  const value = strictObject(raw, ["sha256", "url"], ["sha256", "url"], label, errors);
  if (!value) return null;
  if (!releaseAssetBelongsTo(value.url, repository)) errors.push(`${label}.url: v0.0.1 asset in source repository required`);
  if (typeof value.sha256 !== "string" || !SHA256_RE.test(value.sha256)) errors.push(`${label}.sha256: exact SHA-256 required`);
  return errors.length === before ? { url: value.url as string, sha256: value.sha256 as string } : null;
}

function expectedManifest(kind: ReleaseKind): ReleaseArtifact["manifest"] {
  if (kind === "plugin") return "plugin.json";
  if (kind === "sidecar") return "sidecar.json";
  if (kind === "kit") return "kit.json";
  if (kind === "contract") return "contract.json";
  return "spec.json";
}

function parseArtifacts(raw: unknown, kind: ReleaseKind, repository: string, errors: string[]): ReleaseArtifact[] {
  const result: ReleaseArtifact[] = [];
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push("release.artifacts: non-empty array required");
    return result;
  }
  raw.forEach((item, index) => {
    const label = `release.artifacts[${index}]`;
    const before = errors.length;
    const value = strictObject(item, ["format", "manifest", "sha256", "size", "target", "url"], ["format", "manifest", "sha256", "size", "target", "url"], label, errors);
    if (!value) return;
    if (!releaseAssetBelongsTo(value.url, repository)) errors.push(`${label}.url: v0.0.1 asset in source repository required`);
    if (typeof value.sha256 !== "string" || !SHA256_RE.test(value.sha256)) errors.push(`${label}.sha256: exact SHA-256 required`);
    if (!Number.isSafeInteger(value.size) || (value.size as number) <= 0) errors.push(`${label}.size: positive safe integer required`);
    if (!(ARTIFACT_FORMATS as readonly unknown[]).includes(value.format)) errors.push(`${label}.format: tar.gz|tgz required`);
    if (value.manifest !== expectedManifest(kind)) errors.push(`${label}.manifest: ${expectedManifest(kind)} required`);
    if (kind === "sidecar") {
      if (!(RUST_SIDECAR_TARGETS as readonly unknown[]).includes(value.target)) errors.push(`${label}.target: native target required`);
    } else if (value.target !== "any") errors.push(`${label}.target: any required for ${kind}`);
    if (errors.length === before) result.push({
      url: value.url as string,
      sha256: value.sha256 as string,
      size: value.size as number,
      target: value.target as ReleaseArtifact["target"],
      format: value.format as ArtifactFormat,
      manifest: value.manifest as ReleaseArtifact["manifest"],
    });
  });
  sortedUnique(result.map((artifact) => artifact.target), "release.artifacts", errors);
  if (kind !== "sidecar" && result.length !== 1) errors.push(`release.artifacts: ${kind} requires one any artifact`);
  return result;
}

export function parseReleaseManifest(raw: unknown): PlatformParseResult<ReleaseDocument> {
  const errors: string[] = [];
  const value = strictObject(raw, ["artifacts", "contract", "kit", "plugin", "reports", "sidecar", "source", "spec"], ["artifacts", "reports", "source"], "release", errors);
  if (!value) return { ok: false, errors };
  const kinds = (["plugin", "sidecar", "kit", "contract", "spec"] as const).filter((kind) => value[kind] !== undefined);
  if (kinds.length !== 1) errors.push("release: exactly one plugin, sidecar, kit, contract, or spec identity required");
  const kind = kinds[0];
  const reference = kind ? parseReference(value[kind], `release.${kind}`, errors) : null;
  const source = parseSource(value.source, errors);
  if (!kind || !reference || !source) return { ok: false, errors };
  const artifacts = parseArtifacts(value.artifacts, kind, source.repository, errors);
  const reports: IntegrityReference[] = [];
  if (!Array.isArray(value.reports) || value.reports.length === 0) errors.push("release.reports: non-empty array required");
  else value.reports.forEach((item, index) => {
    const report = parseIntegrity(item, `release.reports[${index}]`, source.repository, errors);
    if (report) reports.push(report);
  });
  sortedUnique(reports.map((report) => report.url), "release.reports", errors);
  if (errors.length > 0) return { ok: false, errors };
  const fields = { source, artifacts, reports };
  if (kind === "plugin") return { ok: true, value: { ...fields, plugin: reference } };
  if (kind === "sidecar") return { ok: true, value: { ...fields, sidecar: reference } };
  if (kind === "kit") return { ok: true, value: { ...fields, kit: reference } };
  if (kind === "contract") return { ok: true, value: { ...fields, contract: reference } };
  return { ok: true, value: { ...fields, spec: reference } };
}
