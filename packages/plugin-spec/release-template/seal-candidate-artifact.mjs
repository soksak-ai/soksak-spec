#!/usr/bin/env node
import path from "node:path";

import { sealCandidateArtifact } from "./candidate-artifact.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const directory = option("--directory");
const evidence = [];
for (let index = 0; index < process.argv.length; index += 1) {
  if (process.argv[index] === "--evidence") evidence.push(process.argv[index + 1]);
}
if (!directory || !path.isAbsolute(directory) || evidence.some((value) => !value)) {
  throw new Error("--directory must be absolute and every --evidence must name a file");
}
process.stdout.write(`${JSON.stringify(sealCandidateArtifact({ directory, evidence }))}\n`);
