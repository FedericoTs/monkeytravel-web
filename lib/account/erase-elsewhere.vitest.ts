// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Deleting an account must also remove what other services keep about the
 * person: the mailing-list contact in Resend, and the PostHog person with its
 * events and recordings. Our own tables never held those copies.
 */

const remove = vi.fn<(args: { email: string; audienceId: string }) => Promise<{ error: { name: string; message: string } | null }>>(
  async () => ({ error: null }),
);
vi.mock("resend", () => ({
  Resend: class {
    contacts = { remove };
  },
}));

const USER = { id: "user-1", email: "traveler@example.com" };
type Reply = { ok: boolean; status: number; json: () => Promise<unknown> };
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Reply>>(async () => ({
  ok: true,
  status: 202,
  json: async () => ({ persons_found: 1 }),
}));

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("RESEND_AUDIENCE_ID", "aud_1");
  vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "phx_test");
  vi.stubEnv("POSTHOG_PROJECT_ID", "123");
  vi.stubEnv("POSTHOG_QUERY_HOST", "");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com");
  vi.stubGlobal("fetch", fetchMock);
  remove.mockClear();
  fetchMock.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function erase() {
  const { eraseElsewhere } = await import("./erase-elsewhere");
  return eraseElsewhere(USER);
}

describe("eraseElsewhere", () => {
  it("removes the Resend contact and the PostHog person", async () => {
    await expect(erase()).resolves.toEqual({ resendContact: "removed", posthogPerson: "removed" });
    expect(remove).toHaveBeenCalledWith({ email: USER.email, audienceId: "aud_1" });

    const [url, init] = fetchMock.mock.calls[0];
    // The private API is on the app host, not the ingestion host.
    expect(url).toBe("https://eu.posthog.com/api/projects/123/persons/bulk_delete/");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer phx_test" });
    expect(JSON.parse(String(init?.body))).toEqual({
      distinct_ids: [USER.id],
      delete_events: true,
      delete_recordings: true,
    });
  });

  it("reports a person or contact that was never there", async () => {
    remove.mockResolvedValueOnce({ error: { name: "not_found", message: "Contact not found" } });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({ persons_found: 0 }) });
    await expect(erase()).resolves.toEqual({ resendContact: "absent", posthogPerson: "absent" });
  });

  it("skips a service whose keys are not set", async () => {
    vi.stubEnv("RESEND_AUDIENCE_ID", "");
    vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "");
    await expect(erase()).resolves.toEqual({ resendContact: "skipped", posthogPerson: "skipped" });
    expect(remove).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the key's own project when no project id is set", async () => {
    vi.stubEnv("POSTHOG_PROJECT_ID", "");
    await erase();
    expect(fetchMock.mock.calls[0][0]).toBe("https://eu.posthog.com/api/projects/@current/persons/bulk_delete/");
  });

  it("never throws, and one failure does not stop the other", async () => {
    remove.mockRejectedValueOnce(new Error("network down"));
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(erase()).resolves.toEqual({ resendContact: "failed", posthogPerson: "failed" });
    expect(errors).toHaveBeenCalledTimes(2);
    errors.mockRestore();
  });
});
