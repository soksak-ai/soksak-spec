import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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
  fs.mkdirSync(inputDirectory, { recursive: true });
  const overrides = { ...(metadata.pnpm?.overrides ?? {}) };
  const reportDependencies = [];
  for (const dependency of inputs) {
    if (!declared.has(dependency.name)) {
      throw new Error(`candidate dependency is not declared by the source package: ${dependency.name}`);
    }
    const stagedArtifact = path.join(inputDirectory, `${dependency.sha256}.tgz`);
    fs.copyFileSync(dependency.artifact, stagedArtifact, fs.constants.COPYFILE_EXCL);
    const relativeArtifact = path.relative(path.dirname(stagedPackage), stagedArtifact).split(path.sep).join("/");
    overrides[dependency.name] = `file:${relativeArtifact}`;
    reportDependencies.push({ name: dependency.name, sha256: dependency.sha256, artifact: relativeArtifact });
  }
  metadata.pnpm = { ...(metadata.pnpm ?? {}), overrides };
  fs.writeFileSync(stagedPackage, `${JSON.stringify(metadata, null, 2)}\n`);
  const report = { sourceCommit, packagePath: relativePackage.split(path.sep).join("/"), dependencies: reportDependencies };
  fs.writeFileSync(path.join(destination, ".candidate-stage.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
