// The canonical plugin release builder (release-template/build-release.mjs) is the single source every
// plugin runs to create its release. The fixture plugin declares only its file set; identity and
// version derive from plugin manifests, outputs are deterministic, and malformed plugins fail.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readRegularFileArchive } from "../release-template/archive.mjs";
import { releaseDirectory } from "../release-template/resolve-release.mjs";
import { GITHUB_ORG } from "../src/release-primitives.js";

const TEMPLATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../release-template");
const COMMIT = "a".repeat(40);
const FILES = ["LICENSE", "NOTICE", "README.ko.md", "README.md", "main.js", "plugin.json"];
const SIDECAR_ID = "soksak-sidecar-example";
const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

let root = "";
let outDir = "";
let store = "";

// A local store holding one sidecar release; the dependency composer reads its release.json bytes.
function writeStoreSidecar(version = "0.0.1"): Buffer {
  const directory = releaseDirectory(store, "sidecar", SIDECAR_ID, version);
  fs.mkdirSync(directory, { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify({
    kind: "sidecar", id: SIDECAR_ID, version,
    manifest: { file: "sidecar.json", size: 1, sha256: "b".repeat(64) },
    source: { repository: `https://github.com/${GITHUB_ORG}/${SIDECAR_ID}`, commit: "c".repeat(40) },
    artifacts: [{ target: "aarch64-apple-darwin", file: `${SIDECAR_ID}-${version}-aarch64-apple-darwin.tar.gz`, size: 2, sha256: "d".repeat(64), format: "tar.gz", manifest: "sidecar.json" }],
    evidence: [{ file: "conformance-release.json", size: 3, sha256: "e".repeat(64) }],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(directory, "release.json"), bytes);
  return bytes;
}

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
    appVersionRequirement: "0.0.1",
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

function build(out = outDir, extra: string[] = []): { status: number | null; stdout: string; stderr: string } {
  // Run from the fixture plugin root discovered by release-files.json.
  const r = spawnSync("node", [path.join(TEMPLATE, "build-release.mjs"), "--commit", COMMIT, "--out", out, ...extra], {
    encoding: "utf8",
    cwd: root,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "relbuild-root-"));
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "relbuild-out-"));
  store = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "relbuild-store-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(store, { recursive: true, force: true });
});

describe("release-template/build-release.mjs — canonical plugin release", () => {
  it("derives plugin identity and emits the declared artifacts", () => {
    writeFixture();
    const r = build();
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.archive).toBe("soksak-plugin-example-0.0.1-any.tgz");

    const releaseBytes = fs.readFileSync(path.join(outDir, "release.json"));
    const release = JSON.parse(releaseBytes.toString());
    expect(release).toMatchObject({
      kind: "plugin", id: "soksak-plugin-example", version: "0.0.1",
      source: { repository: `https://github.com/${GITHUB_ORG}/soksak-plugin-example`, commit: COMMIT },
    });
    expect(release.artifacts).toEqual([{ target: "any", file: out.archive, size: expect.any(Number), sha256: out.sha256, format: "tgz", manifest: "plugin.json" }]);
    const manifestBytes = fs.readFileSync(path.join(root, "plugin.json"));
    expect(release.manifest).toEqual({ file: "plugin.json", size: manifestBytes.length, sha256: sha256(manifestBytes) });
    expect(releaseBytes.toString()).not.toContain("url");
    expect(release.runtimeDependencies).toBeUndefined();

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
    const files = release.evidence.map((item: { file: string }) => item.file);
    expect(files).toEqual(["conformance-contract-01.json", "conformance-plugin.json", "conformance-release.json"]);
    const bytes = fs.readFileSync(path.join(outDir, "conformance-contract-01.json"));
    expect(release.evidence[0]).toEqual({ file: "conformance-contract-01.json", size: bytes.length, sha256: sha256(bytes) });
  });

  it("composes runtime dependencies from the local store: the manifest names id and version, the release records the release.json digest", () => {
    const dependencyBytes = writeStoreSidecar();
    writeFixture({ plugin: { permissions: ["sidecar"], runtimeDependencies: { sidecars: [{ id: SIDECAR_ID, version: "0.0.1" }] } } });
    const result = build(outDir, ["--store", store]);
    expect(result.status, result.stderr).toBe(0);
    const release = JSON.parse(fs.readFileSync(path.join(outDir, "release.json"), "utf8"));
    expect(release.runtimeDependencies).toEqual({
      sidecars: [{ id: SIDECAR_ID, version: "0.0.1", size: dependencyBytes.length, sha256: sha256(dependencyBytes) }],
    });
  });

  it("fails by name when a runtime dependency is absent from the store", () => {
    writeFixture({ plugin: { permissions: ["sidecar"], runtimeDependencies: { sidecars: [{ id: SIDECAR_ID, version: "0.0.1" }] } } });
    const result = build(outDir, ["--store", store]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("RuntimeDependencyError");
    expect(result.stderr).toContain(`${SIDECAR_ID}@0.0.1`);
    expect(fs.existsSync(path.join(outDir, "release.json"))).toBe(false);
  });

  it("refuses a manifest dependency that names a location or digest", () => {
    writeStoreSidecar();
    writeFixture({ plugin: { permissions: ["sidecar"], runtimeDependencies: { sidecars: [{
      id: SIDECAR_ID, version: "0.0.1", url: `https://github.com/${GITHUB_ORG}/${SIDECAR_ID}/releases/download/v0.0.1/release.json`, size: 1, sha256: "a".repeat(64),
    }] } } });
    const result = build(outDir, ["--store", store]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/plugin manifest is invalid/);
  });

  it("refuses a relative or valueless --store", () => {
    writeFixture();
    expect(build(outDir, ["--store", "relative/store"]).stderr).toMatch(/--store must be an absolute/);
    expect(build(outDir, ["--store"]).stderr).toMatch(/--store must be an absolute/);
  });

  it("reads private build metadata from frontend/package.json", () => {
    writeFixture({ frontendPackage: true, pkg: { name: "@soksak/soksak-plugin-example", license: undefined } });
    expect(build().status).toBe(0);
  });

  it("rejects obsolete release dependency metadata", () => {
    writeFixture({ releaseDependencies: [
      { kit: { id: "soksak-kit-plugin-terminal", version: "0.0.1" }, scope: "build" },
      { contract: { id: "soksak-contract-plugin-terminal", version: "0.0.1" }, scope: "build" },
      { spec: { id: "soksak-spec", version: "0.0.1" }, scope: "build" },
    ] });
    const result = build();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("release/dependencies.json is not a release input");
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
    writeFixture({ plugin: { consumes: [{ id: "soksak-spec-plugin-git", requirement: "0.0.1" }] } });
    expect(build().status).toBe(0);
  });

  it("refuses a malformed consumes entry (shape is validated)", () => {
    writeFixture({ plugin: { consumes: [{ id: "soksak-spec-plugin-git" }] } });
    const r = build();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/consumes\[0\]\.requirement/);
  });

  it("refuses a non-private plugin package", () => {
    writeFixture({ pkg: { private: false } });
    const r = build();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/must be private/);
  });

  it.each([
    "file:/tmp/example.tgz", "file:///tmp/example.tgz", "link:../example", "workspace:*",
    "portal:../example", "catalog:example", "../example", "/tmp/example", "C:\\example",
  ])("refuses local package dependency %s as a release input", (specifier) => {
    writeFixture({ pkg: { dependencies: { "@soksak/example": specifier } } });
    const result = build();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("local dependency is not a release input");
  });

  it("refuses a local dependency retained only in the lockfile", () => {
    writeFixture({ frontendPackage: true });
    fs.writeFileSync(path.join(root, "frontend", "pnpm-lock.yaml"), [
      "lockfileVersion: '9.0'",
      "importers:",
      "  .:",
      "    dependencies:",
      "      '@soksak/example':",
      "        specifier: file:/tmp/example.tgz",
      "        version: file:../../tmp/example.tgz",
      "",
    ].join("\n"));
    const result = build();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("local dependency is not a release input");
  });

  it("refuses a local dependency retained only in pnpm workspace settings", () => {
    writeFixture({ frontendPackage: true });
    fs.writeFileSync(path.join(root, "frontend", "pnpm-workspace.yaml"), [
      "overrides:",
      "  '@soksak/example': file:../candidate/example.tgz",
      "",
    ].join("\n"));
    const result = build();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("local dependency is not a release input");
  });

  it("refuses an obsolete schema discriminator", () => {
    writeFixture({ plugin: { schema: "soksak-spec-plugin@0.0.1" } });
    const r = build();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/plugin manifest is invalid/);
  });

  it("refuses an archive name outside the release file grammar", () => {
    writeFixture({ pkg: { version: "0.0.1+build.1" }, plugin: { version: "0.0.1+build.1" } });
    const r = build();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/release file name is invalid/);
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
