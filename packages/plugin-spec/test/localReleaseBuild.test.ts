import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildLocalRelease, removeWorkDirectory } from "../release-template/local-release-build.mjs";
import { runLocalRelease } from "../release-template/local-release.mjs";
import { inspectLocalRelease } from "../release-template/local-release-store.mjs";
import { releaseDirectory } from "../release-template/resolve-release.mjs";
import { readSidecarReleaseArchive } from "../release-template/sidecar/archive.mjs";
import { GITHUB_ORG } from "../src/release-primitives.js";

const SIDECAR_ID = "soksak-sidecar-example";
const TARGET = "aarch64-apple-darwin";
const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
let root = ""; let source = ""; let store = "";
function run(command: string, args: string[], cwd: string) { const result = spawnSync(command, args, { cwd, encoding: "utf8" }); if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`); return result.stdout.trim(); }
function write(name: string, body: string | Buffer) { const target = path.join(source, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, body); }
function commit() { run("git", ["add", "."], source); run("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"], source); }
function writePlugin(over: Record<string, unknown> = {}) {
  write("plugin.json", JSON.stringify({ id: "soksak-plugin-example", name: "Example", version: "0.0.1", appVersionRequirement: "0.0.1", description: "Example", entry: "main.js", permissions: [], ...over }));
}
// A sidecar release published into the store: the plugin build composes its dependency from these bytes.
function storeSidecar(): Buffer {
  const directory = releaseDirectory(store, "sidecar", SIDECAR_ID, "0.0.1");
  fs.mkdirSync(directory, { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify({
    kind: "sidecar", id: SIDECAR_ID, version: "0.0.1",
    manifest: { file: "sidecar.json", size: 1, sha256: "b".repeat(64) },
    source: { repository: `https://github.com/${GITHUB_ORG}/${SIDECAR_ID}`, commit: "c".repeat(40) },
    artifacts: [{ target: TARGET, file: `${SIDECAR_ID}-0.0.1-${TARGET}.tar.gz`, size: 2, sha256: "d".repeat(64), format: "tar.gz", manifest: "sidecar.json" }],
    evidence: [{ file: "conformance-release.json", size: 3, sha256: "e".repeat(64) }],
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(directory, "release.json"), bytes);
  return bytes;
}
function macho(cpu = 0x0100000c): Buffer {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(cpu, 4);
  return bytes;
}
// A sidecar owner: make verify gates the source and make stage writes sidecar.json and the process
// binary, flat, into OUT for one TARGET.
function writeSidecarSource() {
  fs.rmSync(source, { recursive: true, force: true }); fs.mkdirSync(source);
  write("sidecar.json", `${JSON.stringify({ id: SIDECAR_ID, version: "0.0.1", interface: { id: "soksak-spec-sidecar-example", version: "0.0.1" }, process: `dist/${SIDECAR_ID}` }, null, 2)}\n`);
  write("Makefile", "verify:\n\t@test -f sidecar.json\nstage:\n\t@cp sidecar.json $(OUT)/sidecar.json\n\t@cp bin/$(TARGET) $(OUT)/soksak-sidecar-example\n");
  write(`bin/${TARGET}`, macho());
  write("LICENSE", "MIT\n");
  run("git", ["init", "-q"], source); commit();
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "local-build-test-")); source = path.join(root, "source"); store = path.join(root, "store"); fs.mkdirSync(source);
  write("Makefile", "verify:\n\t@test -f plugin.json\n");
  write("package.json", JSON.stringify({ name: "soksak-plugin-example", version: "0.0.1", private: true, type: "module" }));
  writePlugin();
  write("main.js", "export function activate() {}\n"); write("LICENSE", "MIT\n"); write("NOTICE", "Example\n"); write("README.md", "# Example\n"); write("README.ko.md", "# 예제\n");
  write("release-files.json", JSON.stringify(["LICENSE", "NOTICE", "README.ko.md", "README.md", "main.js", "plugin.json"]));
  run("git", ["init", "-q"], source); commit();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("local release owner build", () => {
  it("builds a clean exact Plugin commit and publishes its canonical release", () => {
    const result = buildLocalRelease({ store, source });
    expect(result).toMatchObject({ state: "published", kind: "plugin", id: "soksak-plugin-example", version: "0.0.1" });
    expect(inspectLocalRelease({ store, kind: "plugin", id: "soksak-plugin-example", version: "0.0.1" }).assets.map(({ name }) => name)).toContain("release.json");
    const release = JSON.parse(fs.readFileSync(path.join(result.directory, "release.json"), "utf8"));
    expect(release.artifacts[0].file).toBe("soksak-plugin-example-0.0.1-any.tgz");
    expect(release.manifest.file).toBe("plugin.json");
    expect(release.source.repository).toBe(`https://github.com/${GITHUB_ORG}/soksak-plugin-example`);
    expect(buildLocalRelease({ store, source })).toMatchObject({ state: "unchanged" });
  });

  it("replaces a stored version when a new commit of the owner is built", () => {
    const first = buildLocalRelease({ store, source });
    fs.appendFileSync(path.join(source, "main.js"), "export const changed = true;\n"); commit();
    const second = buildLocalRelease({ store, source });
    expect(second).toMatchObject({ state: "replaced", directory: first.directory });
    expect(JSON.parse(fs.readFileSync(path.join(second.directory, "release.json"), "utf8")).source.commit).toBe(run("git", ["rev-parse", "HEAD"], source));
  });

  it("composes a Plugin's runtime dependencies against the same store it publishes into", () => {
    const dependency = storeSidecar();
    writePlugin({ permissions: ["sidecar"], runtimeDependencies: { sidecars: [{ id: SIDECAR_ID, version: "0.0.1" }] } });
    commit();
    const result = buildLocalRelease({ store, source });
    expect(result).toMatchObject({ state: "published", kind: "plugin" });
    const release = JSON.parse(fs.readFileSync(path.join(result.directory, "release.json"), "utf8"));
    expect(release.runtimeDependencies).toEqual({ sidecars: [{ id: SIDECAR_ID, version: "0.0.1", size: dependency.length, sha256: sha256(dependency) }] });
  });

  it("fails by name when a Plugin's runtime dependency is absent from the store", () => {
    writePlugin({ permissions: ["sidecar"], runtimeDependencies: { sidecars: [{ id: SIDECAR_ID, version: "0.0.1" }] } });
    commit();
    expect(() => buildLocalRelease({ store, source })).toThrow(new RegExp(`${SIDECAR_ID}@0.0.1`));
  });

  it("rejects a dirty owner source instead of hiding changes in a clone", () => {
    fs.appendFileSync(path.join(source, "main.js"), "changed\n");
    expect(() => buildLocalRelease({ store, source })).toThrow(/owner source must be clean/);
  });

  it("builds a Sidecar per target from the owner's make stage output and publishes per-target archives", () => {
    writeSidecarSource();
    const result = buildLocalRelease({ store, source, targets: [TARGET] });
    expect(result).toMatchObject({ state: "published", kind: "sidecar", id: SIDECAR_ID, version: "0.0.1" });
    const release = JSON.parse(fs.readFileSync(path.join(result.directory, "release.json"), "utf8"));
    const archiveName = `${SIDECAR_ID}-0.0.1-${TARGET}.tar.gz`;
    expect(release.artifacts).toEqual([expect.objectContaining({ target: TARGET, file: archiveName, format: "tar.gz", manifest: "sidecar.json" })]);
    expect(release.manifest.file).toBe("sidecar.json");
    expect(release.source.repository).toBe(`https://github.com/${GITHUB_ORG}/${SIDECAR_ID}`);
    expect(fs.readdirSync(result.directory).sort()).toEqual(["conformance-interface.json", "conformance-release.json", "conformance-sidecar.json", "release.json", "sidecar.json", archiveName]);
    const archive = fs.readFileSync(path.join(result.directory, archiveName));
    expect(sha256(archive)).toBe(release.artifacts[0].sha256);
    expect(readSidecarReleaseArchive(archive).map((entry) => entry.name)).toEqual(["LICENSE", `dist/${SIDECAR_ID}`, "sidecar.json"]);
    expect(() => buildLocalRelease({ store, source, targets: [] })).toThrow(/unique --target/);
  });

  it("refuses a target whose archive name is outside the release file grammar before the owner build runs", () => {
    writeSidecarSource();
    expect(() => buildLocalRelease({ store, source, targets: ["a b"] })).toThrow(/release file name is invalid/);
  });

  it("refuses a staged sidecar binary built for another architecture", () => {
    writeSidecarSource();
    write(`bin/${TARGET}`, macho(0x01000007)); commit();
    expect(() => buildLocalRelease({ store, source, targets: [TARGET] })).toThrow(/binary target/);
  });

  it("accepts only --store, --source, --targets, and --registry for a build", () => {
    expect(() => runLocalRelease(["build", "--store", store, "--source", source, "--unknown", "value"])).toThrow("build accepts --store, --source, --targets, and --registry");
  });
});

describe("local release command entry", () => {
  it("runs when invoked through a symbolic link, as a package manager's bin shim does", () => {
    const script = path.resolve(import.meta.dirname, "../release-template/local-release.mjs");
    const link = path.join(root, "soksak-local-release");
    fs.symlinkSync(script, link);
    const result = spawnSync(process.execPath, [link, "list", "--store", store], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ releases: 0, entries: [] });
  });

  it("passes --registry to the owner's make verify as a command-line REGISTRY", () => {
    write("Makefile", "verify:\n\t@test '$(origin REGISTRY)' = 'command line' || { echo 'REGISTRY required' >&2; exit 64; }\n\t@test -f plugin.json\n");
    commit();
    expect(() => buildLocalRelease({ store, source })).toThrow(/REGISTRY required/);
    expect(buildLocalRelease({ store, source, registry: "http://127.0.0.1:4873" })).toMatchObject({ state: "published", kind: "plugin" });
    expect(() => runLocalRelease(["build", "--store", store, "--source", source, "--registry", "localhost:4873"])).toThrow(/--registry must be an absolute http\(s\) URL/);
  });
});

describe("local release owner tools", () => {
  it("hands the owner's make the validator this package ships, ahead of any soksak-validate on PATH", () => {
    // An owner preflight calls soksak-validate by name; in Actions the spec package is installed
    // globally, locally the local release tool supplies its own bin.
    write("Makefile", "verify:\n\t@soksak-validate --help >/dev/null || exit 78\n\t@test -f plugin.json\n");
    commit();
    const shadow = path.join(root, "shadow"); fs.mkdirSync(shadow);
    fs.writeFileSync(path.join(shadow, "soksak-validate"), "#!/bin/sh\necho 'other tool' >&2; exit 2\n", { mode: 0o755 });
    const previous = process.env.PATH;
    process.env.PATH = `${shadow}:${previous}`;
    try {
      expect(buildLocalRelease({ store, source })).toMatchObject({ state: "published", kind: "plugin" });
    } finally {
      process.env.PATH = previous;
    }
  });
});

describe("local release work directory", () => {
  it.skipIf(process.platform === "win32")("removes owner output sealed read-only by its gate", () => {
    const work = path.join(root, "readonly-work");
    const sealed = path.join(work, "sealed");
    fs.mkdirSync(sealed, { recursive: true });
    fs.writeFileSync(path.join(sealed, "artifact"), "verified\n");
    fs.chmodSync(sealed, 0o555);
    try {
      expect(removeWorkDirectory(work, { state: "published" })).toEqual({ state: "published" });
      expect(fs.existsSync(work)).toBe(false);
    } finally {
      if (fs.existsSync(sealed)) fs.chmodSync(sealed, 0o755);
    }
  });

  it("retries the cleanup and names the leftover directory next to the published result", () => {
    const calls: number[] = [];
    const remove = (directory: string) => { calls.push(calls.length); if (calls.length < 3) { const error = new Error("ENOTEMPTY") as NodeJS.ErrnoException; error.code = "ENOTEMPTY"; throw error; } };
    expect(removeWorkDirectory("/tmp/work", { state: "published" }, remove)).toEqual({ state: "published" });
    expect(calls.length).toBe(3);
    const stuck = () => { const error = new Error("ENOTEMPTY") as NodeJS.ErrnoException; error.code = "ENOTEMPTY"; throw error; };
    expect(() => removeWorkDirectory("/tmp/work", { state: "published" }, stuck)).toThrow(/published.*\/tmp\/work/s);
  });
});
