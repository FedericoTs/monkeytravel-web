/** @vitest-environment node */
/**
 * A first visit reserves the docked assistant's column on <main>. For a
 * browser that has already met the assistant (the layout's script marks
 * <html> before paint), CSS keeps the column centred instead, so letting the
 * reservation go after hydration moves nothing. Asserted against the sources.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const read = (path: string) => readFileSync(join(__dirname, path), "utf8");
const PAGE = read("TripDetailClient.tsx");
const CSS = read("../../../../globals.css");
const LAYOUT = read("../../../layout.tsx");

describe("the trip page's reserved assistant column", () => {
  it("is marked on <main> only while reserved and the assistant is closed", () => {
    expect(PAGE).toMatch(/data-assistant-dock=\{assistantDockReserved && !isAIAssistantOpen \? "reserved" : undefined\}/);
  });

  it("stays centred at the docking breakpoint for a browser that has met the assistant", () => {
    expect(PAGE).toMatch(/"lg:mr-\[420px\]"/);
    expect(CSS).toMatch(
      /@media \(min-width: 1024px\) \{\s*html\[data-assistant-seen\] main\[data-assistant-dock="reserved"\] \{\s*margin-right: auto;\s*\}/
    );
  });

  it("gets its marker from the layout, before paint", () => {
    expect(LAYOUT).toMatch(/<script \{\.\.\.assistantSeenScriptProps\(\)\} \/>/);
    expect(LAYOUT).toMatch(/<html [^>]*suppressHydrationWarning/);
  });
});
