#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { COMPONENT_ID_RE, STRICT_SEMVER_RE } from "../../dist/release-primitives.js";
import { createRegularFileArchive, sha256 } from "../archive.mjs";
import { readSidecarReleaseArchive } from "./archive.mjs";
import { assertNativeBinaryTarget } from "./native-binary.mjs";

const TARGET = /^(?:aarch64|x86_64)-(?:apple-darwin|pc-windows-msvc|unknown-linux-(?:gnu|musl))$/;

function sourceRoot(value) {
  const absolute = path.resolve(value);
  const stat = fs.lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(absolute) !== absolute) {
    throw new Error(`staged source must be a regular directory with no symbolic path: ${absolute}`);
  }
  return absolute;
}

function readIdentity(root, target) {
  const manifestPath = path.join(root, "sidecar.json");
  const stat = fs.lstatSync(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("staged sidecar.json must be a regular file");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const process = `dist/${manifest.id}${target.includes("windows") ? ".exe" : ""}`;
  if (!COMPONENT_ID_RE.test(manifest.id ?? "") || !STRICT_SEMVER_RE.test(manifest.version ?? "") || manifest.process !== process) {
    throw new Error("staged sidecar identity does not match its target process");
  }
  const executable = path.join(root, ...process.split("/"));
  const executableStat = fs.lstatSync(executable);
  if (!executableStat.isFile() || executableStat.isSymbolicLink()) throw new Error("staged sidecar process must be a regular file");
  assertNativeBinaryTarget(fs.readFileSync(executable), target);
  return { id: manifest.id, version: manifest.version, process };
}

function existingOutput(out, checksumPath, archive, checksum) {
  const archiveExists = fs.existsSync(out);
  const checksumExists = fs.existsSync(checksumPath);
  if (!archiveExists && !checksumExists) return false;
  if (!archiveExists || !checksumExists || !fs.lstatSync(out).isFile() || !fs.lstatSync(checksumPath).isFile() ||
      !fs.readFileSync(out).equals(archive) || fs.readFileSync(checksumPath, "utf8") !== checksum) {
    throw new Error(`archive output conflict: ${out}`);
  }
  return true;
}

export function packSidecarTarget({ source, target, out }) {
  if (!TARGET.test(target ?? "")) throw new Error(`unsupported sidecar target: ${target}`);
  const root = sourceRoot(source);
  const identity = readIdentity(root, target);
  const output = path.resolve(out);
  const name = `${identity.id}-${identity.version}-${target}.tar.gz`;
  if (path.basename(output) !== name) throw new Error(`archive output must be named ${name}`);
  const files = fs.readdirSync(root).sort();
  if (files.length === 0) throw new Error("staged sidecar tree is empty");
  const archive = createRegularFileArchive({ root, files });
  const archived = readSidecarReleaseArchive(archive);
  if (!archived.some((entry) => entry.name === "sidecar.json") || !archived.some((entry) => entry.name === identity.process)) {
    throw new Error("packed sidecar archive lost its manifest or process");
  }
  const archiveSHA256 = sha256(archive);
  const checksumPath = `${output}.sha256`;
  const checksum = `${archiveSHA256}  ${name}\n`;
  const result = Object.freeze({ archive: name, sha256: archiveSHA256, size: archive.length, target });
  if (existingOutput(output, checksumPath, archive, checksum)) return result;

  fs.mkdirSync(path.dirname(output), { recursive: true });
  // '~' is outside the archive name grammar, so a staging file never collides with an output.
  const temporaryArchive = `${output}~next.${process.pid}`;
  const temporaryChecksum = `${checksumPath}~next.${process.pid}`;
  try {
    fs.writeFileSync(temporaryArchive, archive, { flag: "wx", mode: 0o644 });
    fs.writeFileSync(temporaryChecksum, checksum, { flag: "wx", mode: 0o644 });
    fs.renameSync(temporaryArchive, output);
    fs.renameSync(temporaryChecksum, checksumPath);
  } finally {
    fs.rmSync(temporaryArchive, { force: true });
    fs.rmSync(temporaryChecksum, { force: true });
  }
  return result;
}

function options(argv) {
  if (argv.length !== 6) throw new Error("usage: pack-target.mjs --source <staged-dir> --target <triple> --out <archive>");
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    if (!["--source", "--target", "--out"].includes(name) || !argv[index + 1] || result[name]) {
      throw new Error("usage: pack-target.mjs --source <staged-dir> --target <triple> --out <archive>");
    }
    result[name] = argv[index + 1];
  }
  return { source: result["--source"], target: result["--target"], out: result["--out"] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = packSidecarTarget(options(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
