// Local owner build: a clean exact commit of one owner repository is cloned, verified by its own
// make verify, built by the canonical builder for its kind, and published into a local store. A
// Plugin composes its runtime dependencies against that store; build inputs come from the package
// manager.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GITHUB_ORG, RELEASE_FILE_RE } from "../dist/release-primitives.js";
import { publishLocalRelease } from "./local-release-store.mjs";
import { packSidecarTarget } from "./sidecar/pack-target.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
// The owner's make receives only the variables named on its command line: GNU make would otherwise
// read the calling make's command-line variables from MAKEFLAGS and treat them as its own.
const { MAKEFLAGS: _makeflags, MFLAGS: _mflags, GNUMAKEFLAGS: _gnumakeflags, ...ownerEnvironment } = process.env;
function run(command, args, cwd, env = ownerEnvironment) { const result = spawnSync(command, args, { cwd, encoding: "utf8", env }); if (result.error) throw result.error; if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}${result.stderr}`); return result.stdout.trim(); }
function read(pathname) { const info = fs.lstatSync(pathname); if (info.isSymbolicLink() || !info.isFile()) throw new Error(`regular file required: ${pathname}`); return fs.readFileSync(pathname); }
// Every file name the release document records or the build writes satisfies the release file grammar.
function releaseFile(name) { if (!RELEASE_FILE_RE.test(name)) throw new Error(`release file name is invalid: ${name}`); return name; }
function write(directory, name, bytes) { fs.writeFileSync(path.join(directory, releaseFile(name)), bytes, { flag: "wx" }); }
function writeJSON(directory, name, value) { write(directory, name, `${JSON.stringify(value, null, 2)}\n`); }

function kindOf(root) {
  const values = [["plugin", "plugin.json"], ["sidecar", "sidecar.json"], ["kit", "kit.json"], ["contract", "contract.json"], ["spec", "spec.json"]].filter(([, name]) => fs.existsSync(path.join(root, name)));
  if (values.length === 0 && fs.existsSync(path.join(root, "package.json"))) {
    const owner = JSON.parse(read(path.join(root, "package.json"))).soksakRelease;
    if (owner?.spec?.id === "soksak-spec" && owner.manifest === "release.json") values.push(["spec", "package.json"]);
  }
  if (values.length !== 1) throw new Error("owner repository must contain exactly one component manifest");
  return values[0][0];
}

function copyRegularTree(from, to) {
  const info = fs.lstatSync(from);
  if (info.isSymbolicLink()) throw new Error(`sidecar stage contains a symbolic link: ${from}`);
  if (info.isDirectory()) {
    fs.mkdirSync(to);
    for (const name of fs.readdirSync(from).sort()) copyRegularTree(path.join(from, name), path.join(to, name));
  } else if (info.isFile()) fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
  else throw new Error(`sidecar stage contains a non-regular entry: ${from}`);
}

function makeTreeOwnerWritable(pathname) {
  const info = fs.lstatSync(pathname);
  if (info.isSymbolicLink()) return;
  if (info.isDirectory()) {
    fs.chmodSync(pathname, info.mode | 0o700);
    for (const name of fs.readdirSync(pathname)) makeTreeOwnerWritable(path.join(pathname, name));
  } else if (info.isFile()) fs.chmodSync(pathname, info.mode | 0o600);
}

function removeWorkTree(directory) {
  if (fs.existsSync(directory)) makeTreeOwnerWritable(directory);
  fs.rmSync(directory, { recursive: true, force: true });
}

// make stage TARGET=<target> OUT=<stage> writes sidecar.json and the process binary, flat, into
// the stage. The package for one target is sidecar.json, dist/<everything else staged>, and the
// source license files.
function packageSidecarStage({ source, manifest, stage, target, output }) {
  const staged = JSON.parse(read(path.join(stage, "sidecar.json")));
  const process = `dist/${manifest.id}${target.includes("windows") ? ".exe" : ""}`;
  if (staged.id !== manifest.id || staged.version !== manifest.version || JSON.stringify(staged.interface) !== JSON.stringify(manifest.interface) || staged.process !== process) {
    throw new Error(`staged sidecar identity differs from source or target ${target}`);
  }
  fs.writeFileSync(path.join(output, "sidecar.json"), read(path.join(stage, "sidecar.json")), { flag: "wx" });
  fs.mkdirSync(path.join(output, "dist"));
  for (const name of fs.readdirSync(stage).sort()) {
    if (name !== "sidecar.json") copyRegularTree(path.join(stage, name), path.join(output, "dist", name));
  }
  const licenses = fs.readdirSync(source).filter((name) => name === "LICENSE" || name.startsWith("LICENSE.") || name === "THIRD-PARTY-NOTICES").sort();
  if (licenses.length === 0) throw new Error("sidecar source has no license file");
  for (const name of licenses) fs.copyFileSync(path.join(source, name), path.join(output, name), fs.constants.COPYFILE_EXCL);
}

// An owner preflight calls soksak-validate by name. Actions install the spec package globally; the
// local build supplies the validator this package ships, ahead of anything else on PATH.
function ownerTools(work, template) {
  const bin = path.join(work, "bin");
  fs.mkdirSync(bin);
  const validator = path.resolve(template, "..", "bin", "validate.mjs");
  fs.writeFileSync(path.join(bin, "soksak-validate"), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(validator)} "$@"\n`, { mode: 0o755 });
  return { ...ownerEnvironment, PATH: `${bin}${path.delimiter}${ownerEnvironment.PATH ?? ""}` };
}

function assembleSidecar(root, commit, targets, work, env) {
  if (targets.length === 0 || new Set(targets).size !== targets.length) throw new Error("Sidecar build requires unique --target values");
  const manifest = JSON.parse(read(path.join(root, "sidecar.json")));
  const output = path.join(work, "release"); fs.mkdirSync(output);
  const artifacts = [];
  for (const target of [...targets].sort()) {
    const name = releaseFile(`${manifest.id}-${manifest.version}-${target}.tar.gz`);
    const stage = path.join(work, `stage-${target}`); const packaged = path.join(work, `package-${target}`);
    fs.mkdirSync(stage); fs.mkdirSync(packaged);
    run("make", ["verify", `TARGET=${target}`], root, env);
    run("make", ["stage", `TARGET=${target}`, `OUT=${stage}`], root, env);
    packageSidecarStage({ source: root, manifest, stage, target, output: packaged });
    const packed = packSidecarTarget({ source: packaged, target, out: path.join(output, name) });
    artifacts.push({ target, file: name, size: packed.size, sha256: packed.sha256, format: "tar.gz", manifest: "sidecar.json" });
    fs.rmSync(path.join(output, `${name}.sha256`));
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`); write(output, "sidecar.json", manifestBytes);
  const report = (claim) => ({ subject: { sidecar: { id: manifest.id, version: manifest.version } }, claim, result: "passed", validator: { name: "soksak-validate", version: manifest.version }, artifacts: artifacts.map(({ target, sha256 }) => ({ target, sha256 })) });
  const evidence = [["conformance-interface.json", report({ contract: manifest.interface })], ["conformance-release.json", report({ release: true })], ["conformance-sidecar.json", report({ manifest: true })]].map(([name, value]) => { const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`); write(output, name, bytes); return { file: name, size: bytes.length, sha256: sha256(bytes) }; });
  writeJSON(output, "release.json", { kind: "sidecar", id: manifest.id, version: manifest.version, manifest: { file: "sidecar.json", size: manifestBytes.length, sha256: sha256(manifestBytes) }, source: { repository: `https://github.com/${GITHUB_ORG}/${manifest.id}`, commit }, artifacts, evidence });
  return output;
}

// registry: the package registry the owner's make verify installs @soksak packages from, handed
// over as the command-line variable REGISTRY; an owner without such packages ignores it.
export function buildLocalRelease({ store, source, targets = [], registry, template = path.dirname(fileURLToPath(import.meta.url)) }) {
  const verify = ["verify", ...(registry === undefined ? [] : [`REGISTRY=${registry}`])];
  let env = ownerEnvironment;
  let result;
  let failure;
  if (!path.isAbsolute(store) || !path.isAbsolute(source)) throw new Error("store and source must be absolute");
  const sourceRoot = fs.realpathSync(source);
  if (run("git", ["status", "--porcelain"], sourceRoot) !== "") throw new Error("owner source must be clean");
  const commit = run("git", ["rev-parse", "HEAD"], sourceRoot);
  const work = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "soksak-local-build-"));
  const checkout = path.join(work, "source");
  try {
    run("git", ["clone", "--quiet", "--no-local", sourceRoot, checkout], work);
    if (run("git", ["rev-parse", "HEAD"], checkout) !== commit) throw new Error("local build clone commit mismatch");
    env = ownerTools(work, template);
    const kind = kindOf(checkout); let release;
    // A local Plugin build composes its runtime dependencies against the store it publishes into.
    if (kind === "plugin") { release = path.join(work, "release"); run("make", verify, checkout, env); run(process.execPath, [path.join(template, "build-release.mjs"), "--commit", commit, "--out", release, "--store", store], checkout); }
    else if (kind === "kit" || kind === "contract") { release = path.join(work, "release"); run("make", verify, checkout, env); fs.mkdirSync(release); run(process.execPath, [path.join(template, "build-portable-release.mjs"), "--commit", commit, "--out", release], checkout); }
    else if (kind === "spec") { run("make", verify, checkout, env); release = path.join(checkout, "artifacts"); }
    else release = assembleSidecar(checkout, commit, targets, work, env);
    result = publishLocalRelease({ store, release });
  } catch (error) { failure = error; }
  // A build failure and a cleanup failure are two facts; neither hides the other.
  try { removeWorkDirectory(work, result); }
  catch (error) { throw failure === undefined ? error : new Error(`${failure instanceof Error ? failure.message : String(failure)}\n${error instanceof Error ? error.message : String(error)}`); }
  if (failure !== undefined) throw failure;
  return result;
}

// Owner gates may seal verified artifacts read-only; cleanup restores owner access before removal.
export function removeWorkDirectory(work, result, remove = removeWorkTree) {
  let failure;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { remove(work); return result; } catch (error) { failure = error; }
  }
  throw new Error(`release ${JSON.stringify(result)}; work directory could not be removed: ${work}: ${failure instanceof Error ? failure.message : String(failure)}`);
}
