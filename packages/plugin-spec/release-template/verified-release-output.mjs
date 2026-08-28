import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { isEntryModule } from "./entry.mjs";

const RECEIPT = "component-build-receipt.json";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function regularDirectory(directory, label) {
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || fs.realpathSync(directory) !== directory) {
    throw new Error(`${label} must be a real directory with no symbolic path`);
  }
}

function regularFiles(directory, label) {
  regularDirectory(directory, label);
  return fs.readdirSync(directory, { withFileTypes: true }).map((entry) => {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`${label} must contain only regular files: ${entry.name}`);
    }
    const filename = path.join(directory, entry.name);
    if (fs.realpathSync(filename) !== filename) {
      throw new Error(`${label} file has a symbolic path: ${entry.name}`);
    }
    return entry.name;
  }).sort();
}

function releaseDocument(directory, label) {
  const filename = path.join(directory, "release.json");
  try {
    return JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch (error) {
    throw new Error(`${label} release.json is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function withoutReceipt(release) {
  return {
    ...release,
    evidence: (release.evidence ?? []).filter((entry) => entry?.file !== RECEIPT),
  };
}

function assertOptionalReceipt(directory, release, names) {
  const references = (release.evidence ?? []).filter((entry) => entry?.file === RECEIPT);
  const hasFile = names.includes(RECEIPT);
  if (references.length === 0 && !hasFile) return;
  if (references.length !== 1 || !hasFile) {
    throw new Error("verified release output has an incomplete component build receipt");
  }
  const bytes = fs.readFileSync(path.join(directory, RECEIPT));
  const reference = references[0];
  if (reference.size !== bytes.length || reference.sha256 !== sha256(bytes)) {
    throw new Error("verified release output component build receipt metadata differs");
  }
}

export function assertSameVerifiedReleaseBase(candidate, output) {
  const candidateNames = regularFiles(candidate, "verified release candidate");
  const outputNames = regularFiles(output, "verified release output");
  if (candidateNames.includes(RECEIPT)) {
    throw new Error("base release candidate must not contain a component build receipt");
  }
  const candidateRelease = releaseDocument(candidate, "candidate");
  const outputRelease = releaseDocument(output, "output");
  assertOptionalReceipt(output, outputRelease, outputNames);

  const expectedNames = [...candidateNames, ...(outputNames.includes(RECEIPT) ? [RECEIPT] : [])].sort();
  if (JSON.stringify(outputNames) !== JSON.stringify(expectedNames)) {
    throw new Error("verified release output file set differs from the candidate");
  }
  for (const name of candidateNames) {
    if (name === "release.json") continue;
    if (!fs.readFileSync(path.join(candidate, name)).equals(fs.readFileSync(path.join(output, name)))) {
      throw new Error(`verified release output differs from the candidate: ${name}`);
    }
  }
  if (JSON.stringify(candidateRelease) !== JSON.stringify(withoutReceipt(outputRelease))) {
    throw new Error("verified release output release.json differs from the candidate base");
  }
}

// The candidate is already complete and verified when it arrives here. A final
// output is write-once: first publication is one rename, and a repeated run may
// only prove that the existing base (with an optional canonical receipt) is the
// same. A different output is preserved and refused by name.
export function publishVerifiedCandidate(candidate, output) {
  if (!path.isAbsolute(candidate) || !path.isAbsolute(output)) {
    throw new Error("verified release candidate and output must be absolute paths");
  }
  regularDirectory(candidate, "verified release candidate");
  const parent = path.dirname(output);
  regularDirectory(parent, "verified release output parent");
  if (!fs.existsSync(output)) {
    fs.renameSync(candidate, output);
    return { state: "created", output };
  }
  assertSameVerifiedReleaseBase(candidate, output);
  return { state: "unchanged", output };
}

function commandOptions(argv) {
  if (argv.length !== 4) throw new Error("usage: verified-release-output.mjs --candidate <directory> --output <directory>");
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if ((name !== "--candidate" && name !== "--output") || !value || values.has(name)) {
      throw new Error("usage: verified-release-output.mjs --candidate <directory> --output <directory>");
    }
    values.set(name, value);
  }
  return { candidate: values.get("--candidate"), output: values.get("--output") };
}

if (isEntryModule(import.meta.url)) {
  try {
    const options = commandOptions(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(publishVerifiedCandidate(options.candidate, options.output))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
