/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import common from "@/messages/en/common.json";
import GenerationProgress from "./GenerationProgress";

const progress = (isGenerating: boolean) => (
  <NextIntlClientProvider locale="en" messages={{ common }}>
    <GenerationProgress destination="Lisbon" isGenerating={isGenerating} />
  </NextIntlClientProvider>
);
const percent = () => screen.getByText(/^\d+%$/).textContent;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("GenerationProgress", () => {
  it("advances while the trip is being written", () => {
    render(progress(true));
    expect(percent()).toBe("0%");
    act(() => vi.advanceTimersByTime(10_000));
    expect(Number(percent()!.replace("%", ""))).toBeGreaterThan(20);
  });

  it("stops promising under 30 seconds once 30 seconds have passed", () => {
    render(progress(true));
    const promise = screen.getByText(common.generation.estimatedTime);
    expect(promise.getAttribute("aria-hidden")).toBeNull();
    act(() => vi.advanceTimersByTime(29_000));
    expect(promise.getAttribute("aria-hidden")).toBeNull();
    act(() => vi.advanceTimersByTime(2_000));
    expect(promise.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText(common.generation.takingLonger).getAttribute("aria-hidden")).toBeNull();
  });

  it("starts the next generation from zero", () => {
    const { rerender } = render(progress(true));
    act(() => vi.advanceTimersByTime(10_000));
    rerender(progress(false));
    rerender(progress(true));
    expect(percent()).toBe("0%");
  });
});
