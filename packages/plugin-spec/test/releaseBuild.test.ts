// The canonical plugin release builder (release-template/build-release.mjs) is the single source every
// plugin runs to create its release. The fixture plugin declares only its file set; identity and
// version derive from plugin manifests, outputs are deterministic, and malformed plugins fail.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readRegularFileArchive } from "../release-template/archive.mjs";

const TEMPLATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../release-template");
const COMMIT = "a".repeat(40);
const FILES = ["LICENSE", "NOTICE", "README.ko.md", "README.md", "main.js", "plugin.json"];

let root = "";
let outDir = "";

function writeFixture(overrides: { pkg?: Record<string, unknown>; plugin?: Record<string, unknown>; frontendPackage?: boolean; releaseDependencies?: unknown[] } = {}): void {
  const pkg = {
    name: "soksak-plugin-example",
    version: "0.0.1",
    private: true,
    license: "Apache-2.0",
    type: "module",
    ...overrides.pkg,
  };
  const plugin = {
    id: "soksak-plugin-example",
    name: { en: "Example", ko: "예제" },
    version: "0.0.1",
    description: { en: "Example plugin", ko: "예제 플러그인" },
    entry: "main.js",
    permissions: ["data"],
    ...overrides.plugin,
  };
  fs.writeFileSync(path.join(root, "release-files.json"), `${JSON.stringify(FILES)}\n`);
  if (overrides.releaseDependencies) {
    fs.mkdirSync(path.join(root, "release"), { recursive: true });
    fs.writeFileSync(path.join(root, "release", "dependencies.json"), `${JSON.stringify(overrides.releaseDependencies, null, 2)}\n`);
  }
  const packagePath = overrides.frontendPackage ? path.join(root, "frontend", "package.json") : path.join(root, "package.json");
  fs.mkdirSync(path.dirname(packagePath), { recursive: true });
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "plugin.json"), `${JSON.stringify(plugin, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "main.js"), "export default { controller: {} };\n");
  fs.writeFileSync(path.join(root, "LICENSE"), "Apache-2.0\n");
  fs.writeFileSync(path.join(root, "NOTICE"), "soksak\n");
  fs.writeFileSync(path.join(root, "README.md"), "# example\n");
  fs.writeFileSync(path.join(root, "README.ko.md"), "# 예제\n");
}

function build(out = outDir): { status: number | null; stdout: string; stderr: string } {
  // Run from the fixture plugin root discovered by release-files.json.
  const r = spawnSync("node", [path.join(TEMPLATE, "build-release.mjs"), "--commit", COMMIT, "--out", out], {
    encoding: "utf8",
    cwd: root,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "relbuild-root-"));
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "relbuild-out-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outDir, { recursive: true, force: true });
});

describe("release-template/build-release.mjs — canonical plugin release", () => {
  it("derives plugin identity and emits the declared artifacts", () => {
    writeFixture();
    const r = build();
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.archive).toBe("soksak-plugin-example-0.0.1-any.tgz");

    const release = JSON.parse(fs.readFileSync(path.join(outDir, "release.json")).toString());
    expect(release).toMatchObject({
      plugin: { id: "soksak-plugin-example", version: "0.0.1" },
      source: { repository: "https://github.com/soksak-ai/soksak-plugin-example", commit: COMMIT },
    });
    expect(release.artifacts[0]).toMatchObject({ target: "any", format: "tgz", sha256: out.sha256 });

    const names = readRegularFileArchive(fs.readFileSync(path.join(outDir, out.archive))).map((e) => e.name);
    expect(names).toEqual(FILES);
    for (const report of ["conformance-release.json", "conformance-plugin.json"]) {
      expect(fs.existsSync(path.join(outDir, report))).toBe(true);
    }
  });

  it("emits one domain conformance report per implemented plugin contract", () => {
    writeFixture({ plugin: { implements: [{ id: "soksak-spec-plugin-terminal", version: "0.0.1" }] } });
    expect(build().status).toBe(0);
    const report = JSON.parse(fs.readFileSync(path.join(outDir, "conformance-contract-01.json"), "utf8"));
    expect(report.claim).toEqual({ contract: { id: "soksak-spec-plugin-terminal", version: "0.0.1" } });
    const release = JSON.parse(fs.readFileSync(path.join(outDir, "release.json"), "utf8"));
    expect(release.reports.map((item: { url: string }) => item.url)).toContain(
      "https://github.com/soksak-ai/soksak-plugin-example/releases/download/v0.0.1/conformance-contract-01.json",
    );
  });

  it("reads private build metadata from frontend/package.json", () => {
    writeFixture({ frontendPackage: true, pkg: { name: "@soksak/soksak-plugin-example", license: undefined } });
    expect(build().status).toBe(0);
  });

  it("records exact kit, contract, and spec build dependencies without selecting a sidecar", () => {
    writeFixture({ releaseDependencies: [
      { kit: { id: "soksak-kit-plugin-terminal", version: "0.0.1" }, scope: "build" },
      { contract: { id: "soksak-contract-plugin-terminal", version: "0.0.1" }, scope: "build" },
      { spec: { id: "soksak-spec", version: "0.0.1" }, scope: "build" },
    ] });
    expect(build().status).toBe(0);
    const release = JSON.parse(fs.readFileSync(path.join(outDir, "release.json"), "utf8"));
    expect(release.dependencies).toEqual([
      { contract: { id: "soksak-contract-plugin-terminal", version: "0.0.1" }, scope: "build" },
      { kit: { id: "soksak-kit-plugin-terminal", version: "0.0.1" }, scope: "build" },
      { spec: { id: "soksak-spec", version: "0.0.1" }, scope: "build" },
    ]);
    expect(release.dependencies).not.toEqual(expect.arrayContaining([expect.objectContaining({ sidecar: expect.anything() })]));
  });

  it("is deterministic — same inputs produce the same archive sha256", () => {
    writeFixture();
    const a = JSON.parse(build().stdout);
    const out2 = fs.mkdtempSync(path.join(os.tmpdir(), "relbuild-out2-"));
    const b = JSON.parse(build(out2).stdout);
    fs.rmSync(out2, { recursive: true, force: true });
    expect(a.sha256).toBe(b.sha256);
  });

  it("does not pin which contracts a plugin relates to", () => {
    writeFixture({ plugin: { consumes: [{ id: "soksak-spec-plugin-git", range: "0.0.1" }] } });
    expect(build().status).toBe(0);
  });

  it("refuses a malformed consumes entry (shape is validated)", () => {
    writeFixture({ plugin: { consumes: [{ id: "soksak-spec-plugin-git" }] } });
    const r = build();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/consumes\[0\]\.range/);
  });

  it("refuses a non-private plugin package", () => {
    writeFixture({ pkg: { private: false } });
    const r = build();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/must be private/);
  });

  it("refuses an obsolete schema discriminator", () => {
    writeFixture({ plugin: { schema: "soksak-spec-plugin@0.0.1" } });
    const r = build();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/plugin manifest is invalid/);
  });

  it("refuses a non-SHA commit", () => {
    writeFixture();
    const r = spawnSync("node", [path.join(TEMPLATE, "build-release.mjs"), "--commit", "v0.0.1", "--out", outDir], {
      encoding: "utf8",
      cwd: root,
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/40-character Git commit/);
  });
});
