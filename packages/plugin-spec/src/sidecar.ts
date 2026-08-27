import { SIDECAR_CONTRACT_ID_RE, parseContractProviderRef, type ContractProviderRef } from "./contracts.js";
import { COMPONENT_ID_RE, STRICT_SEMVER_RE } from "./release-primitives.js";
import { checkKnownKeys, isRecord } from "./util.js";

export interface SidecarManifest {
  id: string;
  version: string;
  /** Every contract this sidecar serves; the first entry is its primary role. */
  interface: ContractProviderRef[];
  process: string;
}

export function parseSidecarManifest(raw: unknown): { ok: true; value: SidecarManifest } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ["sidecar manifest must be an object"] };
  checkKnownKeys(raw, ["id", "interface", "process", "version"], "sidecar", errors);
  for (const key of ["id", "interface", "process", "version"]) {
    if (!(key in raw)) errors.push(`sidecar.${key}: required`);
  }
  if (typeof raw.id !== "string" || !COMPONENT_ID_RE.test(raw.id)) errors.push("sidecar.id: sidecar id required");
  if (typeof raw.version !== "string" || !STRICT_SEMVER_RE.test(raw.version)) errors.push("sidecar.version: strict SemVer required");
  if (typeof raw.process !== "string" || (raw.process !== `dist/${raw.id}` && raw.process !== `dist/${raw.id}.exe`)) errors.push("sidecar.process: platform executable path required");
  const interfaces: ContractProviderRef[] = [];
  if (!Array.isArray(raw.interface) || raw.interface.length === 0) {
    errors.push("sidecar.interface: non-empty provider array required");
  } else {
    const seen = new Set<string>();
    raw.interface.forEach((entry, index) => {
      const ref = parseContractProviderRef(entry, `sidecar.interface[${index}]`, errors, SIDECAR_CONTRACT_ID_RE);
      if (!ref) return;
      if (seen.has(ref.id)) {
        errors.push(`sidecar.interface[${index}]: duplicate provider ${ref.id}`);
        return;
      }
      seen.add(ref.id);
      interfaces.push(ref);
    });
  }
  if (errors.length > 0 || interfaces.length === 0 || typeof raw.id !== "string") return { ok: false, errors };
  return { ok: true, value: { id: raw.id, version: raw.version as string, interface: interfaces, process: raw.process as string } };
}
