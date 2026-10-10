import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import enCommon from "@/messages/en/common.json";
import itCommon from "@/messages/it/common.json";

/**
 * The invite page in the visitor's language: the join screen's errors and the
 * page's own title and link preview. The join route answers in English for its
 * logs, and that English used to reach the screen.
 */
const COMMON = { en: enCommon, it: itCommon } as const;

vi.mock("@/lib/i18n/routing", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "user-1", email: "guest@example.com" }, loading: false }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {} }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    setRequestLocale: () => {},
    getTranslations: async (arg: string | { locale: keyof typeof COMMON; namespace: string }) => {
      const { locale, namespace } = typeof arg === "string" ? { locale: "it" as const, namespace: arg } : arg;
      return createTranslator({ locale, messages: { common: COMMON[locale] }, namespace: namespace as never });
    },
  };
});

// The invite lookup: `rpc` answers per function name, `from` per table.
const db = vi.hoisted(() => ({
  rpc: {} as Record<string, unknown[]>,
  tables: {} as Record<string, unknown>,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: async (name: string) => ({ data: db.rpc[name] ?? [], error: null }),
    from: (table: string) => {
      const result = db.tables[table];
      const chain: Record<string, unknown> = {
        single: async () => result,
        maybeSingle: async () => result,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      for (const step of ["select", "eq", "is"]) chain[step] = () => chain;
      return chain;
    },
  }),
}));

import InviteAcceptClient from "./InviteAcceptClient";
import JoinPage, { generateMetadata } from "./page";

const props = {
  invite: { token: "tok12345", role: "voter" as const, expiresAt: "2036-01-01T00:00:00Z", message: null },
  trip: {
    id: "trip-1",
    title: "Lisbon Trip",
    description: null,
    coverImageUrl: null,
    startDate: "2026-11-24",
    endDate: "2026-11-25",
    durationDays: 2,
    destination: "Lisbon",
    collaboratorCount: 3,
  },
  owner: { displayName: "Ana", avatarUrl: null },
  inviter: null,
};

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function joinAndRead(status: number, body: object): Promise<string> {
  fetchMock.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body });
  render(
    <NextIntlClientProvider locale="it" messages={{ common: itCommon }}>
      <InviteAcceptClient {...props} />
    </NextIntlClientProvider>
  );
  fireEvent.click(screen.getByText(itCommon.invitePage.joinTrip));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  return (await screen.findByText((_, el) => el?.tagName === "P" && el.className.includes("text-red-700"))).textContent ?? "";
}

describe("joining from the invite page", () => {
  it("explains an expired invite in Italian, not the route's English", async () => {
    const text = await joinAndRead(410, { error: "This invite has expired", code: "EXPIRED" });
    expect(text).toBe(itCommon.invitePage.errors.expiredDesc);
  });

  it("explains a used-up invite", async () => {
    expect(await joinAndRead(410, { error: "This invite link has already been used", code: "MAX_USES" })).toBe(
      itCommon.invitePage.errors.maxUsesDesc
    );
  });

  it("asks to sign in again when the session is gone", async () => {
    expect(await joinAndRead(401, { error: "Authentication required" })).toBe(itCommon.errors.sessionExpired);
  });

  it("falls back to a plain failure for anything else", async () => {
    expect(await joinAndRead(500, { error: "Failed to join trip" })).toBe(itCommon.invitePage.errors.failedToJoin);
  });
});

describe("the invite page's title and link preview", () => {
  const usable = {
    id: "invite-1",
    trip_id: "trip-1",
    token: "tok12345",
    role: "voter",
    created_by: "owner-1",
    created_at: "2026-10-01T00:00:00Z",
    expires_at: "2036-01-01T00:00:00Z",
    max_uses: 10,
    use_count: 0,
    is_active: true,
    recipient_email: null,
    message: null,
  };

  beforeEach(() => {
    db.rpc = {};
    db.tables = {
      trips: {
        data: {
          id: "trip-1",
          title: "Lisbon Trip",
          description: null,
          start_date: "2026-11-24",
          end_date: "2026-11-25",
          cover_image_url: null,
          share_token: null,
          user_id: "owner-1",
          itinerary: [{ activities: [{ location: "Lisbon" }] }],
        },
        error: null,
      },
      users: { data: { display_name: "Ana", avatar_url: null } },
      trip_collaborators: { count: 2 },
    };
  });

  const metadataFor = (locale: "en" | "it") => generateMetadata({ params: Promise.resolve({ token: "tok12345", locale }) });

  it("reads in the page's language", async () => {
    db.rpc.get_invite_by_token = [usable];
    const metadata = await metadataFor("it");
    expect(metadata.title).toBe("Unisciti a Lisbon Trip");
    expect(metadata.description).toBe("Ti hanno invitato a organizzare Lisbon. Accetta l’invito e pianificate il viaggio insieme!");
    expect(metadata.openGraph?.description).toBe("Ana ti ha invitato a un viaggio.");
  });

  it("keeps the English for English visitors", async () => {
    db.rpc.get_invite_by_token = [usable];
    const metadata = await metadataFor("en");
    expect(metadata.title).toBe("Join Lisbon Trip");
    expect(metadata.openGraph?.description).toBe("Ana invited you to join their trip.");
  });

  it("names what is wrong with a dead invite", async () => {
    db.rpc.get_invite_status_by_token = [{ ...usable, expires_at: "2020-01-01T00:00:00Z" }];
    expect((await metadataFor("it")).title).toBe(itCommon.invitePage.errors.expired);

    db.rpc.get_invite_status_by_token = [];
    expect((await metadataFor("it")).title).toBe(itCommon.invitePage.errors.invalidToken);
  });

  it("calls an owner without a name by the page's own words", async () => {
    db.rpc.get_invite_by_token = [usable];
    db.tables.users = { data: { display_name: null, avatar_url: null } };
    expect((await metadataFor("it")).openGraph?.description).toBe(
      `${itCommon.invitePage.ownerFallback} ti ha invitato a un viaggio.`
    );
    expect((await metadataFor("en")).openGraph?.description).toBe("Trip Owner invited you to join their trip.");
  });

  it("calls an inviter without a name someone, not the owner", async () => {
    db.rpc.get_invite_by_token = [{ ...usable, created_by: "member-1" }];
    db.tables.users = { data: { display_name: null, avatar_url: null } };
    expect((await metadataFor("it")).openGraph?.description).toBe("Qualcuno ti ha invitato a un viaggio.");
  });

  it("shows the join screen with the stand-in, never null", async () => {
    db.rpc.get_invite_by_token = [{ ...usable, message: "Ci vediamo a Lisbona" }];
    db.tables.users = { data: { display_name: null, avatar_url: null } };
    const page = await JoinPage({ params: Promise.resolve({ token: "tok12345", locale: "it" }) });
    render(<NextIntlClientProvider locale="it" messages={{ common: itCommon }}>{page}</NextIntlClientProvider>);
    expect(screen.getByText(`${itCommon.invitePage.ownerFallback} ti ha invitato a unirti`)).toBeTruthy();
    expect(screen.getByLabelText(itCommon.invitePage.inviterNoteLabel)).toBeTruthy();
    expect(document.body.textContent).not.toContain("null");
  });
});
