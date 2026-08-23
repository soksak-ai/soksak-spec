import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readRegularFileArchive } from "../release-template/archive.mjs";
import { parseConformanceReport } from "../src/conformanceWire.js";
import { parseReleaseManifest } from "../src/release.js";

const TEMPLATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../release-template");
const COMMIT = "a".repeat(40);
let root = "";
let out = "";

function writeFixture(kind: "contract" | "kit", id: string): void {
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({
    name: `@soksak/${id}`, version: "0.0.1", private: true,
    repository: { type: "git", url: `git+https://github.com/soksak-ai/${id}.git` },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, `${kind}.json`), `${JSON.stringify({ id, version: "0.0.1" }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "release-files.json"), `${JSON.stringify(["LICENSE", `${kind}.json`, "src/index.ts"])}\n`);
  fs.writeFileSync(path.join(root, "LICENSE"), "MIT\n");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/index.ts"), "export const value = 1;\n");
}

function writeCargoKitFixture(id: string): void {
  fs.writeFileSync(path.join(root, "Cargo.toml"), `[package]\nname = "${id}"\nversion = "0.0.1"\nedition = "2024"\npublish = false\nrepository = "https://github.com/soksak-ai/${id}"\n`);
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
      const release = JSON.parse(fs.readFileSync(path.join(out, "release.json"), "utf8"));
      const parsed = parseReleaseManifest(release);
      expect(parsed.ok).toBe(true);
      expect(release[kind]).toEqual({ id, version: "0.0.1" });
      const names = readRegularFileArchive(fs.readFileSync(path.join(out, summary.archive))).map(({ name }) => name);
      expect(names).toEqual(["LICENSE", `${kind}.json`, "src/index.ts"]);
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
    expect(release.kit).toEqual({ id: "soksak-kit-sidecar-example", version: "0.0.1" });
  });
});
