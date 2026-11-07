import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { CONSENT_CHANGE_EVENT } from "@/lib/consent";

/**
 * GA4 reports the production site only, and the team's own devices carry
 * traffic_type=internal, which GA4's Internal Traffic filter drops.
 */

vi.mock("next/script", () => ({
  default: ({ src }: { src: string }) => <i data-gtag={src} />,
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

import { ConsentGatedTags } from "./ConsentGatedTags";

const w = window as unknown as Record<string, unknown>;
const realLocation = window.location;

/** The gtag commands on the dataLayer, as plain arrays. */
const commands = () => ((w.dataLayer as ArrayLike<unknown>[] | undefined) ?? []).map((args) => Array.from(args));
const configs = () => commands().filter(([name]) => name === "config");
const INTERNAL = [["config", "G-TEST", { traffic_type: "internal" }]];
const VISITOR = [["config", "G-TEST"]];

function open(url: string) {
  Object.defineProperty(window, "location", { configurable: true, value: new URL(url) });
  return render(<ConsentGatedTags />);
}

const loadsGa = (view: ReturnType<typeof open>) => view.container.querySelector('[data-gtag*="id=G-TEST"]') !== null;

function forgetGa() {
  cleanup();
  delete w.dataLayer;
  delete w.gtag;
  delete w.__mtGaConsentDefault;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "G-TEST");
  vi.stubEnv("NEXT_PUBLIC_GA_CONSENT_MODE", "advanced");
  localStorage.clear();
  forgetGa();
});

afterEach(() => {
  forgetGa();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
  document.cookie = "mt_session_id=; Max-Age=0; path=/";
});

describe("where GA4 loads", () => {
  it("loads on the production site", () => {
    expect(loadsGa(open("https://monkeytravel.app/es/blog"))).toBe(true);
    expect(configs()).toEqual(VISITOR);
  });

  it.each([
    ["a local dev build", "http://localhost:3000/"],
    ["a preview deployment", "https://monkeytravel-web-git-fix-x.vercel.app/trips/new"],
    ["a translation proxy", "https://monkeytravel-app.translate.goog/?_x_tr_sl=en&_x_tr_tl=de"],
    ["a proxy that keeps the name in its host", "https://monkeytravel.app.example.net/"],
  ])("does not load on %s", (_, url) => {
    expect(loadsGa(open(url))).toBe(false);
    expect(configs()).toEqual([]);
  });

  it("is not decided on the server, which has no host to read", () => {
    Object.defineProperty(window, "location", { configurable: true, value: new URL("https://monkeytravel.app/") });
    expect(renderToString(<ConsentGatedTags />)).not.toContain("data-gtag");
  });

  it("does not load off production after the visitor accepts, in gated mode either", () => {
    vi.stubEnv("NEXT_PUBLIC_GA_CONSENT_MODE", "gated");
    const view = open("http://localhost:3000/");
    act(() => {
      window.dispatchEvent(
        new CustomEvent(CONSENT_CHANGE_EVENT, {
          detail: { essential: true, analytics: true, sessionRecording: false, marketing: false },
        })
      );
    });
    expect(loadsGa(view)).toBe(false);
    expect(configs()).toEqual([]);
  });

  it("loads on production once the visitor accepts, in gated mode", () => {
    vi.stubEnv("NEXT_PUBLIC_GA_CONSENT_MODE", "gated");
    const view = open("https://monkeytravel.app/");
    expect(loadsGa(view)).toBe(false);
    act(() => {
      window.dispatchEvent(
        new CustomEvent(CONSENT_CHANGE_EVENT, {
          detail: { essential: true, analytics: true, sessionRecording: false, marketing: false },
        })
      );
    });
    expect(loadsGa(view)).toBe(true);
    expect(configs()).toEqual(VISITOR);
  });
});

describe("a team device", () => {
  it("is tagged internal from the page opened with ?mt_team=1, and on later pages", () => {
    open("https://monkeytravel.app/?mt_team=1");
    expect(configs()).toEqual(INTERNAL);

    forgetGa();
    open("https://monkeytravel.app/trips/new");
    expect(configs()).toEqual(INTERNAL);
  });

  it("is a visitor again from the page opened with ?mt_team=0", () => {
    open("https://monkeytravel.app/?mt_team=1");
    forgetGa();
    open("https://monkeytravel.app/blog?mt_team=0");
    expect(configs()).toEqual(VISITOR);

    forgetGa();
    open("https://monkeytravel.app/");
    expect(configs()).toEqual(VISITOR);
  });

  it("includes a production probe, which sets its own readable session cookie", () => {
    document.cookie = "mt_session_id=e2eprobe-live-1; path=/";
    open("https://monkeytravel.app/");
    expect(configs()).toEqual(INTERNAL);
  });

  it("does not include a visitor whose session cookie is not a probe's", () => {
    document.cookie = "mt_session_id=11111111-1111-4111-8111-111111111111; path=/";
    document.cookie = "other=e2eprobe-x; path=/";
    open("https://monkeytravel.app/");
    expect(configs()).toEqual(VISITOR);
  });
});

describe("a browser that refuses", () => {
  it("storage still loads GA4, as a visitor", () => {
    const blocked = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(blocked);
    expect(loadsGa(open("https://monkeytravel.app/?mt_team=0"))).toBe(true);
    expect(configs()).toEqual(VISITOR);
  });

  it("cookies still loads GA4, as a visitor", () => {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => {
        throw new DOMException("The document is sandboxed.", "SecurityError");
      },
    });
    try {
      expect(loadsGa(open("https://monkeytravel.app/"))).toBe(true);
      expect(configs()).toEqual(VISITOR);
    } finally {
      delete (document as unknown as Record<string, unknown>).cookie;
    }
  });
});
