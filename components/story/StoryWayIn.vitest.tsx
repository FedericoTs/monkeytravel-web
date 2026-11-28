/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/messages/en/common.json";
import esCommon from "@/messages/es/common.json";
import itCommon from "@/messages/it/common.json";
import ptCommon from "@/messages/pt/common.json";

const opened = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@/lib/posthog/events", () => ({
  captureStoryWayInOpened: async (e: Record<string, unknown>) => {
    opened.push(e);
  },
}));
import { StoryWayIn } from "./StoryWayIn";

/**
 * The one sharing a trip is offered its story for friends who aren't coming: a guess to play instead of a plan to
 * read. It opens /shared/<token>/story, where the link's maker sees what friends see and how to send it.
 */
const TOKEN = "11111111-2222-4333-8444-555555555555";

function renderWayIn(props: Partial<React.ComponentProps<typeof StoryWayIn>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ common: enCommon }}>
      <StoryWayIn token={TOKEN} from="planner" {...props} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  opened.length = 0;
});

describe("the way to a trip's story", () => {
  it("says who it is for and opens the story of that link", () => {
    renderWayIn();
    expect(screen.getByText(enCommon.story.wayIn.note)).toBeTruthy();
    const link = screen.getByRole("link", { name: enCommon.story.wayIn.cta });
    expect(link.getAttribute("href")).toBe(`/shared/${TOKEN}/story`);
  });

  it("opens the story in the page's language", () => {
    render(
      <NextIntlClientProvider locale="es" messages={{ common: esCommon }}>
        <StoryWayIn token={TOKEN} from="planner" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("link", { name: esCommon.story.wayIn.cta }).getAttribute("href")).toBe(`/es/shared/${TOKEN}/story`);
  });

  it("keeps the page it is on when asked, by opening a new tab", () => {
    renderWayIn({ newTab: true });
    const link = screen.getByRole("link", { name: enCommon.story.wayIn.cta });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    cleanup();
    renderWayIn();
    expect(screen.getByRole("link", { name: enCommon.story.wayIn.cta }).getAttribute("target")).toBeNull();
  });

  it("counts the open, with where it was offered", () => {
    renderWayIn({ from: "saved_trip" });
    fireEvent.click(screen.getByRole("link", { name: enCommon.story.wayIn.cta }));
    expect(opened).toEqual([{ from: "saved_trip" }]);
  });

  it("keeps the shared page's test id, so its checks still find it", () => {
    const { container } = renderWayIn({ from: "shared" });
    expect(container.querySelector('[data-testid="story-way-in"]')).toBeTruthy();
    expect(container.querySelector('[data-story-way-in="shared"]')).toBeTruthy();
  });

  it("is worded in every language", () => {
    for (const common of [enCommon, esCommon, itCommon, ptCommon]) {
      expect(common.story.wayIn.note).toBeTruthy();
      expect(common.story.wayIn.cta).toBeTruthy();
    }
  });
});
