import { COMPONENT_ID_RE, SHA256_RE, STRICT_SEMVER_RE } from "./release-primitives.js";
import type { ExactReference } from "./release.js";
import { checkKnownKeys, isRecord } from "./util.js";

// A dependency intent (plugin.json) names a release: { id, version }.
// A release reference (release.json, registry index) pins that release: { id, version, size, sha256 },
// where size and sha256 are of the referenced release.json. No reference names a location; the
// resolver derives the release directory from kind, id, and version.
export interface ReleaseReference extends ExactReference {
  size: number;
  sha256: string;
}

export interface DependencyGroups<T> {
  plugins?: T[];
  sidecars?: T[];
}
export type RuntimeDependencyIntents = DependencyGroups<ExactReference>;
export type RuntimeDependencies = DependencyGroups<ReleaseReference>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function parseIdentity(raw: Record<string, unknown>, label: string, errors: string[]): void {
  if (typeof raw.id !== "string" || !COMPONENT_ID_RE.test(raw.id)) errors.push(`${label}.id: component id required`);
  if (typeof raw.version !== "string" || !STRICT_SEMVER_RE.test(raw.version)) errors.push(`${label}.version: exact strict SemVer required`);
}

export function parseDependencyIntent(raw: unknown, label = "dependency"): ParseResult<ExactReference> {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: [`${label}: object required`] };
  checkKnownKeys(raw, ["id", "version"], label, errors);
  for (const key of ["id", "version"]) if (!(key in raw)) errors.push(`${label}.${key}: required`);
  parseIdentity(raw, label, errors);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { id: raw.id as string, version: raw.version as string } };
}

export function parseReleaseReference(raw: unknown, label = "release"): ParseResult<ReleaseReference> {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: [`${label}: object required`] };
  checkKnownKeys(raw, ["id", "sha256", "size", "version"], label, errors);
  for (const key of ["id", "sha256", "size", "version"]) if (!(key in raw)) errors.push(`${label}.${key}: required`);
  parseIdentity(raw, label, errors);
  if (!Number.isSafeInteger(raw.size) || (raw.size as number) <= 0) errors.push(`${label}.size: positive safe integer required`);
  if (typeof raw.sha256 !== "string" || !SHA256_RE.test(raw.sha256)) errors.push(`${label}.sha256: exact SHA-256 required`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { id: raw.id as string, version: raw.version as string, size: raw.size as number, sha256: raw.sha256 as string } };
}

type ItemParser<T> = (raw: unknown, label: string) => ParseResult<T>;

function parseGroup<T extends ExactReference>(raw: unknown, label: string, parseItem: ItemParser<T>, errors: string[]): T[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) { errors.push(`${label}: non-empty array required`); return undefined; }
  const values: T[] = [];
  raw.forEach((item, index) => {
    const parsed = parseItem(item, `${label}[${index}]`);
    if (parsed.ok) values.push(parsed.value); else errors.push(...parsed.errors);
  });
  const keys = values.map((value) => `${value.id}@${value.version}`);
  if (new Set(keys).size !== keys.length) errors.push(`${label}: duplicate id and version forbidden`);
  const sorted = [...keys].sort();
  if (keys.some((key, index) => key !== sorted[index])) errors.push(`${label}: entries must be sorted by id and version`);
  return values;
}

function parseGroups<T extends ExactReference>(raw: unknown, label: string, parseItem: ItemParser<T>): ParseResult<DependencyGroups<T>> {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: [`${label}: object required`] };
  checkKnownKeys(raw, ["plugins", "sidecars"], label, errors);
  const plugins = raw.plugins === undefined ? undefined : parseGroup(raw.plugins, `${label}.plugins`, parseItem, errors);
  const sidecars = raw.sidecars === undefined ? undefined : parseGroup(raw.sidecars, `${label}.sidecars`, parseItem, errors);
  if (plugins === undefined && sidecars === undefined) errors.push(`${label}: plugins or sidecars required`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { ...(plugins ? { plugins } : {}), ...(sidecars ? { sidecars } : {}) } };
}

export function parseRuntimeDependencyIntents(raw: unknown, label = "runtimeDependencies"): ParseResult<RuntimeDependencyIntents> {
  return parseGroups(raw, label, parseDependencyIntent);
}

export function parseRuntimeDependencies(raw: unknown, label = "runtimeDependencies"): ParseResult<RuntimeDependencies> {
  return parseGroups(raw, label, parseReleaseReference);
}
