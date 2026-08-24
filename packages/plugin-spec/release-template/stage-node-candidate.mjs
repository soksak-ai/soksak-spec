#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

import { stageNodeCandidate } from "./candidate-stage.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const source = option("--source");
const output = option("--out");
const planPath = option("--plan");
if (!source || !output || !planPath || !path.isAbsolute(source) || !path.isAbsolute(output) || !path.isAbsolute(planPath)) {
  throw new Error("--source, --out and --plan must be absolute paths");
}
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
if (!plan || typeof plan !== "object" || Array.isArray(plan) ||
    JSON.stringify(Object.keys(plan).sort()) !== JSON.stringify(["dependencies", "packagePath"])) {
  throw new Error("candidate stage plan must contain only packagePath and dependencies");
}
const report = stageNodeCandidate({
  source, output, packagePath: plan.packagePath, dependencies: plan.dependencies,
});
process.stdout.write(`${JSON.stringify(report)}\n`);
