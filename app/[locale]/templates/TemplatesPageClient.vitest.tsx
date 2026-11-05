import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * The ready-made trips page reads its list in the browser. A list that can't be
 * read says so and offers another try: "No itineraries found, try adjusting your
 * filters" would send someone hunting through filters that aren't the problem.
 */

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => Object.assign((key: string) => key, { has: () => false }),
}));
vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/ui/MobileBottomNav", () => ({ default: () => null }));
vi.mock("@/components/ui/BottomSheet", () => ({ default: () => null }));

import TemplatesPageClient from "./TemplatesPageClient";

const template = {
  id: "tpl-1",
  title: "Rome in 3 days",
  description: "A short city break",
  destination: "Rome",
  country: "Italy",
  countryCode: "IT",
  coverImageUrl: null,
  durationDays: 3,
  budgetTier: "balanced",
  moodTags: [],
  tags: [],
  copyCount: 0,
};

const answers = (templates: unknown[]) => new Response(JSON.stringify({ templates }), { status: 200 });

let fetchMock: ReturnType<typeof vi.fn>;

const show = async () => {
  render(<TemplatesPageClient />);
  await act(async () => {});
};

beforeEach(() => {
  fetchMock = vi.fn(async () => answers([template]));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the ready-made trips list", () => {
  it.each([
    ["the server refuses", async () => new Response("{}", { status: 500 })],
    ["the connection drops", async () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("says it couldn't load when %s, not that nothing matched", async (_name, answer) => {
    fetchMock.mockImplementationOnce(answer);
    await show();
    expect(screen.getByRole("alert").textContent).toContain("loadFailed.title");
    expect(screen.queryByText("empty.title")).toBeNull();
  });

  it("loads on another try", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await show();
    fireEvent.click(screen.getByRole("button", { name: "loadFailed.retry" }));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.querySelector('a[href="/trips/template/tpl-1"]')).not.toBeNull();
  });

  it("can fail again on that try", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await show();
    fireEvent.click(screen.getByRole("button", { name: "loadFailed.retry" }));
    await act(async () => {});
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("says nothing matched when the list really is empty", async () => {
    fetchMock.mockResolvedValueOnce(answers([]));
    await show();
    expect(screen.getByText("empty.title")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
