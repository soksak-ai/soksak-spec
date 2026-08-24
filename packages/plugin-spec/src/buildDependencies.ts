import { SEMVER_RE } from "./semver.js";
import { checkDuplicates, checkKnownKeys, isRecord } from "./util.js";

const ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TARGET = /^(?:aarch64|x86_64)-(?:apple-darwin|pc-windows-msvc|unknown-linux-(?:gnu|musl))$/;
const SAFE_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

export interface BuildDependency {
  id: string;
  repository: string;
  commit: string;
  tools: Readonly<Record<string, string>>;
  targets: Readonly<Record<string, { outputs: readonly BuildOutput[] }>>;
}

export interface BuildOutput {
  path: string;
  type: "file" | "tree";
}

export interface BuildDependencies {
  schema: "soksak-build-dependencies-v1";
  dependencies: readonly BuildDependency[];
}

export interface BuildDependencyReceipt {
  schema: "soksak-build-dependency-receipt-v1";
  dependency: string;
  target: string;
  repository: string;
  commit: string;
  tools: Readonly<Record<string, string>>;
  outputs: readonly BuildReceiptOutput[];
}

export type BuildReceiptOutput =
  | { path: string; type: "file"; size: number; sha256: string }
  | { path: string; type: "tree"; files: number; size: number; sha256: string };

export type BuildOutputInspection =
  | { type: "file"; size: number; sha256: string }
  | { type: "tree"; files: number; size: number; sha256: string };

function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const errors: string[] = [];
  checkKnownKeys(value, allowed, label, errors);
  if (errors.length > 0) throw new Error(`${label} contains an unknown key`);
}

function assertUnique(values: string[], label: string): void {
  const errors: string[] = [];
  checkDuplicates(values, label, errors);
  if (errors.length > 0) throw new Error(`${label} must be unique`);
}

function safePath(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_PATH.test(value) || value.startsWith("/") ||
      value.split("/").some((part) => part === "." || part === "..")) {
    throw new Error(`${label} must be a safe relative path`);
  }
  return value;
}

function repositoryURL(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a canonical HTTPS Git URL`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a canonical HTTPS Git URL`);
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash ||
      parsed.href !== value || segments.length < 2 || !parsed.pathname.endsWith(".git") ||
      segments.some((part) => part === "." || part === "..")) {
    throw new Error(`${label} must be a canonical HTTPS Git URL`);
  }
  return value;
}

function parseTools(value: unknown, label: string): Readonly<Record<string, string>> {
  if (!isRecord(value) || Object.keys(value).length === 0) throw new Error(`${label} must declare tools`);
  const result: Record<string, string> = {};
  for (const name of Object.keys(value).sort()) {
    if (!ID.test(name) || !SEMVER_RE.test(String(value[name] ?? ""))) {
      throw new Error(`${label} contains an invalid exact tool version`);
    }
    result[name] = String(value[name]);
  }
  return Object.freeze(result);
}

function parseTargets(value: unknown): Readonly<Record<string, { outputs: readonly BuildOutput[] }>> {
  if (!isRecord(value) || Object.keys(value).length === 0) throw new Error("build dependency must declare targets");
  const result: Record<string, { outputs: readonly BuildOutput[] }> = {};
  for (const target of Object.keys(value).sort()) {
    const raw = value[target];
    if (!TARGET.test(target) || !isRecord(raw)) throw new Error(`unsupported build dependency target: ${target}`);
    assertKnownKeys(raw, ["outputs"], `build dependency target ${target}`);
    if (!Array.isArray(raw.outputs) || raw.outputs.length === 0) {
      throw new Error(`build dependency target ${target} must declare outputs`);
    }
    const outputs = raw.outputs.map((output) => {
      if (!isRecord(output)) throw new Error(`build dependency target ${target} output must be an object`);
      assertKnownKeys(output, ["path", "type"], `build dependency target ${target} output`);
      const outputPath = safePath(output.path, `build dependency target ${target} output path`);
      if (output.type !== "file" && output.type !== "tree") {
        throw new Error(`build dependency target ${target} output type is invalid`);
      }
      return Object.freeze({ path: outputPath, type: output.type });
    });
    if (outputs.some((output) => !output.path.startsWith(`targets/${target}/`))) {
      throw new Error(`build dependency target ${target} requires a target-namespaced output`);
    }
    const paths = outputs.map((output) => output.path);
    assertUnique(paths, `build dependency target ${target} outputs`);
    if ([...paths].sort().join("\n") !== paths.join("\n")) {
      throw new Error(`build dependency target ${target} outputs must be sorted`);
    }
    result[target] = Object.freeze({ outputs: Object.freeze(outputs) });
  }
  return Object.freeze(result);
}

function parseDependency(value: unknown): BuildDependency {
  if (!isRecord(value)) throw new Error("build dependency must be an object");
  assertKnownKeys(value, ["id", "repository", "commit", "tools", "targets"], "build dependency");
  if (!ID.test(String(value.id ?? ""))) throw new Error("build dependency id is invalid");
  const repository = repositoryURL(value.repository, "build dependency repository");
  if (!COMMIT.test(String(value.commit ?? ""))) throw new Error("build dependency requires an exact commit");
  return Object.freeze({
    id: String(value.id),
    repository,
    commit: String(value.commit),
    tools: parseTools(value.tools, "build dependency tools"),
    targets: parseTargets(value.targets),
  });
}

export function parseBuildDependencies(value: unknown): BuildDependencies {
  if (!isRecord(value)) throw new Error("build dependencies document must be an object");
  assertKnownKeys(value, ["schema", "dependencies"], "build dependencies document");
  if (value.schema !== "soksak-build-dependencies-v1" || !Array.isArray(value.dependencies) || value.dependencies.length === 0) {
    throw new Error("build dependencies document is invalid");
  }
  const dependencies = value.dependencies.map(parseDependency);
  const ids = dependencies.map((dependency) => dependency.id);
  assertUnique(ids, "build dependency ids");
  if ([...ids].sort().join("\n") !== ids.join("\n")) throw new Error("build dependency ids must be sorted");
  return Object.freeze({ schema: "soksak-build-dependencies-v1", dependencies: Object.freeze(dependencies) });
}

export function resolveBuildDependency(dependencies: BuildDependencies, id: string, target: string) {
  const dependency = dependencies.dependencies.find((candidate) => candidate.id === id);
  if (!dependency) throw new Error(`build dependency is not declared: ${id}`);
  const targetEntry = dependency.targets[target];
  if (!targetEntry) throw new Error(`build dependency target is not declared: ${id}/${target}`);
  return Object.freeze({
    id: dependency.id,
    repository: dependency.repository,
    commit: dependency.commit,
    tools: dependency.tools,
    outputs: targetEntry.outputs,
  });
}

export function parseBuildDependencyReceipt(value: unknown): BuildDependencyReceipt {
  if (!isRecord(value)) throw new Error("build dependency receipt must be an object");
  assertKnownKeys(value, ["schema", "dependency", "target", "repository", "commit", "tools", "outputs"], "build dependency receipt");
  if (value.schema !== "soksak-build-dependency-receipt-v1" || !ID.test(String(value.dependency ?? "")) ||
      !TARGET.test(String(value.target ?? ""))) {
    throw new Error("build dependency receipt identity is invalid");
  }
  const target = String(value.target);
  const repository = repositoryURL(value.repository, "build dependency receipt repository");
  if (!COMMIT.test(String(value.commit ?? ""))) throw new Error("build dependency receipt requires an exact commit");
  const tools = parseTools(value.tools, "build dependency receipt tools");
  if (!Array.isArray(value.outputs) || value.outputs.length === 0) {
    throw new Error("build dependency receipt must declare outputs");
  }
  const outputs: BuildReceiptOutput[] = value.outputs.map((raw) => {
    if (!isRecord(raw)) throw new Error("build dependency receipt output must be an object");
    if (raw.type === "file") {
      assertKnownKeys(raw, ["path", "type", "size", "sha256"], "build dependency receipt file output");
    } else if (raw.type === "tree") {
      assertKnownKeys(raw, ["path", "type", "files", "size", "sha256"], "build dependency receipt tree output");
    } else {
      throw new Error("build dependency receipt output type is invalid");
    }
    const outputPath = safePath(raw.path, "build dependency receipt output path");
    if (!outputPath.startsWith(`targets/${target}/`) || typeof raw.size !== "number" ||
        !Number.isSafeInteger(raw.size) || raw.size < 1 || !SHA256.test(String(raw.sha256 ?? ""))) {
      throw new Error("build dependency receipt output is invalid");
    }
    if (raw.type === "tree") {
      if (typeof raw.files !== "number" || !Number.isSafeInteger(raw.files) || raw.files < 1) {
        throw new Error("build dependency receipt tree output file count is invalid");
      }
      return Object.freeze({ path: outputPath, type: "tree" as const, files: raw.files, size: raw.size, sha256: String(raw.sha256) });
    }
    return Object.freeze({ path: outputPath, type: "file" as const, size: raw.size, sha256: String(raw.sha256) });
  });
  const paths = outputs.map((output) => output.path);
  assertUnique(paths, "build dependency receipt outputs");
  if ([...paths].sort().join("\n") !== paths.join("\n")) throw new Error("build dependency receipt outputs must be sorted");
  return Object.freeze({
    schema: "soksak-build-dependency-receipt-v1",
    dependency: String(value.dependency),
    target,
    repository,
    commit: String(value.commit),
    tools,
    outputs: Object.freeze(outputs),
  });
}

export function verifyBuildDependencyReceipt(input: {
  dependencies: BuildDependencies;
  receipt: unknown;
  inspectOutput: (relative: string) => BuildOutputInspection | null;
}): BuildDependencyReceipt {
  const receipt = parseBuildDependencyReceipt(input.receipt);
  const dependency = input.dependencies.dependencies.find((candidate) => candidate.id === receipt.dependency);
  if (!dependency) throw new Error("build dependency receipt dependency is not declared");
  const expectedOutputs = dependency.targets[receipt.target]?.outputs;
  if (!expectedOutputs) throw new Error("build dependency receipt target is not declared");
  if (receipt.repository !== dependency.repository || receipt.commit !== dependency.commit) {
    throw new Error("build dependency receipt source differs from declaration");
  }
  if (JSON.stringify(receipt.tools) !== JSON.stringify(dependency.tools)) {
    throw new Error("build dependency receipt tools differ from declaration");
  }
  if (JSON.stringify(receipt.outputs.map(({ path, type }) => ({ path, type }))) !== JSON.stringify(expectedOutputs)) {
    throw new Error("build dependency receipt output set differs from declaration");
  }
  for (const output of receipt.outputs) {
    const actual = input.inspectOutput(output.path);
    if (!actual || actual.type !== output.type || actual.size !== output.size || actual.sha256 !== output.sha256 ||
        (output.type === "tree" && (actual.type !== "tree" || actual.files !== output.files))) {
      throw new Error(`build dependency output bytes differ from receipt: ${output.path}`);
    }
  }
  return receipt;
}
