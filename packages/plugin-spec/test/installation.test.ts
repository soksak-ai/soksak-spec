import { describe, expect, it } from "vitest";
import { parseEnvironmentDocument } from "../src/installation.js";

const empty = () => ({ revision: 1, plugins: {}, sidecars: {} });
const digest = "a".repeat(64);

describe("environment ownership", () => {
  it("accepts materialized components without plugin role bindings", () => {
    expect(parseEnvironmentDocument({ ...empty(), plugins: { demo: { version: "0.0.1", path: "/installed/demo", artifactSha256: digest, source: "registry", registry: "official", enabled: true } } })).toMatchObject({ ok: true });
    expect(parseEnvironmentDocument({ ...empty(), plugins: { demo: { version: "0.0.1", path: "/installed/demo", artifactSha256: digest, source: "registry", registry: "official", enabled: true, sidecars: { terminal: "terminal-provider" } } } }).ok).toBe(false);
  });
  it("accepts a development materialization without a registry", () => {
    expect(parseEnvironmentDocument({ ...empty(), sidecars: { demo: { version: "0.0.1", path: "/work/demo", artifactSha256: digest, source: "local", target: "aarch64-apple-darwin" } } })).toMatchObject({ ok: true });
  });
  it("rejects retired raw development sources and missing artifact identity", () => {
    expect(parseEnvironmentDocument({ ...empty(), sidecars: { demo: { version: "0.0.1", path: "/work/demo", artifactSha256: digest, source: "development", target: "aarch64-apple-darwin" } } }).ok).toBe(false);
    expect(parseEnvironmentDocument({ ...empty(), sidecars: { demo: { version: "0.0.1", path: "/work/demo", source: "local", target: "aarch64-apple-darwin" } } }).ok).toBe(false);
  });
  it("rejects remote provenance copied out of the registry", () => {
    expect(parseEnvironmentDocument({ ...empty(), plugins: { demo: { version: "0.0.1", path: "/installed/demo", artifactSha256: digest, source: "registry", registry: "official", enabled: false, repository: "https://example.invalid" } } }).ok).toBe(false);
  });
  it("requires registry only for managed materializations", () => {
    expect(parseEnvironmentDocument({ ...empty(), plugins: { demo: { version: "0.0.1", path: "/installed/demo", artifactSha256: digest, source: "registry", enabled: false } } }).ok).toBe(false);
    expect(parseEnvironmentDocument({ ...empty(), plugins: { demo: { version: "0.0.1", path: "/work/demo", artifactSha256: digest, source: "local", registry: "official", enabled: false } } }).ok).toBe(false);
  });
  it("discovers runtime component paths from the environment document", () => {
    const result = parseEnvironmentDocument({ ...empty(), sidecars: { pty: { version: "0.0.1", path: "/local/pty", artifactSha256: digest, source: "registry", registry: "official", target: "aarch64-apple-darwin" } } });
    expect(result).toMatchObject({ ok: true, value: { sidecars: { pty: { path: "/local/pty" } } } });
  });
});
