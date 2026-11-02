import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useAnalyticsConsent } from "./hooks";
import { saveLocalConsent } from "./storage";
import { CONSENT_CHANGE_EVENT, DEFAULT_CONSENT_STATE, type ConsentState } from "./types";

/** As the consent context does: save, then announce. */
function decide(consent: ConsentState) {
  saveLocalConsent(consent, "banner_accept_all");
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: consent }));
}

afterEach(() => localStorage.clear());

describe("useAnalyticsConsent", () => {
  it("is off until the visitor agrees", () => {
    const { result } = renderHook(() => useAnalyticsConsent());
    expect(result.current).toBe(false);
  });

  it("reads a consent given on an earlier visit", () => {
    saveLocalConsent({ ...DEFAULT_CONSENT_STATE, analytics: true }, "banner_accept_all");
    const { result } = renderHook(() => useAnalyticsConsent());
    expect(result.current).toBe(true);
  });

  it("follows the visitor's choice as it changes", () => {
    const { result } = renderHook(() => useAnalyticsConsent());
    act(() => decide({ ...DEFAULT_CONSENT_STATE, analytics: true }));
    expect(result.current).toBe(true);
    act(() => decide({ ...DEFAULT_CONSENT_STATE, analytics: false }));
    expect(result.current).toBe(false);
  });

  it("is off in the server render, whatever was stored", () => {
    saveLocalConsent({ ...DEFAULT_CONSENT_STATE, analytics: true }, "banner_accept_all");
    function Probe() {
      return <span>{String(useAnalyticsConsent())}</span>;
    }
    expect(renderToString(<Probe />)).toContain("false");
  });
});
