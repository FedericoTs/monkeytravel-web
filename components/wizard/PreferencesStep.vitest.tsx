import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MUST_DO_MAX_LENGTH } from "@/lib/trips/request-limits";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));
vi.mock("@/components/trip/VibeSelector", () => ({ default: () => null }));

import PreferencesStep from "./PreferencesStep";
import type { Arrival, Departure } from "@/lib/wizard/answers";

/** What the step last set when they arrive and leave. */
const picked: { arrival?: Arrival | null; departure?: Departure | null } = {};

afterEach(cleanup);

/** The step with its wishes held as the wizard holds them. */
function Step({ initial = [] as string[] }) {
  const [mustDos, setMustDos] = useState<string[]>(initial);
  const [mustDoInput, setMustDoInput] = useState("");
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [departure, setDeparture] = useState<Departure | null>(null);
  return (
    <PreferencesStep
      destination="Lisbon"
      selectedVibes={["cultural"]}
      handleVibesChange={vi.fn()}
      mustDos={mustDos}
      setMustDos={setMustDos}
      mustDoInput={mustDoInput}
      setMustDoInput={setMustDoInput}
      dietary={[]}
      setDietary={vi.fn()}
      showAdvancedPrefs={false}
      setShowAdvancedPrefs={vi.fn()}
      budgetTier="balanced"
      setBudgetTier={vi.fn()}
      pace="moderate"
      setPace={vi.fn()}
      requirements=""
      setRequirements={vi.fn()}
      arrival={arrival}
      setArrival={(value) => {
        picked.arrival = value;
        setArrival(value);
      }}
      departure={departure}
      setDeparture={(value) => {
        picked.departure = value;
        setDeparture(value);
      }}
    />
  );
}

const input = () => screen.getByRole("textbox", { name: /wizard\.step2\.mustDos\.title/ }) as HTMLInputElement;
/** The wishes shown, read from their remove buttons. */
const wishes = () =>
  screen
    .queryAllByRole("button", { name: /^wizard\.step2\.mustDos\.remove / })
    .map((b) => JSON.parse(b.getAttribute("aria-label")!.replace(/^wizard\.step2\.mustDos\.remove /, "")).item as string);

describe("the wishes on step 2", () => {
  it("cut a wish longer than the server takes to its length, added by Enter or by tapping away", () => {
    render(<Step />);
    // As a phone keyboard's suggestion writes it, past the input's maxLength.
    fireEvent.change(input(), { target: { value: "Sunset at Miradouro da Senhora do Monte with a picnic, then fado in Alfama" + " and more".repeat(3) } });
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.change(input(), { target: { value: "b".repeat(MUST_DO_MAX_LENGTH + 15) } });
    fireEvent.blur(input());
    expect(wishes().map((w) => w.length)).toEqual([MUST_DO_MAX_LENGTH, MUST_DO_MAX_LENGTH]);
    expect(input().value).toBe("");
  });

  it("add a wish once, trimmed and without a trailing comma, by Enter, a comma or tapping away", () => {
    render(<Step />);
    fireEvent.change(input(), { target: { value: "  Tram 28,, " } });
    fireEvent.blur(input());
    fireEvent.change(input(), { target: { value: "Pastéis de Belém" } });
    fireEvent.keyDown(input(), { key: "," });
    fireEvent.change(input(), { target: { value: "tram 28" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(wishes()).toEqual(["Tram 28", "Pastéis de Belém"]);
    expect(input().value).toBe("");
  });

  it("keep typing that is only commas instead of adding it", () => {
    render(<Step initial={["Tram 28"]} />);
    fireEvent.change(input(), { target: { value: ",," } });
    fireEvent.blur(input());
    expect(wishes()).toEqual(["Tram 28"]);
    expect(input().value).toBe(",,");
  });
});

describe("the first and last day", () => {
  const arriving = () => screen.getByRole("combobox", { name: /wizard\.step2\.travelDays\.arriving/ }) as HTMLSelectElement;
  const leaving = () => screen.getByRole("combobox", { name: /wizard\.step2\.travelDays\.leaving/ }) as HTMLSelectElement;

  it("asks when they arrive and leave, any time unless they say", () => {
    render(<Step />);
    expect(screen.getByRole("group", { name: /wizard\.step2\.travelDays\.title/ })).toBeTruthy();
    expect([...arriving().options].map((o) => o.value)).toEqual(["", "morning", "afternoon", "evening", "night"]);
    expect([...leaving().options].map((o) => o.value)).toEqual(["", "morning", "afternoon", "evening"]);
    expect(arriving().value).toBe("");
    expect(leaving().value).toBe("");
  });

  it("keeps what they pick, and any time again clears it", () => {
    render(<Step />);
    fireEvent.change(arriving(), { target: { value: "evening" } });
    expect(picked.arrival).toBe("evening");
    expect(arriving().value).toBe("evening");
    fireEvent.change(leaving(), { target: { value: "morning" } });
    expect(picked.departure).toBe("morning");
    // Each shows its own answer.
    expect(leaving().value).toBe("morning");
    expect(arriving().value).toBe("evening");
    fireEvent.change(arriving(), { target: { value: "" } });
    expect(picked.arrival).toBeNull();
    expect(arriving().value).toBe("");
  });
});
