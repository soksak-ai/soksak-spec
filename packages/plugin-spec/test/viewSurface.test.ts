import { describe, expect, it } from "vitest";
import { parseManifest } from "../src/spec.js";

const manifest = (view: Record<string, unknown>) => ({
  id: "surface-demo", name: "Surface demo", version: "0.0.1", appVersionRequirement: "0.0.1", description: "Surface demo",
  permissions: ["ui"], contributes: { views: [view] },
});

describe("plugin view surfaces", () => {
  it("accepts direct tab and side surfaces", () => {
    const parsed = parseManifest(manifest({ id: "main", title: "Main", icon: "M", surfaces: ["tab", "side"] }), "surface-demo");
    expect(parsed.validation.errors, parsed.validation.errors.join("; ")) .toEqual([]);
    expect(parsed.manifest?.contributes.views[0].surfaces).toEqual(["tab", "side"]);
  });

  it("rejects the removed placement vocabulary", () => {
    const parsed = parseManifest(manifest({ id: "main", title: "Main", icon: "M", placements: ["content"] }), "surface-demo");
    expect(parsed.manifest).toBeNull();
  });
});
