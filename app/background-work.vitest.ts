// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Work a route or a server page leaves running after its response is lost
 * when the function is frozen, which a serverless host does once the response
 * is sent: it goes in waitUntil or after(), or into a helper that keeps itself
 * alive. A `void (async () => …)()` or `void fn(…)` in a route, page or layout
 * fails here unless fn is one of these.
 */
const KEPT_ALIVE: Record<string, string> = {
  captureServerEvent: "flushes through waitUntil itself (lib/posthog/server.ts)",
  logFunnelEventServer: "writes in waitUntil itself (lib/analytics/funnel-events.ts)",
  recordAiOutcome: "logs its line before its first await; only a Sentry breadcrumb can be lost",
};

const FLOATING = /^\s*void\s+(\(async|([\w.]+)\s*\()/gm;

/** Routes, pages and layouts. */
function entryFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entryFiles(path);
    return /^(route\.tsx?|page\.tsx|layout\.tsx)$/.test(entry.name) ? [path] : [];
  });
}

/** Each floating statement in a file's `text` that no helper keeps alive; none in a browser file. */
function floatingIn(text: string): string[] {
  if (/^\s*["']use client["']/m.test(text.slice(0, 200))) return [];
  return [...text.matchAll(FLOATING)]
    .filter((m) => !(m[2] && KEPT_ALIVE[m[2].split(".").pop() as string]))
    .map((m) => `${text.slice(0, m.index).split("\n").length}: void ${m[2] ?? m[1]}`);
}

describe("work left running after a response", () => {
  it("is kept alive: in waitUntil, after(), or a helper that does it", () => {
    const root = process.cwd();
    const floating = entryFiles(join(root, "app")).flatMap((file) =>
      floatingIn(readFileSync(file, "utf8")).map((at) => `${relative(root, file).replace(/\\/g, "/")}:${at}`)
    );
    expect(floating).toEqual([]);
  });

  it("is found however it is written", () => {
    const route = [
      "  void (async () => {",
      "  void sendVoteEmail({ tripId });",
      "    void lib.scheduleTripNotifications(args);",
      "  void captureServerEvent(id, \"trip_liked\");",
      "  waitUntil(sendVoteEmail({ tripId }));",
      "  await logApiCall(row);",
    ].join("\n");
    expect(floatingIn(route)).toEqual(["1: void (async", "2: void sendVoteEmail", "3: void lib.scheduleTripNotifications"]);
    // A browser isn't frozen after a response.
    expect(floatingIn(`"use client";\n\n${route}`)).toEqual([]);
  });
});
