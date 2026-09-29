import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
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
