import { COMPONENT_ID_RE, GIT_COMMIT_RE, SHA256_RE } from "./release-primitives.js";
import { checkKnownKeys, isRecord } from "./util.js";

type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };
type Preference = { development?: { path: string } };
type PluginPreference = Preference & { enabled: boolean; providers?: Record<string, string> };
export interface SettingsDocument {
  revision: number;
  plugins: Record<string, PluginPreference>;
  sidecars: Record<string, Preference>;
  kits: Record<string, Preference>;
  contracts: Record<string, Preference>;
  specs: Record<string, Preference>;
}
export interface InstalledComponent {
  version: string; path: string; registryId: string; repository: string; sourceCommit: string;
  manifestSha256: string; artifactSha256: string; target?: string;
}
export interface InstalledDocument {
  revision: number;
  plugins: Record<string, InstalledComponent>;
  sidecars: Record<string, InstalledComponent>;
  kits: Record<string, InstalledComponent>;
  contracts: Record<string, InstalledComponent>;
  specs: Record<string, InstalledComponent>;
}

const COLLECTIONS = ["plugins", "sidecars", "kits", "contracts", "specs"] as const;
const TOP_LEVEL = ["contracts", "kits", "plugins", "revision", "sidecars", "specs"];
const PROVIDER_RE = /^[a-z0-9][a-z0-9-]*$/;
const REGISTRY_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const REPOSITORY_RE = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const absolutePath = (value: unknown): value is string => typeof value === "string" && (/^\/(?!\/)/.test(value) || /^[A-Za-z]:\\/.test(value));

function strict(raw: unknown, allowed: readonly string[], required: readonly string[], label: string, errors: string[]): Record<string, unknown> | null {
  if (!isRecord(raw)) { errors.push(label + ": object required"); return null; }
  checkKnownKeys(raw, allowed, label, errors);
  for (const key of required) if (!(key in raw)) errors.push(label + "." + key + ": required");
  return raw;
}

function development(raw: unknown, label: string, errors: string[]): { path: string } | undefined {
  if (raw === undefined) return undefined;
  const value = strict(raw, ["path"], ["path"], label, errors);
  if (!value || !absolutePath(value.path)) { errors.push(label + ".path: absolute path required"); return undefined; }
  return { path: value.path };
}

function preferences(raw: unknown, label: string, plugin: boolean, errors: string[]): Record<string, Preference | PluginPreference> {
  if (!isRecord(raw)) { errors.push(label + ": object required"); return {}; }
  const result: Record<string, Preference | PluginPreference> = {};
  for (const [id, item] of Object.entries(raw)) {
    const itemLabel = label + "." + id;
    if (!COMPONENT_ID_RE.test(id)) { errors.push(itemLabel + ": component id required"); continue; }
    const allowed = plugin ? ["development", "enabled", "providers"] : ["development"];
    const value = strict(item, allowed, plugin ? ["enabled"] : [], itemLabel, errors);
    if (!value) continue;
    const source = development(value.development, itemLabel + ".development", errors);
    if (!plugin) { result[id] = source ? { development: source } : {}; continue; }
    if (typeof value.enabled !== "boolean") errors.push(itemLabel + ".enabled: boolean required");
    let providers: Record<string, string> | undefined;
    if (value.providers !== undefined) {
      if (!isRecord(value.providers)) errors.push(itemLabel + ".providers: object required");
      else {
        providers = {};
        for (const [name, provider] of Object.entries(value.providers)) {
          if (!PROVIDER_RE.test(name) || typeof provider !== "string" || !COMPONENT_ID_RE.test(provider)) errors.push(itemLabel + ".providers." + name + ": sidecar id required");
          else providers[name] = provider;
        }
      }
    }
    result[id] = { enabled: value.enabled as boolean, ...(source ? { development: source } : {}), ...(providers ? { providers } : {}) };
  }
  return result;
}

export function parseSettingsDocument(raw: unknown): Result<SettingsDocument> {
  const errors: string[] = [];
  const value = strict(raw, TOP_LEVEL, TOP_LEVEL, "settings", errors);
  if (!value) return { ok: false, errors };
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1) errors.push("settings.revision: positive safe integer required");
  const result = {
    revision: value.revision as number,
    plugins: preferences(value.plugins, "settings.plugins", true, errors) as Record<string, PluginPreference>,
    sidecars: preferences(value.sidecars, "settings.sidecars", false, errors),
    kits: preferences(value.kits, "settings.kits", false, errors),
    contracts: preferences(value.contracts, "settings.contracts", false, errors),
    specs: preferences(value.specs, "settings.specs", false, errors),
  };
  return errors.length ? { ok: false, errors } : { ok: true, value: result };
}

function installed(raw: unknown, label: string, sidecar: boolean, errors: string[]): Record<string, InstalledComponent> {
  if (!isRecord(raw)) { errors.push(label + ": object required"); return {}; }
  const result: Record<string, InstalledComponent> = {};
  for (const [id, item] of Object.entries(raw)) {
    const itemLabel = label + "." + id;
    const keys = ["artifactSha256", "manifestSha256", "path", "registryId", "repository", "sourceCommit", ...(sidecar ? ["target"] : []), "version"];
    const value = strict(item, keys, keys, itemLabel, errors);
    if (!COMPONENT_ID_RE.test(id) || !value) { errors.push(itemLabel + ": component record required"); continue; }
    if (value.version !== "0.0.1") errors.push(itemLabel + ".version: exact 0.0.1 required");
    if (!absolutePath(value.path)) errors.push(itemLabel + ".path: absolute path required");
    if (typeof value.registryId !== "string" || !REGISTRY_RE.test(value.registryId)) errors.push(itemLabel + ".registryId: registry id required");
    if (typeof value.repository !== "string" || !REPOSITORY_RE.test(value.repository)) errors.push(itemLabel + ".repository: repository required");
    if (typeof value.sourceCommit !== "string" || !GIT_COMMIT_RE.test(value.sourceCommit)) errors.push(itemLabel + ".sourceCommit: exact commit required");
    if (typeof value.manifestSha256 !== "string" || !SHA256_RE.test(value.manifestSha256)) errors.push(itemLabel + ".manifestSha256: SHA-256 required");
    if (typeof value.artifactSha256 !== "string" || !SHA256_RE.test(value.artifactSha256)) errors.push(itemLabel + ".artifactSha256: SHA-256 required");
    if (sidecar && (typeof value.target !== "string" || value.target.length === 0)) errors.push(itemLabel + ".target: target required");
    result[id] = value as unknown as InstalledComponent;
  }
  return result;
}

export function parseInstalledDocument(raw: unknown): Result<InstalledDocument> {
  const errors: string[] = [];
  const value = strict(raw, TOP_LEVEL, TOP_LEVEL, "installed", errors);
  if (!value) return { ok: false, errors };
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1) errors.push("installed.revision: positive safe integer required");
  const result = { revision: value.revision as number } as InstalledDocument;
  for (const name of COLLECTIONS) result[name] = installed(value[name], "installed." + name, name === "sidecars", errors);
  return errors.length ? { ok: false, errors } : { ok: true, value: result };
}
