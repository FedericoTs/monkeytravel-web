/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useTripExpenses } from "./useTripExpenses";

/**
 * A refresh that read the ledger just before you saved a payment must not
 * answer after your save and put the old ledger back.
 */

const ledger = (ids: string[]) => ({
  expenses: ids.map((id) => ({ id, amountCents: 3000, currency: "EUR", splits: [] })),
  summary: { currency: "EUR", totalCents: ids.length * 3000, youPaidCents: 0, youOweCents: 0, netCents: 0, count: ids.length },
});

afterEach(() => vi.unstubAllGlobals());

describe("useTripExpenses", () => {
  it("keeps your new payment when an older refresh answers after it", async () => {
    let releaseSlowRead: (() => void) | null = null;
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") return new Response(JSON.stringify(ledger(["mine", "dinner"])), { status: 200 });
        reads++;
        if (reads === 1) return new Response(JSON.stringify(ledger(["dinner"])), { status: 200 });
        // The refresh read the ledger before the payment was saved, and answers late.
        await new Promise<void>((resolve) => (releaseSlowRead = resolve));
        return new Response(JSON.stringify(ledger(["dinner"])), { status: 200 });
      }),
    );

    const { result } = renderHook(() => useTripExpenses("/api/shared/token-1", true));
    await waitFor(() => expect(result.current.expenses.map((e) => e.id)).toEqual(["dinner"]));

    let refresh: Promise<void> = Promise.resolve();
    act(() => {
      refresh = result.current.refetch();
    });
    await waitFor(() => expect(releaseSlowRead).not.toBeNull());
    await act(async () => {
      await result.current.add({ amount: "30" });
    });
    expect(result.current.expenses.map((e) => e.id)).toEqual(["mine", "dinner"]);

    await act(async () => {
      releaseSlowRead?.();
      await refresh;
    });
    expect(result.current.expenses.map((e) => e.id)).toEqual(["mine", "dinner"]);
  });
});
