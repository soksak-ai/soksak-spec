// Location is derived: no document records a url. resolve-release.mjs owns the derivation for the
// GitHub org and for a local store; compose-runtime-dependencies.mjs turns manifest intents
// ({ id, version }) into release references ({ id, version, size, sha256 }) through a resolver.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { composeRuntimeDependencies } from "../release-template/compose-runtime-dependencies.mjs";
import {
  MAX_RELEASE_DOCUMENT_BYTES,
  githubResolver,
  localStoreResolver,
  releaseDirectory,
  releaseResolver,
  releaseURL,
} from "../release-template/resolve-release.mjs";
import { COMPONENT_ID_RE, GITHUB_ORG, STRICT_SEMVER_RE } from "../src/release-primitives.js";

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const SIDECAR_ID = "soksak-sidecar-example";
const VERSION = "0.0.1";

function sidecarReleaseBytes(id = SIDECAR_ID, version = VERSION, kind = "sidecar"): Buffer {
  return Buffer.from(`${JSON.stringify({
    kind, id, version,
    manifest: { file: "sidecar.json", size: 1, sha256: "b".repeat(64) },
    source: { repository: `https://github.com/soksak-ai/${id}`, commit: "a".repeat(40) },
    artifacts: [{ target: "aarch64-apple-darwin", file: `${id}-${version}-aarch64-apple-darwin.tar.gz`, size: 2, sha256: "c".repeat(64), format: "tar.gz", manifest: "sidecar.json" }],
    evidence: [{ file: "conformance-release.json", size: 3, sha256: "d".repeat(64) }],
  }, null, 2)}\n`);
}

let store = "";
beforeEach(() => { store = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "resolve-store-")); });
afterEach(() => fs.rmSync(store, { recursive: true, force: true }));

function publishFixture(bytes: Buffer, kind = "sidecar", id = SIDECAR_ID, version = VERSION): string {
  const directory = releaseDirectory(store, kind, id, version);
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "release.json");
  fs.writeFileSync(file, bytes);
  return file;
}

// A fetch double that serves one release.json body as a stream and records cancellation.
function streamingFetch(bytes: Buffer, headers: Record<string, string> = {}) {
  const state = { pulls: 0, cancelled: false };
  const fetchImpl = async () => {
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        state.pulls += 1;
        if (offset >= bytes.length) { controller.close(); return; }
        controller.enqueue(new Uint8Array(bytes.subarray(offset, offset + 16)));
        offset += 16;
      },
      cancel() { state.cancelled = true; },
    }, { highWaterMark: 0 });
    return new Response(body, { status: 200, headers });
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, state };
}

describe("release location derivation", () => {
  it("derives the GitHub download url from the org constant, id, version, and bare file name", () => {
    expect(releaseURL("soksak-plugin-example", "1.2.3", "release.json"))
      .toBe(`https://github.com/${GITHUB_ORG}/soksak-plugin-example/releases/download/v1.2.3/release.json`);
  });

  it("derives the local store directory as <store>/<kind>s/<id>/<version>", () => {
    expect(releaseDirectory(store, "plugin", "soksak-plugin-example", "0.0.1"))
      .toBe(path.join(store, "plugins", "soksak-plugin-example", "0.0.1"));
    expect(releaseDirectory(store, "sidecar", SIDECAR_ID, VERSION)).toBe(path.join(store, "sidecars", SIDECAR_ID, VERSION));
    expect(() => releaseDirectory(store, "widget", SIDECAR_ID, VERSION)).toThrow(/unsupported kind/);
    expect(() => releaseDirectory("relative/store", "plugin", SIDECAR_ID, VERSION)).toThrow(/absolute/);
    expect(() => releaseDirectory(store, "plugin", "../escape", VERSION)).toThrow(/component id/);
  });

  it("builds the directory from segments validated by the component id grammar, the strict SemVer grammar, and the kind enum", () => {
    for (const id of ["Upper-Case", "dot.id", "under_score", "-leading", "a".repeat(129)]) {
      expect(COMPONENT_ID_RE.test(id)).toBe(false);
      expect(() => releaseDirectory(store, "plugin", id, VERSION), id).toThrow(/^LOCAL_RELEASE_INVALID: component id/);
    }
    // '~' is outside the SemVer grammar: a replacement staging directory never collides with a stored version.
    for (const version of ["v0.0.1", "0.0.1~next", "0.0.1~previous", "01.0.0", "0.0"]) {
      expect(STRICT_SEMVER_RE.test(version)).toBe(false);
      expect(() => releaseDirectory(store, "plugin", SIDECAR_ID, version), version).toThrow(/^LOCAL_RELEASE_INVALID: component version/);
    }
    expect(releaseDirectory(store, "plugin", SIDECAR_ID, "1.0.0-rc.1+build.7")).toBe(path.join(store, "plugins", SIDECAR_ID, "1.0.0-rc.1+build.7"));
    expect(() => releaseDirectory(store, "plugins", SIDECAR_ID, VERSION)).toThrow(/^LOCAL_RELEASE_INVALID: unsupported kind/);
  });

  // The sidecar set vendored byte-identical into sidecar repositories has no access to dist/ and
  // restates the org in release-contract.mjs; every other module derives it from the constant.
  it("derives every repository from the org constant: no template or bin module outside the vendored sidecar set restates the literal", () => {
    const template = path.resolve(import.meta.dirname, "../release-template");
    const vendored = ["archive.mjs", "native-binary.mjs", "release-contract.mjs", "build-release.mjs", "validate-with-spec.mjs"].map((name) => path.join(template, "sidecar", name));
    const modules: string[] = [];
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.name.endsWith(".mjs") && !vendored.includes(file)) modules.push(file);
      }
    };
    walk(template); walk(path.resolve(import.meta.dirname, "../bin"));
    expect(modules.length).toBeGreaterThan(10);
    for (const file of modules) expect(fs.readFileSync(file, "utf8"), file).not.toContain(GITHUB_ORG);
    const contract = fs.readFileSync(path.join(template, "sidecar", "release-contract.mjs"), "utf8");
    expect(contract).toContain(`const GITHUB_ORG = "${GITHUB_ORG}";`);
  });

  it("reads release.json from the derived local store path and names an absent release in the message only", async () => {
    const bytes = sidecarReleaseBytes();
    const file = publishFixture(bytes);
    const resolver = localStoreResolver(store);
    await expect(resolver.read({ kind: "sidecar", id: SIDECAR_ID, version: VERSION })).resolves.toEqual({ bytes, path: file });
    const absent = await resolver.read({ kind: "sidecar", id: SIDECAR_ID, version: "0.0.2" }).catch((error: Error) => error);
    expect(absent).toMatchObject({ name: "UnresolvedReleaseError", message: expect.stringContaining(`${SIDECAR_ID}@0.0.2`) });
    expect(absent).not.toHaveProperty("location");
    expect(() => localStoreResolver("relative/store")).toThrow(/absolute/);
  });

  it("fetches release.json from the derived https url and names an absent release in the message only", async () => {
    const bytes = sidecarReleaseBytes();
    const requested: string[] = [];
    const fetchImpl = async (url: string) => {
      requested.push(url);
      if (url.endsWith("/v0.0.1/release.json")) return new Response(bytes, { status: 200 });
      return new Response("missing", { status: 404 });
    };
    const resolver = githubResolver(fetchImpl as typeof fetch);
    const resolved = await resolver.read({ kind: "sidecar", id: SIDECAR_ID, version: VERSION });
    expect(resolved.url).toBe(releaseURL(SIDECAR_ID, VERSION, "release.json"));
    expect(Buffer.from(resolved.bytes).equals(bytes)).toBe(true);
    const absent = await resolver.read({ kind: "sidecar", id: SIDECAR_ID, version: "0.0.2" }).catch((error: Error) => error);
    expect(absent).toMatchObject({ name: "UnresolvedReleaseError", message: expect.stringContaining(`${SIDECAR_ID}@0.0.2`) });
    expect(absent).not.toHaveProperty("location");
    expect(requested).toEqual([releaseURL(SIDECAR_ID, VERSION, "release.json"), releaseURL(SIDECAR_ID, "0.0.2", "release.json")]);
  });

  it("refuses a declared content-length above the reference size without reading the body", async () => {
    const bytes = sidecarReleaseBytes();
    const { fetchImpl, state } = streamingFetch(bytes, { "content-length": String(bytes.length) });
    await expect(githubResolver(fetchImpl).read({ kind: "sidecar", id: SIDECAR_ID, version: VERSION, size: bytes.length - 1, sha256: sha256(bytes) }))
      .rejects.toThrow(/exceeds/);
    expect(state.pulls).toBe(0);
  });

  it("cancels the stream once the bytes exceed the reference size", async () => {
    const bytes = sidecarReleaseBytes();
    const { fetchImpl, state } = streamingFetch(bytes);
    await expect(githubResolver(fetchImpl).read({ kind: "sidecar", id: SIDECAR_ID, version: VERSION, size: 40, sha256: sha256(bytes) }))
      .rejects.toThrow(/exceeds/);
    expect(state.cancelled).toBe(true);
    expect(state.pulls).toBeLessThan(Math.ceil(bytes.length / 16));
  });

  it("reads exactly the reference size and bounds a root read without a reference by the document maximum", async () => {
    const bytes = sidecarReleaseBytes();
    const exact = await githubResolver(streamingFetch(bytes).fetchImpl).read({ kind: "sidecar", id: SIDECAR_ID, version: VERSION, size: bytes.length, sha256: sha256(bytes) });
    expect(Buffer.from(exact.bytes).equals(bytes)).toBe(true);
    const unbounded = await githubResolver(streamingFetch(bytes).fetchImpl).read({ kind: "sidecar", id: SIDECAR_ID, version: VERSION });
    expect(Buffer.from(unbounded.bytes).equals(bytes)).toBe(true);
    expect(MAX_RELEASE_DOCUMENT_BYTES).toBe(1_048_576);
    const oversized = Buffer.alloc(MAX_RELEASE_DOCUMENT_BYTES + 1, 0x20);
    await expect(githubResolver(streamingFetch(oversized, { "content-length": String(oversized.length) }).fetchImpl).read({ kind: "sidecar", id: SIDECAR_ID, version: VERSION }))
      .rejects.toThrow(/exceeds/);
  });

  it("selects the local store resolver when a store is given and the GitHub resolver otherwise", () => {
    expect(releaseResolver(store).kind).toBe("local-store");
    expect(releaseResolver(undefined).kind).toBe("github");
    expect(() => releaseResolver("relative/store")).toThrow(/absolute/);
  });
});

describe("runtime dependency composition", () => {
  it("composes release references with the size and sha256 of each dependency's release.json", async () => {
    const bytes = sidecarReleaseBytes();
    publishFixture(bytes);
    const composed = await composeRuntimeDependencies({
      intents: { sidecars: [{ id: SIDECAR_ID, version: VERSION }] },
      resolver: localStoreResolver(store),
    });
    expect(composed).toEqual({ sidecars: [{ id: SIDECAR_ID, version: VERSION, size: bytes.length, sha256: sha256(bytes) }] });
  });

  it("composes plugins and sidecars in manifest order without adding a location", async () => {
    const sidecar = sidecarReleaseBytes();
    const plugin = Buffer.from(`${JSON.stringify({
      kind: "plugin", id: "soksak-plugin-provider", version: "1.2.0",
      manifest: { file: "plugin.json", size: 1, sha256: "b".repeat(64) },
      source: { repository: "https://github.com/soksak-ai/soksak-plugin-provider", commit: "a".repeat(40) },
      artifacts: [{ target: "any", file: "soksak-plugin-provider-1.2.0-any.tgz", size: 2, sha256: "c".repeat(64), format: "tgz", manifest: "plugin.json" }],
      evidence: [{ file: "conformance-release.json", size: 3, sha256: "d".repeat(64) }],
    }, null, 2)}\n`);
    publishFixture(sidecar);
    publishFixture(plugin, "plugin", "soksak-plugin-provider", "1.2.0");
    const composed = await composeRuntimeDependencies({
      intents: { plugins: [{ id: "soksak-plugin-provider", version: "1.2.0" }], sidecars: [{ id: SIDECAR_ID, version: VERSION }] },
      resolver: localStoreResolver(store),
    });
    expect(composed).toEqual({
      plugins: [{ id: "soksak-plugin-provider", version: "1.2.0", size: plugin.length, sha256: sha256(plugin) }],
      sidecars: [{ id: SIDECAR_ID, version: VERSION, size: sidecar.length, sha256: sha256(sidecar) }],
    });
    expect(JSON.stringify(composed)).not.toContain("url");
  });

  it("returns undefined for a manifest without runtime dependencies", async () => {
    await expect(composeRuntimeDependencies({ intents: undefined, resolver: localStoreResolver(store) })).resolves.toBeUndefined();
  });

  it("fails by name when the resolver cannot read a dependency", async () => {
    await expect(composeRuntimeDependencies({
      intents: { sidecars: [{ id: SIDECAR_ID, version: VERSION }] },
      resolver: localStoreResolver(store),
    })).rejects.toMatchObject({ name: "RuntimeDependencyError", message: expect.stringContaining(`sidecar ${SIDECAR_ID}@${VERSION}`) });
  });

  it("fails by name when the resolved release is not the requested kind, id, and version", async () => {
    publishFixture(sidecarReleaseBytes(SIDECAR_ID, VERSION, "plugin"));
    await expect(composeRuntimeDependencies({
      intents: { sidecars: [{ id: SIDECAR_ID, version: VERSION }] },
      resolver: localStoreResolver(store),
    })).rejects.toMatchObject({ name: "RuntimeDependencyError", message: expect.stringContaining(`${SIDECAR_ID}@${VERSION}`) });
    publishFixture(Buffer.from("not json\n"), "sidecar", SIDECAR_ID, "0.0.2");
    await expect(composeRuntimeDependencies({
      intents: { sidecars: [{ id: SIDECAR_ID, version: "0.0.2" }] },
      resolver: localStoreResolver(store),
    })).rejects.toMatchObject({ name: "RuntimeDependencyError", message: expect.stringContaining(`${SIDECAR_ID}@0.0.2`) });
  });
});
