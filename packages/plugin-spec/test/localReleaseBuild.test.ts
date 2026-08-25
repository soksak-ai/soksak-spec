import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildLocalRelease } from "../release-template/local-release-build.mjs";
import { inspectLocalRelease } from "../release-template/local-release-store.mjs";

let root = ""; let source = ""; let store = "";
function run(command: string, args: string[], cwd: string) { const result = spawnSync(command, args, { cwd, encoding: "utf8" }); if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`); return result.stdout.trim(); }
function write(name: string, body: string) { const target = path.join(source, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, body); }

beforeEach(() => {
  root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "local-build-test-")); source = path.join(root, "source"); store = path.join(root, "store"); fs.mkdirSync(source);
  write("Makefile", "verify:\n\t@test -f plugin.json\n");
  write("package.json", JSON.stringify({ name: "soksak-plugin-example", version: "0.0.1", private: true, type: "module" }));
  write("plugin.json", JSON.stringify({ id: "soksak-plugin-example", name: "Example", version: "0.0.1", appVersionRequirement: "0.0.1", description: "Example", entry: "main.js", permissions: [] }));
  write("main.js", "export function activate() {}\n"); write("LICENSE", "MIT\n"); write("NOTICE", "Example\n"); write("README.md", "# Example\n"); write("README.ko.md", "# 예제\n");
  write("release-files.json", JSON.stringify(["LICENSE", "NOTICE", "README.ko.md", "README.md", "main.js", "plugin.json"]));
  run("git", ["init", "-q"], source); run("git", ["add", "."], source); run("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"], source);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("local release owner build", () => {
  it("builds a clean exact Plugin commit and publishes its canonical release", () => {
    const result = buildLocalRelease({ store, source });
    expect(result).toMatchObject({ state: "published", kind: "plugin", id: "soksak-plugin-example", version: "0.0.1" });
    expect(inspectLocalRelease({ store, kind: "plugin", id: "soksak-plugin-example", version: "0.0.1" }).assets.map(({ name }) => name)).toContain("release.json");
    expect(buildLocalRelease({ store, source })).toMatchObject({ state: "unchanged" });
  });

  it("rejects a dirty owner source instead of hiding changes in a clone", () => {
    fs.appendFileSync(path.join(source, "main.js"), "changed\n");
    expect(() => buildLocalRelease({ store, source })).toThrow(/owner source must be clean/);
  });
});
