import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "../src/permissions.js";

describe("plugin permission vocabulary", () => {
  it("does not expose the removed built-in PTY permission", () => {
    expect(PERMISSIONS).not.toContain("pty");
    expect(PERMISSIONS).toContain("sidecar");
    expect(PERMISSIONS).toContain("terminal");
  });

  it("names a native surface permission apart from the webview one", () => {
    // A terminal pane composited as a native surface drives no web view; gating its label and
    // input provider behind "webview" would show a person a consent sentence that is false.
    expect(PERMISSIONS).toContain("surface");
    expect(PERMISSIONS).toContain("webview");
  });
});
