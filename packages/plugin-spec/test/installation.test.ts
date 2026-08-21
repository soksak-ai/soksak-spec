import { describe, expect, it } from "vitest";
import { parseInstalledDocument, parseSettingsDocument } from "../src/installation.js";

const empty = () => ({ revision: 1, plugins: {}, sidecars: {}, kits: {}, contracts: {}, specs: {} });
const installed = () => ({ version: "0.0.1", path: "/home/user/.soksak/installed/plugin/demo/0.0.1", registryId: "official", repository: "https://github.com/example/demo", sourceCommit: "a".repeat(40), manifestSha256: "b".repeat(64), artifactSha256: "c".repeat(64) });

describe("settings and installed ownership", () => {
  it("accepts user choices in settings", () => {
    expect(parseSettingsDocument({ ...empty(), plugins: { demo: { enabled: true, providers: { terminal: "terminal-provider" }, development: { path: "/work/demo" } } } })).toMatchObject({ ok: true });
  });
  it("rejects installation results in settings", () => {
    expect(parseSettingsDocument({ ...empty(), plugins: { demo: { enabled: true, installPath: "/installed" } } }).ok).toBe(false);
  });
  it("accepts exact installed content", () => {
    expect(parseInstalledDocument({ ...empty(), plugins: { demo: installed() } })).toMatchObject({ ok: true });
  });
  it("rejects user choices in installed records", () => {
    expect(parseInstalledDocument({ ...empty(), plugins: { demo: { ...installed(), enabled: true } } }).ok).toBe(false);
  });
});
