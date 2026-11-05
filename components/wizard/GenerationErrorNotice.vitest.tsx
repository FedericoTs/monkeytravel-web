import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { MODEL_OUTAGE_MESSAGE } from "@/lib/ai/model-outage";
import GenerationErrorNotice from "./GenerationErrorNotice";

type Props = ComponentProps<typeof GenerationErrorNotice>;
const notice = (over: Partial<Props> = {}) =>
  render(
    <GenerationErrorNotice error="Something odd happened" errorFix={null} effectiveMaxTripDays={14} onAction={vi.fn()} {...over} />
  );

afterEach(cleanup);

describe("GenerationErrorNotice", () => {
  it("asks a refused request to edit the detail it names, with its day count or the limit", () => {
    const onAction = vi.fn();
    notice({ error: "Trip is too long: 30 days", errorFix: "duration", onAction });
    expect(screen.getByText('generation.fix.duration {"days":30}')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "generation.editDetails" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    cleanup();

    notice({ error: "Trip is too long", errorFix: "duration" });
    expect(screen.getByText('generation.fix.duration {"days":14}')).toBeTruthy();
  });

  it("puts a failure the traveller can't act on in friendlier words, with a retry", () => {
    const onAction = vi.fn();
    notice({ error: "Failed to generate valid itinerary after retries", onAction });
    expect(screen.getByText("generation.errorServerBusy")).toBeTruthy();
    const retry = screen.getByRole("button", { name: "generation.retry" });
    expect(retry.querySelector("svg")).not.toBeNull();
    fireEvent.click(retry);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("says the planner is out of service, with a retry for later and ready-made trips for now", () => {
    const onAction = vi.fn();
    notice({ error: MODEL_OUTAGE_MESSAGE, onAction });
    expect(screen.getByText("generation.errorUnavailable")).toBeTruthy();
    expect(screen.queryByText(MODEL_OUTAGE_MESSAGE)).toBeNull();
    expect(screen.getByRole("link", { name: "generation.browseTemplates" }).getAttribute("href")).toBe("/templates");
    fireEvent.click(screen.getByRole("button", { name: "generation.retry" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a busy server", { error: "Failed to generate itinerary" }],
    ["a refusal", { error: "Trip is too long", errorFix: "duration" as const }],
    ["any other message", {}],
  ])("sends nobody to ready-made trips for %s", (_name, over) => {
    notice(over);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows any other message as it is", () => {
    notice();
    expect(screen.getByText("Something odd happened")).toBeTruthy();
    expect(screen.getByRole("button", { name: "generation.retry" })).toBeTruthy();
  });
});
