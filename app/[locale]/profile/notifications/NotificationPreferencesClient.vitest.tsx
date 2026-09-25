import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import enProfile from "@/messages/en/profile.json";
import esProfile from "@/messages/es/profile.json";
import itProfile from "@/messages/it/profile.json";
import ptProfile from "@/messages/pt/profile.json";

/**
 * /profile/notifications: the "Manage preferences" link of every email.
 *
 * It was English-only, and four of its six switches were read by no email
 * while trip reminders and marketing had none. It now shows, in the page's
 * language, exactly the switches the email pipeline reads.
 */

vi.mock("@/lib/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import NotificationPreferencesClient from "./NotificationPreferencesClient";

// Includes keys the page doesn't show: they must survive a save untouched.
const STORED = {
  emailNotifications: true,
  tripReminders: true,
  collabVotes: true,
  marketingNotifications: true,
  weeklyDigest: true,
  dealAlerts: true,
  quietHoursStart: 22,
};

const LOG = [
  { id: "1", recipient_email: "a@b.c", template_id: "trip_reminder", status: "sent", sent_at: null, bounced_at: null, created_at: "2026-09-25T16:10:00Z" },
  { id: "2", recipient_email: "a@b.c", template_id: "unknown", status: "skipped_disabled", sent_at: null, bounced_at: null, created_at: "2026-09-24T07:00:00Z" },
  { id: "3", recipient_email: "a@b.c", template_id: "share_fix_notice", status: "complained", sent_at: null, bounced_at: null, created_at: "2026-09-25T16:10:53Z" },
];

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

let stored: Record<string, unknown>;
let patchStatus: number;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url.startsWith("/api/profile") && init?.method === "PATCH") {
    return reply(patchStatus < 400 ? { ok: true } : { error: "Internal Server Error" }, patchStatus);
  }
  if (url.startsWith("/api/profile")) return reply({ data: { profile: { notification_settings: stored } } });
  if (url.startsWith("/api/notifications/email-log")) return reply({ data: { entries: LOG } });
  return reply({}, 404);
});

beforeEach(() => {
  stored = { ...STORED };
  patchStatus = 200;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderPage(locale: string, profile: object) {
  render(
    <NextIntlClientProvider locale={locale} messages={{ profile }}>
      <NotificationPreferencesClient />
    </NextIntlClientProvider>
  );
}

const switchNames = async () =>
  (await screen.findAllByRole("switch")).map((s) => s.getAttribute("aria-label"));

describe("notification settings page", () => {
  it("in Italian, with exactly the switches the emails read", async () => {
    renderPage("it", itProfile);
    expect(await screen.findByRole("heading", { name: "Preferenze di notifica" })).toBeTruthy();
    expect(await switchNames()).toEqual([
      "Inviami email",
      "Promemoria di viaggio",
      "Voti sui miei viaggi",
      "Novità e aggiornamenti",
    ]);
    for (const gone of [/weekly digest/i, /proposed activities/i, /comments on activities/i, /invite accepted/i]) {
      expect(screen.queryByText(gone)).toBeNull();
    }

    const history = screen.getByRole("list");
    expect(within(history).getByText("Promemoria di viaggio")).toBeTruthy();
    expect(within(history).getByText("Inviata")).toBeTruthy();
    expect(within(history).getByText("Email")).toBeTruthy(); // unknown template id
    expect(within(history).getByText("Non inviata — preferenza disattivata")).toBeTruthy();
    expect(within(history).getByText("Segnalata come spam")).toBeTruthy();
    expect(within(history).getAllByText(/set 2026/).length).toBeGreaterThan(0); // Italian dates
  });

  it.each([
    ["es", esProfile, "Preferencias de notificaciones", ["Enviarme correos", "Recordatorios de viaje", "Votos en mis viajes", "Novedades y actualizaciones"]],
    ["pt", ptProfile, "Preferências de notificação", ["Receber e-mails", "Lembretes de viagem", "Votos nas minhas viagens", "Novidades e atualizações"]],
    ["en", enProfile, "Notification preferences", ["Send me emails", "Trip reminders", "Votes on my trips", "News and updates"]],
  ])("in %s", async (locale, profile, heading, switches) => {
    renderPage(locale, profile);
    expect(await screen.findByRole("heading", { name: heading })).toBeTruthy();
    expect(await switchNames()).toEqual(switches);
  });

  it("turning off news and updates saves marketingNotifications=false and keeps every other key", async () => {
    renderPage("en", enProfile);
    fireEvent.click(await screen.findByRole("switch", { name: "News and updates" }));
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    expect(await screen.findByText(/Saved/)).toBeTruthy();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body)).notification_settings).toEqual({
      ...STORED,
      marketingNotifications: false,
    });
  });

  it("trip reminders can be turned off here too", async () => {
    renderPage("en", enProfile);
    const reminders = await screen.findByRole("switch", { name: "Trip reminders" });
    expect(reminders.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(reminders);
    expect(reminders.getAttribute("aria-checked")).toBe("false");
  });

  it("with the master switch off, the others can't be changed", async () => {
    renderPage("en", enProfile);
    fireEvent.click(await screen.findByRole("switch", { name: "Send me emails" }));
    for (const name of ["Trip reminders", "Votes on my trips", "News and updates"]) {
      expect((screen.getByRole("switch", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("a key that was never stored shows as on, as the pipeline treats it", async () => {
    stored = {};
    renderPage("en", enProfile);
    const states = (await screen.findAllByRole("switch")).map((s) => s.getAttribute("aria-checked"));
    expect(states).toEqual(["true", "true", "true", "true"]);
  });

  it("a failed save says so in the page's language, not the server's words", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    patchStatus = 500;
    renderPage("it", itProfile);
    fireEvent.click(await screen.findByRole("button", { name: "Salva preferenze" }));
    expect(await screen.findByText("Non siamo riusciti a salvare le preferenze. Riprova.")).toBeTruthy();
    expect(screen.queryByText(/Internal Server Error/)).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Salva preferenze" })).toBeTruthy());
  });
});
