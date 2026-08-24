import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stageNodeCandidate } from "../release-template/candidate-stage.mjs";
import { assertNoLocalPackageDependencies } from "../release-template/package-dependencies.mjs";

let root = "";
let output = "";
let artifact = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-source-"));
  output = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-stage-"));
  artifact = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "candidate-input-")), "dependency.tgz");
  fs.writeFileSync(artifact, "candidate bytes");
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({
    name: "@soksak/consumer", version: "0.0.1", private: true,
    devDependencies: { "@soksak/dependency": "https://example.invalid/dependency.tgz" },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "allowBuilds:\n  esbuild: true\n");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "candidate@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Candidate Test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
});

afterEach(() => {
  for (const directory of [root, output, path.dirname(artifact)]) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("candidate dependency staging", () => {
  it("projects verified archives into an isolated checkout without changing source", () => {
    const digest = createHash("sha256").update(fs.readFileSync(artifact)).digest("hex");
    const before = fs.readFileSync(path.join(root, "package.json"));
    const report = stageNodeCandidate({
      source: root, output, packagePath: "package.json",
      dependencies: [{ name: "@soksak/dependency", artifact, sha256: digest }],
    });

    expect(fs.readFileSync(path.join(root, "package.json"))).toEqual(before);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" })).toBe("");
    expect(fs.readFileSync(path.join(output, "package.json"))).toEqual(before);
    const workspace = fs.readFileSync(path.join(output, "pnpm-workspace.yaml"), "utf8");
    expect(workspace).toContain("overrides:");
    expect(workspace).toMatch(/'@soksak\/dependency': file:\.candidate-inputs\//);
    expect(report).toMatchObject({ sourceCommit: expect.stringMatching(/^[0-9a-f]{40}$/), packagePath: "package.json" });
    expect(() => assertNoLocalPackageDependencies(path.join(output, "package.json")))
      .toThrow("local dependency is not a release input");
  });

  it("rejects a changed candidate artifact", () => {
    expect(() => stageNodeCandidate({
      source: root, output, packagePath: "package.json",
      dependencies: [{ name: "@soksak/dependency", artifact, sha256: "0".repeat(64) }],
    })).toThrow("candidate dependency digest mismatch");
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" })).toBe("");
  });
});
