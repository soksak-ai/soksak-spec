import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { publishVerifiedCandidate } from "../release-template/verified-release-output.mjs";

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

let root = "";
let output = "";

function candidate(name: string, artifact = "same bytes\n"): string {
  const directory = fs.mkdtempSync(path.join(root, `${name}-`));
  fs.writeFileSync(path.join(directory, "plugin.tgz"), artifact);
  fs.writeFileSync(path.join(directory, "release.json"), `${JSON.stringify({
    kind: "plugin", id: "soksak-plugin-example", version: "0.0.1",
    evidence: [], artifacts: [{ file: "plugin.tgz" }],
  }, null, 2)}\n`);
  return directory;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "verified-release-output-"));
  output = path.join(root, "final");
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("verified plugin release output", () => {
  it("publishes once by rename and leaves an equal repeated build unchanged", () => {
    const first = candidate("first");
    expect(publishVerifiedCandidate(first, output).state).toBe("created");
    const before = fs.readFileSync(path.join(output, "release.json"));

    const second = candidate("second");
    expect(publishVerifiedCandidate(second, output).state).toBe("unchanged");
    expect(fs.readFileSync(path.join(output, "release.json"))).toEqual(before);
    expect(fs.existsSync(second)).toBe(true);
  });

  it("recognises the same base after canonical attestation without deleting the receipt", () => {
    publishVerifiedCandidate(candidate("first"), output);
    const receipt = Buffer.from("{\"schema\":\"soksak-component-build-receipt-v1\"}\n");
    fs.writeFileSync(path.join(output, "component-build-receipt.json"), receipt);
    const releasePath = path.join(output, "release.json");
    const release = JSON.parse(fs.readFileSync(releasePath, "utf8"));
    release.evidence.push({ file: "component-build-receipt.json", size: receipt.length, sha256: sha256(receipt) });
    fs.writeFileSync(releasePath, `${JSON.stringify(release, null, 2)}\n`);
    const attested = fs.readFileSync(releasePath);

    expect(publishVerifiedCandidate(candidate("repeat"), output).state).toBe("unchanged");
    expect(fs.readFileSync(releasePath)).toEqual(attested);
    expect(fs.readFileSync(path.join(output, "component-build-receipt.json"))).toEqual(receipt);
  });

  it("refuses different bytes and preserves the completed output", () => {
    publishVerifiedCandidate(candidate("first"), output);
    const before = fs.readFileSync(path.join(output, "plugin.tgz"));
    const different = candidate("different", "different bytes\n");

    expect(() => publishVerifiedCandidate(different, output)).toThrow(/differs from the candidate/);
    expect(fs.readFileSync(path.join(output, "plugin.tgz"))).toEqual(before);
    expect(fs.existsSync(different)).toBe(true);
  });
});
