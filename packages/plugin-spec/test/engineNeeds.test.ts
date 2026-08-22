import { describe, expect, it } from "vitest";
import { parseManifest, unmetNeeds } from "../src/spec.js";

describe("plugin engine requirements", () => {
  it("parses public engine needs", () => {
    const parsed = parseManifest({ id: "demo", name: "Demo", version: "0.0.1", appVersionRequirement: "0.0.1", description: "Demo", permissions: [], requiresEngine: "chromium", requiresEngineModules: true }, "demo");
    expect(parsed.validation.errors).toEqual([]);
    expect(parsed.manifest).toMatchObject({ requiresEngine: "chromium", requiresEngineModules: true });
  });
  it("reports unmet needs from host facts", () => {
    expect(unmetNeeds({ requiresEngine: "chromium", requiresEngineModules: true }, { chromium: false, nativeChildWebview: true, engineModules: false, supportsDocumentStart: true, supportsInputInjection: true })).toEqual(["requiresEngine=chromium", "requiresEngineModules"]);
  });
});
