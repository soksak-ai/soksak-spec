import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("spec owner emits a sealed candidate artifact without publication authority", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/candidate.yml"), "utf8");
  for (const required of [
    "workflow_dispatch:",
    "contents: read",
    "persist-credentials: false",
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
  ]) assert.doesNotMatch(workflow, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
