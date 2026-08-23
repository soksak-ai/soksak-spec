// The canonical sidecar release builder (release-template/sidecar/) is the single source every
// sidecar vendors byte-identical (scripts/{release-contract,build-release,validate-with-spec}.mjs)
// and runs in its publish job to emit the owner manifest + conformance reports the signed registry
// requires. These run the real artifacts from a fixture sidecar repository with sidecar.json,
// release/targets.json, the validator pin, and a five-target archive set — and fix the contract:
// identity derives from sidecar.json and the emitted release carries per-target archives.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRegularFileArchive } from "../release-template/archive.mjs";

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

function writeFixture(overrides: { sidecar?: Record<string, unknown>; cargoVersion?: string; targets?: string[]; language?: "rust" | "go" } = {}): void {
  const targets = overrides.targets ?? TARGETS;
  const sidecar = {
    id: "soksak-sidecar-example",
    version: "0.0.1",
    interface: { id: "soksak-spec-sidecar-example", version: "0.0.1" },
    process: "dist/soksak-sidecar-example",
    ...overrides.sidecar,
  };
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "release"), { recursive: true });
  for (const name of ["release-contract.mjs", "build-release.mjs", "validate-with-spec.mjs"]) {
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
    fs.writeFileSync(path.join(root, "go.mod"), `module github.com/soksak-ai/${sidecar.id}\n\ngo ${GO_VERSION}\n`);
  }
  for (const target of targets) {
    const asset = `${sidecar.id}-${sidecar.version}-${target}.tar.gz`;
    const archiveRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "sidecar-archive-"));
    const process = `dist/${sidecar.id}${target.includes("windows") ? ".exe" : ""}`;
    fs.mkdirSync(path.join(archiveRoot, "dist"));
    fs.writeFileSync(path.join(archiveRoot, "sidecar.json"), `${JSON.stringify({ ...sidecar, process }, null, 2)}\n`);
    fs.writeFileSync(path.join(archiveRoot, process), "binary");
    const bytes = createRegularFileArchive({ root: archiveRoot, files: ["sidecar.json", process] });
    fs.rmSync(archiveRoot, { recursive: true, force: true });
    fs.writeFileSync(path.join(artifactsDir, asset), bytes);
    fs.writeFileSync(path.join(artifactsDir, `${asset}.sha256`), `${sha256(bytes)}  ${asset}\n`);
  }
}

// The canonical script discovers sidecar.json from the fixture repository.
function build(tag = "v0.0.1", emitSummary = false, deVendored = false): { status: number | null; stdout: string; stderr: string } {
  const script = deVendored
    ? path.join(TEMPLATE, "build-release.mjs")
    : path.join(root, "scripts", "build-release.mjs");
  const args = [script, "--commit", COMMIT, "--tag", tag, "--artifacts", artifactsDir, "--out", outDir];
  if (emitSummary) args.push("--emit-summary");
  const r = spawnSync("node", args, { encoding: "utf8", cwd: root });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const SUMMARY_MARK = "@@RELEASE_SUMMARY@@ ";

beforeEach(() => {
  // The canon refuses any symlink on the path walk — macOS tmpdir sits behind the /var symlink,
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
  it("emits a sidecar release and three conformance reports from sidecar.json", () => {
    writeFixture();
    const r = build();
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);

    const release = JSON.parse(fs.readFileSync(path.join(outDir, "release.json"), "utf8"));
    expect(release).toMatchObject({
      sidecar: { id: "soksak-sidecar-example", version: "0.0.1" },
      source: { repository: "https://github.com/soksak-ai/soksak-sidecar-example", commit: COMMIT },
    });
    expect(release.artifacts).toHaveLength(5);
    expect(release.artifacts.map((a: { target: string }) => a.target)).toEqual(TARGETS);
    for (const artifact of release.artifacts) {
      expect(artifact.format).toBe("tar.gz");
      expect(artifact.manifest).toBe("sidecar.json");
    }
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
    writeFixture({ sidecar: { version: "0.0.4", interface: { id: "soksak-spec-sidecar-example", version: "0.0.1" } }, cargoVersion: "0.0.4" });
    const result = build("v0.0.4");
    expect(result.status, result.stderr).toBe(0);
    const release = JSON.parse(fs.readFileSync(path.join(outDir, "release.json"), "utf8"));
    expect(release.sidecar.version).toBe("0.0.4");
    expect(JSON.parse(fs.readFileSync(path.join(outDir, "conformance-interface.json"), "utf8")).claim.contract.version).toBe("0.0.1");
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

  it("discovers sidecar.json when run from the canonical source", () => {
    writeFixture();
    const r = build("v0.0.1", false, true);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const release = JSON.parse(fs.readFileSync(path.join(outDir, "release.json"), "utf8"));
    expect(release.sidecar.id).toBe("soksak-sidecar-example");
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
      interface: { id: "soksak-spec-sidecar-example", version: "0.0.1" },
      process: "dist/soksak-sidecar-example.exe",
    }));
    fs.writeFileSync(path.join(archiveRoot, "dist/soksak-sidecar-example.exe"), "binary");
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
      interface: { id: "soksak-spec-sidecar-example", version: "0.0.1" },
      process: "dist/soksak-sidecar-example",
    }));
    fs.writeFileSync(path.join(archiveRoot, "dist/soksak-sidecar-example"), "binary");
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
    writeFixture({ sidecar: { interface: { id: "soksak-browser-spec", version: "0.0.1" } } });
    const r = build();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/interface provider must match the sidecar version/);
  });
});
