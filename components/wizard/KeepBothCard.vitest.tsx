import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enTrips from "@/messages/en/trips.json";
import esTrips from "@/messages/es/trips.json";
import itTrips from "@/messages/it/trips.json";
import ptTrips from "@/messages/pt/trips.json";
import { KeepBothCard } from "./KeepBothCard";

/** A signed-out planner on a second place's plan is asked to keep them all with a free account. */
const card = (places: number, locale = "en", messages: Record<string, unknown> = enTrips) => {
  const onSignIn = vi.fn();
  const onDismiss = vi.fn();
  render(
    <NextIntlClientProvider locale={locale} messages={{ trips: messages }}>
      <KeepBothCard places={places} onSignIn={onSignIn} onDismiss={onDismiss} />
    </NextIntlClientProvider>
  );
  return { onSignIn, onDismiss };
};

afterEach(cleanup);

describe("KeepBothCard", () => {
  it("asks to keep both trips, or all of them, with a free sign-in", () => {
    card(2);
    expect(screen.getByRole("region", { name: "Keep both trips" })).toBeTruthy();
    cleanup();
    card(3);
    expect(screen.getByRole("region", { name: "Keep all 3 trips" })).toBeTruthy();
    expect(screen.getByText("Sign in free and every place you planned today stays in My Trips.")).toBeTruthy();
  });

  it("signs in, or is turned down", () => {
    const { onSignIn, onDismiss } = card(2);
    fireEvent.click(screen.getByRole("button", { name: "Sign in free" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["es", esTrips, "Guarda los dos viajes", "Ahora no"],
    ["it", itTrips, "Tieni entrambi i viaggi", "Non ora"],
    ["pt", ptTrips, "Guarde as duas viagens", "Agora não"],
  ])("speaks %s", (locale, messages, title, notNow) => {
    card(2, locale, messages as Record<string, unknown>);
    expect(screen.getByRole("region", { name: title })).toBeTruthy();
    expect(screen.getByRole("button", { name: notNow })).toBeTruthy();
  });
});
