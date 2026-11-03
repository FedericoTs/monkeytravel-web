import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTripStatus } from "./TripStatus";

const addToast = vi.fn();
const refresh = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next-intl", () => ({ useTranslations: (ns: string) => (key: string) => `${ns}:${key}` }));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useTripStatus", () => {
  it("saves the new status, says so and refreshes the page's data", async () => {
    const { result } = renderHook(() => useTripStatus("t1", "planning"));
    await act(() => result.current.update("confirmed"));

    expect(fetchMock).toHaveBeenCalledWith("/api/trips/t1/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "confirmed" }),
    });
    expect(result.current).toMatchObject({ status: "confirmed", updating: false });
    expect(addToast).toHaveBeenCalledWith("common.trips:tripConfirmed", "success");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("names each change in its toast", async () => {
    const { result } = renderHook(() => useTripStatus("t1", "planning"));
    await act(() => result.current.update("cancelled"));
    await act(() => result.current.update("planning"));
    expect(addToast.mock.calls.map(([message]) => message)).toEqual(["common.trips:tripCancelled", "common.trips:tripRestored"]);
    expect(result.current.status).toBe("planning");
  });

  it("is updating while the request is out", async () => {
    let answer: (r: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)));
    const { result } = renderHook(() => useTripStatus("t1", "planning"));
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = result.current.update("confirmed");
    });
    expect(result.current.updating).toBe(true);
    await act(async () => {
      answer(new Response("{}", { status: 200 }));
      await done;
    });
    expect(result.current.updating).toBe(false);
  });

  it("keeps the status and says it failed when the server refuses", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 403 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useTripStatus("t1", "planning"));
    await act(() => result.current.update("cancelled"));
    expect(result.current).toMatchObject({ status: "planning", updating: false });
    expect(addToast).toHaveBeenCalledWith("trips:detail.cancelTrip.failed", "error");
    expect(refresh).not.toHaveBeenCalled();
  });
});
