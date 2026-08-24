import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRegularFileArchive } from "../release-template/archive.mjs";
import { stageCargoCandidate } from "../release-template/cargo-candidate-stage.mjs";
import { assertNoLocalCargoDependencies } from "../release-template/cargo-dependencies.mjs";

const SOURCE = "https://github.com/soksak-ai/soksak-kit-sidecar-terminal";
let root = "";
let output = "";
let artifactRoot = "";
let artifact = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cargo-candidate-source-"));
  output = fs.mkdtempSync(path.join(os.tmpdir(), "cargo-candidate-stage-"));
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cargo-candidate-input-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "lib.rs"), "pub const VALUE: u8 = 1;\n");
  fs.writeFileSync(path.join(root, "Cargo.toml"), `[package]\nname = "consumer"\nversion = "0.0.1"\nedition = "2024"\npublish = false\n\n[dependencies]\nsoksak-kit-sidecar-terminal = { git = "${SOURCE}", rev = "${"a".repeat(40)}" }\n`);
  fs.writeFileSync(path.join(root, "Cargo.lock"), `version = 4\n\n[[package]]\nname = "consumer"\nversion = "0.0.1"\n\n[[package]]\nname = "soksak-kit-sidecar-terminal"\nversion = "0.0.7"\nsource = "git+${SOURCE}?rev=${"a".repeat(40)}#${"a".repeat(40)}"\n`);
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "candidate@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Candidate Test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });

  fs.mkdirSync(path.join(artifactRoot, "src"));
  fs.writeFileSync(path.join(artifactRoot, "src", "lib.rs"), "pub const VALUE: u8 = 2;\n");
  fs.writeFileSync(path.join(artifactRoot, "Cargo.toml"), '[package]\nname = "soksak-kit-sidecar-terminal"\nversion = "0.0.7"\nedition = "2024"\npublish = false\n');
  fs.writeFileSync(path.join(artifactRoot, "kit.json"), '{"id":"soksak-kit-sidecar-terminal","version":"0.0.7"}\n');
  artifact = path.join(artifactRoot, "candidate.tgz");
  fs.writeFileSync(artifact, createRegularFileArchive({ root: artifactRoot, files: ["Cargo.toml", "kit.json", "src/lib.rs"] }));
});

afterEach(() => {
  for (const directory of [root, output, artifactRoot]) fs.rmSync(directory, { recursive: true, force: true });
});

describe("Cargo candidate dependency staging", () => {
  it("uses a digest-verified archive only inside an isolated checkout", () => {
    const sha256 = createHash("sha256").update(fs.readFileSync(artifact)).digest("hex");
    const report = stageCargoCandidate({
      source: root, output,
      dependencies: [{ name: "soksak-kit-sidecar-terminal", source: SOURCE, artifact, sha256 }],
    });
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" })).toBe("");
    const config = fs.readFileSync(path.join(output, ".cargo", "config.toml"), "utf8");
    expect(config).toMatch(/path = "\.\.\/.candidate-inputs\/[0-9a-f]{64}"/);
    expect(report).toMatchObject({ sourceCommit: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(() => assertNoLocalCargoDependencies(output)).toThrow("local Cargo dependency is not a release input");
  });

  it("rejects a changed Cargo candidate artifact", () => {
    expect(() => stageCargoCandidate({
      source: root, output,
      dependencies: [{ name: "soksak-kit-sidecar-terminal", source: SOURCE, artifact, sha256: "0".repeat(64) }],
    })).toThrow("candidate dependency digest mismatch");
  });
});
