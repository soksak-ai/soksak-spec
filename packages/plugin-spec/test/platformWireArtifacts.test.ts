import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { parseConformanceReport } from "../src/conformanceWire.js";
import { parseRegistry, parseRegistryPublicKey } from "../src/registry.js";
import { parseReleaseManifest } from "../src/release.js";

const PACKAGE_ROOT = join(import.meta.dirname, "..");
const FIXTURES = join(PACKAGE_ROOT, "test/fixtures/platform-wire");
const SCHEMAS = join(PACKAGE_ROOT, "schema");

function json(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("portable platform wire artifacts", () => {
  it("publishes strict draft-2020-12 schemas for every public JSON boundary", () => {
    const release = json(join(SCHEMAS, "release.schema.json"));
    const conformance = json(join(SCHEMAS, "conformance-report.schema.json"));
    const registry = json(join(SCHEMAS, "registry-index.schema.json"));
    const registryPublicKey = json(join(SCHEMAS, "registry-public-key.schema.json"));

    for (const schema of [release, conformance, registry, registryPublicKey]) {
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schema.additionalProperties).toBe(false);
    }
    expect(release.properties).not.toHaveProperty("schema");
    expect(conformance.properties).not.toHaveProperty("schema");
    expect(registry.properties).not.toHaveProperty("schema");
    expect(registryPublicKey.properties.algorithm.const).toBe("ed25519");
    expect(release.$id).toBe("urn:soksak:spec:release:0.0.1");
    expect(conformance.$id).toBe("urn:soksak:spec:conformance:0.0.1");
    expect(registry.$id).toBe("urn:soksak:spec:registry:0.0.1");
    expect(registryPublicKey.$id).toBe("urn:soksak:spec:registry-public-key:0.0.1");

    expect(release.required).toContain("evidence");
    expect(release.$defs.reference.properties.version.$ref).toContain("version");
    expect(release.$defs.reference.required).toEqual(["id", "version", "size", "sha256"]);
    expect(release.$defs.integrity.required).toEqual(["file", "size", "sha256"]);
    expect(release.$defs.artifact.required).toEqual(["file", "size", "sha256", "target", "format", "manifest"]);
    for (const name of ["reference", "integrity", "artifact"]) expect(release.$defs[name].properties, name).not.toHaveProperty("url");
    expect(release.$defs.integrity.properties.file.pattern).toBe(release.$defs.artifact.properties.file.pattern);
    expect(registry.properties.plugins.items.$ref).toContain("reference");
    expect(registry.properties).not.toHaveProperty("sidecars");
    expect(registry.properties).not.toHaveProperty(["un", "its"].join(""));
  });

  it("keeps the checked-in language-neutral corpus accepted by the executable parsers", () => {
    for (const kind of ["contract", "kit", "plugin", "sidecar", "spec"]) {
      expect(parseReleaseManifest(json(join(FIXTURES, `release-${kind}.json`))).ok, kind).toBe(true);
    }
    for (const name of [
      "conformance-kit-kind.json",
      "conformance-kit-release.json",
      "conformance-plugin-kind.json",
      "conformance-plugin-release.json",
      "conformance-sidecar-interface.json",
      "conformance-sidecar-kind.json",
      "conformance-sidecar-release.json",
    ]) {
      expect(parseConformanceReport(json(join(FIXTURES, name))).ok, name).toBe(true);
    }
    expect(parseRegistry(json(join(FIXTURES, "registry.json"))).ok).toBe(true);
    expect(parseRegistryPublicKey(json(join(FIXTURES, "registry-public-key.json"))).ok).toBe(true);
  });

  it("compiles every schema and accepts the same valid cross-language corpus", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const releaseSchema = json(join(SCHEMAS, "release.schema.json"));
    ajv.addSchema(releaseSchema);
    const validators = {
      release: ajv.getSchema(releaseSchema.$id)!,
      conformance: ajv.compile(json(join(SCHEMAS, "conformance-report.schema.json"))),
      registry: ajv.compile(json(join(SCHEMAS, "registry-index.schema.json"))),
      publicKey: ajv.compile(json(join(SCHEMAS, "registry-public-key.schema.json"))),
    };

    for (const kind of ["contract", "kit", "plugin", "sidecar", "spec"]) {
      const valid = validators.release(json(join(FIXTURES, `release-${kind}.json`)));
      expect(valid, JSON.stringify(validators.release.errors)).toBe(true);
    }
    for (const name of [
      "conformance-kit-kind.json",
      "conformance-kit-release.json",
      "conformance-plugin-kind.json",
      "conformance-plugin-release.json",
      "conformance-sidecar-interface.json",
      "conformance-sidecar-kind.json",
      "conformance-sidecar-release.json",
    ]) {
      const valid = validators.conformance(json(join(FIXTURES, name)));
      expect(valid, `${name}: ${JSON.stringify(validators.conformance.errors)}`).toBe(true);
    }
    expect(
      validators.registry(json(join(FIXTURES, "registry.json")),),
      JSON.stringify(validators.registry.errors),
    ).toBe(true);
    expect(
      validators.publicKey(json(join(FIXTURES, "registry-public-key.json"))),
      JSON.stringify(validators.publicKey.errors),
    ).toBe(true);
  });

  it("rejects generic identities and wrong kind-specific manifests", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validate = ajv.compile(json(join(SCHEMAS, "release.schema.json")));
    const generic = json(join(FIXTURES, "release-plugin.json"));
    generic.plugin = { id: generic.id, version: generic.version };
    expect(validate(generic)).toBe(false);
    const wrongManifest = json(join(FIXTURES, "release-plugin.json"));
    wrongManifest.artifacts[0].manifest = "sidecar.json";
    expect(validate(wrongManifest)).toBe(false);
    for (const file of ["", ".", "..", "sub/plugin.json", "../plugin.json", "https://github.com/example/weather-plugin/releases/download/v0.0.1/weather-plugin-0.0.1.tgz"]) {
      const located = json(join(FIXTURES, "release-plugin.json"));
      located.artifacts[0].file = file;
      expect(validate(located), file).toBe(false);
    }
    const withUrl = json(join(FIXTURES, "release-plugin.json"));
    withUrl.evidence[0].url = "https://github.com/example/weather-plugin/releases/download/v0.0.1/plugin-kind.conformance.json";
    expect(validate(withUrl)).toBe(false);
  });
});
