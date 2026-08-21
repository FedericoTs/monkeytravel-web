import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

/**
 * The point of the filter is that it is NARROW. A blanket DEP0169 suppression
 * would also hide the warning if our own code started calling url.parse() —
 * exactly the signal worth keeping. These tests pin that boundary.
 *
 * Each test re-imports the module via vi.resetModules(): the install guard is
 * module-level state, so without a reset only the first test would actually
 * install the wrapper and the rest would pass vacuously. (That is exactly what
 * happened on the first run of this file.)
 */

const originalEmit = process.emitWarning;

/** Fresh module + a spy standing in for the real emitter. */
async function installFresh() {
  vi.resetModules();
  const spy = vi.fn();
  process.emitWarning = spy as typeof process.emitWarning;
  const { silenceOtelUrlParseDeprecation } = await import(
    "./silence-otel-url-parse-deprecation"
  );
  silenceOtelUrlParseDeprecation();
  return spy;
}

/** Emit through a stack frame whose path looks like the otel package. */
function emitFromOtelFrame(fn: () => void) {
  const file =
    "/var/task/node_modules/@opentelemetry/instrumentation-http/build/src/utils.js";
  const runner = new Function("fn", `//# sourceURL=${file}\nreturn fn();`) as (
    f: () => void
  ) => void;
  runner(fn);
}

beforeEach(() => {
  process.emitWarning = originalEmit;
});
afterEach(() => {
  process.emitWarning = originalEmit;
});

describe("silenceOtelUrlParseDeprecation", () => {
  it("swallows DEP0169 raised from inside @opentelemetry", async () => {
    const spy = await installFresh();

    emitFromOtelFrame(() => {
      process.emitWarning(
        "url.parse() is deprecated",
        "DeprecationWarning",
        "DEP0169"
      );
    });

    expect(
      spy,
      "the otel deprecation should not reach the logger"
    ).not.toHaveBeenCalled();
  });

  it("lets DEP0169 through when it is NOT from otel — i.e. when it is ours", async () => {
    const spy = await installFresh();

    // Emitted straight from this test file: no @opentelemetry frame.
    process.emitWarning(
      "url.parse() is deprecated",
      "DeprecationWarning",
      "DEP0169"
    );

    expect(
      spy,
      "our own url.parse() deprecation must stay visible"
    ).toHaveBeenCalledTimes(1);
  });

  it("never touches unrelated warnings", async () => {
    const spy = await installFresh();

    emitFromOtelFrame(() => {
      // Same origin, different code — must pass through.
      process.emitWarning("something else", "DeprecationWarning", "DEP0040");
    });
    process.emitWarning("a plain warning");

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("supports the options-object overload", async () => {
    const spy = await installFresh();

    emitFromOtelFrame(() => {
      process.emitWarning("url.parse() is deprecated", {
        type: "DeprecationWarning",
        code: "DEP0169",
      });
    });

    expect(
      spy,
      "the object overload carries the code too"
    ).not.toHaveBeenCalled();
  });

  it("is idempotent — repeated installs do not stack wrappers", async () => {
    vi.resetModules();
    process.emitWarning = vi.fn() as typeof process.emitWarning;
    const { silenceOtelUrlParseDeprecation } = await import(
      "./silence-otel-url-parse-deprecation"
    );
    silenceOtelUrlParseDeprecation();
    const afterFirst = process.emitWarning;
    silenceOtelUrlParseDeprecation();
    expect(process.emitWarning).toBe(afterFirst);
  });
});
