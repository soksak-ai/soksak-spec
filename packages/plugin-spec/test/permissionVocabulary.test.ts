import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "../src/permissions.js";

describe("plugin permission vocabulary", () => {
  it("does not expose the removed built-in PTY permission", () => {
    expect(PERMISSIONS).not.toContain("pty");
    expect(PERMISSIONS).toContain("sidecar");
    expect(PERMISSIONS).toContain("terminal");
  });
});
