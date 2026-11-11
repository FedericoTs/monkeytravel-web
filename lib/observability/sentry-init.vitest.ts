import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { CONSENT_CATEGORIES } from "@/lib/consent/types";

/**
 * What each runtime hands Sentry.init. The browser SDK is fetched only when
 * something asks for it (./sentry.ts), so the browser tests load
 * instrumentation-client.ts against a stand-in SDK and read the options its
 * init receives once the SDK is asked for, as an error would ask.
 */

const { init, lazyLoadIntegration } = vi.hoisted(() => ({
  init: vi.fn(),
  lazyLoadIntegration: vi.fn(() => Promise.resolve(() => ({ name: "Replay" }))),
}));
vi.mock("@sentry/nextjs", () => ({ init, lazyLoadIntegration, addIntegration: vi.fn() }));
// Both patch the page the moment the file loads; nothing here needs them.
vi.mock("@/lib/platform/survive-page-translators", () => ({ survivePageTranslators: () => {} }));
vi.mock("@/lib/analytics/page-translated", () => ({ reportPageTranslation: () => {} }));

type Consent = { analytics: boolean; sessionRecording: boolean };

/** Loads the browser instrumentation as a page does, its idle-time work included. */
async function loadBrowser(consent?: Consent) {
  if (consent) localStorage.setItem("mt_cookie_consent", JSON.stringify({ consent }));
  await import("../../instrumentation-client");
  await vi.dynamicImportSettled();
}

/** The options the browser SDK is initialised with once an error asks for it. */
async function browserOptions(consent?: Consent) {
  await loadBrowser(consent);
  const { sentry } = await import("./sentry");
  await sentry();
  expect(init).toHaveBeenCalledTimes(1);
  return init.mock.calls[0][0];
}

describe("the browser SDK", () => {
  beforeEach(() => {
    vi.resetModules();
    init.mockClear();
    lazyLoadIntegration.mockClear();
    localStorage.clear();
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "test-dsn");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_ENABLE_DEV", "1");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", undefined);
    // PostHog's init is not under test here.
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", undefined);
    vi.spyOn(console, "log").mockImplementation(() => {});
    // The idle-time init runs straight away.
    vi.stubGlobal("requestIdleCallback", (run: () => void) => run());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends a message without a stack, so Sentry titles its issue by the message", async () => {
    expect((await browserOptions()).attachStacktrace).toBe(false);
  });

  it.each(["production", "preview"])("reports a %s deployment under Vercel's name for it", async (name) => {
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", name);
    expect((await browserOptions()).environment).toBe(name);
  });

  it("falls back to NODE_ENV off Vercel, since the SDK reports an unset name as production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect((await browserOptions()).environment).toBe("development");
  });

  describe("records no session, even where the visitor agreed to recording", () => {
    const recording = { analytics: true, sessionRecording: true };

    it("leaves the SDK unfetched until an error asks for it", async () => {
      await loadBrowser(recording);
      expect(init).not.toHaveBeenCalled();
    });

    it("starts no recorder once it is fetched", async () => {
      const options = await browserOptions(recording);
      expect(options).not.toHaveProperty("replaysSessionSampleRate");
      expect(options).not.toHaveProperty("replaysOnErrorSampleRate");
      await vi.dynamicImportSettled();
      expect(lazyLoadIntegration).not.toHaveBeenCalled();
    });

    it("is named as a recorder neither in the cookie settings nor in the privacy policy", () => {
      const recorders = CONSENT_CATEGORIES.find((c) => c.id === "sessionRecording")!.services;
      expect(recorders.filter((service) => /sentry/i.test(service))).toEqual([]);
      const policy = readFileSync("app/[locale]/privacy/page.tsx", "utf8").split("\n");
      const sentryLines = policy.filter((line) => line.includes("<strong>Sentry:</strong>"));
      expect(sentryLines).toHaveLength(1);
      expect(sentryLines[0]).not.toMatch(/replay|record/i);
    });
  });
});

/**
 * On Vercel the SDK names the environment after the deployment (production,
 * preview), where NODE_ENV says "production" on every one of them.
 */
describe("the server and edge SDKs", () => {
  beforeEach(() => {
    vi.resetModules();
    init.mockClear();
  });

  it("the server SDK leaves the environment to the SDK's own default", async () => {
    await import("../../sentry.server.config");
    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0][0]).not.toHaveProperty("environment");
  });

  it("the edge SDK leaves the environment to the SDK's own default", async () => {
    await import("../../sentry.edge.config");
    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0][0]).not.toHaveProperty("environment");
  });
});
