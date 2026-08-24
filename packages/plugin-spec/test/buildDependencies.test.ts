import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  parseBuildDependencies,
  resolveBuildDependency,
  verifyBuildDependencyReceipt,
} from "../src/buildDependencies";

const repository = "https://github.com/example/terminal-engine.git";
const commit = "a".repeat(40);
const output = Buffer.from("native library bytes");
const outputSHA256 = createHash("sha256").update(output).digest("hex");
const target = "aarch64-apple-darwin";
const outputPath = `targets/${target}/lib/libterminal-engine.a`;
const fileOutput = { path: outputPath, type: "file" as const };

function document() {
  return {
    schema: "soksak-build-dependencies-v1",
    dependencies: [{
      id: "terminal-engine-sdk",
      repository,
      commit,
      tools: { zig: "1.2.3" },
      targets: {
        [target]: { outputs: [fileOutput] },
      },
    }],
  };
}

function receipt() {
  return {
    schema: "soksak-build-dependency-receipt-v1",
    dependency: "terminal-engine-sdk",
    target,
    repository,
    commit,
    tools: { zig: "1.2.3" },
    outputs: [{ ...fileOutput, size: output.length, sha256: outputSHA256 }],
  };
}

const inspection = () => ({ type: "file" as const, size: output.length, sha256: outputSHA256 });

describe("build dependency contract", () => {
  it("resolves the exact source, tools and target outputs declared by the owner", () => {
    const resolved = resolveBuildDependency(parseBuildDependencies(document()), "terminal-engine-sdk", target);
    expect(resolved).toEqual({
      id: "terminal-engine-sdk",
      repository,
      commit,
      tools: { zig: "1.2.3" },
      outputs: [fileOutput],
    });
  });

  it("verifies receipt identity and observed output bytes", () => {
    expect(() => verifyBuildDependencyReceipt({
      dependencies: parseBuildDependencies(document()),
      receipt: receipt(),
      inspectOutput: (relative) => relative === outputPath ? inspection() : null,
    })).not.toThrow();
  });

  it("rejects unused kind and source compatibility wrappers", () => {
    const withKind = document();
    Object.assign(withKind.dependencies[0], { kind: "native-sdk" });
    expect(() => parseBuildDependencies(withKind)).toThrow(/unknown key/);

    const nested = document().dependencies[0];
    const { repository: _repository, commit: _commit, ...withoutAddress } = nested;
    expect(() => parseBuildDependencies({
      schema: "soksak-build-dependencies-v1",
      dependencies: [{ ...withoutAddress, source: { repository, commit } }],
    })).toThrow(/unknown key/);
  });

  it("rejects local source locators and unscoped outputs", () => {
    const local = document();
    local.dependencies[0].repository = "file:///local/engine";
    expect(() => parseBuildDependencies(local)).toThrow(/canonical HTTPS Git URL/);

    const absolute = document();
    absolute.dependencies[0].targets[target].outputs = [{ path: "/tmp/libengine.a", type: "file" }];
    expect(() => parseBuildDependencies(absolute)).toThrow(/safe relative path/);

    const unscoped = document();
    unscoped.dependencies[0].targets[target].outputs = [{ path: "lib/libengine.a", type: "file" }];
    expect(() => parseBuildDependencies(unscoped)).toThrow(/target-namespaced output/);

    const legacy = document();
    Object.assign(legacy.dependencies[0].targets[target], { outputs: [outputPath] });
    expect(() => parseBuildDependencies(legacy)).toThrow(/output must be an object/);
  });

  it("verifies a declared output tree as one canonical receipt entry", () => {
    const treePath = `targets/${target}/kitty-provider`;
    const treeDocument = document();
    Object.assign(treeDocument.dependencies[0].targets[target], { outputs: [{ path: treePath, type: "tree" }] });
    const treeReceipt = {
      ...receipt(),
      outputs: [{ path: treePath, type: "tree", files: 2, size: 456, sha256: "c".repeat(64) }],
    };
    expect(() => verifyBuildDependencyReceipt({
      dependencies: parseBuildDependencies(treeDocument),
      receipt: treeReceipt,
      inspectOutput: () => ({ type: "tree", files: 2, size: 456, sha256: "c".repeat(64) }),
    })).not.toThrow();
  });

  it("rejects receipt drift and changed output bytes", () => {
    const changedSource = receipt();
    changedSource.repository = "https://github.com/example/another-engine.git";
    expect(() => verifyBuildDependencyReceipt({
      dependencies: parseBuildDependencies(document()), receipt: changedSource, inspectOutput: inspection,
    })).toThrow(/source differs/);

    const changedBytes = Buffer.from("different");
    expect(() => verifyBuildDependencyReceipt({
      dependencies: parseBuildDependencies(document()), receipt: receipt(),
      inspectOutput: () => ({
        type: "file",
        size: changedBytes.length,
        sha256: createHash("sha256").update(changedBytes).digest("hex"),
      }),
    })).toThrow(/output bytes differ/);
  });
});
