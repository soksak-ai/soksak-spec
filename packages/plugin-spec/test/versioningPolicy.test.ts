import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseContractProviderRef,
  parseContractRequirement,
  parseManifest,
  parseSidecarManifest,
} from "../src/spec.js";

type Example = { id: string; kind: string; value: unknown };

const docs = join(import.meta.dirname, "../docs");
const english = readFileSync(join(docs, "VERSIONING.md"), "utf8");
const korean = readFileSync(join(docs, "VERSIONING.ko.md"), "utf8");

function ruleIds(document: string): string[] {
  return [...document.matchAll(/<!-- rule:([a-z0-9-]+) -->/g)].map((match) => match[1]);
}

function examples(document: string): Example[] {
  const fence = String.fromCharCode(96).repeat(3);
  const pattern = new RegExp("<!-- example:([a-z0-9-]+):([a-z0-9-]+) -->\\s*" + fence + "json\\s*([\\s\\S]*?)\\s*" + fence, "g");
  return [...document.matchAll(pattern)]
    .map((match) => ({ id: match[1], kind: match[2], value: JSON.parse(match[3]) }));
}

function example(id: string): Example {
  const found = examples(english).find((item) => item.id === id);
  if (!found) throw new Error("missing versioning example " + id);
  return found;
}

describe("normative versioning documents", () => {
  it("keeps the Korean translation structurally identical to the English source", () => {
    expect(ruleIds(korean)).toEqual(ruleIds(english));
    expect(examples(korean)).toEqual(examples(english));
    expect(korean).toContain("[VERSIONING.md](VERSIONING.md)");
  });

  it("uses unique rule and example identifiers", () => {
    const rules = ruleIds(english);
    const fixtures = examples(english).map(({ id }) => id);
    expect(new Set(rules).size).toBe(rules.length);
    expect(new Set(fixtures).size).toBe(fixtures.length);
    expect(rules.length).toBeGreaterThanOrEqual(9);
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
  });
});

describe("documented 0.0.1 versioning contract", () => {
  it("accepts documented plugin manifests and requires appVersionRequirement", () => {
    for (const id of ["plugin-valid", "terminal-plugin-valid"]) {
      const value = example(id).value as Record<string, unknown>;
      const parsed = parseManifest(value, value.id as string);
      expect(parsed.validation.errors, id).toEqual([]);
      expect(parsed.manifest).toMatchObject({ appVersionRequirement: "0.0.1" });
    }
    const withoutRequirement = { ...(example("plugin-valid").value as Record<string, unknown>) };
    delete withoutRequirement.appVersionRequirement;
    expect(parseManifest(withoutRequirement, withoutRequirement.id as string).validation.ok).toBe(false);
  });

  it("rejects the obsolete minimum field and an unproved app range", () => {
    for (const id of ["plugin-obsolete-minimum", "plugin-unproved-range"]) {
      const value = example(id).value as Record<string, unknown>;
      expect(parseManifest(value, value.id as string).validation.ok, id).toBe(false);
    }
  });

  it("keeps provider versions exact and names consumer conditions requirement", () => {
    const providerErrors: string[] = [];
    expect(parseContractProviderRef(example("provider-valid").value, "provider", providerErrors)).toEqual(example("provider-valid").value);
    expect(providerErrors).toEqual([]);

    const requirementErrors: string[] = [];
    expect(parseContractRequirement(example("consumer-valid").value, "consumer", requirementErrors)).toEqual(example("consumer-valid").value);
    expect(requirementErrors).toEqual([]);

    for (const id of ["consumer-provider-shape", "consumer-wildcard"]) {
      const errors: string[] = [];
      expect(parseContractRequirement(example(id).value, id, errors), id).toBeNull();
      expect(errors.length, id).toBeGreaterThan(0);
    }
  });

  it("accepts the documented sidecar provider without an app requirement", () => {
    expect(parseSidecarManifest(example("terminal-sidecar-valid").value)).toMatchObject({ ok: true });
  });
});
