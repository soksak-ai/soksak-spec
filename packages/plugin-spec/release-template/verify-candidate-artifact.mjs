#!/usr/bin/env node
import path from "node:path";

import { verifyCandidateArtifact } from "./candidate-artifact.mjs";

const index = process.argv.indexOf("--directory");
const directory = index < 0 ? undefined : process.argv[index + 1];
if (!directory || !path.isAbsolute(directory)) throw new Error("--directory must be absolute");
process.stdout.write(`${JSON.stringify(verifyCandidateArtifact({ directory }))}\n`);
