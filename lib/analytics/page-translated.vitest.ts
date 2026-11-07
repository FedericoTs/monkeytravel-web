import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportPageTranslation } from "./page-translated";

const capture = vi.fn();

vi.mock("@/lib/posthog/client", () => ({
  onPostHogReady: (fn: (posthog: unknown) => void) => fn({ capture }),
}));

const html = document.documentElement;
/** Lets the observer's callback run, then the wait after it. */
const settle = async (ms = 3_000) => {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(ms);
};

describe("reportPageTranslation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capture.mockClear();
    html.className = "";
    html.lang = "en";
  });

  afterEach(() => {
    vi.useRealTimers();
    html.className = "";
    html.lang = "";
  });

  it("reports the language the browser is translating into", async () => {
    reportPageTranslation();
    html.lang = "pl";
    html.className = "translated-ltr";
    await settle();
    expect(capture).toHaveBeenCalledWith("page_translated", { to: "pl" });
  });

  it("knows right-to-left translations too", async () => {
    reportPageTranslation();
    html.lang = "ar";
    html.className = "dark translated-rtl";
    await settle();
    expect(capture).toHaveBeenCalledWith("page_translated", { to: "ar" });
  });

  it("waits for the language when the class comes first", async () => {
    reportPageTranslation();
    html.className = "translated-ltr";
    await settle(1_000);
    html.lang = "zh-CN";
    expect(capture).not.toHaveBeenCalled();
    await settle(2_000);
    expect(capture).toHaveBeenCalledWith("page_translated", { to: "zh-CN" });
  });

  it("reports a page that's already translated when this starts", async () => {
    html.lang = "fr";
    html.className = "translated-ltr";
    reportPageTranslation();
    await settle();
    expect(capture).toHaveBeenCalledWith("page_translated", { to: "fr" });
  });

  it("reports once, however often the class changes", async () => {
    reportPageTranslation();
    html.className = "translated-ltr";
    await settle();
    html.className = "";
    await settle();
    html.className = "translated-ltr";
    await settle();
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("says nothing about a page nobody translates", async () => {
    reportPageTranslation();
    html.className = "dark";
    html.lang = "es";
    await settle();
    expect(capture).not.toHaveBeenCalled();
  });
});
