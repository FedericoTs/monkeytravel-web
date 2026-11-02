import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Activity } from "@/types";

vi.mock("next-intl", () => ({ useTranslations: (ns: string) => (key: string) => `${ns}.${key}` }));
vi.mock("@/lib/locale", () => ({
  useCurrency: () => ({ convert: (amount: number, from: string) => ({ formatted: `≈${amount} ${from}→GBP` }) }),
}));

import { activityPrice, useActivityPrice } from "./activity-price";

const convert = (amount: number, from: string) => ({ formatted: `${from}>${amount}` });
const cost = (amount: unknown, currency = "") => ({ amount, currency, tier: "moderate" }) as Activity["estimated_cost"];

describe("an activity's price", () => {
  it("is converted from the estimate's own currency", () => {
    expect(activityPrice(cost(25, "JPY"), "EUR", convert, "Free")).toBe("JPY>25");
  });

  it("falls back to the trip's currency when the estimate names none", () => {
    expect(activityPrice(cost(25), "EUR", convert, "Free")).toBe("EUR>25");
  });

  it("is free when the estimate is 0", () => {
    expect(activityPrice(cost(0, "EUR"), "EUR", convert, "Free")).toBe("Free");
  });

  it("is unknown, not free, without an estimate", () => {
    expect(activityPrice(undefined, "EUR", convert, "Free")).toBeNull();
    expect(activityPrice(cost(null, "EUR"), "EUR", convert, "Free")).toBeNull();
  });

  it("reads the viewer's currency and the shared Free label in a page", () => {
    function Price({ activity }: { activity: Pick<Activity, "estimated_cost"> }) {
      const priceOf = useActivityPrice();
      return <span>{priceOf(activity, "USD") ?? "none"}</span>;
    }
    const { rerender } = render(<Price activity={{ estimated_cost: cost(40) }} />);
    expect(screen.getByText("≈40 USD→GBP")).toBeTruthy();
    rerender(<Price activity={{ estimated_cost: cost(0, "EUR") }} />);
    expect(screen.getByText("common.activity.free")).toBeTruthy();
    rerender(<Price activity={{}} />);
    expect(screen.getByText("none")).toBeTruthy();
  });
});
