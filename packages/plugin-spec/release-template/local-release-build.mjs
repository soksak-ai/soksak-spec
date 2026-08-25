import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { publishLocalRelease } from "./local-release-store.mjs";
import { stageNodeCandidate } from "./candidate-stage.mjs";
import { buildNodeCandidate } from "./candidate-build.mjs";
import { packSidecarTarget } from "./sidecar/pack-target.mjs";
import { stageSidecarCandidatePackage } from "./sidecar/candidate.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function run(command, args, cwd) { const result = spawnSync(command, args, { cwd, encoding: "utf8", env: process.env }); if (result.error) throw result.error; if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}${result.stderr}`); return result.stdout.trim(); }
function read(pathname) { const info = fs.lstatSync(pathname); if (info.isSymbolicLink() || !info.isFile()) throw new Error(`regular file required: ${pathname}`); return fs.readFileSync(pathname); }
function writeJSON(directory, name, value) { fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" }); }

function kindOf(root) {
  const values = [["plugin", "plugin.json"], ["sidecar", "sidecar.json"], ["kit", "kit.json"], ["contract", "contract.json"], ["spec", "spec.json"]].filter(([, name]) => fs.existsSync(path.join(root, name)));
  if (values.length === 0 && fs.existsSync(path.join(root, "package.json"))) {
    const owner = JSON.parse(read(path.join(root, "package.json"))).soksakRelease;
    if (owner?.spec?.id === "soksak-spec" && owner.manifest === "release.json") values.push(["spec", "package.json"]);
  }
  if (values.length !== 1) throw new Error("owner repository must contain exactly one component manifest");
  return values[0][0];
}

function assembleSidecar(root, commit, targets, work, template) {
  if (targets.length === 0 || new Set(targets).size !== targets.length) throw new Error("Sidecar build requires unique --target values");
  const manifest = JSON.parse(read(path.join(root, "sidecar.json")));
  const output = path.join(work, "release"); fs.mkdirSync(output);
  const artifacts = [];
  for (const target of [...targets].sort()) {
    const stage = path.join(work, `stage-${target}`); const packaged = path.join(work, `package-${target}`);
    fs.mkdirSync(stage); fs.mkdirSync(packaged);
    run("make", ["verify", `TARGET=${target}`], root);
    run("make", ["stage", `TARGET=${target}`, `OUT=${stage}`], root);
    stageSidecarCandidatePackage({ source: root, stage, target, output: packaged });
    const name = `${manifest.id}-${manifest.version}-${target}.tar.gz`;
    const packed = packSidecarTarget({ source: packaged, target, out: path.join(output, name) });
    artifacts.push({ target, url: `https://github.com/soksak-ai/${manifest.id}/releases/download/v${manifest.version}/${name}`, size: packed.size, sha256: packed.sha256, format: "tar.gz", manifest: "sidecar.json" });
    fs.rmSync(path.join(output, `${name}.sha256`));
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`); fs.writeFileSync(path.join(output, "sidecar.json"), manifestBytes);
  const report = (claim) => ({ subject: { sidecar: { id: manifest.id, version: manifest.version } }, claim, result: "passed", validator: { name: "soksak-validate", version: manifest.version }, artifacts: artifacts.map(({ target, sha256 }) => ({ target, sha256 })) });
  const evidence = [["conformance-interface.json", report({ contract: manifest.interface })], ["conformance-release.json", report({ release: true })], ["conformance-sidecar.json", report({ manifest: true })]].map(([name, value]) => { const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`); fs.writeFileSync(path.join(output, name), bytes); return { url: `https://github.com/soksak-ai/${manifest.id}/releases/download/v${manifest.version}/${name}`, size: bytes.length, sha256: sha256(bytes) }; });
  writeJSON(output, "release.json", { kind: "sidecar", id: manifest.id, version: manifest.version, manifest: { url: `https://github.com/soksak-ai/${manifest.id}/releases/download/v${manifest.version}/sidecar.json`, size: manifestBytes.length, sha256: sha256(manifestBytes) }, source: { repository: `https://github.com/soksak-ai/${manifest.id}`, commit }, artifacts, evidence });
  return output;
}

export function buildLocalRelease({ store, source, targets = [], plan, generated = [], template = path.dirname(fileURLToPath(import.meta.url)) }) {
  if (!path.isAbsolute(store) || !path.isAbsolute(source)) throw new Error("store and source must be absolute");
  const sourceRoot = fs.realpathSync(source);
  if (run("git", ["status", "--porcelain"], sourceRoot) !== "") throw new Error("owner source must be clean");
  const commit = run("git", ["rev-parse", "HEAD"], sourceRoot);
  const work = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "soksak-local-build-"));
  const checkout = path.join(work, "source");
  try {
    run("git", ["clone", "--quiet", "--no-local", sourceRoot, checkout], work);
    if (run("git", ["rev-parse", "HEAD"], checkout) !== commit) throw new Error("local build clone commit mismatch");
    const kind = kindOf(checkout); let release; let buildReceipt;
    if (plan !== undefined) {
      if (kind === "sidecar" || kind === "spec") throw new Error("candidate dependency plans belong only to Plugin, Kit, or Contract builds");
      if (!path.isAbsolute(plan)) throw new Error("candidate plan path must be absolute");
      const declaration = JSON.parse(read(plan));
      const stage = path.join(work, "candidate-stage"); release = path.join(work, "release"); fs.mkdirSync(stage); fs.mkdirSync(release);
      stageNodeCandidate({ source: checkout, output: stage, packagePath: declaration.packagePath, dependencies: declaration.dependencies });
      buildReceipt = buildNodeCandidate({ stage, output: release, kind: kind === "plugin" ? "plugin" : "portable", generated });
      fs.rmSync(path.join(release, "candidate-build.json"));
    }
    else if (kind === "plugin") { release = path.join(work, "release"); run("make", ["verify"], checkout); run(process.execPath, [path.join(template, "build-release.mjs"), "--commit", commit, "--out", release], checkout); }
    else if (kind === "kit" || kind === "contract") { release = path.join(work, "release"); run("make", ["verify"], checkout); fs.mkdirSync(release); run(process.execPath, [path.join(template, "build-portable-release.mjs"), "--commit", commit, "--out", release], checkout); }
    else if (kind === "spec") { run("make", ["verify"], checkout); release = path.join(checkout, "artifacts"); }
    else release = assembleSidecar(checkout, commit, targets, work, template);
    return { ...publishLocalRelease({ store, release }), ...(buildReceipt ? { buildReceipt } : {}) };
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}
