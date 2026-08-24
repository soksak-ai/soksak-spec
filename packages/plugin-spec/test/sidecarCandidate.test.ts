import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { packSidecarTarget } from "../release-template/sidecar/pack-target.mjs";
import {
  buildSidecarCandidate,
  stageSidecarCandidatePackage,
} from "../release-template/sidecar/candidate.mjs";

const TARGET = "aarch64-apple-darwin";
const COMMIT = "c".repeat(40);

let source = "";
let stage = "";
let packaged = "";
let artifacts = "";
let output = "";

function macho(): Buffer {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(0x0100000c, 4);
  return bytes;
}

beforeEach(() => {
  const temporary = fs.realpathSync(os.tmpdir());
  source = fs.mkdtempSync(path.join(temporary, "sidecar-candidate-source-"));
  stage = fs.mkdtempSync(path.join(temporary, "sidecar-candidate-stage-"));
  packaged = fs.mkdtempSync(path.join(temporary, "sidecar-candidate-package-"));
  artifacts = fs.mkdtempSync(path.join(temporary, "sidecar-candidate-artifacts-"));
  output = fs.mkdtempSync(path.join(temporary, "sidecar-candidate-output-"));
  const manifest = {
    id: "soksak-sidecar-example",
    version: "0.0.1",
    interface: { id: "soksak-spec-sidecar-example", version: "0.0.1" },
    process: "dist/soksak-sidecar-example",
  };
  fs.writeFileSync(path.join(source, "sidecar.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(source, "Cargo.toml"), '[package]\nname = "soksak-sidecar-example"\nversion = "0.0.1"\npublish = false\n');
  fs.writeFileSync(path.join(source, "LICENSE"), "license\n");
  fs.mkdirSync(path.join(source, "target/build-dependencies/example-sdk/receipts"), { recursive: true });
  fs.writeFileSync(path.join(source, `target/build-dependencies/example-sdk/receipts/${TARGET}.json`), '{"receipt":true}\n');
  fs.writeFileSync(path.join(stage, "sidecar.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(stage, "soksak-sidecar-example"), macho());
  fs.mkdirSync(path.join(stage, "provider"));
  fs.writeFileSync(path.join(stage, "provider/data.bin"), "provider bytes");
});

afterEach(() => {
  for (const directory of [source, stage, packaged, artifacts, output]) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("native sidecar candidate", () => {
  it("normalizes the owner stage without knowing the provider file names", () => {
    const result = stageSidecarCandidatePackage({ source, stage, target: TARGET, output: packaged });
    expect(result).toMatchObject({ id: "soksak-sidecar-example", version: "0.0.1", target: TARGET });
    expect(fs.readdirSync(packaged).sort()).toEqual([
      "LICENSE", "build-dependency-receipts", "dist", "sidecar.json",
    ]);
    expect(fs.readFileSync(path.join(packaged, "dist/provider/data.bin"), "utf8")).toBe("provider bytes");
    expect(fs.readFileSync(path.join(packaged, "build-dependency-receipts/example-sdk.json"), "utf8")).toContain("receipt");
  });

  it("builds a one-target release and candidate evidence from the packed owner bytes", () => {
    stageSidecarCandidatePackage({ source, stage, target: TARGET, output: packaged });
    const archiveName = "soksak-sidecar-example-0.0.1-aarch64-apple-darwin.tar.gz";
    const archivePath = path.join(artifacts, archiveName);
    const packed = packSidecarTarget({ source: packaged, target: TARGET, out: archivePath });
    const result = buildSidecarCandidate({ source, sourceCommit: COMMIT, target: TARGET, artifact: archivePath, output });
    expect(result).toMatchObject({ sourceCommit: COMMIT, target: TARGET, archive: archiveName, sha256: packed.sha256 });
    const release = JSON.parse(fs.readFileSync(path.join(output, "release.json"), "utf8"));
    expect(release).toMatchObject({
      kind: "sidecar",
      id: "soksak-sidecar-example",
      source: { repository: "https://github.com/soksak-ai/soksak-sidecar-example", commit: COMMIT },
      artifacts: [{ target: TARGET, sha256: packed.sha256 }],
    });
    expect(fs.existsSync(path.join(output, "sidecar-candidate-build.json"))).toBe(true);
  });

  it("rejects links in owner stage and source receipts", () => {
    fs.symlinkSync("provider/data.bin", path.join(stage, "linked"));
    expect(() => stageSidecarCandidatePackage({ source, stage, target: TARGET, output: packaged }))
      .toThrow("symbolic link");
  });
});
