/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useChecklist } from "./useChecklist";

/**
 * The checklist is the owner's (its routes and RLS admit only the owner), so
 * the trip page turns the hook off for collaborators. Before 2026-09-24 it
 * fetched for everyone and 404'd on every collaborator's page load.
 */

const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ items: [{ id: "c1", text: "Passport" }] }) }));

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

describe("useChecklist", () => {
  it("does not fetch when disabled, and is not left loading", async () => {
    const { result } = renderHook(() => useChecklist("trip-1", { enabled: false }));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  it("fetches as before when enabled (the default)", async () => {
    const { result } = renderHook(() => useChecklist("trip-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith("/api/trips/trip-1/checklist");
    expect(result.current.items).toHaveLength(1);
  });
});
