import { SIDECAR_CONTRACT_ID_RE, parseContractProviderRef, type ContractProviderRef } from "./contracts.js";
import { COMPONENT_ID_RE } from "./release-primitives.js";
import { checkKnownKeys, isRecord } from "./util.js";

export interface SidecarManifest {
  id: string;
  version: "0.0.1";
  interface: ContractProviderRef;
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
  if (raw.version !== "0.0.1") errors.push("sidecar.version: exact 0.0.1 required");
  if (typeof raw.process !== "string" || raw.process !== `dist/${raw.id}`) errors.push("sidecar.process: dist/<sidecar-id> required");
  const interfaceRef = parseContractProviderRef(raw.interface, "sidecar.interface", errors, SIDECAR_CONTRACT_ID_RE);
  if (errors.length > 0 || !interfaceRef || typeof raw.id !== "string") return { ok: false, errors };
  return { ok: true, value: { id: raw.id, version: "0.0.1", interface: interfaceRef, process: raw.process as string } };
}
