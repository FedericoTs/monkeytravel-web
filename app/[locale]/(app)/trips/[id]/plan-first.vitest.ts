/** @vitest-environment node */
/**
 * The saved trip page puts the plan first. Who is going, confirming, getting
 * ready and booking ahead used to be cards between the header and Day 1, two
 * to three phone screens of them; they are the chips of one row now
 * (components/trip/TripStrip.tsx), each opening on a tap. Asserted against the
 * source, as the page needs a signed-in session to render; the browser suite
 * opens each chip (tests/e2e/book-ahead, participants, trip-status).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(join(__dirname, "TripDetailClient.tsx"), "utf8").replace(/\r\n/g, "\n");
const main = SRC.slice(SRC.indexOf("      <main\n"));
const items = SRC.slice(SRC.indexOf("const stripItems: TripStripItem[] = [];"), SRC.indexOf("const todayView = showToday"));
const CARDS = ["<WhoIsGoingCard", "<ConfirmTripCard", "<CountdownHero", "<PreTripChecklist", "<BookAheadList"];

describe("the saved trip page, plan first", () => {
  it("opens its main area with the row of chips, before the controls and the days", () => {
    const strip = main.indexOf("<TripStrip");
    expect(strip).toBeGreaterThan(-1);
    expect(main.slice(0, strip)).not.toMatch(/<[A-Z][A-Za-z]+/);
    expect(strip).toBeLessThan(main.indexOf("<TripControlsBar"));
    expect(strip).toBeLessThan(main.indexOf("<TripDayList"));
  });

  it.each(CARDS)("keeps %s out of the page's flow, as a chip's card", (card) => {
    expect(main).not.toContain(card);
    expect(items).toContain(card);
  });

  it("offers each chip to those its card was for", () => {
    expect(items).toMatch(/if \(isOwner && participantsEnabled && !isEditMode\) \{\s*stripItems\.push\(\{\s*id: "who"/);
    expect(items).toMatch(/if \(shownStatus === "planning" && isOwner\) \{\s*stripItems\.push\(\{\s*id: "confirm"/);
    expect(items).toMatch(/if \(isPreTripPhase\) \{[\s\S]*?id: "ready"/);
    expect(items).toMatch(/if \(isPreTripPhase && isOwner && stopsToBook > 0\) \{\s*stripItems\.push\(\{\s*id: "book"/);
    expect(items).toMatch(/\{isOwner && \(\s*<PreTripChecklist/);
  });

  // The map is a screen tall on a phone. The server page tells a phone by its
  // request (lib/device/phone-request.ts), so the first paint is already right.
  it("starts the map closed on a phone, open elsewhere, behind the same button", () => {
    expect(SRC).toContain("mapOpenAtFirst = true,");
    expect(SRC).toContain("const [showMap, setShowMap] = useState(mapOpenAtFirst);");
    const page = readFileSync(join(__dirname, "page.tsx"), "utf8").replace(/\r\n/g, "\n");
    expect(page).toContain("const onPhone = isPhoneRequest(await headers());");
    expect(page).toContain("mapOpenAtFirst={!onPhone}");
  });

  it("keeps the group's card and the book-ahead list alive while closed: they hold a count and ticks", () => {
    const kept = [...items.matchAll(/id: "(\w+)"[\s\S]*?(?=stripItems\.push|$)/g)]
      .filter((m) => m[0].includes("keepMounted: true"))
      .map((m) => m[1]);
    expect(kept).toEqual(["who", "book"]);
    expect(items).toContain("onCount={setGoingCount}");
    expect(items).toContain("onProgress={setBookedCount}");
  });
});
