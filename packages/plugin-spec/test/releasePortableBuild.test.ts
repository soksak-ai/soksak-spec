import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readRegularFileArchive } from "../release-template/archive.mjs";
import { parseConformanceReport } from "../src/conformanceWire.js";
import { GITHUB_ORG } from "../src/release-primitives.js";
import { parseReleaseManifest } from "../src/release.js";

const TEMPLATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../release-template");
const COMMIT = "a".repeat(40);
const WORKSPACE_CARGO = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Cargo.toml"), "utf8");
const RUST_EDITION = WORKSPACE_CARGO.match(/^edition = "([^"]+)"$/m)?.[1];
let root = "";
let out = "";

function writeFixture(kind: "contract" | "kit", id: string): void {
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({
    name: `@soksak/${id}`, version: "0.0.1", private: true, exports: { ".": { types: "./src/index.ts", default: "./src/index.ts" } },
    repository: { type: "git", url: `git+https://github.com/${GITHUB_ORG}/${id}.git` },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, `${kind}.json`), `${JSON.stringify({ id, version: "0.0.1" }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "release-files.json"), `${JSON.stringify(["LICENSE", `${kind}.json`, "package.json", "src/index.ts"])}\n`);
  fs.writeFileSync(path.join(root, "LICENSE"), "MIT\n");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/index.ts"), "export const value = 1;\n");
}

function writeCargoKitFixture(id: string): void {
  if (!RUST_EDITION) throw new Error("workspace Rust edition is missing");
  fs.writeFileSync(path.join(root, "Cargo.toml"), `[package]\nname = "${id}"\nversion = "0.0.1"\nedition = "${RUST_EDITION}"\npublish = false\nrepository = "https://github.com/${GITHUB_ORG}/${id}"\n`);
  fs.writeFileSync(path.join(root, "kit.json"), `${JSON.stringify({ id, version: "0.0.1" }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "release-files.json"), `${JSON.stringify(["Cargo.toml", "LICENSE", "kit.json", "src/lib.rs"])}\n`);
  fs.writeFileSync(path.join(root, "LICENSE"), "MIT\n");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/lib.rs"), "pub const VALUE: u8 = 1;\n");
}

function build(): ReturnType<typeof spawnSync> {
  return spawnSync("node", [path.join(TEMPLATE, "build-portable-release.mjs"), "--commit", COMMIT, "--out", out], { cwd: root, encoding: "utf8" });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "portable-release-root-"));
  out = fs.mkdtempSync(path.join(os.tmpdir(), "portable-release-out-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
});

describe("portable contract and kit release builder", () => {
  for (const kind of ["contract", "kit"] as const) {
    it(`builds a deterministic ${kind} release`, () => {
      const id = `soksak-${kind}-example`;
      writeFixture(kind, id);
      const first = build();
      expect(first.status, first.stderr).toBe(0);
      const summary = JSON.parse(first.stdout);
      expect(summary.archive).toBe(`${id}-0.0.1-any.tgz`);
      const releaseBytes = fs.readFileSync(path.join(out, "release.json"));
      const release = JSON.parse(releaseBytes.toString("utf8"));
      const parsed = parseReleaseManifest(release);
      expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
      expect(release).toMatchObject({ kind, id, version: "0.0.1", source: { repository: `https://github.com/${GITHUB_ORG}/${id}`, commit: COMMIT } });
      expect(release.artifacts).toEqual([{ target: "any", file: summary.archive, size: expect.any(Number), sha256: summary.sha256, format: "tgz", manifest: `${kind}.json` }]);
      expect(release.manifest).toMatchObject({ file: `${kind}.json` });
      expect(release.evidence.map(({ file }: { file: string }) => file)).toEqual(["conformance-manifest.json", "conformance-release.json"]);
      expect(releaseBytes.toString("utf8")).not.toContain("url");
      const names = readRegularFileArchive(fs.readFileSync(path.join(out, summary.archive))).map(({ name }) => name);
      expect(names).toEqual(["package/LICENSE", `package/${kind}.json`, "package/package.json", "package/src/index.ts"]);
      const packageMetadata = JSON.parse(
        readRegularFileArchive(fs.readFileSync(path.join(out, summary.archive)))
          .find(({ name }) => name === "package/package.json")!.data.toString("utf8"),
      );
      for (const exported of Object.values(packageMetadata.exports["."])) {
        expect(names).toContain(`package/${String(exported)}`.replace("./", ""));
      }
      for (const reportName of ["conformance-manifest.json", "conformance-release.json"]) {
        const report = JSON.parse(fs.readFileSync(path.join(out, reportName), "utf8"));
        expect(parseConformanceReport(report).ok).toBe(true);
      }
      const secondOut = fs.mkdtempSync(path.join(os.tmpdir(), "portable-release-out2-"));
      const second = spawnSync("node", [path.join(TEMPLATE, "build-portable-release.mjs"), "--commit", COMMIT, "--out", secondOut], { cwd: root, encoding: "utf8" });
      expect(JSON.parse(second.stdout).sha256).toBe(summary.sha256);
      fs.rmSync(secondOut, { recursive: true, force: true });
    });
  }

  it("rejects identity mismatch and undeclared manifest files", () => {
    writeFixture("kit", "soksak-kit-example");
    fs.writeFileSync(path.join(root, "kit.json"), '{"id":"other","version":"0.0.1"}\n');
    expect(build().status).not.toBe(0);
  });

  it("builds a Cargo-owned kit without inventing JavaScript metadata", () => {
    writeCargoKitFixture("soksak-kit-sidecar-example");
    const result = build();
    expect(result.status, result.stderr).toBe(0);
    const release = JSON.parse(fs.readFileSync(path.join(out, "release.json"), "utf8"));
    expect(release).toMatchObject({ kind: "kit", id: "soksak-kit-sidecar-example", version: "0.0.1" });
  });

  it("refuses a Cargo path dependency in a portable release", () => {
    writeCargoKitFixture("soksak-kit-sidecar-example");
    fs.appendFileSync(path.join(root, "Cargo.toml"), '\n[dependencies]\nlocal = { path = "/tmp/local" }\n');
    const result = build();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("local Cargo dependency is not a release input");
  });

  it("refuses a Cargo patch path in portable workspace settings", () => {
    writeCargoKitFixture("soksak-kit-sidecar-example");
    fs.mkdirSync(path.join(root, ".cargo"));
    fs.writeFileSync(path.join(root, ".cargo", "config.toml"), '[patch."https://example.invalid/repository"]\nlocal = { path = "../local" }\n');
    const result = build();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("local Cargo dependency is not a release input");
  });

  it("refuses a local Cargo package retained only in Cargo.lock", () => {
    writeCargoKitFixture("soksak-kit-sidecar-example");
    fs.writeFileSync(path.join(root, "Cargo.lock"), [
      "version = 4", "", "[[package]]", 'name = "soksak-kit-sidecar-example"', 'version = "0.0.1"', "",
      "[[package]]", 'name = "local-dependency"', 'version = "0.0.1"', "",
    ].join("\n"));
    const result = build();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("local Cargo dependency is not a release input");
  });

  it("refuses local dependency state in a portable release", () => {
    writeFixture("kit", "soksak-kit-example");
    const packagePath = path.join(root, "package.json");
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    pkg.devDependencies = { "@soksak/example": "file:/tmp/example.tgz" };
    fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
    const result = build();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("local dependency is not a release input");
  });

  it("refuses local dependency state retained only in a portable lockfile", () => {
    writeFixture("contract", "soksak-contract-example");
    fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), [
      "lockfileVersion: '9.0'",
      "packages:",
      "  '@soksak/example@file:../../tmp/example.tgz':",
      "    resolution: {tarball: file:../../tmp/example.tgz}",
      "",
    ].join("\n"));
    const files = JSON.parse(fs.readFileSync(path.join(root, "release-files.json"), "utf8"));
    files.push("pnpm-lock.yaml");
    fs.writeFileSync(path.join(root, "release-files.json"), `${JSON.stringify(files)}\n`);
    const result = build();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("local dependency is not a release input");
  });

  it("refuses an archive name outside the release file grammar", () => {
    writeFixture("kit", "soksak-kit-example");
    for (const name of ["kit.json", "package.json"]) {
      const file = path.join(root, name);
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      fs.writeFileSync(file, `${JSON.stringify({ ...value, version: "0.0.1+build.1" }, null, 2)}\n`);
    }
    const result = build();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/release file name is invalid/);
  });

  it("refuses local dependency state retained only in portable pnpm workspace settings", () => {
    writeFixture("kit", "soksak-kit-example");
    fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), [
      "overrides:",
      "  '@soksak/example': file:../candidate/example.tgz",
      "",
    ].join("\n"));
    const result = build();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("local dependency is not a release input");
  });
});
