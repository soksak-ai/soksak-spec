#!/usr/bin/env node
import path from "node:path";

import { stageSidecarCandidatePackage } from "./candidate.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const source = option("--source");
const stage = option("--stage");
const target = option("--target");
const output = option("--out");
if (![source, stage, output].every((value) => value && path.isAbsolute(value)) || !target) {
  throw new Error("--source, --stage and --out must be absolute; --target is required");
}
process.stdout.write(`${JSON.stringify(stageSidecarCandidatePackage({ source, stage, target, output }))}\n`);
