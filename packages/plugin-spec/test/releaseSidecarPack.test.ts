import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readSidecarReleaseArchive } from "../release-template/sidecar/archive.mjs";
import { packSidecarTarget } from "../release-template/sidecar/pack-target.mjs";

let root = "";
let output = "";

function macho(cpu = 0x0100000c): Buffer {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(cpu, 4);
  return bytes;
}

function stage(binary = macho()): void {
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "sidecar.json"), `${JSON.stringify({
    id: "soksak-sidecar-example", version: "0.0.1",
    interface: [{ id: "soksak-spec-sidecar-example", version: "0.0.1" }],
    process: "dist/soksak-sidecar-example",
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "dist/soksak-sidecar-example"), binary);
  fs.writeFileSync(path.join(root, "LICENSE"), "license\n");
}

beforeEach(() => {
  const temporary = fs.realpathSync(os.tmpdir());
  root = fs.mkdtempSync(path.join(temporary, "sidecar-pack-source-"));
  output = path.join(fs.mkdtempSync(path.join(temporary, "sidecar-pack-output-")),
    "soksak-sidecar-example-0.0.1-aarch64-apple-darwin.tar.gz");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(path.dirname(output), { recursive: true, force: true });
});

describe("sidecar target packer", () => {
  it("creates byte-identical target archives and checksum evidence", () => {
    stage();
    const first = packSidecarTarget({ source: root, target: "aarch64-apple-darwin", out: output });
    const second = packSidecarTarget({ source: root, target: "aarch64-apple-darwin", out: output });
    expect(second).toEqual(first);
    expect(fs.readFileSync(`${output}.sha256`, "utf8")).toBe(`${first.sha256}  ${path.basename(output)}\n`);
    expect(readSidecarReleaseArchive(fs.readFileSync(output)).map((entry) => entry.name)).toEqual([
      "LICENSE", "dist/soksak-sidecar-example", "sidecar.json",
    ]);
  });

  it("refuses a staged binary for another architecture", () => {
    stage(macho(0x01000007));
    expect(() => packSidecarTarget({ source: root, target: "aarch64-apple-darwin", out: output }))
      .toThrow(/binary target.*architecture x86_64.*want arm64/);
  });

  it("refuses a symbolic link in the staged release tree", () => {
    stage();
    fs.symlinkSync("LICENSE", path.join(root, "linked-license"));
    expect(() => packSidecarTarget({ source: root, target: "aarch64-apple-darwin", out: output }))
      .toThrow(/symbolic link/);
  });

  it("stages the archive beside the output as <output>~next.<pid> and leaves no output on failure", () => {
    stage();
    fs.mkdirSync(`${output}~next.${process.pid}`);
    expect(() => packSidecarTarget({ source: root, target: "aarch64-apple-darwin", out: output }))
      .toThrow(/EEXIST|EISDIR/);
    expect(fs.existsSync(output)).toBe(false);
    expect(fs.existsSync(`${output}.sha256`)).toBe(false);
  });

  it("preserves existing evidence when the same output name receives different inputs", () => {
    stage();
    const first = packSidecarTarget({ source: root, target: "aarch64-apple-darwin", out: output });
    fs.writeFileSync(path.join(root, "LICENSE"), "changed\n");
    expect(() => packSidecarTarget({ source: root, target: "aarch64-apple-darwin", out: output }))
      .toThrow(/archive output conflict/);
    expect(fs.readFileSync(`${output}.sha256`, "utf8")).toBe(`${first.sha256}  ${path.basename(output)}\n`);
  });
});
