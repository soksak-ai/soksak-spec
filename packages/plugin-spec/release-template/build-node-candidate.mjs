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
const store = option("--store");
const generated = [];
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "--generated") generated.push(process.argv[index + 1]);
}
if (!stage || !output || !path.isAbsolute(stage) || !path.isAbsolute(output) || (store !== undefined && !path.isAbsolute(store))) {
  throw new Error("--stage and --out must be absolute paths; --store, when present, must be absolute");
}
process.stdout.write(`${JSON.stringify(buildNodeCandidate({ stage, output, kind, store, generated }))}\n`);
