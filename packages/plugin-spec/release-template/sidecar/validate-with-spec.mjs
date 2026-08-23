#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  ROOT, assertNoLinkPath, parseOptions,
} from "./release-contract.mjs";

// The sidecar repository root is discovered by release-contract and is not passed as an option.
const options = parseOptions(process.argv.slice(2), ["spec-package", "release-dir"]);
const specPackage = assertNoLinkPath(options["spec-package"], "directory");
const releaseDir = assertNoLinkPath(options["release-dir"], "directory");
const validator = assertNoLinkPath(path.join(specPackage, "bin/validate.mjs"), "file");
const release = assertNoLinkPath(path.join(releaseDir, "release.json"), "file");
const reports = ["conformance-interface.json", "conformance-release.json", "conformance-sidecar.json"]
  .map((name) => assertNoLinkPath(path.join(releaseDir, name), "file"));
const sidecarManifest = assertNoLinkPath(path.join(ROOT, "sidecar.json"), "file");
for (const args of [["release", release], ["conformance", ...reports, "--release", release, "--sidecar-manifest", sidecarManifest]]) {
  const result = spawnSync(process.execPath, [validator, ...args], { cwd: ROOT, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`soksak-spec validator rejected release:\n${result.stderr}`);
  process.stdout.write(result.stdout);
}
