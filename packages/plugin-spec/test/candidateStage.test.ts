import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildNodeCandidate, finalizeNodeCandidate, stageNodeCandidate } from "../release-template/candidate-stage.mjs";
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
    name: "@soksak/soksak-kit-example", version: "0.0.1", private: true,
    repository: { type: "git", url: "git+https://github.com/soksak-ai/soksak-kit-example.git" },
    exports: { ".": { types: "./src/index.ts", default: "./dist/index.js" } },
    devDependencies: { "@soksak/dependency": "https://example.invalid/dependency.tgz" },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "allowBuilds:\n  esbuild: true\n");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "index.ts"), "export const value = 1;\n");
  fs.writeFileSync(path.join(root, "kit.json"), '{"id":"soksak-kit-example","version":"0.0.1"}\n');
  fs.writeFileSync(path.join(root, "LICENSE"), "MIT\n");
  fs.writeFileSync(path.join(root, "release-files.json"), `${JSON.stringify([
    "LICENSE", "dist/index.js", "kit.json", "package.json", "pnpm-lock.yaml", "src/index.ts",
  ])}\n`);
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

  it("restores canonical metadata and keeps only declared generated output", () => {
    const digest = createHash("sha256").update(fs.readFileSync(artifact)).digest("hex");
    stageNodeCandidate({
      source: root, output, packagePath: "package.json",
      dependencies: [{ name: "@soksak/dependency", artifact, sha256: digest }],
    });
    fs.writeFileSync(path.join(output, "pnpm-lock.yaml"), "candidate lock\n");
    fs.mkdirSync(path.join(output, "dist"));
    fs.writeFileSync(path.join(output, "dist", "index.js"), "export const value = 2;\n");

    const report = finalizeNodeCandidate({ output, generated: ["dist"] });
    for (const name of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
      expect(fs.readFileSync(path.join(output, name))).toEqual(fs.readFileSync(path.join(root, name)));
    }
    expect(fs.readFileSync(path.join(output, "dist", "index.js"), "utf8")).toContain("value = 2");
    expect(fs.existsSync(path.join(output, ".candidate-inputs"))).toBe(false);
    expect(fs.existsSync(path.join(output, ".candidate-stage.json"))).toBe(false);
    expect(report).toMatchObject({ generated: ["dist"] });
    expect(() => assertNoLocalPackageDependencies(path.join(output, "package.json"))).not.toThrow();
  });

  it("refuses source drift outside declared generated output", () => {
    const digest = createHash("sha256").update(fs.readFileSync(artifact)).digest("hex");
    stageNodeCandidate({
      source: root, output, packagePath: "package.json",
      dependencies: [{ name: "@soksak/dependency", artifact, sha256: digest }],
    });
    fs.writeFileSync(path.join(output, "src", "index.ts"), "export const value = 99;\n");
    expect(() => finalizeNodeCandidate({ output, generated: ["dist"] })).toThrow("candidate build changed undeclared source");
  });

  it("builds and verifies a candidate archive only after metadata restoration", () => {
    const digest = createHash("sha256").update(fs.readFileSync(artifact)).digest("hex");
    stageNodeCandidate({
      source: root, output, packagePath: "package.json",
      dependencies: [{ name: "@soksak/dependency", artifact, sha256: digest }],
    });
    const candidateOut = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-out-"));
    try {
      const result = buildNodeCandidate({
        stage: output, output: candidateOut, kind: "portable", generated: ["dist"],
        runChecks: ({ packageDirectory }: { packageDirectory: string }) => {
          fs.writeFileSync(path.join(packageDirectory, "pnpm-lock.yaml"), "candidate lock\n");
          fs.mkdirSync(path.join(packageDirectory, "dist"));
          fs.writeFileSync(path.join(packageDirectory, "dist", "index.js"), "export const value = 2;\n");
        },
      });
      expect(result).toMatchObject({ sourceCommit: expect.stringMatching(/^[0-9a-f]{40}$/), kind: "portable" });
      expect(fs.existsSync(path.join(candidateOut, "soksak-kit-example-0.0.1-any.tgz"))).toBe(true);
      expect(fs.existsSync(path.join(candidateOut, "candidate-build.json"))).toBe(true);
      expect(fs.readFileSync(path.join(candidateOut, "candidate-build.json"), "utf8")).not.toContain("file:");
    } finally {
      fs.rmSync(candidateOut, { recursive: true, force: true });
    }
  });
});
