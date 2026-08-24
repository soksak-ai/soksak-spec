#!/usr/bin/env node
import path from "node:path";

import { buildSidecarCandidate } from "./candidate.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const source = option("--source");
const sourceCommit = option("--commit");
const target = option("--target");
const artifact = option("--artifact");
const output = option("--out");
if (![source, artifact, output].every((value) => value && path.isAbsolute(value)) || !sourceCommit || !target) {
  throw new Error("--source, --artifact and --out must be absolute; --commit and --target are required");
}
process.stdout.write(`${JSON.stringify(buildSidecarCandidate({
  source, sourceCommit, target, artifact, output,
}))}\n`);
