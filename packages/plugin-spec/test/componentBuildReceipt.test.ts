import { describe, expect, it } from "vitest";

import {
  parseComponentBuildReceipt,
  verifyComponentBuildReceipt,
} from "../src/componentBuildReceipt";
import type { ReleaseDocument } from "../src/release";
import type { ReleaseKind } from "../src/release-primitives";

const commit = "a".repeat(40);
const sha = (value: string) => value.repeat(64);

function release(kind: ReleaseKind): ReleaseDocument {
  const target = kind === "sidecar" ? "aarch64-apple-darwin" : "any";
  return {
    kind, id: `soksak-${kind}-example`, version: "1.2.3",
    source: { repository: `https://github.com/soksak-ai/soksak-${kind}-example`, commit },
    manifest: { file: `${kind}.json`, size: 123, sha256: sha("b") },
    artifacts: [{
      target, file: `soksak-${kind}-example-1.2.3-${target}.${kind === "sidecar" ? "tar.gz" : "tgz"}`,
      size: 456, sha256: sha("c"), format: kind === "sidecar" ? "tar.gz" : "tgz",
      manifest: `${kind}.json`,
    }],
    evidence: [{ file: "conformance-release.json", size: 12, sha256: sha("d") }],
  } as ReleaseDocument;
}

function receipt(kind: ReleaseKind) {
  const built = release(kind);
  return {
    schema: "soksak-component-build-receipt-v1",
    subject: { kind, id: built.id, version: built.version },
    source: built.source,
    manifest: built.manifest,
    spec: { kind: "spec", id: "soksak-spec", version: "0.0.36", size: 1000, sha256: sha("e") },
    tooling: { kind: "kit", id: "soksak-sdk", version: "0.0.1", size: 2000, sha256: sha("f") },
    command: "make verify",
    execution: { mode: "native", platform: "darwin", architecture: "arm64" },
    tools: { node: "26.7.0", pnpm: "11.22.0" },
    artifacts: built.artifacts.map(({ target, sha256 }) => ({ target, sha256 })),
  };
}

describe("component build receipt", () => {
  it("binds all five component kinds to exact Spec, tooling, source, manifest, and artifacts", () => {
    for (const kind of ["plugin", "sidecar", "kit", "contract", "spec"] as const) {
      const parsed = parseComponentBuildReceipt(receipt(kind));
      expect(parsed.subject.kind).toBe(kind);
      expect(() => verifyComponentBuildReceipt({ receipt: parsed, release: release(kind) })).not.toThrow();
    }
  });

  it("does not make an author SDK package part of release identity", () => {
    const value = { ...receipt("plugin"), sdk: { name: "@soksak/plugin-sdk", version: "1.0.0" } };
    expect(() => parseComponentBuildReceipt(value)).toThrow(/unknown key/);
  });

  it("rejects noncanonical commands, runtime shapes, and release drift", () => {
    expect(() => parseComponentBuildReceipt({ ...receipt("plugin"), command: "pnpm build" })).toThrow(/make verify/);
    expect(() => parseComponentBuildReceipt({
      ...receipt("plugin"), execution: { mode: "fallback", platform: "darwin", architecture: "arm64" },
    })).toThrow(/execution/);
    expect(() => parseComponentBuildReceipt({ ...receipt("plugin"), tools: { node: "latest" } })).toThrow(/tool version/);

    const changed = release("plugin");
    changed.artifacts[0] = { ...changed.artifacts[0], sha256: sha("0") };
    expect(() => verifyComponentBuildReceipt({ receipt: receipt("plugin"), release: changed })).toThrow(/artifact/);
  });
});
