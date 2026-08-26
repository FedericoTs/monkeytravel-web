import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The point of this helper is that a boundary event stays useful when Sentry
 * cannot parse a stack — the exact state Sentry JAVASCRIPT-NEXTJS-23 arrived
 * in ("No stacktrace available"). These tests pin the fields that survive.
 */

const captureException = vi.fn();
const setTag = vi.fn();
const setContext = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  captureException: (...a: unknown[]) => captureException(...a),
  withScope: (fn: (scope: unknown) => void) => fn({ setTag, setContext }),
}));

beforeEach(() => {
  captureException.mockClear();
  setTag.mockClear();
  setContext.mockClear();
});

async function report(error: Error & { digest?: string }, type = "locale-root-error") {
  const { reportBoundaryError } = await import("./report-boundary-error");
  reportBoundaryError(error, type);
}

const ctx = () =>
  (setContext.mock.calls.find((c) => c[0] === "boundary")?.[1] ?? {}) as Record<
    string,
    unknown
  >;

describe("reportBoundaryError", () => {
  it("keeps the raw stack string, which is what survives a failed frame parse", async () => {
    const err = new Error("Cannot access 'q' before initialization");
    err.stack = "ReferenceError: Cannot access 'q'\n    at chunk.js:1:133736";
    await report(err);

    expect(ctx().rawStack).toContain("chunk.js:1:133736");
    expect(captureException).toHaveBeenCalledWith(err);
  });

  it("records a placeholder rather than dropping the field when there is no stack", async () => {
    const err = new Error("boom");
    delete (err as { stack?: string }).stack;
    await report(err);

    expect(ctx().rawStack).toMatch(/no stack present/i);
  });

  // The shape JAVASCRIPT-NEXTJS-23 actually arrived in: `stack` was a
  // function, so the first version of the helper logged "[Function:
  // <anonymous>]" and the escape hatch bought us nothing.
  it("invokes a lazily-materialised stack instead of logging [Function]", async () => {
    const err = new Error("Cannot access 'q' before initialization");
    Object.defineProperty(err, "stack", {
      value: () => "ReferenceError: Cannot access 'q' at chunk.js:1:133736",
      configurable: true,
    });
    await report(err);

    expect(ctx().rawStack).toContain("chunk.js:1:133736");
    expect(ctx().rawStack).not.toContain("[Function");
  });

  it("names the type rather than dropping it when the stack is neither string nor thunk", async () => {
    const err = new Error("boom");
    Object.defineProperty(err, "stack", { value: { frames: [] }, configurable: true });
    await report(err);

    expect(ctx().rawStack).toContain("object");
  });

  it("never throws out of the error path when reading the stack throws", async () => {
    const err = new Error("boom");
    Object.defineProperty(err, "stack", {
      value: () => {
        throw new Error("stack getter exploded");
      },
      configurable: true,
    });

    await expect(report(err)).resolves.not.toThrow();
    expect(captureException).toHaveBeenCalledWith(err);
  });

  it("captures Next's digest, the only link to the server-side error", async () => {
    const err = Object.assign(new Error("server blew up"), { digest: "3389472" });
    await report(err);

    expect(setTag).toHaveBeenCalledWith("digest", "3389472");
    expect(ctx().digest).toBe("3389472");
  });

  it("omits the digest tag when there is none, instead of tagging undefined", async () => {
    await report(new Error("client-only"));
    expect(setTag.mock.calls.map((c) => c[0])).not.toContain("digest");
  });

  it("always tags the boundary that fired", async () => {
    await report(new Error("x"), "shared-trip-error");
    expect(setTag).toHaveBeenCalledWith("errorType", "shared-trip-error");
  });

  it("does not copy the query string — tokens live in URLs", async () => {
    await report(new Error("x"));
    const serialised = JSON.stringify(ctx());
    expect(serialised).not.toMatch(/\?/);
    // pathname is allowed; href/search are not.
    expect(Object.keys(ctx())).not.toContain("href");
    expect(Object.keys(ctx())).not.toContain("search");
  });
});
