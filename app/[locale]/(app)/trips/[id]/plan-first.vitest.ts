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

  it("tells a solo owner about editing in place under the first day, not above the plan", () => {
    const list = main.indexOf("<TripDayList");
    expect(main.slice(0, list)).not.toContain("detail.ambientEditHint");
    const passed = main.slice(list, main.indexOf("\n        />", list));
    expect(passed).toMatch(/afterFirstDay=\{\s*ambientEdit \?/);
    expect(passed).toContain('t("detail.ambientEditHint")');
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

  // On the live site the owner's /explore bar was one more row above the plan.
  it("makes a chip of the explore bar when the server page sends one", () => {
    expect(main).not.toContain("{engagementSlot");
    expect(items).toMatch(/if \(engagementSlot\) \{\s*stripItems\.push\(\{\s*id: "explore"/);
    const page = readFileSync(join(__dirname, "page.tsx"), "utf8").replace(/\r\n/g, "\n");
    expect(page).toMatch(/engagementSlot=\{\s*isExploreUgcEnabled\(\) && \(isPublic \|\| isOwnerView\) \? \(/);
  });

  it("keeps the group's card, the book-ahead list and the explore bar alive while closed: they hold counts, ticks and presses", () => {
    const kept = [...items.matchAll(/id: "(\w+)"[\s\S]*?(?=stripItems\.push|$)/g)]
      .filter((m) => m[0].includes("keepMounted: true"))
      .map((m) => m[1]);
    expect(kept).toEqual(["who", "book", "explore"]);
    expect(items).toContain("onCount={setGoingCount}");
    expect(items).toContain("onProgress={setBookedCount}");
  });

  // The page asks for the crew's votes after it has drawn. What that read
  // brings (the votes, or a nudge to send the trip) arrived above the days and
  // pushed the first stop down a moment after the visitor had seen it.
  it("keeps what arrives late about the crew under the days", () => {
    const days = main.indexOf("<TripDayList");
    expect(days).toBeGreaterThan(-1);
    for (const late of ["<CrewVotesSummary", "<CrewShareNudge"]) {
      expect(main.indexOf(late)).toBeGreaterThan(days);
      expect(main.indexOf(late)).toBeLessThan(main.indexOf("<TripPackingEssentials"));
    }
  });

  // The floating assistant button sat on the first stop of a phone's first
  // screen. The bar has its own assistant button there, so the floating one
  // waits until that has scrolled away. The bar is drawn outside a trip under
  // way and its button outside edit mode: elsewhere the floating one stays.
  it("keeps the floating assistant button off a phone's screen while the bar's own is in view", () => {
    expect(SRC).toContain("const { ref: assistantBarButton, offScreen: assistantBarButtonAway } = useOffScreen<HTMLButtonElement>();");
    const bar = main.slice(main.indexOf("<TripControlsBar"), main.indexOf("</TripControlsBar>"));
    expect(bar).toContain("assistantButtonRef={assistantBarButton}");
    const floating = SRC.slice(SRC.indexOf("<TripAssistantButton"));
    expect(floating.slice(0, floating.indexOf("/>"))).toContain("barButtonInView={!isActiveTripPhase && !isEditMode && !assistantBarButtonAway}");
  });
});
