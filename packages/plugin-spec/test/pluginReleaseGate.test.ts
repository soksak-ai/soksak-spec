import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
describe("plugin owner release gate", () => {
  it("runs the full owner proof and compares two release generations", () => {
    const source = readFileSync(join(import.meta.dirname, "../release-template/verify-plugin-release.mjs"), "utf8");
    for (const required of ["make", "verify", "build-release.mjs", "release generation is not idempotent", "conformance", "publishVerifiedCandidate"]) expect(source).toContain(required);
    for (const duplicate of ["--frozen-lockfile", "typecheck", '["test"]', '["build"]']) expect(source).not.toContain(duplicate);
    expect(source).not.toContain("fs.rmSync(output");
  });
  it("passes --registry to the owner Makefile as a command-line REGISTRY", () => {
    const source = readFileSync(join(import.meta.dirname, "../release-template/verify-plugin-release.mjs"), "utf8");
    expect(source).toContain('option("--registry")');
    expect(source).toContain('`REGISTRY=${registry}`');
    expect(source).not.toContain('run("make", ["verify"])');
  });
});
