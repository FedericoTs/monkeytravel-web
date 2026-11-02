import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import type { ReactNode } from "react";
import enCommon from "@/messages/en/common.json";
import esCommon from "@/messages/es/common.json";
import itCommon from "@/messages/it/common.json";
import ptCommon from "@/messages/pt/common.json";
import enAuth from "@/messages/en/auth.json";
import esAuth from "@/messages/es/auth.json";
import itAuth from "@/messages/it/auth.json";
import ptAuth from "@/messages/pt/auth.json";
import { APP_CLIENT_NAMESPACES, pickMessages } from "@/lib/i18n/client-messages";

/**
 * The onboarding page's own copy (header, banner, progress and navigation) in
 * the visitor's language. The four steps have their own translations.
 */
const MESSAGES = {
  en: { common: enCommon, auth: enAuth },
  es: { common: esCommon, auth: esAuth },
  it: { common: itCommon, auth: itAuth },
  pt: { common: ptCommon, auth: ptAuth },
} as const;
type Locale = keyof typeof MESSAGES;
const LOCALES = Object.keys(MESSAGES) as Locale[];

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  // One object per test: the page restores from it whenever its identity changes.
  prefs: {} as Record<string, unknown>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}));
vi.mock("@/lib/analytics", () => ({
  trackOnboardingStepViewed: vi.fn(),
  trackOnboardingStepCompleted: vi.fn(),
  trackOnboardingCompleted: vi.fn(),
  trackOnboardingSkipped: vi.fn(),
}));
vi.mock("@/hooks/useOnboardingPreferences", () => ({
  useOnboardingPreferences: () => ({
    preferences: state.prefs,
    isLoaded: true,
    savePreferences: vi.fn(),
    completeOnboarding: vi.fn(),
    getPreferencesForDatabase: vi.fn(),
  }),
}));

import OnboardingPage from "./page";

const strip = (message: string) => message.replace(/<\/?\w+>/g, "");
// The messages the (app) layout serializes. The cast is for common.roles, whose
// string arrays (read with t.raw) AbstractIntlMessages does not describe.
const clientMessages = (locale: Locale) =>
  pickMessages(MESSAGES[locale] as unknown as AbstractIntlMessages, APP_CLIENT_NAMESPACES);
const renderAt = (locale: Locale, currentStep: number) => {
  state.prefs = { travelStyles: [], dietaryPreferences: [], accessibilityNeeds: [], activeHoursStart: 8, activeHoursEnd: 22, currentStep };
  return render(
    <NextIntlClientProvider locale={locale} messages={clientMessages(locale)}>
      <OnboardingPage />
    </NextIntlClientProvider>,
  );
};
// The page's own lines in a locale.
const shell = (locale: Locale) => {
  const { common, auth } = MESSAGES[locale];
  const page = common.onboarding.page;
  return {
    page,
    lines: [
      page.skipForNow,
      page.valueProposition,
      strip(page.banner),
      page.stepOf.replace("{step}", "1").replace("{total}", "4"),
      common.buttons.continue,
      auth.signup.hasAccount,
      auth.signup.signInLink,
    ],
  };
};

beforeEach(() => {
  state.user = null;
});

describe.each(LOCALES)("in %s", (locale) => {
  const { page, lines } = shell(locale);
  const { common, auth } = MESSAGES[locale];

  it("the first step frames the page in the visitor's language, and nothing in English", async () => {
    const { container } = renderAt(locale, 1);
    await screen.findByText(auth.signup.signInLink);
    const text = container.textContent ?? "";
    for (const line of lines) expect(text).toContain(line);
    expect(screen.getByText(auth.signup.signInLink).getAttribute("href")).toBe("/auth/login");
    expect(screen.queryByText(page.back)).toBeNull();
    expect(text).not.toMatch(/onboarding\.page\.|buttons\.|signup\.|<\/?strong>/);
    if (locale !== "en") for (const line of shell("en").lines) expect(text).not.toContain(line);
  });

  it("the last step goes back, and asks a visitor to create an account", async () => {
    renderAt(locale, 4);
    await screen.findByText(auth.signup.signInLink);
    expect(screen.getByText(page.back)).toBeTruthy();
    expect(screen.getByText(page.createAccount)).toBeTruthy();
    expect(screen.getByText(page.stepOf.replace("{step}", "4").replace("{total}", "4"))).toBeTruthy();
  });

  it("the last step saves for a signed-in user, with no sign-in line", async () => {
    state.user = { id: "user-1" };
    const { container } = renderAt(locale, 4);
    await screen.findByText(page.saveAndContinue);
    expect(container.textContent).not.toContain(auth.signup.hasAccount);
    expect(screen.queryByText(page.createAccount)).toBeNull();
    expect(screen.queryByText(common.buttons.continue)).toBeNull();
  });
});
