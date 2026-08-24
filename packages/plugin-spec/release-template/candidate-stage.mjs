import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { assertNoLocalPackageDependencies } from "./package-dependencies.mjs";

const SHA256 = /^[0-9a-f]{64}$/;

function run(command, args, cwd, input) {
  const result = spawnSync(command, args, {
    cwd, input, encoding: input === undefined ? "utf8" : null, maxBuffer: 128 << 20,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    throw new Error(`${command} ${args.join(" ")} failed: ${output}`);
  }
  return result.stdout;
}

function inside(root, candidate) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

function verifiedDependencies(dependencies) {
  if (!Array.isArray(dependencies) || dependencies.length === 0) {
    throw new Error("candidate stage requires at least one dependency artifact");
  }
  const names = new Set();
  return dependencies.map((dependency) => {
    if (!dependency || typeof dependency !== "object" || Array.isArray(dependency) ||
        typeof dependency.name !== "string" || dependency.name.length === 0 || names.has(dependency.name) ||
        typeof dependency.artifact !== "string" || !path.isAbsolute(dependency.artifact) ||
        typeof dependency.sha256 !== "string" || !SHA256.test(dependency.sha256)) {
      throw new Error("candidate dependency declaration is invalid");
    }
    names.add(dependency.name);
    const info = fs.lstatSync(dependency.artifact);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`candidate dependency is not a regular file: ${dependency.artifact}`);
    }
    const actual = createHash("sha256").update(fs.readFileSync(dependency.artifact)).digest("hex");
    if (actual !== dependency.sha256) {
      throw new Error(`candidate dependency digest mismatch: ${dependency.name}`);
    }
    return { ...dependency };
  });
}

function verifiedGenerated(generated, packagePath) {
  if (!Array.isArray(generated) || generated.length === 0 || new Set(generated).size !== generated.length) {
    throw new Error("candidate stage requires unique generated output paths");
  }
  const metadata = new Set([
    path.normalize(packagePath),
    path.join(path.dirname(path.normalize(packagePath)), "pnpm-lock.yaml"),
    path.join(path.dirname(path.normalize(packagePath)), "pnpm-workspace.yaml"),
  ]);
  return generated.map((value) => {
    if (typeof value !== "string" || value === "" || path.isAbsolute(value)) {
      throw new Error("candidate generated output path is invalid");
    }
    const clean = path.normalize(value);
    if (clean === "." || clean === ".." || clean.startsWith(".." + path.sep) || metadata.has(clean)) {
      throw new Error("candidate generated output path is invalid");
    }
    return clean.split(path.sep).join("/");
  });
}

function fileDigest(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function regularFiles(root, directory = root) {
  const found = [];
  for (const name of fs.readdirSync(directory).sort()) {
    const file = path.join(directory, name);
    const relative = path.relative(root, file).split(path.sep).join("/");
    const info = fs.lstatSync(file);
    if (info.isSymbolicLink()) throw new Error(`candidate checkout contains a symbolic link: ${relative}`);
    if (info.isDirectory()) found.push(...regularFiles(root, file));
    else if (info.isFile()) found.push(relative);
    else throw new Error(`candidate checkout contains a non-regular entry: ${relative}`);
  }
  return found;
}

function underGenerated(relative, generated) {
  return generated.some((prefix) => relative === prefix || relative.startsWith(prefix + "/"));
}

function removeAmbientMetadata(directory) {
  for (const name of fs.readdirSync(directory)) {
    const entry = path.join(directory, name);
    if (name === ".DS_Store") {
      fs.rmSync(entry, { force: true });
      continue;
    }
    if (fs.lstatSync(entry).isDirectory()) removeAmbientMetadata(entry);
  }
}

function applyWorkspaceOverrides(workspacePath, overrides) {
  const original = fs.existsSync(workspacePath) ? fs.readFileSync(workspacePath, "utf8") : "";
  const lines = original.split(/\r?\n/);
  let start = lines.findIndex((line) => /^overrides:\s*$/.test(line));
  const entries = Object.entries(overrides).map(([name, value]) => `  '${name}': ${value}`);
  if (start < 0) {
    const prefix = original === "" || original.endsWith("\n") ? original : original + "\n";
    fs.writeFileSync(workspacePath, `${prefix}overrides:\n${entries.join("\n")}\n`);
    return;
  }
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === "" || /^\s/.test(lines[end]))) end += 1;
  const existing = lines.slice(start + 1, end).join("\n");
  for (const name of Object.keys(overrides)) {
    if (existing.includes(`'${name}'`) || existing.includes(`"${name}"`) || existing.includes(`${name}:`)) {
      throw new Error(`candidate dependency already has a workspace override: ${name}`);
    }
  }
  lines.splice(end, 0, ...entries);
  fs.writeFileSync(workspacePath, lines.join("\n"));
}

export function stageNodeCandidate({ source, output, packagePath, dependencies }) {
  const root = fs.realpathSync(source);
  const destination = fs.realpathSync(output);
  if (!path.isAbsolute(source) || !path.isAbsolute(output) || root === destination ||
      inside(root, destination) || inside(destination, root)) {
    throw new Error("candidate source and output must be distinct absolute directories");
  }
  const rootInfo = fs.lstatSync(root);
  const outputInfo = fs.lstatSync(destination);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || !outputInfo.isDirectory() || outputInfo.isSymbolicLink()) {
    throw new Error("candidate source and output must be regular directories");
  }
  if (fs.readdirSync(destination).length !== 0) {
    throw new Error("candidate output directory must be empty");
  }
  const discovered = String(run("git", ["rev-parse", "--show-toplevel"], root)).trim();
  if (path.resolve(discovered) !== root) throw new Error("candidate source must be a Git repository root");
  const status = String(run("git", ["status", "--porcelain"], root)).trim();
  if (status !== "") throw new Error(`candidate source checkout is dirty:\n${status}`);
  const sourceCommit = String(run("git", ["rev-parse", "HEAD"], root)).trim();
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error("candidate source commit is not exact");
  const inputs = verifiedDependencies(dependencies);

  const archive = run("git", ["archive", "--format=tar", sourceCommit], root);
  run("tar", ["-xf", "-", "-C", destination], root, archive);

  const relativePackage = path.normalize(packagePath);
  const stagedPackage = path.resolve(destination, relativePackage);
  if (!inside(destination, stagedPackage) || !fs.statSync(stagedPackage).isFile()) {
    throw new Error(`candidate package path is invalid: ${packagePath}`);
  }
  const metadata = JSON.parse(fs.readFileSync(stagedPackage, "utf8"));
  const declared = new Set([
    ...Object.keys(metadata.dependencies ?? {}), ...Object.keys(metadata.devDependencies ?? {}),
    ...Object.keys(metadata.peerDependencies ?? {}), ...Object.keys(metadata.optionalDependencies ?? {}),
  ]);
  const inputDirectory = path.join(destination, ".candidate-inputs");
  const sourceHashes = Object.fromEntries(regularFiles(destination).map((relative) => [
    relative, fileDigest(path.join(destination, relative)),
  ]));
  const metadataPaths = [
    relativePackage,
    path.join(path.dirname(relativePackage), "pnpm-lock.yaml"),
    path.join(path.dirname(relativePackage), "pnpm-workspace.yaml"),
  ];
  const canonicalMetadata = Object.fromEntries(metadataPaths.map((relative) => {
    const file = path.join(destination, relative);
    return [relative.split(path.sep).join("/"), fs.existsSync(file) ? fs.readFileSync(file).toString("base64") : null];
  }));
  fs.mkdirSync(inputDirectory, { recursive: true });
  const overrides = {};
  const reportDependencies = [];
  for (const dependency of inputs) {
    if (!declared.has(dependency.name)) {
      throw new Error(`candidate dependency is not declared by the source package: ${dependency.name}`);
    }
    const stagedArtifact = path.join(inputDirectory, `${dependency.sha256}.tgz`);
    fs.copyFileSync(dependency.artifact, stagedArtifact, fs.constants.COPYFILE_EXCL);
    const workspacePath = path.join(path.dirname(stagedPackage), "pnpm-workspace.yaml");
    const relativeArtifact = path.relative(path.dirname(workspacePath), stagedArtifact).split(path.sep).join("/");
    overrides[dependency.name] = `file:${relativeArtifact}`;
    reportDependencies.push({ name: dependency.name, sha256: dependency.sha256, artifact: relativeArtifact });
  }
  applyWorkspaceOverrides(path.join(path.dirname(stagedPackage), "pnpm-workspace.yaml"), overrides);
  const report = {
    sourceCommit, packagePath: relativePackage.split(path.sep).join("/"),
    dependencies: reportDependencies,
  };
  fs.writeFileSync(path.join(destination, ".candidate-control.json"), `${JSON.stringify({
    report, sourceHashes, canonicalMetadata,
  })}\n`);
  fs.writeFileSync(path.join(destination, ".candidate-stage.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function finalizeNodeCandidate({ output, generated }) {
  const destination = fs.realpathSync(output);
  const controlPath = path.join(destination, ".candidate-control.json");
  const reportPath = path.join(destination, ".candidate-stage.json");
  if (!fs.statSync(controlPath).isFile() || !fs.statSync(reportPath).isFile()) {
    throw new Error("candidate stage control metadata is missing");
  }
  const control = JSON.parse(fs.readFileSync(controlPath, "utf8"));
  const report = control.report;
  const generatedPaths = verifiedGenerated(generated, report.packagePath);
  for (const [relative, encoded] of Object.entries(control.canonicalMetadata)) {
    const file = path.join(destination, relative);
    if (encoded === null) {
      if (fs.existsSync(file)) fs.rmSync(file);
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(encoded, "base64"));
    }
  }
  const packageDirectory = path.dirname(path.join(destination, report.packagePath));
  fs.rmSync(path.join(packageDirectory, "node_modules"), { recursive: true, force: true });
  removeAmbientMetadata(destination);

  const ignored = new Set([".candidate-control.json", ".candidate-stage.json"]);
  const current = regularFiles(destination).filter((relative) =>
    !ignored.has(relative) && !relative.startsWith(".candidate-inputs/") &&
    !relative.includes("/node_modules/") && !underGenerated(relative, generatedPaths));
  const source = Object.keys(control.sourceHashes).filter((relative) => !underGenerated(relative, generatedPaths));
  const violations = [];
  for (const relative of source) {
    const file = path.join(destination, relative);
    if (!fs.existsSync(file) || fileDigest(file) !== control.sourceHashes[relative]) violations.push(relative);
  }
  for (const relative of current) if (!(relative in control.sourceHashes)) violations.push(relative);
  if (violations.length > 0) {
    throw new Error(`candidate build changed undeclared source: ${[...new Set(violations)].sort().join(", ")}`);
  }
  fs.rmSync(path.join(destination, ".candidate-inputs"), { recursive: true, force: true });
  assertNoLocalPackageDependencies(path.join(destination, report.packagePath));
  fs.rmSync(controlPath);
  fs.rmSync(reportPath);
  return { ...report, generated: generatedPaths };
}
