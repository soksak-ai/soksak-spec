import {
  type ContractProviderRef,
  contractProviderKey,
  parseContractProviderRef,
} from "./contracts.js";
import {
  type ExactReference,
  type PlatformParseResult,
  type ReleaseDocument,
  releaseIdentity,
} from "./release.js";
import {
  ANY_TARGET,
  CONFORMANCE_REPORT_SPEC,
  RELEASE_SPEC,
  RUST_SIDECAR_TARGETS,
  SHA256_RE,
  STRICT_SEMVER_RE,
  COMPONENT_ID_RE,
  MANIFEST_SPEC_BY_RELEASE_KIND,
  type ReleaseKind,
} from "./release-primitives.js";
import { checkKnownKeys, isRecord } from "./util.js";

export type ConformanceSubject =
  | { plugin: ExactReference }
  | { sidecar: ExactReference }
  | { kit: ExactReference };

export interface ConformanceArtifactSubject { target: "any" | (typeof RUST_SIDECAR_TARGETS)[number]; sha256: string }
export interface ConformanceValidator { name: string; version: string }
export type PlatformConformanceContract = typeof RELEASE_SPEC | (typeof MANIFEST_SPEC_BY_RELEASE_KIND)[ReleaseKind];

export interface ConformanceReport {
  spec: typeof CONFORMANCE_REPORT_SPEC;
  subject: ConformanceSubject;
  contract: PlatformConformanceContract | ContractProviderRef;
  result: "passed";
  validator: ConformanceValidator;
  artifacts: ConformanceArtifactSubject[];
}

function strictObject(raw: unknown, allowed: readonly string[], required: readonly string[], label: string, errors: string[]): Record<string, unknown> | null {
  if (!isRecord(raw)) { errors.push(`${label}: object required`); return null; }
  checkKnownKeys(raw, allowed, label, errors);
  for (const key of required) if (!(key in raw)) errors.push(`${label}.${key}: required`);
  return raw;
}

function isPlatformConformanceContract(value: unknown): value is PlatformConformanceContract {
  return typeof value === "string" && (value === RELEASE_SPEC || Object.values(MANIFEST_SPEC_BY_RELEASE_KIND).includes(value as never));
}

export function conformanceContractKey(contract: PlatformConformanceContract | ContractProviderRef): string {
  return typeof contract === "string" ? `schema\0${contract}` : `domain\0${contractProviderKey(contract)}`;
}

export function requiredConformanceContracts(kind: ReleaseKind): PlatformConformanceContract[] {
  return [RELEASE_SPEC, MANIFEST_SPEC_BY_RELEASE_KIND[kind]].sort();
}

function parseExactReference(raw: unknown, label: string, errors: string[]): ExactReference | null {
  const before = errors.length;
  const value = strictObject(raw, ["id", "version"], ["id", "version"], label, errors);
  if (!value) return null;
  if (typeof value.id !== "string" || !COMPONENT_ID_RE.test(value.id)) errors.push(`${label}.id: component id required`);
  if (value.version !== "0.0.1") errors.push(`${label}.version: exact 0.0.1 required`);
  return errors.length === before ? { id: value.id as string, version: "0.0.1" } : null;
}

function parseSubject(raw: unknown, errors: string[]): ConformanceSubject | null {
  const value = strictObject(raw, ["kit", "plugin", "sidecar"], [], "conformance.subject", errors);
  if (!value) return null;
  const kinds = (["plugin", "sidecar", "kit"] as const).filter((kind) => value[kind] !== undefined);
  if (kinds.length !== 1) { errors.push("conformance.subject: exactly one plugin, sidecar, or kit required"); return null; }
  const kind = kinds[0];
  const reference = parseExactReference(value[kind], `conformance.subject.${kind}`, errors);
  return reference ? { [kind]: reference } as ConformanceSubject : null;
}

function subjectIdentity(subject: ConformanceSubject): { kind: ReleaseKind; id: string; version: string } {
  if ("plugin" in subject) return { kind: "plugin", ...subject.plugin };
  if ("sidecar" in subject) return { kind: "sidecar", ...subject.sidecar };
  return { kind: "kit", ...subject.kit };
}

export function parseConformanceReport(raw: unknown): PlatformParseResult<ConformanceReport> {
  const errors: string[] = [];
  const value = strictObject(raw, ["artifacts", "contract", "result", "spec", "subject", "validator"], ["artifacts", "contract", "result", "spec", "subject", "validator"], "conformance", errors);
  if (!value) return { ok: false, errors };
  if (value.spec !== CONFORMANCE_REPORT_SPEC) errors.push(`conformance.spec: ${CONFORMANCE_REPORT_SPEC} required`);
  const contract = isPlatformConformanceContract(value.contract)
    ? value.contract
    : parseContractProviderRef(value.contract, "conformance.contract", errors);
  if (value.result !== "passed") errors.push("conformance.result: passed required");
  const subject = parseSubject(value.subject, errors);
  const validatorRaw = strictObject(value.validator, ["name", "version"], ["name", "version"], "conformance.validator", errors);
  let validator: ConformanceValidator | null = null;
  if (validatorRaw) {
    if (typeof validatorRaw.name !== "string" || !COMPONENT_ID_RE.test(validatorRaw.name)) errors.push("conformance.validator.name: tool id required");
    if (typeof validatorRaw.version !== "string" || !STRICT_SEMVER_RE.test(validatorRaw.version)) errors.push("conformance.validator.version: semantic version required");
    if (typeof validatorRaw.name === "string" && typeof validatorRaw.version === "string") validator = { name: validatorRaw.name, version: validatorRaw.version };
  }
  const artifacts: ConformanceArtifactSubject[] = [];
  if (!Array.isArray(value.artifacts) || value.artifacts.length === 0) errors.push("conformance.artifacts: non-empty array required");
  else value.artifacts.forEach((item, index) => {
    const label = `conformance.artifacts[${index}]`;
    const before = errors.length;
    const artifact = strictObject(item, ["sha256", "target"], ["sha256", "target"], label, errors);
    if (!artifact) return;
    if (artifact.target !== ANY_TARGET && !(RUST_SIDECAR_TARGETS as readonly unknown[]).includes(artifact.target)) errors.push(`${label}.target: artifact target required`);
    if (typeof artifact.sha256 !== "string" || !SHA256_RE.test(artifact.sha256)) errors.push(`${label}.sha256: exact SHA-256 required`);
    if (errors.length === before) artifacts.push({ target: artifact.target as ConformanceArtifactSubject["target"], sha256: artifact.sha256 as string });
  });
  const targets = artifacts.map((artifact) => artifact.target);
  if (new Set(targets).size !== targets.length) errors.push("conformance.artifacts: duplicate targets forbidden");
  if (targets.some((target, index) => target !== [...targets].sort()[index])) errors.push("conformance.artifacts: targets must be sorted");
  if (errors.length > 0 || !subject || !validator || !contract) return { ok: false, errors };
  return { ok: true, value: { spec: CONFORMANCE_REPORT_SPEC, subject, contract, result: "passed", validator, artifacts } };
}

export function verifyConformanceReport(
  report: ConformanceReport,
  release: ReleaseDocument,
  declaredContracts: readonly ContractProviderRef[] = [],
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const subject = subjectIdentity(report.subject);
  const identity = releaseIdentity(release);
  if (subject.kind !== identity.kind || subject.id !== identity.id || subject.version !== identity.version) errors.push("conformance subject identity mismatch");
  const expected = release.artifacts.map(({ target, sha256 }) => ({ target, sha256 }));
  if (JSON.stringify(report.artifacts) !== JSON.stringify(expected)) errors.push("conformance artifact coverage must equal the release matrix");
  if (typeof report.contract !== "string") {
    const wanted = contractProviderKey(report.contract);
    if (!declaredContracts.some((contract) => contractProviderKey(contract) === wanted)) errors.push("conformance domain contract is not declared by the plugin or sidecar manifest");
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
