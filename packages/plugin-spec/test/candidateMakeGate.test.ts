import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("candidate owner command", () => {
  it("materializes staging metadata and delegates product verification to Make", () => {
    const source = readFileSync(join(import.meta.dirname, "../release-template/candidate-build.mjs"), "utf8");
    expect(source).toContain('run("pnpm", ["install", "--no-frozen-lockfile"]');
    const build = source.indexOf('run("make", ["build"], stage)');
    const verify = source.indexOf('run("make", ["verify"], stage)');
    expect(build).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(build);
    expect(source).toContain('run("make", ["verify"], stage)');
    for (const duplicate of ['["typecheck"]', '["exec", "vitest"']) expect(source).not.toContain(duplicate);
  });
});
