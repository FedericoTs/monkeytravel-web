/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  GA_CONSENT_DEFAULT,
  GA_CONSENT_WAIT_FOR_UPDATE_MS,
  gaConsentDefaultScript,
  gaConsentDefaultScriptProps,
  gaConsentModeFromEnv,
  gaConsentParamsFor,
} from "./ga-consent";

describe("gaConsentModeFromEnv", () => {
  it("is advanced unless explicitly gated", () => {
    expect(gaConsentModeFromEnv(undefined)).toBe("advanced");
    expect(gaConsentModeFromEnv("")).toBe("advanced");
    expect(gaConsentModeFromEnv("advanced")).toBe("advanced");
    expect(gaConsentModeFromEnv("gated")).toBe("gated");
    expect(gaConsentModeFromEnv("GATED")).toBe("advanced");
  });
});

describe("gaConsentParamsFor", () => {
  it("denies everything before a choice", () => {
    expect(gaConsentParamsFor(null)).toEqual(GA_CONSENT_DEFAULT);
    expect(gaConsentParamsFor(undefined)).toEqual(GA_CONSENT_DEFAULT);
  });

  it("grants analytics alone for analytics-only consent", () => {
    expect(gaConsentParamsFor({ analytics: true, marketing: false })).toEqual({
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
  });

  it("grants the three ad signals together for marketing consent", () => {
    expect(gaConsentParamsFor({ analytics: true, marketing: true })).toEqual({
      analytics_storage: "granted",
      ad_storage: "granted",
      ad_user_data: "granted",
      ad_personalization: "granted",
    });
  });

  it("keeps analytics denied when only marketing is on", () => {
    expect(gaConsentParamsFor({ analytics: false, marketing: true }).analytics_storage).toBe("denied");
  });
});

describe("gaConsentDefaultScript", () => {
  it("sets every storage type to denied, waits for an update, and redacts ads data", () => {
    const js = gaConsentDefaultScript();
    expect(js).toContain("gtag('consent','default'");
    expect(js).toContain('"analytics_storage":"denied"');
    expect(js).toContain('"ad_storage":"denied"');
    expect(js).toContain('"ad_user_data":"denied"');
    expect(js).toContain('"ad_personalization":"denied"');
    expect(js).toContain(`"wait_for_update":${GA_CONSENT_WAIT_FOR_UPDATE_MS}`);
    expect(js).toContain("ads_data_redaction");
    expect(js).not.toContain("granted");
  });

  it("defines a gtag that pushes an arguments object, as Google requires", () => {
    expect(gaConsentDefaultScript()).toContain("function gtag(){window.dataLayer.push(arguments)}");
  });
});

describe("gaConsentDefaultScriptProps", () => {
  it("returns a nonced script only when GA4 is configured in advanced mode", () => {
    expect(gaConsentDefaultScriptProps("n0nce", { measurementId: "G-X", mode: undefined })?.nonce).toBe("n0nce");
    expect(gaConsentDefaultScriptProps("n0nce", { measurementId: "G-X", mode: "gated" })).toBeNull();
    expect(gaConsentDefaultScriptProps("n0nce", { measurementId: undefined, mode: "advanced" })).toBeNull();
  });
});
