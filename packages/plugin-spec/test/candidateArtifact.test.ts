import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createCandidateInputReceipt,
  sealCandidateArtifact,
  verifyCandidateArtifact,
} from "../release-template/candidate-artifact.mjs";

const SOURCE_COMMIT = "1".repeat(40);
const REPOSITORY = "https://github.com/soksak-ai/soksak-contract-example";

let directory = "";

function digest(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function write(name: string, body: Buffer | string): { size: number; sha256: string } {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  fs.writeFileSync(path.join(directory, name), bytes);
  return { size: bytes.length, sha256: digest(bytes) };
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-artifact-"));
  const component = write("contract.json", '{"id":"soksak-contract-example","version":"0.0.1"}\n');
  const archive = write("soksak-contract-example-0.0.1-any.tgz", "candidate archive bytes");
  const evidence = write("conformance-release.json", '{"result":"passed"}\n');
  const release = {
    kind: "contract",
    id: "soksak-contract-example",
    version: "0.0.1",
    manifest: {
      url: `${REPOSITORY}/releases/download/v0.0.1/contract.json`,
      ...component,
    },
    source: { repository: REPOSITORY, commit: SOURCE_COMMIT },
    artifacts: [{
      target: "any",
      url: `${REPOSITORY}/releases/download/v0.0.1/soksak-contract-example-0.0.1-any.tgz`,
      ...archive,
      format: "tgz",
      manifest: "contract.json",
    }],
    evidence: [{
      url: `${REPOSITORY}/releases/download/v0.0.1/conformance-release.json`,
      ...evidence,
    }],
  };
  write("release.json", `${JSON.stringify(release, null, 2)}\n`);
  write("candidate-build.json", `${JSON.stringify({
    kind: "portable",
    sourceCommit: SOURCE_COMMIT,
    packagePath: "package.json",
    dependencies: [],
    generated: ["dist"],
    archive: "soksak-contract-example-0.0.1-any.tgz",
    sha256: archive.sha256,
  }, null, 2)}\n`);
});

afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

describe("nonpublishing candidate artifact", () => {
  it("seals one exact regular-file inventory and verifies it again", () => {
    const manifest = sealCandidateArtifact({ directory });
    expect(manifest).toMatchObject({
      schema: "soksak-candidate-artifact-v1",
      component: { kind: "contract", id: "soksak-contract-example", version: "0.0.1" },
      source: { repository: REPOSITORY, commit: SOURCE_COMMIT },
      release: { path: "release.json", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
    });
    expect(manifest.files.map((file: { path: string }) => file.path)).toEqual([
      "candidate-build.json",
      "conformance-release.json",
      "contract.json",
      "release.json",
      "soksak-contract-example-0.0.1-any.tgz",
    ]);
    expect(verifyCandidateArtifact({ directory })).toEqual(manifest);
  });

  it("rejects changed bytes and undeclared files", () => {
    sealCandidateArtifact({ directory });
    fs.appendFileSync(path.join(directory, "soksak-contract-example-0.0.1-any.tgz"), "changed");
    expect(() => verifyCandidateArtifact({ directory })).toThrow("candidate artifact file digest mismatch");

    fs.writeFileSync(path.join(directory, "soksak-contract-example-0.0.1-any.tgz"), "candidate archive bytes");
    sealCandidateArtifact({ directory });
    fs.writeFileSync(path.join(directory, "ambient.txt"), "not declared");
    expect(() => verifyCandidateArtifact({ directory })).toThrow("candidate artifact inventory mismatch");
  });

  it("rejects build evidence for another source commit", () => {
    const build = JSON.parse(fs.readFileSync(path.join(directory, "candidate-build.json"), "utf8"));
    build.sourceCommit = "2".repeat(40);
    fs.writeFileSync(path.join(directory, "candidate-build.json"), `${JSON.stringify(build, null, 2)}\n`);
    expect(() => sealCandidateArtifact({ directory })).toThrow("candidate build source commit differs from release source");
  });

  it("is deterministic when resealing an unchanged directory", () => {
    sealCandidateArtifact({ directory });
    const first = fs.readFileSync(path.join(directory, "candidate-artifact.json"));
    sealCandidateArtifact({ directory });
    expect(fs.readFileSync(path.join(directory, "candidate-artifact.json"))).toEqual(first);
  });

  it("records a downloaded candidate as a validation input without making it a runtime dependency", () => {
    const manifest = sealCandidateArtifact({ directory });
    const manifestBytes = fs.readFileSync(path.join(directory, "candidate-artifact.json"));
    const receipt = createCandidateInputReceipt({
      directory,
      artifactName: `candidate-${manifest.component.id}-${manifest.source.commit}`,
      artifactDigest: "a".repeat(64),
      candidateManifestSHA256: digest(manifestBytes),
    });
    expect(receipt).toEqual({
      schema: "soksak-candidate-input-receipt-v1",
      artifact: {
        name: `candidate-${manifest.component.id}-${manifest.source.commit}`,
        sha256: "a".repeat(64),
        candidateManifestSHA256: digest(manifestBytes),
      },
      component: manifest.component,
      source: manifest.source,
    });
    expect(() => createCandidateInputReceipt({
      directory,
      artifactName: "candidate-invalid",
      artifactDigest: "a".repeat(64),
      candidateManifestSHA256: "0".repeat(64),
    })).toThrow("candidate manifest digest mismatch");
  });
});
