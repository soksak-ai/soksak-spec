import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runLocalRelease } from "../release-template/local-release.mjs";
import {
  inspectLocalRelease,
  publishLocalRelease,
  verifyLocalReleaseStore,
} from "../release-template/local-release-store.mjs";
import { GITHUB_ORG } from "../src/release-primitives.js";

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const PLUGIN = { kind: "plugin", id: "soksak-plugin-example", version: "0.0.1" };
const SIDECAR = { kind: "sidecar", id: "soksak-sidecar-example", version: "0.0.1" };
const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);
let root = ""; let store = "";

interface Fixture { identity?: typeof PLUGIN; content?: string; commit?: string; runtimeDependencies?: Record<string, unknown> }
// A release directory as a canonical builder writes it: release.json plus the files it names.
function releaseFixture({ identity = PLUGIN, content = "archive", commit = COMMIT_A, runtimeDependencies }: Fixture = {}): string {
  const { kind, id, version } = identity;
  const directory = fs.mkdtempSync(path.join(root, "release-"));
  const target = kind === "sidecar" ? "aarch64-apple-darwin" : "any";
  const format = kind === "sidecar" ? "tar.gz" : "tgz";
  const archiveName = `${id}-${version}-${target}.${format}`;
  const archive = Buffer.from(content);
  const manifest = Buffer.from(`${JSON.stringify({ id, version })}\n`);
  const evidence = Buffer.from('{"result":"passed"}\n');
  fs.writeFileSync(path.join(directory, archiveName), archive);
  fs.writeFileSync(path.join(directory, `${kind}.json`), manifest);
  fs.writeFileSync(path.join(directory, "conformance-release.json"), evidence);
  const release = {
    kind, id, version,
    manifest: { file: `${kind}.json`, size: manifest.length, sha256: sha256(manifest) },
    source: { repository: `https://github.com/${GITHUB_ORG}/${id}`, commit },
    artifacts: [{ target, file: archiveName, size: archive.length, sha256: sha256(archive), format, manifest: `${kind}.json` }],
    ...(runtimeDependencies ? { runtimeDependencies } : {}),
    evidence: [{ file: "conformance-release.json", size: evidence.length, sha256: sha256(evidence) }],
  };
  const receipt = Buffer.from(`${JSON.stringify({
    schema: "soksak-component-build-receipt-v1",
    subject: { kind, id, version }, source: release.source, manifest: release.manifest,
    spec: { kind: "spec", id: "soksak-spec", version: "0.0.36", target: "any", file: "soksak-soksak-spec-0.0.36.tgz", size: 133017, sha256: "e".repeat(64) },
    tooling: { kind: "kit", id: "soksak-sdk", version: "0.0.7", target: "any", file: "soksak-sdk-0.0.7-any.tgz", size: 100380, sha256: "f".repeat(64) },
    command: "make verify", artifacts: release.artifacts.map(({ target, sha256 }) => ({
      target, sha256, execution: { mode: "native", platform: "linux", architecture: "x64" }, tools: { node: "26.7.0" },
    })),
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(directory, "component-build-receipt.json"), receipt);
  release.evidence.push({ file: "component-build-receipt.json", size: receipt.length, sha256: sha256(receipt) });
  release.evidence.sort((left, right) => left.file.localeCompare(right.file));
  fs.writeFileSync(path.join(directory, "release.json"), `${JSON.stringify(release, null, 2)}\n`);
  return directory;
}
// The release reference a dependent records: size and sha256 of the dependency's release.json.
function pin(directory: string, identity = SIDECAR) {
  const bytes = fs.readFileSync(path.join(directory, "release.json"));
  return { id: identity.id, version: identity.version, size: bytes.length, sha256: sha256(bytes) };
}
function refusal(action: () => unknown): string {
  try { action(); } catch (error) { return (error as Error).message; }
  throw new Error("refusal expected");
}

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "local-release-store-")); store = path.join(root, "releases"); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("canonical local release store", () => {
  it("publishes atomically and treats identical release bytes as unchanged", () => {
    const release = releaseFixture();
    const first = publishLocalRelease({ store, release });
    const second = publishLocalRelease({ store, release });
    expect(first).toMatchObject({ state: "published", ...PLUGIN });
    expect(first.directory).toBe(path.join(store, "plugins", "soksak-plugin-example", "0.0.1"));
    expect(fs.readdirSync(first.directory).sort()).toEqual(["component-build-receipt.json", "conformance-release.json", "plugin.json", "release.json", "soksak-plugin-example-0.0.1-any.tgz"]);
    expect(second).toMatchObject({ state: "unchanged", directory: first.directory });
    expect(inspectLocalRelease({ store, ...PLUGIN })).toMatchObject({ digest: first.digest });
    expect(verifyLocalReleaseStore({ store })).toMatchObject({ releases: 1 });
  });

  it("rejects different release bytes regardless of source commit and keeps the stored bytes", () => {
    const first = publishLocalRelease({ store, release: releaseFixture({ content: "first" }) });
    expect(refusal(() => publishLocalRelease({ store, release: releaseFixture({ content: "changed", commit: COMMIT_B }) }))).toMatch(/^LOCAL_RELEASE_VERSION_CONFLICT: /);
    expect(inspectLocalRelease({ store, ...PLUGIN })).toMatchObject({ digest: first.digest });
    expect(fs.readFileSync(path.join(first.directory, "soksak-plugin-example-0.0.1-any.tgz"), "utf8")).toBe("first");
  });

  it("never replaces a stored version when another commit publishes different bytes", () => {
    const first = publishLocalRelease({ store, release: releaseFixture({ content: "first" }) });
    const message = refusal(() => publishLocalRelease({ store, release: releaseFixture({ content: "second", commit: COMMIT_B }) }));
    expect(message).toMatch(/^LOCAL_RELEASE_VERSION_CONFLICT: /);
    expect(fs.readFileSync(path.join(first.directory, "soksak-plugin-example-0.0.1-any.tgz"), "utf8")).toBe("first");
    expect(JSON.parse(fs.readFileSync(path.join(first.directory, "release.json"), "utf8")).source.commit).toBe(COMMIT_A);
    expect(fs.readdirSync(path.dirname(first.directory))).toEqual(["0.0.1"]);
    expect(verifyLocalReleaseStore({ store })).toMatchObject({ releases: 1 });
  });

  it("refuses to replace a stored dependency even after every dependent is absent", () => {
    const sidecar = publishLocalRelease({ store, release: releaseFixture({ identity: SIDECAR, content: "sidecar" }) });
    const pinned = fs.readFileSync(path.join(sidecar.directory, "release.json"));
    publishLocalRelease({ store, release: releaseFixture({ runtimeDependencies: { sidecars: [pin(sidecar.directory)] } }) });
    expect(verifyLocalReleaseStore({ store })).toMatchObject({ releases: 2 });
    const replacement = releaseFixture({ identity: SIDECAR, content: "sidecar-2", commit: COMMIT_B });
    const message = refusal(() => publishLocalRelease({ store, release: replacement }));
    expect(message).toMatch(/^LOCAL_RELEASE_VERSION_CONFLICT: /);
    expect(fs.readFileSync(path.join(sidecar.directory, "release.json")).equals(pinned)).toBe(true);
    expect(fs.readdirSync(path.dirname(sidecar.directory))).toEqual(["0.0.1"]);
    // The same commit and bytes are still unchanged while in use.
    expect(publishLocalRelease({ store, release: releaseFixture({ identity: SIDECAR, content: "sidecar" }) })).toMatchObject({ state: "unchanged" });
    expect(refusal(() => publishLocalRelease({ store, release: replacement }))).toMatch(/^LOCAL_RELEASE_VERSION_CONFLICT: /);
  });

  it("verifies that every runtime dependency pin resolves inside the store with matching size and sha256", () => {
    const sidecarRelease = releaseFixture({ identity: SIDECAR, content: "sidecar" });
    publishLocalRelease({ store, release: releaseFixture({ runtimeDependencies: { sidecars: [pin(sidecarRelease)] } }) });
    const absent = refusal(() => verifyLocalReleaseStore({ store }));
    expect(absent).toMatch(/^LOCAL_RELEASE_DEPENDENCY_MISMATCH: /);
    expect(absent).toContain("plugin/soksak-plugin-example@0.0.1");
    expect(absent).toContain("sidecar/soksak-sidecar-example@0.0.1");
    expect(refusal(() => runLocalRelease(["list", "--store", store]))).toMatch(/^LOCAL_RELEASE_DEPENDENCY_MISMATCH: /);
    publishLocalRelease({ store, release: sidecarRelease });
    expect(verifyLocalReleaseStore({ store })).toMatchObject({ releases: 2 });
    publishLocalRelease({ store, release: releaseFixture({ identity: { ...PLUGIN, version: "0.0.2" }, runtimeDependencies: { sidecars: [{ ...pin(sidecarRelease), sha256: "f".repeat(64) }] } }) });
    const mismatch = refusal(() => verifyLocalReleaseStore({ store }));
    expect(mismatch).toMatch(/^LOCAL_RELEASE_DEPENDENCY_MISMATCH: /);
    expect(mismatch).toContain("sidecar/soksak-sidecar-example@0.0.1");
    expect(mismatch).toContain("digest");
  });

  it("refuses every store operation while a publication leftover exists anywhere in the store and does not repair it", () => {
    const published = publishLocalRelease({ store, release: releaseFixture() });
    // The leftover is under another kind and id: the check walks the whole store, not the siblings of one version.
    const other = path.join(store, "sidecars", SIDECAR.id);
    fs.mkdirSync(other, { recursive: true });
    for (const suffix of [`~next.${process.pid}`]) {
      const leftover = path.join(other, `${SIDECAR.version}${suffix}`);
      fs.mkdirSync(leftover);
      for (const action of [
        () => verifyLocalReleaseStore({ store }),
        () => runLocalRelease(["list", "--store", store]),
        () => publishLocalRelease({ store, release: releaseFixture({ content: "second", commit: COMMIT_B }) }),
        () => inspectLocalRelease({ store, ...PLUGIN }),
      ]) {
        const message = refusal(action);
        expect(message).toMatch(/^LOCAL_RELEASE_PUBLICATION_INTERRUPTED: /);
        expect(message).toContain(leftover);
      }
      expect(fs.existsSync(leftover)).toBe(true);
      expect(fs.readFileSync(path.join(published.directory, "soksak-plugin-example-0.0.1-any.tgz"), "utf8")).toBe("archive");
      fs.rmSync(leftover, { recursive: true });
    }
    expect(verifyLocalReleaseStore({ store })).toMatchObject({ releases: 1 });
  });

  it("ignores regular files under the kind and id directories: only directories are store entries", () => {
    const published = publishLocalRelease({ store, release: releaseFixture() });
    for (const directory of [path.join(store, "plugins"), path.dirname(published.directory)]) {
      fs.writeFileSync(path.join(directory, ".DS_Store"), "finder");
    }
    expect(verifyLocalReleaseStore({ store })).toMatchObject({ releases: 1 });
    expect(runLocalRelease(["list", "--store", store])).toMatchObject({ releases: 1 });
    expect(inspectLocalRelease({ store, ...PLUGIN })).toMatchObject({ digest: published.digest });
    expect(publishLocalRelease({ store, release: releaseFixture() })).toMatchObject({ state: "unchanged" });
    expect(verifyLocalReleaseStore({ store })).toMatchObject({ releases: 1 });
  });

  it("does not expose a command that deletes stored releases", () => {
    const sidecar = publishLocalRelease({ store, release: releaseFixture({ identity: SIDECAR, content: "sidecar" }) });
    publishLocalRelease({ store, release: releaseFixture({ runtimeDependencies: { sidecars: [pin(sidecar.directory)] } }) });
    expect(refusal(() => runLocalRelease(["delete", "--store", store, "--kind", SIDECAR.kind, "--id", SIDECAR.id, "--version", SIDECAR.version]))).toMatch(/^command must be publish, list, inspect, or verify$/);
    expect(fs.existsSync(sidecar.directory)).toBe(true);
    expect(verifyLocalReleaseStore({ store })).toMatchObject({ releases: 2 });
  });

  it("rejects partial mutation and undeclared files", () => {
    const published = publishLocalRelease({ store, release: releaseFixture() });
    fs.writeFileSync(path.join(published.directory, "extra"), "no");
    const message = refusal(() => verifyLocalReleaseStore({ store }));
    expect(message).toMatch(/^LOCAL_RELEASE_CORRUPT: /);
    expect(message).toContain(published.directory);
  });
});
