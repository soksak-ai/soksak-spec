import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("schema metadata and payload identity", () => {
  it("documents the ownership rule", () => {
    const document = read("docs/SCHEMA-AND-IDENTITY.md");
    for (const phrase of ["$schema", "payloads do not repeat", "protocol", "serialization formats", "generic `unit`"]) {
      expect(document.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });

  it("keeps schema identifiers out of release, registry, conformance, plugin, and sidecar payloads", () => {
    const files = [
      "test/fixtures/platform-wire/release-plugin.json",
      "test/fixtures/platform-wire/release-sidecar.json",
      "test/fixtures/platform-wire/release-kit.json",
      "test/fixtures/platform-wire/release-contract.json",
      "test/fixtures/platform-wire/release-spec.json",
      "test/fixtures/platform-wire/registry-signed.json",
      "test/fixtures/platform-wire/conformance-plugin-release.json",
      "test/fixtures/platform-wire/plugin.json",
      "test/fixtures/platform-wire/sidecar.json",
    ];
    for (const file of files) {
      const value = JSON.parse(read(file));
      expect(value).not.toHaveProperty("schema");
      expect(value).not.toHaveProperty("format", expect.stringMatching(/^soksak-spec-/));
      if (!file.includes("release-")) expect(typeof value.spec).not.toBe("string");
    }
  });

  it("requires all five direct registry arrays", () => {
    const registry = JSON.parse(read("test/fixtures/platform-wire/registry-signed.json"));
    expect(Object.keys(registry).sort()).toEqual(expect.arrayContaining([
      "plugins", "sidecars", "kits", "contracts", "specs", "profiles",
    ]));
    expect(registry).not.toHaveProperty(["un", "its"].join(""));
  });

  it("uses protocol only for runtime frames", async () => {
    const runtime = await import("../src/pluginRuntime.js");
    const request = {
      protocol: runtime.PLUGIN_RUNTIME_PROTOCOL, kind: "signal", seq: 1,
      requestId: "request.runtime.1", method: "runtime.teardown", params: { reason: "test" },
    };
    expect(runtime.parsePluginRuntimeEnvelope(request).ok).toBe(true);
    expect(runtime.parsePluginRuntimeEnvelope({ ...request, spec: runtime.PLUGIN_RUNTIME_PROTOCOL }).ok).toBe(false);
  });
});
