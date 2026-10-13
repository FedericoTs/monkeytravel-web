/** @vitest-environment jsdom */
/**
 * The trip page reserves the docked assistant's column for a first visit. The
 * server knows a browser has met the assistant only from a cookie, which can
 * be gone while localStorage still remembers it; the layout's script marks
 * <html> before paint so CSS keeps the column unreserved for that browser.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_SEEN_ATTRIBUTE,
  ASSISTANT_SEEN_COOKIE,
  ASSISTANT_SEEN_SCRIPT,
  rememberAssistantSeen,
} from "./assistant-seen";

const run = () => new Function(ASSISTANT_SEEN_SCRIPT)();
const marked = () => document.documentElement.hasAttribute(ASSISTANT_SEEN_ATTRIBUTE);

afterEach(() => {
  document.documentElement.removeAttribute(ASSISTANT_SEEN_ATTRIBUTE);
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("assistant-seen marker", () => {
  it("marks <html> when localStorage remembers the assistant", () => {
    localStorage.setItem(ASSISTANT_SEEN_COOKIE, "1790000000000");
    run();
    expect(marked()).toBe(true);
  });

  it("leaves a first visit unmarked", () => {
    run();
    expect(marked()).toBe(false);
  });

  it("never throws when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(run).not.toThrow();
    expect(marked()).toBe(false);
  });

  it("is marked too once the assistant has been seen on this page", () => {
    rememberAssistantSeen();
    expect(marked()).toBe(true);
    expect(document.cookie).toContain(`${ASSISTANT_SEEN_COOKIE}=1`);
  });
});
