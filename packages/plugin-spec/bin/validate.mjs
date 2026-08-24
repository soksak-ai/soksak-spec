#!/usr/bin/env node
// Public, headless validation boundary. Every mode calls the same parser/verifier that
// consumers import from dist/spec.js; the CLI does not maintain a second wire grammar.

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
  C2_STATIC_ENFORCEMENT,
  certifyRegistry,
  parseBuildDependencies,
  parseBuildDependencyReceipt,
  parseConformanceReport,
  parseManifest,
  parseRegistry,
  parseRegistryPublicKey,
  parseReleaseReference,
  parseReleaseManifest,
  parseSidecarManifest,
  releaseIdentity,
  transparencyViolations,
  resolveBuildDependency,
  verifyBuildDependencyReceipt,
  verifyConformanceReport,
} from "../dist/spec.js";
import { authenticateRegistry, buildRegistry, verifyReleaseClosure } from "../dist/registryPublication.js";
import { GitHubApi, publishImmutableRelease } from "../release-template/publish-release.mjs";

const USAGE = `사용:
  soksak-validate plugin <플러그인 폴더 | plugin.json>...
  soksak-validate build-dependencies <build-dependencies.json> [--dependency <id> --target <triple>]
  soksak-validate build-receipt-create <build-dependencies.json> --dependency <id> --target <triple> --output-root <directory> --out <receipt.json>
  soksak-validate build-receipt <receipt.json> --dependencies <build-dependencies.json> --output-root <directory>
  soksak-validate release <release.json>...
  soksak-validate conformance <report.json>... --release <release.json> [--plugin-manifest <plugin.json> | --sidecar-manifest <sidecar.json>]
  soksak-validate registry <registry.json> --public-key <key.json> --registry-id <id> --key-id <id> [--at <ISO-8601>] [--high-water <sequence>:<sha256>]
  soksak-validate registry-verify <plugins-directory>
  soksak-validate registry-build <plugins-directory> --id <id> --sequence <n> --issued-at <RFC3339> --expires-at <RFC3339> --out <registry.json>
  SOKSAK_REGISTRY_ED25519_SEED=<base64> soksak-validate registry-authenticate <unsigned-registry.json> --out <registry.json>
  SOKSAK_RELEASE_TOKEN=<token> soksak-validate registry-publish <registry.json> --repository <owner/name> --commit <sha>

종료코드: 0 = 통과, 1 = 문서/무결성 위반, 2 = 사용법 오류.`;

const MODES = new Set(["plugin", "build-dependencies", "build-receipt-create", "build-receipt", "release", "conformance", "registry", "registry-verify", "registry-build", "registry-authenticate", "registry-publish"]);

function usageExit(message) {
  if (message) console.error(message);
  console.error(USAGE);
  return 2;
}

function readDocument(path, label = path) {
  try {
    const bytes = readFileSync(path);
    return { bytes, raw: JSON.parse(bytes.toString("utf8")) };
  } catch (error) {
    console.error(`✗ ${label}: UTF-8 JSON 읽기 실패 — ${error.message}`);
    return null;
  }
}

function printErrors(path, errors) {
  console.error(`✗ ${path}`);
  for (const error of errors) console.error(`  - ${error}`);
}

function parseOptions(args, known) {
  const positional = [];
  const options = new Map();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (!known.has(arg) || options.has(arg)) {
      return { ok: false, error: `알 수 없거나 중복된 옵션: ${arg}` };
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      return { ok: false, error: `${arg}: 값이 필요합니다` };
    }
    options.set(arg, value);
    index++;
  }
  return { ok: true, positional, options };
}

function resolvePluginPaths(paths) {
  return paths.map((path) => {
    try {
      if (statSync(path).isDirectory()) return join(path, "plugin.json");
    } catch {
      // The read boundary below reports one canonical failure.
    }
    return path;
  });
}

function validatePlugins(paths) {
  let failed = 0;
  for (const path of resolvePluginPaths(paths)) {
    const document = readDocument(path);
    if (!document) {
      failed++;
      continue;
    }
    const dirName = basename(dirname(resolve(path)));
    const { manifest, validation } = parseManifest(document.raw, dirName);
    if (!validation.ok) {
      printErrors(path, validation.errors);
      failed++;
      continue;
    }
    const c2 = transparencyViolations(manifest.contributes);
    const blocking = c2.filter((violation) => C2_STATIC_ENFORCEMENT[violation.rule] === "blocking");
    const warned = c2.filter((violation) => C2_STATIC_ENFORCEMENT[violation.rule] === "warn");
    if (blocking.length > 0) {
      console.error(`✗ ${path}`);
      console.error("  C2 투명성 위반(blocking — 앱이 활성화를 거부한다):");
      for (const violation of blocking) console.error(`  - ${violation.rule} — ${violation.detail}`);
      for (const violation of warned) console.error(`  ⚠ C2 ${violation.rule}: ${violation.detail}`);
      failed++;
      continue;
    }
    console.log(`✓ ${path}`);
    for (const warning of validation.warnings ?? []) console.log(`  ⚠ ${warning}`);
    for (const violation of warned) console.log(`  ⚠ C2 ${violation.rule}: ${violation.detail}`);
  }
  return failed > 0 ? 1 : 0;
}

function validateBuildDependencies(args) {
  const parsedArgs = parseOptions(args, new Set(["--dependency", "--target"]));
  if (!parsedArgs.ok || parsedArgs.positional.length !== 1) {
    return usageExit(parsedArgs.ok ? "build-dependencies: manifest 경로 하나가 필요합니다" : parsedArgs.error);
  }
  const dependency = parsedArgs.options.get("--dependency");
  const target = parsedArgs.options.get("--target");
  if ((dependency === undefined) !== (target === undefined)) {
    return usageExit("build-dependencies: --dependency와 --target은 함께 사용해야 합니다");
  }
  const path = parsedArgs.positional[0];
  const document = readDocument(path);
  if (!document) return 1;
  try {
    const parsed = parseBuildDependencies(document.raw);
    if (dependency === undefined) {
      console.log(`✓ ${path} (${parsed.dependencies.length} dependencies)`);
      return 0;
    }
    const resolved = resolveBuildDependency(parsed, dependency, target);
    process.stdout.write(`${JSON.stringify({ ...resolved, target })}\n`);
    return 0;
  } catch (error) {
    printErrors(path, [error instanceof Error ? error.message : String(error)]);
    return 1;
  }
}

function regularOutputRoot(value) {
  const absolute = resolve(value);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(absolute) !== absolute) {
    throw new Error("build output root must be a regular directory with no symbolic path");
  }
  return absolute;
}

function inspectOutputTree(root) {
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || realpathSync(root) !== root) return null;
  const entries = [];
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`build output tree contains a symbolic link: ${relative}`);
      if (entry.isDirectory()) {
        walk(absolute, relative);
        continue;
      }
      if (!entry.isFile() || realpathSync(absolute) !== absolute) {
        throw new Error(`build output tree contains a non-regular entry: ${relative}`);
      }
      const stat = lstatSync(absolute);
      const bytes = readFileSync(absolute);
      entries.push({
        path: relative,
        mode: stat.mode & 0o111 ? "755" : "644",
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  };
  walk(root, "");
  if (entries.length === 0) return null;
  const size = entries.reduce((total, entry) => total + entry.size, 0);
  return {
    type: "tree",
    files: entries.length,
    size,
    sha256: createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
  };
}

function inspectDeclaredOutput(outputRoot, declaration) {
  const absolute = resolve(outputRoot, ...declaration.path.split("/"));
  if (!absolute.startsWith(`${outputRoot}${sep}`)) return null;
  if (declaration.type === "tree") return inspectOutputTree(absolute);
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(absolute) !== absolute) return null;
  const bytes = readFileSync(absolute);
  return { type: "file", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function createBuildReceipt(args) {
  const parsedArgs = parseOptions(args, new Set(["--dependency", "--target", "--output-root", "--out"]));
  if (!parsedArgs.ok || parsedArgs.positional.length !== 1) {
    return usageExit(parsedArgs.ok ? "build-receipt-create: dependency manifest 경로 하나가 필요합니다" : parsedArgs.error);
  }
  const dependency = parsedArgs.options.get("--dependency");
  const target = parsedArgs.options.get("--target");
  const outputRootValue = parsedArgs.options.get("--output-root");
  const outValue = parsedArgs.options.get("--out");
  if (!dependency || !target || !outputRootValue || !outValue) {
    return usageExit("build-receipt-create: 모든 named option이 필요합니다");
  }
  const manifestPath = parsedArgs.positional[0];
  const document = readDocument(manifestPath);
  if (!document) return 1;
  try {
    const dependencies = parseBuildDependencies(document.raw);
    const resolved = resolveBuildDependency(dependencies, dependency, target);
    const outputRoot = regularOutputRoot(outputRootValue);
    const outputs = resolved.outputs.map((declaration) => {
      const inspection = inspectDeclaredOutput(outputRoot, declaration);
      if (!inspection) throw new Error(`declared build output is unavailable: ${declaration.path}`);
      return { path: declaration.path, ...inspection };
    });
    const receipt = parseBuildDependencyReceipt({
      schema: "soksak-build-dependency-receipt-v1",
      dependency: resolved.id,
      target,
      repository: resolved.repository,
      commit: resolved.commit,
      tools: resolved.tools,
      outputs,
    });
    const out = resolve(outValue);
    const parent = dirname(out);
    const parentStat = lstatSync(parent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || realpathSync(parent) !== parent) {
      throw new Error("receipt output parent must be a regular directory with no symbolic path");
    }
    writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o644 });
    console.log(`✓ ${out} (${receipt.dependency}/${receipt.target})`);
    return 0;
  } catch (error) {
    printErrors(manifestPath, [error instanceof Error ? error.message : String(error)]);
    return 1;
  }
}

function validateBuildReceipt(args) {
  const parsedArgs = parseOptions(args, new Set(["--dependencies", "--output-root"]));
  if (!parsedArgs.ok || parsedArgs.positional.length !== 1) {
    return usageExit(parsedArgs.ok ? "build-receipt: receipt 경로 하나가 필요합니다" : parsedArgs.error);
  }
  const dependenciesPath = parsedArgs.options.get("--dependencies");
  const outputRootValue = parsedArgs.options.get("--output-root");
  if (!dependenciesPath || !outputRootValue) {
    return usageExit("build-receipt: --dependencies와 --output-root가 필요합니다");
  }
  const receiptPath = parsedArgs.positional[0];
  const dependencyDocument = readDocument(dependenciesPath);
  const receiptDocument = readDocument(receiptPath);
  if (!dependencyDocument || !receiptDocument) return 1;
  try {
    const dependencies = parseBuildDependencies(dependencyDocument.raw);
    const parsedReceipt = parseBuildDependencyReceipt(receiptDocument.raw);
    const outputRoot = regularOutputRoot(outputRootValue);
    const verified = verifyBuildDependencyReceipt({
      dependencies,
      receipt: parsedReceipt,
      inspectOutput(relative) {
        try {
          const declaration = parsedReceipt.outputs.find((output) => output.path === relative);
          if (!declaration) return null;
          return inspectDeclaredOutput(outputRoot, declaration);
        } catch {
          return null;
        }
      },
    });
    console.log(`✓ ${receiptPath} (${verified.dependency}/${verified.target})`);
    return 0;
  } catch (error) {
    printErrors(receiptPath, [error instanceof Error ? error.message : String(error)]);
    return 1;
  }
}

function validateReleases(paths) {
  let failed = 0;
  for (const path of paths) {
    const document = readDocument(path);
    if (!document) {
      failed++;
      continue;
    }
    const parsed = parseReleaseManifest(document.raw);
    if (!parsed.ok) {
      printErrors(path, parsed.errors);
      failed++;
      continue;
    }
    const identity = releaseIdentity(parsed.value);
    console.log(`✓ ${path} (${identity.kind}:${identity.id}@${identity.version})`);
  }
  return failed > 0 ? 1 : 0;
}

function validateConformance(args) {
  const parsedArgs = parseOptions(args, new Set(["--release", "--plugin-manifest", "--sidecar-manifest"]));
  if (!parsedArgs.ok) return usageExit(parsedArgs.error);
  const releasePath = parsedArgs.options.get("--release");
  if (!releasePath || parsedArgs.positional.length === 0) {
    return usageExit("conformance: report 경로와 --release가 필요합니다");
  }
  const releaseDocument = readDocument(releasePath, `owner release ${releasePath}`);
  if (!releaseDocument) return 1;
  const release = parseReleaseManifest(releaseDocument.raw);
  if (!release.ok) {
    printErrors(releasePath, release.errors);
    return 1;
  }
  const identity = releaseIdentity(release.value);
  const pluginManifestPath = parsedArgs.options.get("--plugin-manifest");
  const sidecarManifestPath = parsedArgs.options.get("--sidecar-manifest");
  if (pluginManifestPath !== undefined && sidecarManifestPath !== undefined) {
    return usageExit("conformance: plugin and sidecar manifests are mutually exclusive");
  }
  let ownerPlugin;
  if (pluginManifestPath !== undefined) {
    const document = readDocument(pluginManifestPath, `plugin manifest ${pluginManifestPath}`);
    if (!document) return 1;
    const parsed = parseManifest(document.raw, identity.id);
    if (!parsed.validation.ok || !parsed.manifest) {
      printErrors(pluginManifestPath, parsed.validation.errors);
      return 1;
    }
    if (
      identity.kind !== "plugin" ||
      parsed.manifest.id !== identity.id ||
      parsed.manifest.version !== identity.version
    ) {
      printErrors(pluginManifestPath, ["plugin manifest identity must exactly match the owner plugin release"]);
      return 1;
    }
    ownerPlugin = parsed.manifest;
  }
  let ownerSidecar;
  if (sidecarManifestPath !== undefined) {
    const document = readDocument(sidecarManifestPath, `sidecar manifest ${sidecarManifestPath}`);
    if (!document) return 1;
    const parsed = parseSidecarManifest(document.raw);
    if (!parsed.ok) {
      printErrors(sidecarManifestPath, parsed.errors);
      return 1;
    }
    if (identity.kind !== "sidecar" || parsed.value.id !== identity.id || parsed.value.version !== identity.version) {
      printErrors(sidecarManifestPath, ["sidecar manifest identity must exactly match the sidecar release"]);
      return 1;
    }
    ownerSidecar = parsed.value;
  }
  let failed = 0;
  for (const path of parsedArgs.positional) {
    const document = readDocument(path);
    if (!document) {
      failed++;
      continue;
    }
    const report = parseConformanceReport(document.raw);
    if (!report.ok) {
      printErrors(path, report.errors);
      failed++;
      continue;
    }
    const verified = verifyConformanceReport(
      report.value,
      release.value,
      [...(ownerPlugin?.implements ?? []), ...(ownerSidecar ? [ownerSidecar.interface] : [])],
    );
    if (!verified.ok) {
      printErrors(path, verified.errors);
      failed++;
      continue;
    }
    if ("manifest" in report.value.claim && identity.kind === "plugin" && !ownerPlugin) {
      printErrors(path, [
        "soksak-spec-plugin@0.0.1 evidence requires --plugin-manifest",
      ]);
      failed++;
      continue;
    }
    if ("contract" in report.value.claim && identity.kind === "sidecar" && !ownerSidecar) {
      printErrors(path, ["sidecar domain evidence requires --sidecar-manifest"]);
      failed++;
      continue;
    }
    console.log(`✓ ${path} (${JSON.stringify(report.value.claim)})`);
  }
  return failed > 0 ? 1 : 0;
}

function parseHighWater(value) {
  if (value === undefined) return undefined;
  const separator = value.indexOf(":");
  if (separator < 1) return null;
  const sequence = Number(value.slice(0, separator));
  const digest = value.slice(separator + 1);
  return { sequence, digest };
}

async function validateRegistry(args) {
  const parsedArgs = parseOptions(
    args,
    new Set(["--public-key", "--registry-id", "--key-id", "--at", "--high-water"]),
  );
  if (!parsedArgs.ok) return usageExit(parsedArgs.error);
  if (parsedArgs.positional.length !== 1) {
    return usageExit("registry: registry.json 경로 하나가 필요합니다");
  }
  const publicKeyPath = parsedArgs.options.get("--public-key");
  const expectedRegistryId = parsedArgs.options.get("--registry-id");
  const expectedKeyId = parsedArgs.options.get("--key-id");
  if (!publicKeyPath || !expectedRegistryId || !expectedKeyId) {
    return usageExit("registry: --public-key, --registry-id, --key-id가 모두 필요합니다");
  }
  const atRaw = parsedArgs.options.get("--at");
  const now = atRaw === undefined ? Date.now() : Date.parse(atRaw);
  if (!Number.isFinite(now)) return usageExit("registry: --at은 유효한 ISO-8601 시각이어야 합니다");
  const highWater = parseHighWater(parsedArgs.options.get("--high-water"));
  if (highWater === null) return usageExit("registry: --high-water는 <sequence>:<sha256> 형식이어야 합니다");

  const registryPath = parsedArgs.positional[0];
  const registryDocument = readDocument(registryPath);
  const publicKeyDocument = readDocument(publicKeyPath, `public key ${publicKeyPath}`);
  if (!registryDocument || !publicKeyDocument) return 1;
  const publicKey = parseRegistryPublicKey(publicKeyDocument.raw);
  if (!publicKey.ok) {
    printErrors(publicKeyPath, publicKey.errors);
    return 1;
  }
  const certified = await certifyRegistry(registryDocument.raw, {
    expectedRegistryId,
    expectedKeyId,
    publicKey: publicKey.value,
    now,
    ...(highWater === undefined ? {} : { highWater }),
  });
  if (!certified.ok) {
    printErrors(registryPath, [`${certified.code}: ${certified.errors.join("; ")}`]);
    return 1;
  }
  console.log(
    `✓ ${registryPath} (registry=${certified.value.registry.id} sequence=${certified.value.registry.sequence} digest=${certified.value.digest} continuity=${certified.value.continuity})`,
  );
  return 0;
}
function registryPlugins(directory) {
  if (!statSync(directory).isDirectory()) throw new Error("registry plugins path must be a directory");
  return readdirSync(directory, { withFileTypes: true }).map((entry) => {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) throw new Error(`registry entry must be a regular JSON file: ${entry.name}`);
    const value = readDocument(join(directory, entry.name)); if (!value) throw new Error(`invalid registry entry: ${entry.name}`);
    const reference = parseReleaseReference(value.raw, `registry entry ${entry.name}`);
    if (!reference.ok) throw new Error(reference.errors.join("; "));
    if (entry.name !== `${reference.value.id}.json`) throw new Error(`registry filename does not match id: ${entry.name}`);
    return reference.value;
  }).sort((left, right) => left.id.localeCompare(right.id));
}
async function readRemoteRelease(reference) {
  const response = await fetch(reference.url);
  if (!response.ok) throw new Error(`GET ${reference.url}: ${response.status}`);
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) !== reference.size) throw new Error(`GET ${reference.url}: content length mismatch`);
  if (!response.body) throw new Error(`GET ${reference.url}: response body missing`);
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > reference.size) { await reader.cancel(); throw new Error(`GET ${reference.url}: response exceeds declared size`); } chunks.push(next.value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { bytes, value: JSON.parse(new TextDecoder().decode(bytes)) };
}
async function registryPublication(mode, args) {
  if (mode === "registry-publish") {
    const parsed = parseOptions(args, new Set(["--repository", "--commit"]));
    if (!parsed.ok || parsed.positional.length !== 1 || !parsed.options.has("--repository") || !parsed.options.has("--commit")) return usageExit(parsed.ok ? "registry-publish: input, repository, and commit required" : parsed.error);
    const document = readDocument(parsed.positional[0]); if (!document) return 1;
    const registry = parseRegistry(document.raw); if (!registry.ok) { printErrors(parsed.positional[0], registry.errors); return 1; }
    const token = process.env.SOKSAK_RELEASE_TOKEN; if (!token) throw new Error("SOKSAK_RELEASE_TOKEN is required");
    const bytes = document.bytes;
    const asset = { name: "registry.json", bytes, size: bytes.length, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, contentType: "application/json" };
    const result = await publishImmutableRelease({ repository: parsed.options.get("--repository"), commit: parsed.options.get("--commit"), tag: `registry-${registry.value.sequence}`, prerelease: false, assets: [asset], api: new GitHubApi({ repository: parsed.options.get("--repository"), token }) });
    console.log(JSON.stringify(result)); return 0;
  }
  if (mode === "registry-verify") {
    if (args.length !== 1) return usageExit("registry-verify: plugins directory required");
    const plugins = registryPlugins(args[0]); await verifyReleaseClosure(plugins, readRemoteRelease);
    console.log(`✓ ${args[0]} (${plugins.length} plugins)`); return 0;
  }
  if (mode === "registry-build") {
    const parsed = parseOptions(args, new Set(["--id", "--sequence", "--issued-at", "--expires-at", "--out"]));
    if (!parsed.ok || parsed.positional.length !== 1) return usageExit(parsed.ok ? "registry-build: plugins directory required" : parsed.error);
    const required = ["--id", "--sequence", "--issued-at", "--expires-at", "--out"]; if (required.some((key) => !parsed.options.has(key))) return usageExit("registry-build: all named options are required");
    const value = await buildRegistry({ id: parsed.options.get("--id"), sequence: Number(parsed.options.get("--sequence")), issuedAt: parsed.options.get("--issued-at"), expiresAt: parsed.options.get("--expires-at"), plugins: registryPlugins(parsed.positional[0]), read: readRemoteRelease });
    writeFileSync(parsed.options.get("--out"), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" }); return 0;
  }
  const parsed = parseOptions(args, new Set(["--out"]));
  if (!parsed.ok || parsed.positional.length !== 1 || !parsed.options.has("--out")) return usageExit(parsed.ok ? "registry-authenticate: input and --out required" : parsed.error);
  const input = readDocument(parsed.positional[0]); if (!input) return 1;
  const seed = process.env.SOKSAK_REGISTRY_ED25519_SEED; if (!seed) throw new Error("SOKSAK_REGISTRY_ED25519_SEED is required");
  const value = authenticateRegistry(input.raw, seed);
  writeFileSync(parsed.options.get("--out"), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" }); return 0;
}

async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  if (argv.length === 0) return usageExit();
  if (!MODES.has(argv[0])) return usageExit(`unknown mode: ${argv[0]}`);
  const mode = argv[0];
  const args = argv.slice(1);
  if (args.length === 0) return usageExit(`${mode}: 입력 경로가 필요합니다`);
  if (mode === "plugin") return validatePlugins(args);
  if (mode === "build-dependencies") return validateBuildDependencies(args);
  if (mode === "build-receipt-create") return createBuildReceipt(args);
  if (mode === "build-receipt") return validateBuildReceipt(args);
  if (mode === "release") return validateReleases(args);
  if (mode === "conformance") return validateConformance(args);
  if (mode.startsWith("registry-")) return registryPublication(mode, args);
  return validateRegistry(args);
}

process.exitCode = await main(process.argv.slice(2));
