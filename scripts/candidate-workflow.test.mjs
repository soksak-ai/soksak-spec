import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("spec owner emits a sealed candidate artifact without publication authority", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/candidate.yml"), "utf8");
  for (const required of [
    "workflow_dispatch:",
    "workflow_call:",
    "source_repository:",
    "source_ref:",
    "contents: read",
    "persist-credentials: false",
    "git -C source rev-parse HEAD",
    "working-directory: source",
    "make verify",
    "candidate-output/release.json",
    "seal-candidate-artifact.mjs",
    "verify-candidate-artifact.mjs",
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    "if-no-files-found: error",
  ]) assert.match(workflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const forbidden of [
    "contents: write",
    "create-github-app-token",
    "publish-release",
    "gh release",
    "gh api",
    "github.workflow_ref",
    "repository: soksak-ai/soksak-spec",
  ]) assert.doesNotMatch(workflow, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
