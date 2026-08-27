import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { parseComponentBuildReceipt } from "../src/componentBuildReceipt";

const receipt = {
  schema: "soksak-component-build-receipt-v1",
  subject: { kind: "plugin", id: "soksak-plugin-example", version: "1.2.3" },
  source: { repository: "https://github.com/soksak-ai/soksak-plugin-example", commit: "a".repeat(40) },
  manifest: { file: "plugin.json", size: 123, sha256: "b".repeat(64) },
  spec: { kind: "spec", id: "soksak-spec", version: "0.0.36", size: 1000, sha256: "c".repeat(64) },
  tooling: { kind: "kit", id: "soksak-component-tools", version: "0.0.1", size: 2000, sha256: "d".repeat(64) },
  command: "make verify",
  execution: { mode: "container", platform: "linux", architecture: "x64" },
  tools: { node: "26.7.0", pnpm: "11.22.0" },
  artifacts: [{ target: "any", sha256: "e".repeat(64) }],
};

describe("component build receipt schema", () => {
  it("accepts exactly the executable parser corpus", () => {
    const schema = JSON.parse(readFileSync(join(import.meta.dirname, "../schema/component-build-receipt.schema.json"), "utf8"));
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    expect(validate(receipt)).toBe(true);
    expect(() => parseComponentBuildReceipt(receipt)).not.toThrow();

    const withSDK = { ...receipt, sdk: { name: "@soksak/plugin-sdk", version: "1.0.0" } };
    expect(validate(withSDK)).toBe(false);
    expect(() => parseComponentBuildReceipt(withSDK)).toThrow(/unknown key/);
  });
});
