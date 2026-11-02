import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import en from "@/messages/en/common.json";
import es from "@/messages/es/common.json";
import itCommon from "@/messages/it/common.json";
import pt from "@/messages/pt/common.json";
import { APP_CLIENT_NAMESPACES, pickMessages } from "@/lib/i18n/client-messages";

/**
 * The referral landing page in the visitor's language: the page itself and its
 * link preview, which is how the invite looks wherever it was shared.
 */
const COMMON = { en, es, it: itCommon, pt } as const;
type Locale = keyof typeof COMMON;
const LOCALES = Object.keys(COMMON) as Locale[];

vi.mock("@/lib/i18n/routing", () => ({
  useRouter: () => ({ push: vi.fn() }),
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
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async ({ locale, namespace }: { locale: Locale; namespace: string }) =>
      createTranslator({ locale, messages: { common: COMMON[locale] }, namespace: namespace as never }),
  };
});

// The referral lookups answer one row per table; a missing table is no row.
const db = vi.hoisted(() => {
  const tables: Record<string, unknown> = {};
  const client = {
    from: (table: string) => {
      const chain: Record<string, unknown> = { single: async () => tables[table] ?? { data: null, error: null } };
      for (const step of ["select", "eq"]) chain[step] = () => chain;
      return chain;
    },
  };
  return { tables, client };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client }));

import ReferralLandingClient from "./ReferralLandingClient";
import ReferralLandingPage, { generateMetadata } from "./page";

const strip = (message: string) => message.replace(/<\/?\w+>/g, "");
const inLocale = (locale: Locale, ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale={locale} messages={pickMessages({ common: COMMON[locale] }, APP_CLIENT_NAMESPACES)}>
      {ui}
    </NextIntlClientProvider>,
  );
// Every line the page shows, with the referrer's name filled in.
const shownLines = (locale: Locale, name: string) => {
  const { meta: _meta, friendFallback: _fallback, perks, features, ...lines } = COMMON[locale].referralLanding;
  return [...Object.values(lines), ...Object.values(perks), ...Object.values(features)].map((line) =>
    strip(line).replace("{name}", name),
  );
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
  for (const table of Object.keys(db.tables)) delete db.tables[table];
});

describe.each(LOCALES)("in %s", (locale) => {
  const copy = COMMON[locale].referralLanding;

  it("the page shows its copy with the referrer's first name, and nothing in English", () => {
    const { container } = inLocale(locale, <ReferralLandingClient code="ABC123" referrerName="Marco Rossi" />);
    const text = container.textContent ?? "";
    for (const line of shownLines(locale, "Marco")) expect(text).toContain(line);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(copy.titleLead + strip(copy.titleOffer));
    expect(screen.getByRole("button").textContent).toBe(copy.cta);
    expect(text).toContain(COMMON[locale].footer.copyright.replace("{year}", String(new Date().getFullYear())));
    expect(text).not.toMatch(/referralLanding\.|footer\.|<\/?(strong|highlight)>|Rossi/);
    if (locale !== "en") for (const line of shownLines("en", "Marco")) expect(text).not.toContain(line);
  });

  it("a referrer with no name is introduced by the whole fallback", () => {
    const { container } = inLocale(locale, <ReferralLandingClient code="ABC123" referrerName={null} />);
    expect(container.textContent).toContain(strip(copy.invitedYou).replace("{name}", copy.friendFallback));
    expect(container.textContent).toContain(copy.subtitle.replace("{name}", copy.friendFallback));
  });

  it("the link preview names the referrer, or the fallback", async () => {
    db.tables.referral_codes = { data: { user_id: "user-1" }, error: null };
    db.tables.public_profiles = { data: { display_name: "Marco" }, error: null };
    const named = await generateMetadata({ params: Promise.resolve({ code: "abc123", locale }) });
    const title = copy.meta.title.replace("{name}", "Marco");
    expect(named.title).toBe(title);
    expect(named.description).toBe(copy.meta.description);
    expect(named.openGraph).toMatchObject({ title, description: copy.meta.description });
    expect(named.twitter).toMatchObject({ title, description: copy.meta.shortDescription });

    db.tables.public_profiles = { data: { display_name: null }, error: null };
    const unnamed = await generateMetadata({ params: Promise.resolve({ code: "abc123", locale }) });
    expect(unnamed.title).toBe(copy.meta.title.replace("{name}", copy.friendFallback));
  });
});

it("the page hands the client no English fallback name", async () => {
  db.tables.referral_codes = { data: { id: "ref-1", code: "ABC123", user_id: "user-1" }, error: null };
  const page = await ReferralLandingPage({ params: Promise.resolve({ code: "abc123", locale: "es" }) });
  expect(page.props).toMatchObject({ code: "ABC123", referrerName: null });
});
