import type { ReleaseReference } from "./distribution.js";
import {
  type IntegrityReference,
  type ReleaseDocument,
  type ReleaseIdentity,
  type ReleaseSource,
  releaseIdentity,
} from "./release.js";
import {
  ANY_TARGET,
  COMPONENT_ID_RE,
  GIT_COMMIT_RE,
  RELEASE_FILE_RE,
  RUST_SIDECAR_TARGETS,
  SHA256_RE,
  STRICT_SEMVER_RE,
  type ReleaseKind,
} from "./release-primitives.js";
import { checkKnownKeys, isRecord } from "./util.js";

export interface ComponentBuildInput extends ReleaseReference { kind: "spec" | "kit" }
export interface ComponentBuildExecution {
  mode: "native" | "container" | "cross";
  platform: "darwin" | "linux" | "win32";
  architecture: "arm64" | "x64";
}
export interface ComponentBuildArtifact { target: "any" | (typeof RUST_SIDECAR_TARGETS)[number]; sha256: string }
export interface ComponentBuildReceipt {
  schema: "soksak-component-build-receipt-v1";
  subject: ReleaseIdentity;
  source: ReleaseSource;
  manifest: IntegrityReference;
  spec: ComponentBuildInput & { kind: "spec" };
  tooling: ComponentBuildInput & { kind: "kit" };
  command: "make verify";
  execution: ComponentBuildExecution;
  tools: Readonly<Record<string, string>>;
  artifacts: readonly ComponentBuildArtifact[];
}

function strict(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const errors: string[] = [];
  checkKnownKeys(value, keys, label, errors);
  if (errors.length > 0) throw new Error(`${label} contains an unknown key`);
  for (const key of keys) if (!(key in value)) throw new Error(`${label}.${key} is required`);
  return value;
}

function identity(value: unknown): ReleaseIdentity {
  const raw = strict(value, ["kind", "id", "version"], "component build subject");
  const kinds: readonly ReleaseKind[] = ["plugin", "sidecar", "kit", "contract", "spec"];
  if (!kinds.includes(raw.kind as ReleaseKind) || typeof raw.id !== "string" || !COMPONENT_ID_RE.test(raw.id) ||
      typeof raw.version !== "string" || !STRICT_SEMVER_RE.test(raw.version)) {
    throw new Error("component build subject identity is invalid");
  }
  return { kind: raw.kind as ReleaseKind, id: raw.id, version: raw.version };
}

function source(value: unknown, subject: ReleaseIdentity): ReleaseSource {
  const raw = strict(value, ["repository", "commit"], "component build source");
  const repository = `https://github.com/soksak-ai/${subject.id}`;
  if (raw.repository !== repository || typeof raw.commit !== "string" || !GIT_COMMIT_RE.test(raw.commit)) {
    throw new Error("component build source is invalid");
  }
  return { repository, commit: raw.commit };
}

function integrity(value: unknown, label: string, file?: string): IntegrityReference {
  const raw = strict(value, ["file", "size", "sha256"], label);
  if (typeof raw.file !== "string" || !RELEASE_FILE_RE.test(raw.file) || (file !== undefined && raw.file !== file) ||
      !Number.isSafeInteger(raw.size) || (raw.size as number) < 1 ||
      typeof raw.sha256 !== "string" || !SHA256_RE.test(raw.sha256)) {
    throw new Error(`${label} is invalid`);
  }
  return { file: raw.file, size: raw.size as number, sha256: raw.sha256 };
}

function input(value: unknown, kind: "spec" | "kit", id: string, label: string): ComponentBuildInput {
  const raw = strict(value, ["kind", "id", "version", "size", "sha256"], label);
  if (raw.kind !== kind || raw.id !== id || typeof raw.version !== "string" || !STRICT_SEMVER_RE.test(raw.version) ||
      !Number.isSafeInteger(raw.size) || (raw.size as number) < 1 ||
      typeof raw.sha256 !== "string" || !SHA256_RE.test(raw.sha256)) {
    throw new Error(`${label} release reference is invalid`);
  }
  return { kind, id, version: raw.version, size: raw.size as number, sha256: raw.sha256 };
}

function execution(value: unknown): ComponentBuildExecution {
  const raw = strict(value, ["mode", "platform", "architecture"], "component build execution");
  if (!["native", "container", "cross"].includes(String(raw.mode)) ||
      !["darwin", "linux", "win32"].includes(String(raw.platform)) ||
      !["arm64", "x64"].includes(String(raw.architecture))) {
    throw new Error("component build execution is invalid");
  }
  return raw as unknown as ComponentBuildExecution;
}

function tools(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value) || Object.keys(value).length === 0) throw new Error("component build tools must declare exact tool versions");
  const parsed: Record<string, string> = {};
  for (const name of Object.keys(value).sort()) {
    const version = value[name];
    if (!COMPONENT_ID_RE.test(name) || typeof version !== "string" || !STRICT_SEMVER_RE.test(version)) {
      throw new Error("component build tool version is invalid");
    }
    parsed[name] = version;
  }
  return Object.freeze(parsed);
}

function artifacts(value: unknown): readonly ComponentBuildArtifact[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("component build artifacts are required");
  const parsed = value.map((item) => {
    const raw = strict(item, ["target", "sha256"], "component build artifact");
    if (raw.target !== ANY_TARGET && !(RUST_SIDECAR_TARGETS as readonly unknown[]).includes(raw.target)) {
      throw new Error("component build artifact target is invalid");
    }
    if (typeof raw.sha256 !== "string" || !SHA256_RE.test(raw.sha256)) throw new Error("component build artifact digest is invalid");
    return { target: raw.target as ComponentBuildArtifact["target"], sha256: raw.sha256 };
  });
  const targets = parsed.map(({ target }) => target);
  if (new Set(targets).size !== targets.length || targets.some((target, index) => target !== [...targets].sort()[index])) {
    throw new Error("component build artifacts must have sorted unique targets");
  }
  return Object.freeze(parsed);
}

export function parseComponentBuildReceipt(value: unknown): ComponentBuildReceipt {
  const raw = strict(value, [
    "schema", "subject", "source", "manifest", "spec", "tooling", "command", "execution", "tools", "artifacts",
  ], "component build receipt");
  if (raw.schema !== "soksak-component-build-receipt-v1") throw new Error("component build receipt schema is invalid");
  const subject = identity(raw.subject);
  if (raw.command !== "make verify") throw new Error("component build command must be make verify");
  return Object.freeze({
    schema: "soksak-component-build-receipt-v1",
    subject,
    source: source(raw.source, subject),
    manifest: integrity(raw.manifest, "component build manifest", `${subject.kind}.json`),
    spec: input(raw.spec, "spec", "soksak-spec", "component build spec") as ComponentBuildReceipt["spec"],
    tooling: input(raw.tooling, "kit", "soksak-sdk", "component build tooling") as ComponentBuildReceipt["tooling"],
    command: "make verify",
    execution: execution(raw.execution),
    tools: tools(raw.tools),
    artifacts: artifacts(raw.artifacts),
  });
}

export function verifyComponentBuildReceipt(input: { receipt: unknown; release: ReleaseDocument }): ComponentBuildReceipt {
  const receipt = parseComponentBuildReceipt(input.receipt);
  if (JSON.stringify(receipt.subject) !== JSON.stringify(releaseIdentity(input.release))) {
    throw new Error("component build receipt subject differs from release");
  }
  if (JSON.stringify(receipt.source) !== JSON.stringify(input.release.source)) {
    throw new Error("component build receipt source differs from release");
  }
  if (JSON.stringify(receipt.manifest) !== JSON.stringify(input.release.manifest)) {
    throw new Error("component build receipt manifest differs from release");
  }
  const artifacts = input.release.artifacts.map(({ target, sha256 }) => ({ target, sha256 }));
  if (JSON.stringify(receipt.artifacts) !== JSON.stringify(artifacts)) {
    throw new Error("component build receipt artifact matrix differs from release");
  }
  return receipt;
}
