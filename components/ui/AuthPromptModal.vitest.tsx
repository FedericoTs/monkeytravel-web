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
const signInWithOAuth = vi.fn();
const push = vi.fn();
const assign = vi.fn();
const ui = vi.hoisted(() => ({ locale: "en" }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => ui.locale,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithOtp, verifyOtp, signInWithOAuth } }),
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
  render(<AuthPromptModal isOpen onClose={() => {}} destination="" redirectPath="/trips/new" />);
  // The translator is mocked to echo keys, so the placeholder IS the key.
  const email = screen.getByPlaceholderText("magicLink.emailPlaceholder");
  fireEvent.change(email, { target: { value: "planner@example.com" } });
  const send = screen.getByRole("button", { name: "magicLink.send" });
  fireEvent.click(send);
  await waitFor(() => expect(screen.getByLabelText("magicLink.codePrompt")).toBeTruthy());
}

beforeEach(() => {
  vi.clearAllMocks();
  ui.locale = "en";
  signInWithOAuth.mockResolvedValue({ error: null });
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

/**
 * Every way out of the prompt has to keep the user's language, and none of
 * them may point at /pt/auth/callback. That route does not exist, and from
 * 2026-06-04 to 2026-09-24 every es/it/pt sign-in started here hit its 404.
 */
describe("sign-in from a Portuguese page", () => {
  beforeEach(() => {
    ui.locale = "pt";
  });

  it("emails a link back to the real callback, language in ?locale=", async () => {
    await reachCodeEntry();
    const { emailRedirectTo, data } = signInWithOtp.mock.calls[0][0].options;
    const url = new URL(emailRedirectTo);
    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("locale")).toBe("pt");
    expect(url.searchParams.get("next")).toBe("/trips/new");
    // A brand-new account gets its email (and its locale) in Portuguese.
    expect(data).toEqual({ locale: "pt" });
  });

  it("sends Google back to the real callback too", async () => {
    render(<AuthPromptModal isOpen onClose={() => {}} destination="Lisboa" redirectPath="/trips/new" />);
    fireEvent.click(screen.getByRole("button", { name: "googleButton" }));
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalled());
    const url = new URL(signInWithOAuth.mock.calls[0][0].options.redirectTo);
    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("locale")).toBe("pt");
    expect(url.searchParams.get("next")).toBe("/trips/new");
  });

  it("lands the in-tab code on the Portuguese wizard", async () => {
    await reachCodeEntry();
    fireEvent.change(screen.getByLabelText("magicLink.codePrompt"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "magicLink.codeSubmit" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/pt/trips/new"));
  });

  it("keeps the password signup page in Portuguese", async () => {
    render(<AuthPromptModal isOpen onClose={() => {}} destination="Lisboa" redirectPath="/trips/new" />);
    fireEvent.click(screen.getByRole("button", { name: "preferPassword" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/pt/auth/signup?redirect=%2Ftrips%2Fnew"));
  });

  it("keeps the login page in Portuguese", async () => {
    render(<AuthPromptModal isOpen onClose={() => {}} destination="Lisboa" redirectPath="/trips/new" />);
    fireEvent.click(screen.getByRole("button", { name: "hasAccount" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/pt/auth/login?redirect=%2Ftrips%2Fnew"));
  });
});

describe("sign-in from an English page", () => {
  it("is unchanged: no prefix anywhere", async () => {
    await reachCodeEntry();
    const url = new URL(signInWithOtp.mock.calls[0][0].options.emailRedirectTo);
    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("locale")).toBe("en");
  });
});

/**
 * At the anonymous free-generation cap (#189 made the wizard count against
 * it) the wizard opens this same sign-up, worded for why: keep planning, not
 * save. Before this the visitor got the server's English error string.
 */
describe("at the free-generation cap", () => {
  function renderAtLimit() {
    render(
      <AuthPromptModal
        isOpen
        onClose={() => {}}
        destination="Kutaisi"
        reason="generation_limit"
        location="wizard_generation_limit"
        redirectPath="/trips/new?destination=Kutaisi"
      />
    );
  }

  it("asks for an account to keep planning, not to save a trip", () => {
    renderAtLimit();
    expect(screen.getByRole("heading", { name: "generationLimit.title" })).toBeTruthy();
    expect(screen.getByText("generationLimit.subtitle")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "title" })).toBeNull();
  });

  it("says so again once the link is on its way, and comes back to the wizard with the destination", async () => {
    renderAtLimit();
    fireEvent.change(screen.getByPlaceholderText("magicLink.emailPlaceholder"), {
      target: { value: "planner@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "magicLink.send" }));
    await waitFor(() => expect(screen.getByText("generationLimit.checkInbox")).toBeTruthy());
    const url = new URL(signInWithOtp.mock.calls[0][0].options.emailRedirectTo);
    expect(url.searchParams.get("next")).toBe("/trips/new?destination=Kutaisi");
  });

  it("the save wording is unchanged without a reason", () => {
    render(<AuthPromptModal isOpen onClose={() => {}} destination="Lisboa" />);
    expect(screen.getByRole("heading", { name: "title" })).toBeTruthy();
  });
});

describe("the cap copy exists in every language", () => {
  it.each(["en", "es", "it", "pt"])("%s", async (locale) => {
    const messages = (await import(`../../messages/${locale}/common.json`)).default as {
      authPrompt: { generationLimit?: Record<string, string> };
    };
    const copy = messages.authPrompt.generationLimit ?? {};
    for (const key of ["title", "subtitle", "checkInbox"]) {
      expect(copy[key]?.trim(), `${locale} ${key}`).toBeTruthy();
    }
  });
});
