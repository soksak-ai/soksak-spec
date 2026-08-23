import { COMPONENT_ID_RE, SHA256_RE, STRICT_SEMVER_RE } from "./release-primitives.js";
import { checkKnownKeys, isRecord } from "./util.js";

export interface ReleaseReference {
  id: string;
  version: string;
  url: string;
  size: number;
  sha256: string;
}

export interface RuntimeDependencies {
  plugins?: ReleaseReference[];
  sidecars?: ReleaseReference[];
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const RELEASE_URL_RE = new RegExp(
  "^https://github[.]com/([A-Za-z0-9-]+)/([A-Za-z0-9._-]+)/releases/download/v([^/]+)/release[.]json$",
);

export function parseReleaseReference(raw: unknown, label = "release"): ParseResult<ReleaseReference> {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: [`${label}: object required`] };
  checkKnownKeys(raw, ["id", "sha256", "size", "url", "version"], label, errors);
  for (const key of ["id", "sha256", "size", "url", "version"]) {
    if (!(key in raw)) errors.push(`${label}.${key}: required`);
  }
  if (typeof raw.id !== "string" || !COMPONENT_ID_RE.test(raw.id)) errors.push(`${label}.id: component id required`);
  if (typeof raw.version !== "string" || !STRICT_SEMVER_RE.test(raw.version)) errors.push(`${label}.version: exact strict SemVer required`);
  const match = typeof raw.url === "string" ? RELEASE_URL_RE.exec(raw.url) : null;
  if (!match || match[2] !== raw.id || match[3] !== raw.version) errors.push(`${label}.url: exact owner v${String(raw.version)} release.json required`);
  if (!Number.isSafeInteger(raw.size) || (raw.size as number) <= 0) errors.push(`${label}.size: positive safe integer required`);
  if (typeof raw.sha256 !== "string" || !SHA256_RE.test(raw.sha256)) errors.push(`${label}.sha256: exact SHA-256 required`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { id: raw.id as string, version: raw.version as string, url: raw.url as string, size: raw.size as number, sha256: raw.sha256 as string } };
}

function parseReferences(raw: unknown, label: string, errors: string[]): ReleaseReference[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) { errors.push(`${label}: non-empty array required`); return undefined; }
  const values: ReleaseReference[] = [];
  raw.forEach((item, index) => {
    const parsed = parseReleaseReference(item, `${label}[${index}]`);
    if (parsed.ok) values.push(parsed.value); else errors.push(...parsed.errors);
  });
  const keys = values.map((value) => `${value.id}@${value.version}`);
  if (new Set(keys).size !== keys.length) errors.push(`${label}: duplicate id and version forbidden`);
  const sorted = [...keys].sort();
  if (keys.some((key, index) => key !== sorted[index])) errors.push(`${label}: entries must be sorted by id and version`);
  return values;
}

export function parseRuntimeDependencies(raw: unknown, label = "runtimeDependencies"): ParseResult<RuntimeDependencies> {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: [`${label}: object required`] };
  checkKnownKeys(raw, ["plugins", "sidecars"], label, errors);
  const plugins = raw.plugins === undefined ? undefined : parseReferences(raw.plugins, `${label}.plugins`, errors);
  const sidecars = raw.sidecars === undefined ? undefined : parseReferences(raw.sidecars, `${label}.sidecars`, errors);
  if (plugins === undefined && sidecars === undefined) errors.push(`${label}: plugins or sidecars required`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { ...(plugins ? { plugins } : {}), ...(sidecars ? { sidecars } : {}) } };
}
