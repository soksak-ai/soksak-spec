// The canonical sidecar release builder (release-template/sidecar/) is the single source every
// sidecar vendors byte-identical (scripts/{release-contract,build-release,validate-with-spec}.mjs)
// and runs in its publish job to emit the owner manifest + conformance reports the signed registry
// requires. These run the real artifacts from a fixture sidecar repository with sidecar.json,
// release/targets.json, the validator pin, and a five-target archive set — and fix the contract:
// identity derives from sidecar.json and the emitted release records per-target archives.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRegularFileArchive } from "../release-template/archive.mjs";
import { COMPONENT_ID_RE, GITHUB_ORG, RELEASE_FILE_RE, STRICT_SEMVER_RE } from "../src/release-primitives.js";

const TEMPLATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../release-template/sidecar");
const COMMIT = "b".repeat(40);
const GO_MOD = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../go/platformspec/go.mod"), "utf8");
const GO_VERSION = GO_MOD.match(/^go (\S+)$/m)?.[1];
const TARGETS = [
  "aarch64-apple-darwin",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "x86_64-pc-windows-msvc",
  "x86_64-unknown-linux-gnu",
];

let root = "";
let artifactsDir = "";
let outDir = "";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function binaryFixture(target: string): Buffer {
  if (target.endsWith("apple-darwin")) {
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32LE(0xfeedfacf, 0);
    bytes.writeUInt32LE(target.startsWith("aarch64-") ? 0x0100000c : 0x01000007, 4);
    return bytes;
  }
  if (target.includes("unknown-linux")) {
    const bytes = Buffer.alloc(64);
    bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
    bytes.writeUInt16LE(target.startsWith("aarch64-") ? 183 : 62, 18);
    return bytes;
  }
  if (target === "x86_64-pc-windows-msvc") {
    const bytes = Buffer.alloc(256);
    bytes.write("MZ", 0, "ascii");
    bytes.writeUInt32LE(0x80, 0x3c);
    bytes.write("PE\0\0", 0x80, "binary");
    bytes.writeUInt16LE(0x8664, 0x84);
    bytes.writeUInt16LE(0x20b, 0x98);
    return bytes;
  }
  throw new Error(`unsupported fixture target: ${target}`);
}

function writeFixture(overrides: { sidecar?: Record<string, unknown>; cargoVersion?: string; targets?: string[]; language?: "rust" | "go" } = {}): void {
  const targets = overrides.targets ?? TARGETS;
  const sidecar = {
    id: "soksak-sidecar-example",
    version: "0.0.1",
    interface: [{ id: "soksak-spec-sidecar-example", version: "0.0.1" }],
    process: "dist/soksak-sidecar-example",
    ...overrides.sidecar,
  };
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "release"), { recursive: true });
  for (const name of ["archive.mjs", "native-binary.mjs", "release-contract.mjs", "build-release.mjs", "validate-with-spec.mjs"]) {
    fs.copyFileSync(path.join(TEMPLATE, name), path.join(root, "scripts", name));
  }
  fs.writeFileSync(path.join(root, "sidecar.json"), `${JSON.stringify(sidecar, null, 2)}\n`);
  fs.writeFileSync(
    path.join(root, "release", "targets.json"),
    `${JSON.stringify(targets.map((target) => ({ target, runner: "runner" })), null, 2)}\n`,
  );
  if (overrides.language !== "go") {
    fs.writeFileSync(
      path.join(root, "Cargo.toml"),
      `[package]\nname = "${sidecar.id}"\nversion = "${overrides.cargoVersion ?? sidecar.version}"\npublish = false\n`,
    );
  } else {
    if (!GO_VERSION) throw new Error("workspace Go version is missing");
    fs.writeFileSync(path.join(root, "go.mod"), `module github.com/${GITHUB_ORG}/${sidecar.id}\n\ngo ${GO_VERSION}\n`);
  }
  for (const target of targets) {
    const asset = `${sidecar.id}-${sidecar.version}-${target}.tar.gz`;
    const archiveRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "sidecar-archive-"));
    const process = `dist/${sidecar.id}${target.includes("windows") ? ".exe" : ""}`;
    fs.mkdirSync(path.join(archiveRoot, "dist"));
    fs.writeFileSync(path.join(archiveRoot, "sidecar.json"), `${JSON.stringify({ ...sidecar, process }, null, 2)}\n`);
    fs.writeFileSync(path.join(archiveRoot, process), binaryFixture(target));
    const bytes = createRegularFileArchive({ root: archiveRoot, files: ["sidecar.json", process] });
    fs.rmSync(archiveRoot, { recursive: true, force: true });
    fs.writeFileSync(path.join(artifactsDir, asset), bytes);
    fs.writeFileSync(path.join(artifactsDir, `${asset}.sha256`), `${sha256(bytes)}  ${asset}\n`);
  }
}

// The canonical script discovers sidecar.json from the fixture repository.
function build(tag = "v0.0.1", emitSummary = false, deVendored = false, target?: string): { status: number | null; stdout: string; stderr: string } {
  const script = deVendored
    ? path.join(TEMPLATE, "build-release.mjs")
    : path.join(root, "scripts", "build-release.mjs");
  const args = [script, "--commit", COMMIT, "--tag", tag, "--artifacts", artifactsDir, "--out", outDir];
  if (emitSummary) args.push("--emit-summary");
  if (target) args.push("--target", target);
  const r = spawnSync("node", args, { encoding: "utf8", cwd: root });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const SUMMARY_MARK = "@@RELEASE_SUMMARY@@ ";

beforeEach(() => {
  // The canon refuses any symlink on the path walk — macOS tmpdir is behind the /var symlink,
  // so anchor fixtures at the resolved real path (exactly what a CI checkout gives the scripts).
  const tmp = fs.realpathSync(os.tmpdir());
  root = fs.mkdtempSync(path.join(tmp, "sidecar-rel-root-"));
  artifactsDir = fs.mkdtempSync(path.join(tmp, "sidecar-rel-art-"));
  outDir = path.join(fs.mkdtempSync(path.join(tmp, "sidecar-rel-out-")), "dist-release");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(artifactsDir, { recursive: true, force: true });
  fs.rmSync(path.dirname(outDir), { recursive: true, force: true });
});

describe("release-template/sidecar — canonical sidecar release documents", () => {
  it("validates with an extracted immutable spec package rather than a source checkout", () => {
    const source = fs.readFileSync(path.join(TEMPLATE, "validate-with-spec.mjs"), "utf8");
    expect(source).toContain("spec-package");
    expect(source).toContain("bin/validate.mjs");
    expect(source).not.toContain("git");
    expect(source).not.toContain("spec-root");
  });
  it("emits a sidecar release and three conformance reports from sidecar.json", () => {
    writeFixture();
    const r = build();
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);

    const releaseBytes = fs.readFileSync(path.join(outDir, "release.json"));
    const release = JSON.parse(releaseBytes.toString("utf8"));
    expect(release).toMatchObject({
      kind: "sidecar", id: "soksak-sidecar-example", version: "0.0.1",
      source: { repository: `https://github.com/${GITHUB_ORG}/soksak-sidecar-example`, commit: COMMIT },
    });
    expect(release.artifacts).toHaveLength(5);
    expect(release.artifacts.map((a: { target: string }) => a.target)).toEqual(TARGETS);
    for (const artifact of release.artifacts) {
      expect(artifact.format).toBe("tar.gz");
      expect(artifact.manifest).toBe("sidecar.json");
      expect(artifact.file).toBe(`soksak-sidecar-example-0.0.1-${artifact.target}.tar.gz`);
      expect(fs.readFileSync(path.join(artifactsDir, artifact.file))).toHaveLength(artifact.size);
    }
    const manifestBytes = fs.readFileSync(path.join(outDir, "sidecar.json"));
    expect(release.manifest).toEqual({ file: "sidecar.json", size: manifestBytes.length, sha256: sha256(manifestBytes) });
    expect(release.evidence.map((item: { file: string }) => item.file))
      .toEqual(["conformance-interface.json", "conformance-release.json", "conformance-sidecar.json"]);
    expect(Object.keys(release.manifest).sort()).toEqual(["file", "sha256", "size"]);
    for (const artifact of release.artifacts) expect(Object.keys(artifact).sort()).toEqual(["file", "format", "manifest", "sha256", "size", "target"]);
    for (const item of release.evidence) expect(Object.keys(item).sort()).toEqual(["file", "sha256", "size"]);
    const claims: Record<string, unknown> = {
      "conformance-release.json": { release: true },
      "conformance-sidecar.json": { manifest: true },
      "conformance-interface.json": { contract: { id: "soksak-spec-sidecar-example", version: "0.0.1" } },
    };
    for (const [name, claim] of Object.entries(claims)) {
      const report = JSON.parse(fs.readFileSync(path.join(outDir, name), "utf8"));
      expect(report).toMatchObject({
        subject: { sidecar: { id: "soksak-sidecar-example", version: "0.0.1" } },
        claim,
        result: "passed",
      });
      expect(report.artifacts).toHaveLength(5);
    }
  });

  it("accepts a sidecar-specific four-target matrix", () => {
    const targets = TARGETS.filter((target) => !target.includes("windows"));
    writeFixture({ targets });
    const r = build();
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const release = JSON.parse(fs.readFileSync(path.join(outDir, "release.json"), "utf8"));
    expect(release.artifacts.map((artifact: { target: string }) => artifact.target)).toEqual(targets);
  });

  it("builds one requested local target through the canonical release builder", () => {
    const target = "aarch64-apple-darwin";
    writeFixture();
    for (const name of fs.readdirSync(artifactsDir)) {
      if (!name.includes(target)) fs.rmSync(path.join(artifactsDir, name));
    }
    const result = build("v0.0.1", false, false, target);
    expect(result.status, result.stderr).toBe(0);
    const release = JSON.parse(fs.readFileSync(path.join(outDir, "release.json"), "utf8"));
    expect(release.artifacts.map((artifact: { target: string }) => artifact.target)).toEqual([target]);
    for (const file of ["conformance-interface.json", "conformance-release.json", "conformance-sidecar.json"]) {
      expect(JSON.parse(fs.readFileSync(path.join(outDir, file), "utf8")).artifacts).toHaveLength(1);
    }
  });

  it("accepts a Go sidecar whose identity is owned by sidecar.json", () => {
    writeFixture({ language: "go" });
    const result = build();
    expect(result.status, result.stderr).toBe(0);
  });

  it("accepts the Windows executable name in a sidecar manifest", () => {
    writeFixture({ sidecar: { process: "dist/soksak-sidecar-example.exe" } });
    const result = build();
    expect(result.status, result.stderr).toBe(0);
  });

  it("keeps the component patch version independent from its interface version", () => {
    writeFixture({ sidecar: { version: "0.0.4", interface: [{ id: "soksak-spec-sidecar-example", version: "0.0.2" }] }, cargoVersion: "0.0.4" });
    const result = build("v0.0.4");
    expect(result.status, result.stderr).toBe(0);
    const release = JSON.parse(fs.readFileSync(path.join(outDir, "release.json"), "utf8"));
    expect(release).toMatchObject({ kind: "sidecar", version: "0.0.4" });
    expect(JSON.parse(fs.readFileSync(path.join(outDir, "conformance-interface.json"), "utf8")).claim.contract.version).toBe("0.0.2");
  });

  // --emit-summary lets a caller (the core `release.build` command handler) parse the manifest +
  // per-target digests from stdout instead of re-hashing the bytes itself. Additive: without the
  // flag stdout stays silent, and every invariant above still fires.
  it("with --emit-summary, prints a parseable summary matching the written manifest", () => {
    writeFixture();
    const r = build("v0.0.1", true);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const line = r.stdout.split("\n").find((l) => l.startsWith(SUMMARY_MARK));
    expect(line, "a @@RELEASE_SUMMARY@@ line must be printed").toBeDefined();
    const summary = JSON.parse(line!.slice(SUMMARY_MARK.length));
    const releaseBytes = fs.readFileSync(path.join(outDir, "release.json"));
    expect(summary.releaseJson).toEqual(JSON.parse(releaseBytes.toString("utf8")));
    expect(summary.matrix).toHaveLength(5);
    expect(summary.matrix.map((m: { target: string }) => m.target)).toEqual(TARGETS);
  });

  it("stays silent on stdout without --emit-summary (additive flag)", () => {
    writeFixture();
    const r = build();
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  // The vendored builder set is exactly the five scripts copied by writeFixture; the sidecar
  // release document imports nothing outside that set.
  it("runs from the vendored five-file set with no import outside it", () => {
    const source = fs.readFileSync(path.join(TEMPLATE, "build-release.mjs"), "utf8");
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    expect(imports).toEqual(["node:fs", "node:path", "./release-contract.mjs"]);
  });

  // release-contract.mjs has no access to dist/ and restates three grammars; each restated regex
  // source must equal the dist source, including the SemVer length bound.
  it("restates the component id, strict SemVer, and release file grammars with the exact dist source", () => {
    const contract = fs.readFileSync(path.join(TEMPLATE, "release-contract.mjs"), "utf8");
    const literal = (name: string): string => {
      const match = contract.match(new RegExp(`^const ${name} = /(.*)/;$`, "m"));
      if (!match) throw new Error(`${name} literal missing`);
      return match[1];
    };
    expect(literal("COMPONENT_ID_RE")).toBe(COMPONENT_ID_RE.source);
    expect(literal("SEMVER")).toBe(STRICT_SEMVER_RE.source);
    expect(literal("RELEASE_FILE_RE")).toBe(RELEASE_FILE_RE.source);
  });

  it("refuses an asset name outside the release file grammar", () => {
    writeFixture({ sidecar: { version: "0.0.1+build.1" }, cargoVersion: "0.0.1+build.1" });
    const r = build("v0.0.1+build.1");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/release file name is invalid/);
  });

  it("discovers sidecar.json when run from the canonical source", () => {
    writeFixture();
    const r = build("v0.0.1", false, true);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const release = JSON.parse(fs.readFileSync(path.join(outDir, "release.json"), "utf8"));
    expect(release.id).toBe("soksak-sidecar-example");
    expect(release.artifacts).toHaveLength(5);
  });

  it("refuses a checksum sidecar that does not state the exact archive digest", () => {
    writeFixture();
    const asset = "soksak-sidecar-example-0.0.1-x86_64-apple-darwin.tar.gz";
    fs.writeFileSync(path.join(artifactsDir, `${asset}.sha256`), `${"0".repeat(64)}  ${asset}\n`);
    const r = build();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/must state the exact digest/);
  });

  it("refuses a process binary whose header does not match its declared target", () => {
    writeFixture();
    const target = "aarch64-apple-darwin";
    const asset = `soksak-sidecar-example-0.0.1-${target}.tar.gz`;
    const archiveRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "sidecar-archive-"));
    fs.mkdirSync(path.join(archiveRoot, "dist"));
    fs.writeFileSync(path.join(archiveRoot, "sidecar.json"), JSON.stringify({
      id: "soksak-sidecar-example",
      version: "0.0.1",
      interface: [{ id: "soksak-spec-sidecar-example", version: "0.0.1" }],
      process: "dist/soksak-sidecar-example",
    }));
    fs.writeFileSync(path.join(archiveRoot, "dist/soksak-sidecar-example"), binaryFixture("x86_64-apple-darwin"));
    const bytes = createRegularFileArchive({ root: archiveRoot, files: ["sidecar.json", "dist/soksak-sidecar-example"] });
    fs.rmSync(archiveRoot, { recursive: true, force: true });
    fs.writeFileSync(path.join(artifactsDir, asset), bytes);
    fs.writeFileSync(path.join(artifactsDir, `${asset}.sha256`), `${sha256(bytes)}  ${asset}\n`);
    const result = build();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/binary target.*aarch64-apple-darwin/);
  });

  it("refuses an artifact directory that is not exactly the declared matrix", () => {
    writeFixture();
    fs.writeFileSync(path.join(artifactsDir, "stray.txt"), "stray");
    const r = build();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/exactly the declared release matrix/);
  });

  it("refuses an archive whose sidecar version differs from the release", () => {
    writeFixture();
    const target = "x86_64-pc-windows-msvc";
    const asset = `soksak-sidecar-example-0.0.1-${target}.tar.gz`;
    const archiveRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "sidecar-archive-"));
    fs.mkdirSync(path.join(archiveRoot, "dist"));
    fs.writeFileSync(path.join(archiveRoot, "sidecar.json"), JSON.stringify({
      id: "soksak-sidecar-example",
      version: "0.0.0",
      interface: [{ id: "soksak-spec-sidecar-example", version: "0.0.1" }],
      process: "dist/soksak-sidecar-example.exe",
    }));
    fs.writeFileSync(path.join(archiveRoot, "dist/soksak-sidecar-example.exe"), binaryFixture(target));
    const bytes = createRegularFileArchive({ root: archiveRoot, files: ["sidecar.json", "dist/soksak-sidecar-example.exe"] });
    fs.rmSync(archiveRoot, { recursive: true, force: true });
    fs.writeFileSync(path.join(artifactsDir, asset), bytes);
    fs.writeFileSync(path.join(artifactsDir, `${asset}.sha256`), `${sha256(bytes)}  ${asset}\n`);
    const result = build();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/archive sidecar manifest differs from the release identity/);
  });

  it("accepts GNU long-name metadata for a safe bundled runtime path", () => {
    writeFixture();
    const target = "aarch64-apple-darwin";
    const asset = `soksak-sidecar-example-0.0.1-${target}.tar.gz`;
    const archiveRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "sidecar-archive-"));
    const longPath = `runtime/${"segment/".repeat(16)}library.dylib`;
    fs.mkdirSync(path.join(archiveRoot, "dist"), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(archiveRoot, longPath)), { recursive: true });
    fs.writeFileSync(path.join(archiveRoot, "sidecar.json"), JSON.stringify({
      id: "soksak-sidecar-example",
      version: "0.0.1",
      interface: [{ id: "soksak-spec-sidecar-example", version: "0.0.1" }],
      process: "dist/soksak-sidecar-example",
    }));
    fs.writeFileSync(path.join(archiveRoot, "dist/soksak-sidecar-example"), binaryFixture(target));
    fs.writeFileSync(path.join(archiveRoot, longPath), "runtime");
    const tar = spawnSync("tar", ["-czf", path.join(artifactsDir, asset), "-C", archiveRoot, "."], { encoding: "utf8" });
    expect(tar.status, tar.stderr).toBe(0);
    fs.rmSync(archiveRoot, { recursive: true, force: true });
    const bytes = fs.readFileSync(path.join(artifactsDir, asset));
    fs.writeFileSync(path.join(artifactsDir, `${asset}.sha256`), `${sha256(bytes)}  ${asset}\n`);
    const result = build();
    expect(result.status, result.stderr).toBe(0);
  });

  it("refuses a dispatch tag that does not equal v0.0.1", () => {
    writeFixture();
    const r = build("v9.9.9");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/release tag must equal v0\.0\.1/);
  });

  it("refuses a Cargo package whose version drifted from the release metadata", () => {
    writeFixture({ cargoVersion: "0.0.9" });
    const r = build();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Cargo package must match private release metadata/);
  });

  it("refuses an interface id outside the sidecar contract namespace", () => {
    writeFixture({ sidecar: { interface: [{ id: "soksak-browser-spec", version: "0.0.1" }] } });
    const r = build();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/interface provider must match the sidecar version/);
  });
});
