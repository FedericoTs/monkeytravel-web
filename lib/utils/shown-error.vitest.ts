// @vitest-environment node
import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { shownErrorText } from "./shown-error";

describe("shownErrorText", () => {
  it("shows what our own code threw", () => {
    expect(shownErrorText(new Error("Only the owner can publish"), "fallback")).toBe("Only the owner can publish");
  });

  it("shows a subclass of ours that keeps the plain name", () => {
    class Refused extends Error {}
    expect(shownErrorText(new Refused("Refused, and why"), "fallback")).toBe("Refused, and why");
  });

  it.each([
    ["Chrome's dropped connection", new TypeError("Failed to fetch")],
    ["Safari's dropped connection", new TypeError("Load failed")],
    ["Firefox's dropped connection", new TypeError("NetworkError when attempting to fetch resource.")],
    ["an HTML 504 read as JSON", new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON")],
    ["a timeout", new DOMException("signal timed out", "TimeoutError")],
    ["a cancelled request", new DOMException("The operation was aborted", "AbortError")],
  ])("uses the fallback for %s", (_name, err) => {
    expect(shownErrorText(err, "fallback")).toBe("fallback");
  });

  it.each([[new Error("")], ["a string"], [undefined], [null], [{ message: "not an Error" }]])(
    "uses the fallback when there is no message to trust: %j",
    (err) => {
      expect(shownErrorText(err, "fallback")).toBe("fallback");
    }
  );
});

describe("a translated fallback", () => {
  it("is never left behind `instanceof Error`, where it could not show", () => {
    const found = execSync("git ls-files components app hooks lib", { encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.tsx?$/.test(f) && !/\.vitest\.tsx?$/.test(f))
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .flatMap((line, i) =>
            !/^\s*(\*|\/\/)/.test(line) && /instanceof Error \? \w+\.message : t\w*\(/.test(line) ? [`${file}:${i + 1}`] : []
          )
      );
    expect(found, `use shownErrorText (lib/utils/shown-error.ts):\n${found.join("\n")}`).toEqual([]);
  }, 60_000);
});
