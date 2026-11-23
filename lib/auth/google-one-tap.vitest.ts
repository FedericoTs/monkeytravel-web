// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { GOOGLE_CLIENT_ID, LOAD_TIMEOUT_MS, loadGoogleId, makeNonce, offerOneTap, type GoogleId } from "./google-one-tap";

/**
 * People who press Save often close the sign-in box within seconds, without pressing anything. Google's one-tap lets
 * someone signed in to Google keep the plan with one tap on their own account, without leaving the page.
 */

const fakeId = (): GoogleId & { initialize: ReturnType<typeof vi.fn> } => ({ initialize: vi.fn(), prompt: vi.fn(), cancel: vi.fn() });
const withGoogle = (id: GoogleId | undefined) => {
  (window as unknown as { google?: unknown }).google = id ? { accounts: { id } } : undefined;
};

describe("makeNonce", () => {
  it("gives a fresh raw nonce for Supabase and its SHA-256 for Google", async () => {
    const one = await makeNonce();
    const two = await makeNonce();
    expect(one.raw).toMatch(/^[0-9a-f]{32}$/);
    expect(one.hashed).toBe(createHash("sha256").update(one.raw).digest("hex"));
    expect(two.raw).not.toBe(one.raw);
  });
});

describe("loadGoogleId", () => {
  beforeEach(() => {
    withGoogle(undefined);
    document.getElementById("google-identity-services")?.remove();
  });
  afterEach(() => vi.useRealTimers());

  it("adds Google's script once and gives its one-tap API when it loads", async () => {
    const loading = loadGoogleId();
    const again = loadGoogleId();
    const scripts = document.querySelectorAll("script#google-identity-services");
    expect(scripts).toHaveLength(1);
    expect((scripts[0] as HTMLScriptElement).src).toBe("https://accounts.google.com/gsi/client");
    expect((scripts[0] as HTMLScriptElement).async).toBe(true);
    const id = fakeId();
    withGoogle(id);
    scripts[0].dispatchEvent(new Event("load"));
    expect(await loading).toBe(id);
    expect(await again).toBe(id);
  });

  it("gives the API at once when it is already there", async () => {
    const id = fakeId();
    withGoogle(id);
    expect(await loadGoogleId()).toBe(id);
    expect(document.getElementById("google-identity-services")).toBeNull();
  });

  it("gives nothing when the script fails, at once, or doesn't come in time", async () => {
    vi.useFakeTimers();
    const failing = loadGoogleId();
    let answer: unknown = "waiting";
    void failing.then((value) => (answer = value));
    document.getElementById("google-identity-services")!.dispatchEvent(new Event("error"));
    await Promise.resolve();
    // No wait for the timeout: the box goes on without it.
    expect(answer).toBeNull();

    document.getElementById("google-identity-services")!.remove();
    const slow = loadGoogleId();
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS - 1);
    let settled = false;
    void slow.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    vi.advanceTimersByTime(1);
    expect(await slow).toBeNull();
  });
});

describe("offerOneTap", () => {
  it("offers the person's account with the hashed nonce, in the browser's own prompt", () => {
    const id = fakeId();
    offerOneTap(id, "hashed-nonce", () => {});
    expect(id.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: GOOGLE_CLIENT_ID,
        nonce: "hashed-nonce",
        context: "signin",
        auto_select: false,
        use_fedcm_for_prompt: true,
      })
    );
    expect(id.prompt).toHaveBeenCalledTimes(1);
  });

  it("hands over the credential when they tap their account, and nothing without one", () => {
    const id = fakeId();
    const onCredential = vi.fn();
    offerOneTap(id, "hashed-nonce", onCredential);
    const { callback } = id.initialize.mock.calls[0][0] as { callback: (response: { credential?: string }) => void };
    callback({});
    expect(onCredential).not.toHaveBeenCalled();
    callback({ credential: "google-id-token" });
    expect(onCredential).toHaveBeenCalledWith("google-id-token");
  });

  it("is taken back when the box closes", () => {
    const id = fakeId();
    const cancel = offerOneTap(id, "hashed-nonce", () => {});
    expect(id.cancel).not.toHaveBeenCalled();
    cancel();
    expect(id.cancel).toHaveBeenCalledTimes(1);
  });
});
