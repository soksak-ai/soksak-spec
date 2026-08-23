import { COMPONENT_ID_RE, isStrictSemver } from "./release-primitives.js";
import { checkKnownKeys, isRecord } from "./util.js";

type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };
type Source = "registry" | "development";
export interface Component {
  version: string; path: string; source: Source; registry?: string; target?: string;
}
type Plugin = Component & { enabled: boolean; sidecars?: Record<string, string> };
export interface EnvironmentDocument {
  revision: number;
  plugins: Record<string, Plugin>;
  sidecars: Record<string, Component>;
  kits: Record<string, Component>;
  contracts: Record<string, Component>;
  specs: Record<string, Component>;
}

const TOP_LEVEL = ["contracts", "kits", "plugins", "revision", "sidecars", "specs"];
const PROVIDER_RE = /^[a-z0-9][a-z0-9-]*$/;
const REGISTRY_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const absolutePath = (value: unknown): value is string => typeof value === "string" && (/^\/(?!\/)/.test(value) || /^[A-Za-z]:\\/.test(value));

function strict(raw: unknown, allowed: readonly string[], required: readonly string[], label: string, errors: string[]): Record<string, unknown> | null {
  if (!isRecord(raw)) { errors.push(label + ": object required"); return null; }
  checkKnownKeys(raw, allowed, label, errors);
  for (const key of required) if (!(key in raw)) errors.push(label + "." + key + ": required");
  return raw;
}

function components(raw: unknown, label: string, plugin: boolean, sidecar: boolean, errors: string[]): Record<string, Component | Plugin> {
  if (!isRecord(raw)) { errors.push(label + ": object required"); return {}; }
  const result: Record<string, Component | Plugin> = {};
  for (const [id, item] of Object.entries(raw)) {
    const itemLabel = label + "." + id;
    if (!COMPONENT_ID_RE.test(id)) { errors.push(itemLabel + ": component id required"); continue; }
    const base = ["path", "registry", "source", "target", "version"];
    const allowed = plugin ? [...base, "enabled", "sidecars"] : base;
    const required = plugin ? ["enabled", "path", "source", "version"] : ["path", "source", "version"];
    const value = strict(item, allowed, required, itemLabel, errors);
    if (!value) continue;
    if (!isStrictSemver(value.version)) errors.push(itemLabel + ".version: exact version required");
    if (!absolutePath(value.path)) errors.push(itemLabel + ".path: absolute path required");
    if (value.source !== "registry" && value.source !== "development") errors.push(itemLabel + ".source: registry or development required");
    if (value.source === "registry" && (typeof value.registry !== "string" || !REGISTRY_RE.test(value.registry))) errors.push(itemLabel + ".registry: registry id required");
    if (value.source === "development" && value.registry !== undefined) errors.push(itemLabel + ".registry: forbidden for development source");
    if (sidecar && (typeof value.target !== "string" || value.target.length === 0)) errors.push(itemLabel + ".target: target required");
    if (!sidecar && value.target !== undefined) errors.push(itemLabel + ".target: sidecars only");
    const component = { version: value.version, path: value.path, source: value.source, ...(value.registry === undefined ? {} : { registry: value.registry }), ...(value.target === undefined ? {} : { target: value.target }) } as Component;
    if (!plugin) { result[id] = component; continue; }
    if (typeof value.enabled !== "boolean") errors.push(itemLabel + ".enabled: boolean required");
    let sidecars: Record<string, string> | undefined;
    if (value.sidecars !== undefined) {
      if (!isRecord(value.sidecars)) errors.push(itemLabel + ".sidecars: object required");
      else {
        sidecars = {};
        for (const [role, sidecar] of Object.entries(value.sidecars)) {
          if (!PROVIDER_RE.test(role) || typeof sidecar !== "string" || !COMPONENT_ID_RE.test(sidecar)) errors.push(itemLabel + ".sidecars." + role + ": sidecar id required");
          else sidecars[role] = sidecar;
        }
      }
    }
    result[id] = { ...component, enabled: value.enabled as boolean, ...(sidecars ? { sidecars } : {}) };
  }
  return result;
}

export function parseEnvironmentDocument(raw: unknown): Result<EnvironmentDocument> {
  const errors: string[] = [];
  const value = strict(raw, TOP_LEVEL, TOP_LEVEL, "environment", errors);
  if (!value) return { ok: false, errors };
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1) errors.push("environment.revision: positive safe integer required");
  const result = {
    revision: value.revision as number,
    plugins: components(value.plugins, "environment.plugins", true, false, errors) as Record<string, Plugin>,
    sidecars: components(value.sidecars, "environment.sidecars", false, true, errors) as Record<string, Component>,
    kits: components(value.kits, "environment.kits", false, false, errors) as Record<string, Component>,
    contracts: components(value.contracts, "environment.contracts", false, false, errors) as Record<string, Component>,
    specs: components(value.specs, "environment.specs", false, false, errors) as Record<string, Component>,
  };
  return errors.length ? { ok: false, errors } : { ok: true, value: result };
}
