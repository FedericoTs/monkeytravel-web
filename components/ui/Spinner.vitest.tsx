import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { Spinner } from "./Spinner";

describe("the loading spinner", () => {
  it("spins at the size and colour it is given, hidden from screen readers", () => {
    const { container } = render(<Spinner className="w-5 h-5 text-slate-500" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("class")).toBe("animate-spin w-5 h-5 text-slate-500");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelector("circle")?.getAttribute("class")).toBe("opacity-25");
    expect(svg.querySelector("path")?.getAttribute("class")).toBe("opacity-75");
  });
});

// A spinner SVG pasted into a component drifts from the others; the ring
// gives a pasted copy away.
describe("spinners", () => {
  it("come from components/ui/Spinner, not a pasted SVG", () => {
    const files = execSync("git ls-files --cached --others --exclude-standard app components", { encoding: "utf8" })
      .split("\n")
      .filter((f) => f.endsWith(".tsx") && !f.includes(".vitest.") && f !== "components/ui/Spinner.tsx");
    const pasted = files.filter((f) => /className="opacity-25"[^>]*cx="12"/.test(readFileSync(f, "utf8").replace(/\s+/g, " ")));
    expect(pasted).toEqual([]);
  });
});
