import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("canonical macOS workflow builds sealed native sidecar candidates", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/sidecar-candidate.yml"), "utf8");
  for (const required of [
    "workflow_call:", "source_repository:", "source_ref:", "language:", "profile:",
    "spec_artifact_name:", "spec_artifact_digest:", "spec_candidate_manifest_sha256:", "spec_source_commit:",
    "runs-on: macos-15", "aarch64-apple-darwin",
    "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
    "actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e",
    "dtolnay/rust-toolchain@4be7066ada62dd38de10e7b70166bc74ed198c30",
    "mlugg/setup-zig@d1434d08867e3ee9daa34448df10607b98908d29",
    "actions/setup-python@a309ff8b426b58ec0e2a45f0f869d46889d02405",
    "KyleMayes/install-llvm-action@ebc0426251bc40c7cd31162802432c68818ab8f0",
    "make verify", "make stage",
    "stage-candidate-package.mjs", "pack-target.mjs", "build-candidate.mjs",
    "seal-candidate-artifact.mjs", "verify-candidate-artifact.mjs",
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    "if-no-files-found: error",
  ]) assert.match(workflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const forbidden of [
    "repository: soksak-ai/", "{ value: ${{", "contents: write", "create-github-app-token",
    "publish-canonical-release", "gh release", "gh api", "x86_64-apple-darwin",
  ]) assert.doesNotMatch(workflow, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
