import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * The in-tab code path on the save wall.
 *
 * Magic-link sign-ups reach a session 63.0% of the time against Google's
 * 99.0% (n=142, p=1.8e-9) because the link means leaving the browser. The
 * code exists so someone can finish without going anywhere, so the branch
 * that accepts it is worth covering directly.
 *
 * Mocked rather than driven live because reaching this state for real costs
 * one auth email, and the send cap is project-wide and small enough that two
 * test sends have exhausted it before.
 */

const signInWithOtp = vi.fn();
const verifyOtp = vi.fn();
const assign = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithOtp, verifyOtp, signInWithOAuth: vi.fn() } }),
}));
vi.mock("@/lib/platform/storage", () => ({
  prefs: { set: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue(null) },
}));
vi.mock("@/components/wizard/wizardEvents", () => ({ trackWizardEvent: vi.fn() }));
vi.mock("@/lib/posthog/events", () => ({
  captureAuthPromptShown: vi.fn(),
  captureMagicLinkRequested: vi.fn(),
  captureMagicLinkRequestFailed: vi.fn(),
  captureAuthMethodSwitched: vi.fn(),
  captureAuthPromptDismissed: vi.fn(),
  captureGoogleSignInClicked: vi.fn(),
  captureGoogleSignInFailed: vi.fn(),
}));

import AuthPromptModal from "./AuthPromptModal";

/** Get to the state where the code input exists: request the link first. */
async function reachCodeEntry() {
  render(<AuthPromptModal isOpen onClose={() => {}} redirectPath="/trips/new" />);
  // The translator is mocked to echo keys, so the placeholder IS the key.
  const email = screen.getByPlaceholderText("magicLink.emailPlaceholder");
  fireEvent.change(email, { target: { value: "planner@example.com" } });
  const send = screen.getByRole("button", { name: "magicLink.send" });
  fireEvent.click(send);
  await waitFor(() => expect(screen.getByLabelText("magicLink.codePrompt")).toBeTruthy());
}

beforeEach(() => {
  vi.clearAllMocks();
  signInWithOtp.mockResolvedValue({ error: null });
  verifyOtp.mockResolvedValue({ error: null, data: { session: { access_token: "t" } } });
  Object.defineProperty(window, "location", {
    value: { origin: "https://monkeytravel.app", assign },
    writable: true,
  });
});

describe("the code input appears once the email is on its way", () => {
  it("offers somewhere to type the code", async () => {
    await reachCodeEntry();
    expect(screen.getByLabelText("magicLink.codePrompt")).toBeTruthy();
  });

  it("keeps the emailed link working too — this is an addition", async () => {
    await reachCodeEntry();
    expect(screen.getByText("magicLink.checkInbox")).toBeTruthy();
  });
});

describe("what the field accepts", () => {
  it("takes the code straight out of a paste", async () => {
    // People paste "Or enter this code: 123456" and "123 456". Refusing those
    // sends them back to the mail app, which is the trip being removed.
    await reachCodeEntry();
    const input = screen.getByLabelText("magicLink.codePrompt") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Or enter this code: 123456" } });
    expect(input.value).toBe("123456");
  });

  it("will not submit a half-typed code", async () => {
    await reachCodeEntry();
    const input = screen.getByLabelText("magicLink.codePrompt");
    fireEvent.change(input, { target: { value: "1234" } });
    const verify = screen.getByRole("button", { name: "magicLink.codeSubmit" });
    expect((verify as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(verify);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("enables submit at six digits", async () => {
    await reachCodeEntry();
    fireEvent.change(screen.getByLabelText("magicLink.codePrompt"), { target: { value: "123456" } });
    expect((screen.getByRole("button", { name: "magicLink.codeSubmit" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("redeeming", () => {
  it("verifies and lands the user back where they were saving", async () => {
    await reachCodeEntry();
    fireEvent.change(screen.getByLabelText("magicLink.codePrompt"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "magicLink.codeSubmit" }));
    await waitFor(() => expect(verifyOtp).toHaveBeenCalled());
    expect(verifyOtp.mock.calls[0][0]).toMatchObject({ token: "123456", email: "planner@example.com" });
    // A full navigation, so the server sees the new session cookie and the
    // wizard remounts into the same resume path the emailed link produces.
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/trips/new"));
  });

  it("tries the next type when the first says the code is invalid", async () => {
    // signInWithOtp sends `signup` to a new address and `magiclink` to an
    // existing one, and the client cannot know which.
    verifyOtp
      .mockResolvedValueOnce({ error: { message: "Invalid token" }, data: null })
      .mockResolvedValueOnce({ error: null, data: { session: { access_token: "t" } } });
    await reachCodeEntry();
    fireEvent.change(screen.getByLabelText("magicLink.codePrompt"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "magicLink.codeSubmit" }));
    await waitFor(() => expect(verifyOtp).toHaveBeenCalledTimes(2));
    expect(verifyOtp.mock.calls[0][0].type).toBe("email");
    expect(verifyOtp.mock.calls[1][0].type).toBe("signup");
  });

  it("stops after one attempt when the code has expired", async () => {
    // Expired is expired under every type; retrying only spends attempts.
    verifyOtp.mockResolvedValue({ error: { message: "Token has expired or is invalid" }, data: null });
    await reachCodeEntry();
    fireEvent.change(screen.getByLabelText("magicLink.codePrompt"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "magicLink.codeSubmit" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toBe("magicLink.codeExpired");
    expect(assign).not.toHaveBeenCalled();
  });

  it("never calls a rate limit a wrong code", async () => {
    // Otherwise the user retypes a code that was right the whole time.
    verifyOtp.mockResolvedValue({
      error: { message: "For security purposes, you can only request this after 60 seconds" },
      data: null,
    });
    await reachCodeEntry();
    fireEvent.change(screen.getByLabelText("magicLink.codePrompt"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "magicLink.codeSubmit" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toBe("magicLink.codeRateLimited");
    expect(verifyOtp).toHaveBeenCalledTimes(1);
  });
});
