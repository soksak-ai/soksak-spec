import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const docs = join(import.meta.dirname, "../docs");
const english = readFileSync(join(docs, "BUILD-AND-RELEASE.md"), "utf8");
const korean = readFileSync(join(docs, "BUILD-AND-RELEASE.ko.md"), "utf8");
const rules = (value: string) => [...value.matchAll(/<!-- rule:([a-z0-9-]+) -->/g)].map((match) => match[1]);

describe("component tooling policy", () => {
  it("keeps the normative Korean structure aligned with English", () => {
    expect(rules(korean)).toEqual(rules(english));
    expect(rules(english)).toEqual(["component-tooling-receipt", "sdk-not-release-identity"]);
  });

  it("requires one receipt for all five kinds without making an SDK dependency release identity", () => {
    for (const document of [english, korean]) {
      expect(document).toContain("soksak-component-build-receipt-v1");
      expect(document).toContain("soksak-component-tools");
      expect(document).toContain("make verify");
      for (const kind of ["Plugin", "Sidecar", "Kit", "Contract", "Spec"]) expect(document).toContain(kind);
      expect(document).toContain("SDK dependency");
    }
  });
});
