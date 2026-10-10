import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import enCommon from "@/messages/en/common.json";
import esCommon from "@/messages/es/common.json";
import itCommon from "@/messages/it/common.json";
import ptCommon from "@/messages/pt/common.json";
import { notificationText, notificationTime } from "./display";
import type { NotificationRow } from "./types";

/**
 * The bell in the viewer's language. Every type but "is going" used to show
 * the English line stored when the event happened, and times read "5m ago"
 * in every locale.
 */
const COMMON = { en: enCommon, es: esCommon, it: itCommon, pt: ptCommon } as const;
type Locale = keyof typeof COMMON;

const translator = (locale: Locale) =>
  createTranslator({ locale, messages: { common: COMMON[locale] }, namespace: "common.share.notifications" });

const row = (type: NotificationRow["type"], payload: Record<string, unknown>) => ({
  type,
  payload: { message: "stored English line", ...payload },
});

// Payloads as the routes write them today.
const ROWS = {
  inviteAccepted: row("invite_accepted", { collaborator_name: "Ana", tripName: "Lisbon Trip", trip_id: "t1" }),
  anonVote: row("anon_vote", { voterName: "Bo", tripName: "Lisbon Trip", trip_id: "t1" }),
  collabVote: row("collab_vote", { voter_name: "Ana", vote: "flexible", vote_type: "down", trip_id: "t1" }),
  collabProposal: row("collab_proposal", { proposer_name: "Ana", proposed_activity: "Belém Tower", day_number: 2, trip_id: "t1" }),
  crewJoined: row("crew_joined", { name: "Bo", tripName: "Lisbon Trip", trip_id: "t1" }),
};

describe("notificationText", () => {
  it("writes each type in Italian from its payload", () => {
    const t = translator("it");
    expect(notificationText(ROWS.inviteAccepted, t)).toBe("Ana ora fa parte di “Lisbon Trip”");
    expect(notificationText(ROWS.anonVote, t)).toBe("Bo ha iniziato a votare “Lisbon Trip”");
    expect(notificationText(ROWS.collabVote, t)).toBe("Ana è flessibile su un’attività del tuo viaggio");
    expect(notificationText(ROWS.collabProposal, t)).toBe("Ana ha proposto “Belém Tower” per il giorno 2");
    expect(notificationText(ROWS.crewJoined, t)).toBe("Bo viene a “Lisbon Trip”");
  });

  it.each(["es", "it", "pt"] as const)("%s never falls back to the stored English for those types", (locale) => {
    const t = translator(locale);
    for (const n of Object.values(ROWS)) expect(notificationText(n, t)).not.toBe("stored English line");
  });

  it("keeps the English the routes wrote, for English readers", () => {
    const t = translator("en");
    expect(notificationText(ROWS.collabProposal, t)).toBe("Ana proposed “Belém Tower” for day 2");
    expect(notificationText(ROWS.collabVote, t)).toBe("Ana is flexible on an activity in your trip");
  });

  it("reads older rows as far as their payload allows", () => {
    const t = translator("es");
    // Joins stored before the trip's name was.
    expect(notificationText(row("invite_accepted", { collaborator_name: "Ana" }), t)).toBe("Ana se unió a tu viaje");
    // Votes stored before the exact vote was: "up" was only ever a love.
    expect(notificationText(row("collab_vote", { voter_name: "Ana", vote_type: "up" }), t)).toBe(
      "A Ana le encantó una actividad de tu viaje"
    );
    expect(notificationText(row("collab_vote", { voter_name: "Ana", vote_type: "down" }), t)).toBe(
      "Ana votó una actividad de tu viaje"
    );
    expect(notificationText(row("anon_vote", { voterName: null, tripName: "Lisbon Trip" }), t)).toBe(
      "Alguien empezó a votar en “Lisbon Trip”"
    );
  });

  it("shows the stored line only when the payload can't say it, and never nothing", () => {
    const t = translator("pt");
    expect(notificationText(row("system", { message: "Scheduled maintenance tonight" }), t)).toBe("Scheduled maintenance tonight");
    expect(notificationText(row("collab_proposal", { proposer_name: "Ana" }), t)).toBe("stored English line");
    expect(notificationText({ type: "system", payload: {} as NotificationRow["payload"] }, t)).toBe("Novidade");
  });
});

describe("notificationTime", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
  const time = (locale: Locale, minutes: number) =>
    notificationTime(ago(minutes), locale, translator(locale)("justNow"), now);

  it("says it in the viewer's language", () => {
    expect(time("it", 0.5)).toBe("proprio ora");
    expect(time("it", 5)).toBe("5 minuti fa");
    expect(time("it", 180)).toBe("3 ore fa");
    expect(time("it", 24 * 60)).toBe("ieri");
    expect(time("es", 5)).toBe("hace 5 minutos");
    expect(time("pt", 180)).toBe("há 3 horas");
    expect(time("en", 2 * 24 * 60)).toBe("2 days ago");
  });

  it("gives the date once a week has passed, in the viewer's format", () => {
    const iso = ago(10 * 24 * 60);
    expect(notificationTime(iso, "it", "proprio ora", now)).toBe(new Date(iso).toLocaleDateString("it"));
  });

  it("shows nothing for a timestamp it can't read rather than failing the bell", () => {
    expect(notificationTime("not a date", "it", "proprio ora", now)).toBe("");
  });
});
