import { readFileSync, readdirSync } from "node:fs";
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
      "test/fixtures/platform-wire/registry.json",
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

  it("keeps location out of every payload: files are bare names, releases are id, version, size, sha256", () => {
    const keys = (value: unknown, out: string[] = []): string[] => {
      if (Array.isArray(value)) value.forEach((item) => keys(item, out));
      else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) { out.push(key); keys(item, out); }
      return out;
    };
    const directory = join(root, "test/fixtures/platform-wire");
    for (const name of readdirSync(directory).filter((file) => file.endsWith(".json"))) {
      const value = JSON.parse(read(`test/fixtures/platform-wire/${name}`));
      expect(keys(value), name).not.toContain("url");
    }
    const registry = JSON.parse(read("test/fixtures/platform-wire/registry.json"));
    for (const plugin of registry.plugins) expect(Object.keys(plugin).sort()).toEqual(["id", "sha256", "size", "version"]);
    for (const kind of ["plugin", "sidecar", "kit", "contract", "spec"]) {
      const release = JSON.parse(read(`test/fixtures/platform-wire/release-${kind}.json`));
      expect(release.manifest.file).toBe(`${kind}.json`);
      for (const entry of [release.manifest, ...release.artifacts, ...release.evidence]) expect(entry.file, `${kind} ${entry.file}`).toMatch(/^[A-Za-z0-9._-]+$/);
    }
  });

  it("keeps the registry focused on authenticated plugins", () => {
    const registry = JSON.parse(read("test/fixtures/platform-wire/registry.json"));
    expect(Object.keys(registry).sort()).toEqual(["expiresAt", "id", "issuedAt", "plugins", "sequence", "signature"]);
    expect(registry).not.toHaveProperty("profiles");
    expect(registry).not.toHaveProperty(["un", "its"].join(""));
  });

  it("does not publish a generic unit module", () => {
    const published = readdirSync(join(root, "dist"));
    expect(published.filter((name) => /(^|[-.])unit([-.]|$)/i.test(name))).toEqual([]);
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
