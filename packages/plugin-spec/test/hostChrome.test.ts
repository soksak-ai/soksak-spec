import { describe, expect, it } from "vitest";
import { scanHostChromeViolations } from "../src/hostChrome.js";

describe("host chrome ownership", () => {
  it("reports every owned selector and variable assignment", () => {
    const source = ".sidebar-body-tabs{height:40px}.sidebar-body-tab{padding:0}.ft-header{height:40px}:root{--header-h:40px}";
    expect(scanHostChromeViolations(source)).toEqual(expect.arrayContaining([".sidebar-body-tabs", ".sidebar-body-tab", ".ft-header", "--header-h"]));
  });
  it("does not treat comments and prose as CSS assignments", () => {
    expect(scanHostChromeViolations("/* .sidebar-body-tab */ const text='.content-tabs';")).toEqual([]);
  });
});
