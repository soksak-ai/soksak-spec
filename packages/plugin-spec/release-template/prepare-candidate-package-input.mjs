#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

import { prepareCandidatePackageInput } from "./candidate-artifact.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const directory = option("--directory");
const artifactName = option("--artifact-name");
const artifactDigest = option("--artifact-digest");
const candidateManifestSHA256 = option("--candidate-manifest-sha256");
const sourceCommit = option("--source-commit");
const kind = option("--kind");
const packageName = option("--package-name");
const receiptOutput = option("--receipt-out");
if (!directory || !path.isAbsolute(directory) || !artifactName || !artifactDigest ||
    !candidateManifestSHA256 || !sourceCommit || !kind || !packageName ||
    !receiptOutput || !path.isAbsolute(receiptOutput)) {
  throw new Error("candidate package input requires absolute --directory/--receipt-out and every identity option");
}
const prepared = prepareCandidatePackageInput({
  directory, artifactName, artifactDigest, candidateManifestSHA256,
  sourceCommit, kind, packageName,
});
fs.writeFileSync(receiptOutput, `${JSON.stringify(prepared.receipt, null, 2)}\n`, { flag: "wx", mode: 0o644 });
process.stdout.write(`${JSON.stringify(prepared.dependency)}\n`);
