/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import { isValidElement, type ReactElement } from "react";
import { signFeedbackToken } from "@/lib/feedback/token";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  setRequestLocale: () => {},
}));
vi.mock("@/lib/i18n/routing", () => ({ Link: () => null }));

const { default: DidYouGoPage, generateMetadata } = await import("./page");
const { default: FeedbackLinkExpired } = await import("../FeedbackLinkExpired");
const { default: DidYouGoForm } = await import("./DidYouGoForm");

const open = (searchParams: Record<string, string | string[]>, locale = "it") =>
  DidYouGoPage({ params: Promise.resolve({ locale }), searchParams: Promise.resolve(searchParams) });

/** The first element of `type` in what the page returned. */
function find(node: unknown, type: unknown): ReactElement<Record<string, unknown>> | null {
  if (!isValidElement(node)) return null;
  if (node.type === type) return node as ReactElement<Record<string, unknown>>;
  const { children } = node.props as { children?: unknown };
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = find(child, type);
    if (found) return found;
  }
  return null;
}

beforeEach(() => {
  vi.stubEnv("FEEDBACK_LINK_SECRET", randomBytes(32).toString("hex"));
});

describe("the page the return email's answers open", () => {
  it("asks about the rest with the link's token and answer", async () => {
    const t = signFeedbackToken("user-1", 30, "trip-1");
    const form = find(await open({ t, answer: "no" }), DidYouGoForm);
    expect(form?.props).toMatchObject({ token: t, answer: "no" });
  });

  it.each<[string, () => Record<string, string | string[]>]>([
    ["no token", () => ({ answer: "yes" })],
    ["a token repeated in the link", () => ({ t: ["a", "b"], answer: "yes" })],
    ["a token that doesn't verify", () => ({ t: `${signFeedbackToken("user-1", 30, "trip-1")}x`, answer: "yes" })],
    ["an expired token", () => ({ t: signFeedbackToken("user-1", -1, "trip-1"), answer: "yes" })],
    ["a survey token, which names no trip", () => ({ t: signFeedbackToken("user-1"), answer: "yes" })],
    ["no answer", () => ({ t: signFeedbackToken("user-1", 30, "trip-1") })],
    ["an answer that isn't one", () => ({ t: signFeedbackToken("user-1", 30, "trip-1"), answer: "maybe" })],
  ])("says the link has expired for %s", async (_name, query) => {
    const page = await open(query());
    expect(find(page, DidYouGoForm)).toBeNull();
    expect(find(page, FeedbackLinkExpired)?.props).toEqual({ locale: "it" });
  });

  it("stays out of search engines", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({}) });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
