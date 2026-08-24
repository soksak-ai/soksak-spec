import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = join(import.meta.dirname, "..");
const cli = join(packageRoot, "bin/validate.mjs");
const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "soksak-build-dependency-cli-"));
  temporary.push(root);
  const target = "aarch64-apple-darwin";
  const relative = `targets/${target}/lib/libterminal-engine.a`;
  const bytes = Buffer.from("terminal engine");
  const dependencies = {
    schema: "soksak-build-dependencies-v1",
    dependencies: [{
      id: "terminal-engine-sdk",
      repository: "https://github.com/example/terminal-engine.git",
      commit: "a".repeat(40),
      tools: { zig: "1.2.3" },
      targets: { [target]: { outputs: [relative] } },
    }],
  };
  const receipt = {
    schema: "soksak-build-dependency-receipt-v1",
    dependency: "terminal-engine-sdk",
    target,
    repository: dependencies.dependencies[0].repository,
    commit: dependencies.dependencies[0].commit,
    tools: dependencies.dependencies[0].tools,
    outputs: [{ path: relative, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }],
  };
  const dependencyPath = join(root, "build-dependencies.json");
  const receiptPath = join(root, "receipt.json");
  const outputRoot = join(root, "output");
  mkdirSync(join(outputRoot, `targets/${target}/lib`), { recursive: true });
  writeFileSync(join(outputRoot, relative), bytes);
  writeFileSync(dependencyPath, `${JSON.stringify(dependencies)}\n`);
  writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
  return { root, target, relative, dependencyPath, receiptPath, outputRoot };
}

function run(args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

describe("build dependency CLI", () => {
  it("resolves a declared dependency for an explicit target", () => {
    const input = fixture();
    const result = run(["build-dependencies", input.dependencyPath, "--dependency", "terminal-engine-sdk", "--target", input.target]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      id: "terminal-engine-sdk",
      target: input.target,
      outputs: [input.relative],
    });
  });

  it("verifies a receipt against regular output bytes", () => {
    const input = fixture();
    const result = run([
      "build-receipt", input.receiptPath,
      "--dependencies", input.dependencyPath,
      "--output-root", input.outputRoot,
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("terminal-engine-sdk");
  });
});
