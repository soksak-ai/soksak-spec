import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  parseBuildDependencies,
  resolveBuildDependency,
  verifySDKReceipt,
} from "../src/buildDependencies";

const sourceRepository = "https://github.com/example/terminal-engine.git";
const sourceCommit = "a".repeat(40);
const toolURL = "https://downloads.example.test/tool-1.2.3.tar.xz";
const toolSHA256 = "b".repeat(64);
const output = Buffer.from("native library bytes");
const outputSHA256 = createHash("sha256").update(output).digest("hex");

function document() {
  return {
    schema: "soksak-build-dependencies-v1",
    dependencies: [{
      id: "terminal-engine-sdk",
      source: { repository: sourceRepository, commit: sourceCommit },
      toolchain: {
        id: "example-tool",
        version: "1.2.3",
        archives: {
          "darwin-arm64": { url: toolURL, sha256: toolSHA256 },
        },
      },
      materializer: "scripts/materialize-terminal-engine-sdk.sh",
      targets: {
        "aarch64-apple-darwin": { outputs: ["targets/aarch64-apple-darwin/lib/libterminal-engine.a"] },
      },
    }],
  };
}

function receipt() {
  return {
    schema: "soksak-sdk-receipt-v1",
    dependency: "terminal-engine-sdk",
    target: "aarch64-apple-darwin",
    source: { repository: sourceRepository, commit: sourceCommit },
    toolchain: { id: "example-tool", version: "1.2.3", archiveSHA256: toolSHA256 },
    materializer: "scripts/materialize-terminal-engine-sdk.sh",
    outputs: [{ path: "targets/aarch64-apple-darwin/lib/libterminal-engine.a", size: output.length, sha256: outputSHA256 }],
  };
}

describe("build dependency contract", () => {
  it("resolves the exact address declared by the dependency manifest", () => {
    const parsed = parseBuildDependencies(document());
    const resolved = resolveBuildDependency(parsed, "terminal-engine-sdk", "aarch64-apple-darwin", "darwin-arm64");
    expect(resolved.source).toEqual({ repository: sourceRepository, commit: sourceCommit });
    expect(resolved.toolArchive).toEqual({ url: toolURL, sha256: toolSHA256 });
    expect(resolved.materializer).toBe("scripts/materialize-terminal-engine-sdk.sh");
    expect(resolved.outputs).toEqual(["targets/aarch64-apple-darwin/lib/libterminal-engine.a"]);
  });

  it("verifies receipt identity and actual output bytes", () => {
    const dependency = parseBuildDependencies(document());
    expect(() => verifySDKReceipt({
      dependencies: dependency,
      receipt: receipt(),
      readOutput: (relative) => relative === "targets/aarch64-apple-darwin/lib/libterminal-engine.a" ? output : null,
    })).not.toThrow();
  });

  it("rejects a receipt that changes the declared source address", () => {
    const changed = receipt();
    changed.source.repository = "https://github.com/example/another-engine.git";
    expect(() => verifySDKReceipt({
      dependencies: parseBuildDependencies(document()), receipt: changed, readOutput: () => output,
    })).toThrow(/source differs from build dependency/);
  });

  it("rejects local locators, absolute outputs and undeclared receipt output", () => {
    const local = document();
    local.dependencies[0].source.repository = "file:///local/engine";
    expect(() => parseBuildDependencies(local)).toThrow(/canonical source repository/);
    const absolute = document();
    absolute.dependencies[0].targets["aarch64-apple-darwin"].outputs = ["/tmp/libengine.a"];
    expect(() => parseBuildDependencies(absolute)).toThrow(/safe relative output/);
    const unscoped = document();
    unscoped.dependencies[0].targets["aarch64-apple-darwin"].outputs = ["lib/libengine.a"];
    expect(() => parseBuildDependencies(unscoped)).toThrow(/target-namespaced output/);
    const extra = receipt();
    extra.outputs.push({ path: "targets/aarch64-apple-darwin/lib/extra.a", size: output.length, sha256: outputSHA256 });
    expect(() => verifySDKReceipt({
      dependencies: parseBuildDependencies(document()), receipt: extra, readOutput: () => output,
    })).toThrow(/output set differs from build dependency/);
  });

  it("rejects changed output bytes without accepting the receipt digest", () => {
    expect(() => verifySDKReceipt({
      dependencies: parseBuildDependencies(document()), receipt: receipt(),
      readOutput: () => Buffer.from("different"),
    })).toThrow(/output bytes differ from receipt/);
  });
});
