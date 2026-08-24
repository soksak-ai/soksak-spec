#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

import { createCandidateInputReceipt } from "./candidate-artifact.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const directory = option("--directory");
const artifactName = option("--artifact-name");
const artifactDigest = option("--artifact-digest");
const candidateManifestSHA256 = option("--candidate-manifest-sha256");
const output = option("--out");
if (!directory || !path.isAbsolute(directory) || !artifactName || !artifactDigest ||
    !candidateManifestSHA256 || !output || !path.isAbsolute(output)) {
  throw new Error("--directory, --artifact-name, --artifact-digest, --candidate-manifest-sha256 and --out are required; paths must be absolute");
}
const receipt = createCandidateInputReceipt({
  directory, artifactName, artifactDigest, candidateManifestSHA256,
});
fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o644 });
process.stdout.write(`${JSON.stringify(receipt)}\n`);
