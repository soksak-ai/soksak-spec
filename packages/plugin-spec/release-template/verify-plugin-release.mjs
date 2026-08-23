#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const option = (name) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const commit = option("--commit");
const output = path.resolve(option("--out") ?? "dist-release");
if (!/^[a-f0-9]{40}$/.test(commit ?? "")) throw new Error("--commit must be an exact Git commit");
let root = path.resolve(process.cwd());
while (!fs.existsSync(path.join(root, "release-files.json"))) { const parent = path.dirname(root); if (parent === root) throw new Error("plugin root not found"); root = parent; }
if (output === root || !output.startsWith(root + path.sep)) throw new Error("--out must be inside the plugin repository");
const run = (command, args, cwd = root) => { const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env }); if (result.error) throw result.error; if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`); };
const capture = (command, args, cwd = root) => { const result = spawnSync(command, args, { cwd, encoding: "utf8", env: process.env }); if (result.error) throw result.error; if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}${result.stderr}`); return result.stdout.trim(); };
const checker = path.join(root, "scripts/check-release-workflow.mjs");
if (fs.existsSync(checker)) run(process.execPath, [checker]);
run("pnpm", ["--dir", "frontend", "install", "--frozen-lockfile"]);
run("pnpm", ["--dir", "frontend", "typecheck"]);
run("pnpm", ["--dir", "frontend", "test"]);
run("pnpm", ["--dir", "frontend", "build"]);
run("git", ["diff", "--exit-code", "--", "main.js"]);
const template = path.dirname(fileURLToPath(import.meta.url));
const validator = path.resolve(template, "../bin/validate.mjs");
const first = fs.mkdtempSync(path.join(path.dirname(output), ".plugin-release-a-"));
const second = fs.mkdtempSync(path.join(path.dirname(output), ".plugin-release-b-"));
try {
  run(process.execPath, [path.join(template, "build-release.mjs"), "--commit", commit, "--out", first]);
  run(process.execPath, [path.join(template, "build-release.mjs"), "--commit", commit, "--out", second]);
  const files = (directory) => fs.readdirSync(directory).sort();
  const left = files(first); const right = files(second);
  if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error("release generation is not idempotent: file sets differ");
  for (const name of left) if (!fs.readFileSync(path.join(first, name)).equals(fs.readFileSync(path.join(second, name)))) throw new Error(`release generation is not idempotent: ${name} differs`);
  run(process.execPath, [validator, "release", path.join(first, "release.json")]);
  const evidence = left.filter((name) => /^conformance-.*[.]json$/.test(name)).map((name) => path.join(first, name));
  run(process.execPath, [validator, "conformance", ...evidence, "--release", path.join(first, "release.json"), "--plugin-manifest", path.join(root, "plugin.json")]);
  fs.rmSync(output, { recursive: true, force: true });
  fs.renameSync(first, output);
} finally {
  if (fs.existsSync(first)) fs.rmSync(first, { recursive: true, force: true });
  if (fs.existsSync(second)) fs.rmSync(second, { recursive: true, force: true });
}
if (capture("git", ["status", "--short", "--", "main.js"]) !== "") throw new Error("bundle drift remains after the owner gate");
