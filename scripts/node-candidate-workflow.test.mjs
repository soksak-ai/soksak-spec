import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("one canonical workflow builds Node component candidates for real owners", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/node-candidate.yml"), "utf8");
  for (const required of [
    "workflow_call:", "source_repository:", "source_ref:", "package_path:", "kind:", "generated:",
    "spec_artifact_name:", "spec_artifact_digest:", "spec_candidate_manifest_sha256:", "spec_source_commit:",
    "dependency_one_package_name:", "dependency_one_artifact_name:", "dependency_one_artifact_digest:",
    "dependency_one_candidate_manifest_sha256:", "dependency_one_source_commit:", "dependency_one_kind:",
    "dependency_two_package_name:", "dependency_two_artifact_name:", "dependency_two_artifact_digest:",
    "dependency_two_candidate_manifest_sha256:", "dependency_two_source_commit:", "dependency_two_kind:",
    "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
    "verify-candidate-artifact.mjs", "prepare-candidate-package-input.mjs",
    "stage-node-candidate.mjs", "build-node-candidate.mjs", "seal-candidate-artifact.mjs",
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    "if-no-files-found: error",
  ]) assert.match(workflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const forbidden of [
    "repository: soksak-ai/", "contents: write", "create-github-app-token",
    "publish-canonical-release", "gh release", "gh api",
  ]) assert.doesNotMatch(workflow, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
