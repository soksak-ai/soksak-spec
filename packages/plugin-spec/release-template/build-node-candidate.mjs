#!/usr/bin/env node
import path from "node:path";

import { buildNodeCandidate } from "./candidate-build.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const stage = option("--stage");
const output = option("--out");
const kind = option("--kind");
const generated = [];
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "--generated") generated.push(process.argv[index + 1]);
}
if (!stage || !output || !path.isAbsolute(stage) || !path.isAbsolute(output)) {
  throw new Error("--stage and --out must be absolute paths");
}
process.stdout.write(`${JSON.stringify(buildNodeCandidate({ stage, output, kind, generated }))}\n`);
