import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { useEffect } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The app's providers must keep one tree shape from the first render.
 *
 * ConsentProvider returned <>{children}</> until the stored consent had loaded
 * and <ConsentContext.Provider> after, and PostHogProviderWrapper swapped in a
 * <PostHogProvider> once PostHog loaded. Each change of shape made React
 * unmount and remount EVERYTHING below: measured 2026-09-25 on a production
 * build, the trip page mounted 4 times per load (local state lost, every mount
 * effect run 4 times).
 */

vi.mock("./consent-event-client", () => ({
  buildConsentEvent: vi.fn(() => ({})),
  sendConsentEvent: vi.fn(),
}));

import { ConsentProvider, useConsent } from "./context";

describe("ConsentProvider", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("mounts its children once, before and after the stored consent loads", async () => {
    let mounts = 0;
    function Child() {
      useEffect(() => {
        mounts += 1;
      }, []);
      return null;
    }
    render(
      <ConsentProvider userId={null}>
        <Child />
      </ConsentProvider>
    );
    // Let the load-consent effect run and settle (it sets state on mount).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(mounts).toBe(1);
  });

  it("gives consumers its real state from the first render: nothing consented, banner hidden", () => {
    const seen: Array<{ banner: string; analytics: boolean }> = [];
    function Probe() {
      const { bannerStatus, consent } = useConsent();
      seen.push({ banner: bannerStatus, analytics: consent.analytics });
      return null;
    }
    render(
      <ConsentProvider userId={null}>
        <Probe />
      </ConsentProvider>
    );
    // The context DEFAULT says "visible" with no-op actions; the provider's
    // own state starts "hidden", so no banner flash before loading.
    expect(seen[0]).toEqual({ banner: "hidden", analytics: false });
  });
});

describe("root providers", () => {
  it("the PostHog wrapper never swaps in a provider after the first render", () => {
    const src = readFileSync(path.resolve(__dirname, "../../app/providers.tsx"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/PostHogProvider\b(?!Wrapper)/);
    expect(code).not.toMatch(/useState|useEffect/);
  });
});
