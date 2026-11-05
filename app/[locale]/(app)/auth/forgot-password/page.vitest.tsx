/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import ForgotPasswordPage from "./page";

const state = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock("next/navigation", () => ({ useSearchParams: () => state.params }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key, useLocale: () => "en" }));
vi.mock("@/lib/i18n/routing", () => ({ Link: ({ children }: { children: ReactNode }) => <a>{children}</a> }));

afterEach(() => {
  cleanup();
  state.params = new URLSearchParams();
});

describe("forgot password", () => {
  it("opens without an error", async () => {
    render(<ForgotPasswordPage />);
    await screen.findByRole("button", { name: /sendResetLink|submit|send/i });
    expect(screen.queryByText(/expired/)).toBeNull();
  });

  it("shows the error the sign-in callback sent it back with", async () => {
    state.params = new URLSearchParams("error=The%20link%20has%20expired");
    render(<ForgotPasswordPage />);
    await screen.findByText("The link has expired");
  });
});
