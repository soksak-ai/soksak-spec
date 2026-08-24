import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { parseBuildDependencies, parseBuildDependencyReceipt } from "../src/buildDependencies";

const root = join(import.meta.dirname, "..");
const target = "aarch64-apple-darwin";
const output = `targets/${target}/lib/libterminal-engine.a`;
const dependency = {
  schema: "soksak-build-dependencies-v1",
  dependencies: [{
    id: "terminal-engine-sdk",
    repository: "https://github.com/example/terminal-engine.git",
    commit: "a".repeat(40),
    tools: { zig: "1.2.3" },
    targets: { [target]: { outputs: [output] } },
  }],
};
const receipt = {
  schema: "soksak-build-dependency-receipt-v1",
  dependency: "terminal-engine-sdk",
  target,
  repository: "https://github.com/example/terminal-engine.git",
  commit: "a".repeat(40),
  tools: { zig: "1.2.3" },
  outputs: [{ path: output, size: 123, sha256: "b".repeat(64) }],
};

const json = (name: string) => JSON.parse(readFileSync(join(root, "schema", name), "utf8"));

describe("build dependency JSON schemas", () => {
  it("publishes strict schemas that accept the executable parser corpus", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const dependencySchema = json("build-dependencies.schema.json");
    const receiptSchema = json("build-dependency-receipt.schema.json");
    for (const schema of [dependencySchema, receiptSchema]) {
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schema.additionalProperties).toBe(false);
    }
    expect(ajv.compile(dependencySchema)(dependency)).toBe(true);
    expect(ajv.compile(receiptSchema)(receipt)).toBe(true);
    expect(() => parseBuildDependencies(dependency)).not.toThrow();
    expect(() => parseBuildDependencyReceipt(receipt)).not.toThrow();
  });

  it("rejects compatibility wrappers at both schema and parser boundaries", () => {
    const invalid = structuredClone(dependency);
    Object.assign(invalid.dependencies[0], { kind: "native-sdk" });
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(json("build-dependencies.schema.json"));
    expect(validate(invalid)).toBe(false);
    expect(() => parseBuildDependencies(invalid)).toThrow(/unknown key/);
  });
});
