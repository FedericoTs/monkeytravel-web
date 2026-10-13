/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { openWhatsApp, whatsappUrl } from "./channels";

/**
 * WhatsApp opens in a new window. Asking for that window with "noopener" makes
 * window.open return null even when it opened, so a sent message would read as
 * a blocked pop-up: the window is opened plainly and its opener cut by hand.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("openWhatsApp", () => {
  it("opens WhatsApp with the message, cuts the opener, and says it opened", () => {
    const opened = { opener: window } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(opened);
    expect(openWhatsApp("Vote on Lisbon: https://monkeytravel.app/shared/t?vote=1")).toBe(true);
    expect(open).toHaveBeenCalledWith(whatsappUrl("Vote on Lisbon: https://monkeytravel.app/shared/t?vote=1"), "_blank");
    expect(open.mock.calls[0]).toHaveLength(2);
    expect(opened.opener).toBeNull();
  });

  it("says so when the browser blocked the window", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    expect(openWhatsApp("hi")).toBe(false);
  });

  it("puts the whole message in the link, encoded", () => {
    const url = new URL(whatsappUrl("Lisbon & Porto: https://x.test/s?vote=1"));
    expect(url.origin).toBe("https://wa.me");
    expect(url.searchParams.get("text")).toBe("Lisbon & Porto: https://x.test/s?vote=1");
  });
});
