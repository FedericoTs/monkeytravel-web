/** @vitest-environment node */
/**
 * The Concierge launcher and its history toggle sit above the plan. Loaded
 * client-only, they arrived after hydration and pushed the whole page down,
 * so the trip page renders them on the server. Asserted against the source
 * for the loader, and with a server render for the components.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { renderToString } from "react-dom/server";
import TripConciergeChat from "@/components/trip/TripConciergeChat";
import ConciergeHistory from "@/components/trip/ConciergeHistory";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key, useLocale: () => "en" }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast: () => {} }) }));
vi.mock("@/components/ai/PreviewChangeCard", () => ({ default: () => null }));
vi.mock("@/lib/posthog/events", () => ({
  captureConciergeOpened: async () => {},
  captureConciergeQuestionSent: async () => {},
  captureConciergeResponseReceived: async () => {},
  captureConciergeQuotaBlocked: async () => {},
  captureConciergeError: async () => {},
  captureConciergeProposalShown: async () => {},
  captureConciergeProposalApplied: async () => {},
}));

const SRC = readFileSync(join(__dirname, "TripDetailClient.tsx"), "utf8");
const loaderOptions = (specifier: string) =>
  SRC.match(new RegExp(`dynamic\\(\\s*\\(\\) => import\\("${specifier}"\\)([^;]*)\\);`))?.[1];

describe("the trip page's Concierge row", () => {
  it("is not loaded client-only", () => {
    for (const specifier of ["@/components/trip/TripConciergeChat", "@/components/trip/ConciergeHistory"]) {
      const options = loaderOptions(specifier);
      expect(options, specifier).toBeDefined();
      expect(options, specifier).not.toMatch(/ssr:\s*false/);
    }
  });

  it("renders on the server", () => {
    vi.stubEnv("NEXT_PUBLIC_CONCIERGE_ENABLED", "true");
    expect(renderToString(<TripConciergeChat tripId="trip-1" canEdit />)).toContain("triggerLabel");
    expect(renderToString(<ConciergeHistory tripId="trip-1" />)).toContain("historyToggle");
    vi.unstubAllEnvs();
  });
});
