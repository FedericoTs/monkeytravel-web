import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { humanizeAuthError } from "@/lib/auth-errors";

const signInWithOAuth = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithOAuth } }),
}));

import { OAuthButtons } from "./OAuthButtons";

const RETURN = "https://monkeytravel.app/auth/callback?next=%2Ftrips&locale=en";

function renderButtons(disabled = false) {
  const setError = vi.fn();
  const redirectTo = vi.fn(() => RETURN);
  render(
    <OAuthButtons
      redirectTo={redirectTo}
      disabled={disabled}
      setError={setError}
      appleLabel="Continue with Apple"
      googleLabel="Continue with Google"
    />
  );
  const button = (name: string) => screen.getByRole("button", { name });
  return { setError, redirectTo, button };
}

const spins = (button: HTMLElement) => button.querySelector(".animate-spin") !== null;

beforeEach(() => {
  signInWithOAuth.mockReset();
  signInWithOAuth.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("which buttons show", () => {
  it("shows Google alone while Apple sign-in is off", () => {
    renderButtons();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Continue with Google"]);
  });

  it("puts Apple first once it is switched on", () => {
    vi.stubEnv("NEXT_PUBLIC_APPLE_AUTH_ENABLED", "true");
    renderButtons();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Continue with Apple",
      "Continue with Google",
    ]);
  });
});

describe("a click", () => {
  it("hands the browser to the provider with the page's return address", async () => {
    vi.stubEnv("NEXT_PUBLIC_APPLE_AUTH_ENABLED", "true");
    const { setError, redirectTo, button } = renderButtons();
    expect(redirectTo).not.toHaveBeenCalled();

    fireEvent.click(button("Continue with Apple"));

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
    expect(signInWithOAuth).toHaveBeenCalledWith({ provider: "apple", options: { redirectTo: RETURN } });
    expect(setError).toHaveBeenCalledWith(null);
    // On its way out: both stay disabled, the clicked one spins.
    expect(button("Continue with Apple")).toHaveProperty("disabled", true);
    expect(button("Continue with Google")).toHaveProperty("disabled", true);
    expect(spins(button("Continue with Apple"))).toBe(true);
    expect(spins(button("Continue with Google"))).toBe(false);
  });

  it("reports a sign-in that cannot start, and gives the buttons back", async () => {
    signInWithOAuth.mockResolvedValue({ error: { message: "Unsupported provider: provider is not enabled" } });
    const { setError, button } = renderButtons();

    fireEvent.click(button("Continue with Google"));

    await waitFor(() =>
      expect(setError).toHaveBeenLastCalledWith(humanizeAuthError("Unsupported provider: provider is not enabled"))
    );
    expect(signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: RETURN } });
    expect(setError.mock.calls[0]).toEqual([null]);
    await waitFor(() => expect(button("Continue with Google")).toHaveProperty("disabled", false));
    expect(spins(button("Continue with Google"))).toBe(false);
  });
});

it("is disabled while the email form is busy", () => {
  vi.stubEnv("NEXT_PUBLIC_APPLE_AUTH_ENABLED", "true");
  const { button } = renderButtons(true);
  expect(button("Continue with Apple")).toHaveProperty("disabled", true);
  expect(button("Continue with Google")).toHaveProperty("disabled", true);
});
