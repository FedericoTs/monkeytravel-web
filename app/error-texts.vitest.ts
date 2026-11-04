// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import ts from "typescript";
import { signUnsubscribeToken } from "@/lib/email/unsubscribe";

/**
 * A 500's text is written for the client. An error's own text (a provider's
 * message, a database's) can name a URL, a model or a credential's state, so it
 * goes to the log and to Sentry. errors.internal therefore takes written text:
 * a string, or a template that adds no error to it.
 */

const RAW = "upstream said something internal";
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    throw new Error(RAW);
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error(RAW);
  },
}));
vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: vi.fn() }));

/** Hands over a result's text; every such text is a string where the result is made. */
const WRITTEN_WHERE_MADE = new Set(["app/api/referral/complete/route.ts"]);

/** Lines where errors.internal is given something other than written text. */
export function unwrittenInternalErrors(fileName: string, source: string): number[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: number[] = [];
  const written = (arg: ts.Expression) =>
    ts.isStringLiteralLike(arg) || (ts.isTemplateExpression(arg) && !/\.message\b|\berr(or)?\b/.test(arg.getText(file)));
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "errors.internal" &&
      node.arguments.length > 0 &&
      !written(node.arguments[0])
    ) {
      found.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("the text of a 500", () => {
  it("is written, never an error's own", () => {
    const found = execSync("git ls-files app/api lib", { encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.ts$/.test(f) && !/\.vitest\.ts$/.test(f) && !WRITTEN_WHERE_MADE.has(f))
      .flatMap((file) => unwrittenInternalErrors(file, readFileSync(file, "utf8")).map((line) => `${file}:${line}`));
    expect(found, `errors.internal calls to give written text:\n${found.join("\n")}`).toEqual([]);
  }, 60_000);

  it("counts an error's text however it gets there, and nothing written", () => {
    const count = (code: string) => unwrittenInternalErrors("x.ts", code).length;
    expect(count(`errors.internal(err instanceof Error ? err.message : "Failed", "X");`)).toBe(1);
    expect(count(`errors.internal(message, "X");`)).toBe(1);
    expect(count(`errors.internal(err.message);`)).toBe(1);
    expect(count("errors.internal(`Failed: ${err.message}`);")).toBe(1);
    expect(count("errors.internal(`Failed: ${error}`);")).toBe(1);
    expect(count(`errors.internal("Failed to load", "X");`)).toBe(0);
    expect(count("errors.internal(`Failed to load`);")).toBe(0);
    expect(count("errors.internal(`Failed to load the ${label}`, label);")).toBe(0);
    expect(count(`errors.internal();`)).toBe(0);
    expect(count(`errors.badRequest(message);`)).toBe(0);
  });

  const token = () => {
    vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", randomBytes(32).toString("hex"));
    return signUnsubscribeToken("8e7d6c5b-4a39-4281-9f0e-1d2c3b4a5f6e", "tripReminders");
  };
  it.each<[string, () => Promise<Response>]>([
    [
      "importing a plan",
      async () =>
        (await import("./api/ai/import-plan/route")).POST(
          new NextRequest("http://localhost/api/ai/import-plan", { method: "POST", body: "{}" })
        ),
    ],
    [
      "the email history",
      async () => (await import("./api/notifications/email-log/route")).GET(new NextRequest("http://localhost/api/notifications/email-log")),
    ],
    [
      "unsubscribing",
      async () =>
        (await import("./api/unsubscribe/route")).POST(
          new NextRequest("http://localhost/api/unsubscribe", { method: "POST", body: JSON.stringify({ token: token() }) })
        ),
    ],
    [
      "unsubscribing from an old mail client's link",
      async () =>
        (await import("./api/unsubscribe/route")).GET(
          new NextRequest(`http://localhost/api/unsubscribe?confirm=1&token=${encodeURIComponent(token())}`)
        ),
    ],
  ])("keeps a failure's own text in the log: %s", async (_name, call) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain(RAW);
    expect(logged.mock.calls.flat().map((v) => (v instanceof Error ? v.message : String(v))).join(" ")).toContain(RAW);
    logged.mockRestore();
    vi.unstubAllEnvs();
  });
});
