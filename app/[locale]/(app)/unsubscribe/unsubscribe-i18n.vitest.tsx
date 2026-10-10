import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { randomBytes } from "crypto";
import { fakeSupabase } from "@/tests/fake-supabase";
import enProfile from "@/messages/en/profile.json";
import esProfile from "@/messages/es/profile.json";
import itProfile from "@/messages/it/profile.json";
import ptProfile from "@/messages/pt/profile.json";

/**
 * /unsubscribe: where the one-click link in an email's footer lands.
 * English-only until 2026-09-25; now in the page's language, with the phrase
 * for what is being stopped shaped to fit each language's sentence.
 */

const PROFILE = { en: enProfile, es: esProfile, it: itProfile, pt: ptProfile } as const;
type Locale = keyof typeof PROFILE;

vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const verify = vi.fn();
vi.mock("@/lib/email/unsubscribe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/unsubscribe")>()),
  verifyUnsubscribeToken: (token: string) => verify(token),
}));

/** The guest's trip, as the page reads it; null when it cannot be found. */
let tripTitle: string | null = null;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    fakeSupabase((q) => {
      if (q.table === "trip_participants") return { data: { trip_id: "trip-1" }, error: null };
      if (q.table === "trips") return { data: tripTitle === null ? null : { title: tripTitle }, error: null };
      return { data: null, error: null };
    }).client,
}));

// The server page's translator, built from the same message files.
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async ({ locale, namespace }: { locale: Locale; namespace: string }) =>
      createTranslator({ locale, messages: { profile: PROFILE[locale] }, namespace: namespace as never }),
  };
});

import UnsubscribePage from "./page";
import { UnsubscribeConfirmButton } from "./UnsubscribeConfirmButton";
import { signParticipantUnsubscribeToken } from "@/lib/email/unsubscribe";

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function renderPage(locale: Locale, payload: { k: string } | null, reason?: string) {
  verify.mockReturnValue(payload ? { ok: true, payload } : { ok: false, reason });
  const element = await UnsubscribePage({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve({ token: "tok" }),
  });
  render(
    <NextIntlClientProvider locale={locale} messages={{ profile: PROFILE[locale] }}>
      {element}
    </NextIntlClientProvider>
  );
}

describe("unsubscribe page", () => {
  it.each([
    ["en", "tripReminders", "Stop receiving trip reminders?"],
    ["es", "marketingNotifications", "¿Dejar de recibir las novedades y actualizaciones?"],
    ["it", "tripReminders", "Vuoi smettere di ricevere i promemoria di viaggio?"],
    ["it", "all", "Vuoi smettere di ricevere le email di MonkeyTravel?"],
    ["pt", "collabVotes", "Parar de receber as notificações de votos?"],
    ["it", "notAKey", "Vuoi smettere di ricevere queste email?"],
  ] as const)("%s, %s: asks in the page's language", async (locale, key, title) => {
    await renderPage(locale, { k: key });
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
  });

  it("an expired link, in Italian, points to the settings", async () => {
    await renderPage("it", null, "expired");
    expect(screen.getByRole("heading", { name: "Link scaduto" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Apri le impostazioni delle notifiche" }).getAttribute("href")).toBe(
      "/profile/notifications"
    );
  });

  it("a broken link, in Portuguese", async () => {
    await renderPage("pt", null, "bad_signature");
    expect(screen.getByRole("heading", { name: "Não conseguimos verificar este link" })).toBeTruthy();
  });
});

describe("confirm button", () => {
  function renderButton(locale: Locale, what: string) {
    render(
      <NextIntlClientProvider locale={locale} messages={{ profile: PROFILE[locale] }}>
        <UnsubscribeConfirmButton token="tok" what={what} />
      </NextIntlClientProvider>
    );
  }

  it("Spanish: confirms, says so, and links back to the settings", async () => {
    fetchMock.mockResolvedValue(reply({ applied: true }));
    renderButton("es", esProfile.unsubscribe.what.tripReminders);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByRole("heading", { name: "Te has dado de baja" })).toBeTruthy();
    expect(screen.getByText("Dejaremos de enviarte los recordatorios de viaje. Perdona las molestias.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "configuración de notificaciones" }).getAttribute("href")).toBe(
      "/profile/notifications"
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/unsubscribe", expect.objectContaining({ method: "POST" }));
  });

  it("Italian: an API error shows our message, not the server's English", async () => {
    fetchMock.mockResolvedValue(reply({ error: "Invalid or expired token" }, 400));
    renderButton("it", itProfile.unsubscribe.what.marketingNotifications);
    fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
    expect(await screen.findByText("Non siamo riusciti ad aggiornare le preferenze. Riprova.")).toBeTruthy();
    expect(screen.queryByText(/Invalid or expired token/)).toBeNull();
  });

  it("Portuguese: a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    renderButton("pt", ptProfile.unsubscribe.what.all);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("Erro de rede. Tente novamente.")).toBeTruthy();
  });
});

describe("a guest's link to a trip's daily plan", () => {
  const ROW = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

  beforeEach(() => {
    vi.stubEnv("EMAIL_UNSUBSCRIBE_SECRET", randomBytes(32).toString("hex"));
    tripTitle = "Lisbon Trip";
    verify.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  async function renderGuest(locale: Locale, token = signParticipantUnsubscribeToken(ROW)) {
    const element = await UnsubscribePage({
      params: Promise.resolve({ locale }),
      searchParams: Promise.resolve({ token }),
    });
    render(
      <NextIntlClientProvider locale={locale} messages={{ profile: PROFILE[locale] }}>
        {element}
      </NextIntlClientProvider>
    );
  }

  it.each([
    ["en", "Lisbon Trip", "Stop receiving the daily plan for Lisbon?"],
    ["it", "Lisbona", "Vuoi smettere di ricevere il piano giornaliero di Lisbona?"],
    ["pt", null, "Parar de receber o plano diário desta viagem?"],
  ] as const)("%s: names the trip (%s) and points to no account settings", async (locale, title, heading) => {
    tripTitle = title;
    await renderGuest(locale);
    expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });

  it("Spanish: confirming says the emails stop and they are still going", async () => {
    fetchMock.mockResolvedValue(reply({ ok: true, applied: true, guest: true }));
    await renderGuest("es");
    expect(
      screen.getByText("Confirma y dejaremos de enviarte por correo el plan de cada día. Seguirás en la lista de quienes van.")
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByRole("heading", { name: "Te has dado de baja" })).toBeTruthy();
    expect(screen.getByText("Ya no recibirás el plan diario de Lisbon, pero sigues en la lista de quienes van.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/unsubscribe", expect.objectContaining({ method: "POST" }));
  });

  it("an expired guest link shows the expired state", async () => {
    await renderGuest("en", signParticipantUnsubscribeToken(ROW, -1));
    expect(screen.getByRole("heading", { name: "Link expired" })).toBeTruthy();
    expect(verify).not.toHaveBeenCalled();
  });
});
