import { describe, expect, it } from "vitest";
import { parseEnvironmentDocument } from "../src/installation.js";

const empty = () => ({ revision: 1, plugins: {}, sidecars: {}, kits: {}, contracts: {}, specs: {} });

describe("environment ownership", () => {
  it("accepts materialized components and user choices in one document", () => {
    expect(parseEnvironmentDocument({ ...empty(), plugins: { demo: { version: "0.0.1", path: "/installed/demo", source: "registry", registry: "official", enabled: true, sidecars: { terminal: "terminal-provider" } } } })).toMatchObject({ ok: true });
  });
  it("accepts a development materialization without a registry", () => {
    expect(parseEnvironmentDocument({ ...empty(), sidecars: { demo: { version: "0.0.1", path: "/work/demo", source: "development", target: "aarch64-apple-darwin" } } })).toMatchObject({ ok: true });
  });
  it("rejects remote provenance copied out of the registry", () => {
    expect(parseEnvironmentDocument({ ...empty(), kits: { demo: { version: "0.0.1", path: "/installed/demo", source: "registry", registry: "official", repository: "https://example.invalid", sourceCommit: "a".repeat(40) } } }).ok).toBe(false);
  });
  it("requires registry only for managed materializations", () => {
    expect(parseEnvironmentDocument({ ...empty(), kits: { demo: { version: "0.0.1", path: "/installed/demo", source: "registry" } } }).ok).toBe(false);
    expect(parseEnvironmentDocument({ ...empty(), kits: { demo: { version: "0.0.1", path: "/work/demo", source: "development", registry: "official" } } }).ok).toBe(false);
  });
  it("discovers runtime component paths from the environment document", () => {
    const result = parseEnvironmentDocument({ ...empty(), sidecars: { pty: { version: "0.0.1", path: "/local/pty", source: "registry", registry: "official", target: "aarch64-apple-darwin" } } });
    expect(result).toMatchObject({ ok: true, value: { sidecars: { pty: { path: "/local/pty" } } } });
  });
});
