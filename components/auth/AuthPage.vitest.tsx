import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { AuthField, AuthPage, AuthPageLoading, AuthStatusIcon, AuthSubmitButton } from "./AuthPage";

describe("the sign-in page frame", () => {
  it("puts the logo, linking home, above the card", () => {
    render(<AuthPage>Form</AuthPage>);
    const home = screen.getByRole("link", { name: /MonkeyTravel/ });
    expect(home.getAttribute("href")).toBe("/");
    expect(screen.getByRole("img", { name: "MonkeyTravel" })).toBeTruthy();
    expect(screen.getByText("Form").className).toBe("bg-white rounded-2xl shadow-xl p-8 border border-slate-200");
  });

  it("centers a result card's text", () => {
    render(<AuthPage centered>Done</AuthPage>);
    expect(screen.getByText("Done").className).toContain("text-center");
  });
});

describe("the form button", () => {
  it("shows its label until the form is sent", () => {
    render(<AuthSubmitButton loading={false} loadingLabel="Sending…">Send link</AuthSubmitButton>);
    const button = screen.getByRole("button", { name: "Send link" });
    expect(button.getAttribute("type")).toBe("submit");
    expect(button).toHaveProperty("disabled", false);
    expect(button.querySelector(".animate-spin")).toBeNull();
  });

  it("spins, says so, and cannot be pressed again while it is", () => {
    render(<AuthSubmitButton loading loadingLabel="Sending…">Send link</AuthSubmitButton>);
    const button = screen.getByRole("button", { name: "Sending…" });
    expect(button).toHaveProperty("disabled", true);
    expect(button.querySelector(".animate-spin")).not.toBeNull();
  });
});

it.each([
  ["done", "bg-green-100", "text-green-600", "M5 13l4 4L19 7"],
  ["emailed", "bg-blue-100", "text-blue-600", "M3 8l7.89"],
  ["broken", "bg-red-100", "text-red-600", "M12 9v2"],
] as const)("the %s icon", (status, circle, icon, path) => {
  const { container } = render(<AuthStatusIcon status={status} />);
  expect(container.firstElementChild?.className).toContain(circle);
  expect(container.querySelector("svg")?.getAttribute("class")).toContain(icon);
  expect(container.querySelector("path")?.getAttribute("d")?.startsWith(path)).toBe(true);
});

it("waits with a spinner", () => {
  const { container } = render(<AuthPageLoading />);
  expect(container.querySelector(".animate-spin")).not.toBeNull();
});

describe("a field of the card", () => {
  it("labels its input, names it after its id, and passes the input's own attributes on", () => {
    render(<AuthField id="password" type="password" autoComplete="new-password" label="New password" minLength={6} required placeholder="••••••" />);
    const input = screen.getByLabelText("New password") as HTMLInputElement;
    expect(input.id).toBe("password");
    expect(input.name).toBe("password");
    expect(input.type).toBe("password");
    expect(input.minLength).toBe(6);
    expect(input.required).toBe(true);
    expect(input.getAttribute("autocomplete")).toBe("new-password");
    expect(input.className).toContain("border-slate-300");
    expect(screen.getByText("New password").className).toContain("text-slate-700");
  });

  it("keeps a name that differs from its id", () => {
    render(<AuthField id="displayName" name="name" label="Name" />);
    expect((screen.getByLabelText("Name") as HTMLInputElement).name).toBe("name");
  });

  it("turns label and border red while invalid", () => {
    render(<AuthField id="email" type="email" label="Email" invalid />);
    expect(screen.getByText("Email").className).toContain("text-red-600");
    expect(screen.getByLabelText("Email").className).toContain("border-red-300");
  });

  it("puts an aside next to the label, and a hint under the input", () => {
    render(<AuthField id="password" label="Password" labelAside={<a href="/auth/forgot-password">Forgot?</a>} hint="6 characters or more" />);
    const label = screen.getByText("Password");
    expect(label.parentElement?.className).toBe("flex items-center justify-between mb-1");
    expect(label.parentElement?.querySelector("a")?.textContent).toBe("Forgot?");
    expect(screen.getByText("6 characters or more").tagName).toBe("P");
  });
});
