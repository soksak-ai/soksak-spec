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

function document() {
  return {
    schema: "soksak-build-dependencies-v1",
    dependencies: [{
      id: "terminal-engine-sdk",
      repository,
      commit,
      tools: { zig: "1.2.3" },
      targets: {
        [target]: { outputs: [outputPath] },
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
    outputs: [{ path: outputPath, size: output.length, sha256: outputSHA256 }],
  };
}

const inspection = () => ({ size: output.length, sha256: outputSHA256 });

describe("build dependency contract", () => {
  it("resolves the exact source, tools and target outputs declared by the owner", () => {
    const resolved = resolveBuildDependency(parseBuildDependencies(document()), "terminal-engine-sdk", target);
    expect(resolved).toEqual({
      id: "terminal-engine-sdk",
      repository,
      commit,
      tools: { zig: "1.2.3" },
      outputs: [outputPath],
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
    absolute.dependencies[0].targets[target].outputs = ["/tmp/libengine.a"];
    expect(() => parseBuildDependencies(absolute)).toThrow(/safe relative path/);

    const unscoped = document();
    unscoped.dependencies[0].targets[target].outputs = ["lib/libengine.a"];
    expect(() => parseBuildDependencies(unscoped)).toThrow(/target-namespaced output/);
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
        size: changedBytes.length,
        sha256: createHash("sha256").update(changedBytes).digest("hex"),
      }),
    })).toThrow(/output bytes differ/);
  });
});
