import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { finalizeNodeCandidate } from "./candidate-stage.mjs";

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 128 << 20 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stdout}${result.stderr}`);
  return result.stdout;
}

function defaultCandidateChecks({ packageDirectory }) {
  run("pnpm", ["install", "--no-frozen-lockfile"], packageDirectory);
  run("make", ["verify"], packageDirectory);
}

export function buildNodeCandidate({ stage, output, kind, generated, runChecks = defaultCandidateChecks }) {
  const staged = fs.realpathSync(stage);
  const destination = fs.realpathSync(output);
  if ((kind !== "portable" && kind !== "plugin") || fs.readdirSync(destination).length !== 0) {
    throw new Error("candidate archive kind is invalid or output directory is not empty");
  }
  const control = JSON.parse(fs.readFileSync(path.join(staged, ".candidate-control.json"), "utf8"));
  const packageDirectory = path.dirname(path.join(staged, control.report.packagePath));
  runChecks({ stage: staged, packageDirectory });
  const report = finalizeNodeCandidate({ output: staged, generated });

  const builder = path.join(import.meta.dirname, kind === "plugin" ? "build-release.mjs" : "build-portable-release.mjs");
  const summary = JSON.parse(run(process.execPath, [
    builder, "--commit", report.sourceCommit, "--out", destination,
  ], staged).trim());
  const validator = path.resolve(import.meta.dirname, "../bin/validate.mjs");
  run(process.execPath, [validator, "release", path.join(destination, "release.json")], staged);
  const result = {
    kind, sourceCommit: report.sourceCommit, packagePath: report.packagePath,
    dependencies: report.dependencies.map(({ name, sha256 }) => ({ name, sha256 })),
    generated: report.generated, archive: summary.archive, sha256: summary.sha256,
  };
  fs.writeFileSync(path.join(destination, "candidate-build.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
