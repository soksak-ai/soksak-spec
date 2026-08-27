import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const cli = join(import.meta.dirname, "../bin/validate.mjs");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "soksak-component-receipt-cli-")); roots.push(root);
  const release = {
    kind: "plugin", id: "soksak-plugin-example", version: "1.2.3",
    source: { repository: "https://github.com/soksak-ai/soksak-plugin-example", commit: "a".repeat(40) },
    manifest: { file: "plugin.json", size: 123, sha256: "b".repeat(64) },
    artifacts: [{ target: "any", file: "soksak-plugin-example-1.2.3-any.tgz", size: 456, sha256: "c".repeat(64), format: "tgz", manifest: "plugin.json" }],
    evidence: [{ file: "conformance-release.json", size: 12, sha256: "d".repeat(64) }],
  };
  const receipt = {
    schema: "soksak-component-build-receipt-v1",
    subject: { kind: release.kind, id: release.id, version: release.version },
    source: release.source, manifest: release.manifest,
    spec: { kind: "spec", id: "soksak-spec", version: "0.0.36", size: 1000, sha256: "e".repeat(64) },
    tooling: { kind: "kit", id: "soksak-sdk", version: "0.0.2", size: 2000, sha256: "f".repeat(64) },
    command: "make verify",
    execution: { mode: "native", platform: "linux", architecture: "x64" },
    tools: { node: "26.7.0" }, artifacts: [{ target: "any", sha256: "c".repeat(64) }],
  };
  const releasePath = join(root, "release.json"); const receiptPath = join(root, "component-build-receipt.json");
  writeFileSync(releasePath, JSON.stringify(release)); writeFileSync(receiptPath, JSON.stringify(receipt));
  return { release, releasePath, receiptPath };
}

const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

describe("component build receipt CLI", () => {
  it("verifies the receipt against one exact release", () => {
    const value = fixture();
    const result = run(["component-build-receipt", value.receiptPath, "--release", value.releasePath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("soksak-plugin-example@1.2.3");
  });

  it("fails closed on changed release bytes and unknown options", () => {
    const value = fixture();
    value.release.artifacts[0].sha256 = "0".repeat(64); writeFileSync(value.releasePath, JSON.stringify(value.release));
    expect(run(["component-build-receipt", value.receiptPath, "--release", value.releasePath]).status).toBe(1);
    expect(run(["component-build-receipt", value.receiptPath, "--release", value.releasePath, "--skip", "true"]).status).toBe(2);
  });
});
