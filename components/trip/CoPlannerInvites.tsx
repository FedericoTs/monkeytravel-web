"use client";

/**
 * "Who's planning this with you?": one co-planner (editor) invite per named
 * person. A personal invite to plan together brings people in far more often
 * than a view-only link, so each name gets its own link, sent with a message
 * that says who it is for. A typed email is sent by us instead.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, Loader2, Mail, MessageCircle, Plus, Send, Share2 } from "lucide-react";
import { captureCoPlannerInviteSent } from "@/lib/posthog/events";

export type CoPlannerChannel = "native" | "whatsapp" | "copy" | "email";

interface Row {
  key: number;
  name: string;
  email: string;
  showEmail: boolean;
  status: "idle" | "sending" | "ready" | "sent" | "failed";
  channel?: CoPlannerChannel;
  message?: string;
  copied?: boolean;
}

const MAX_ROWS = 8;
const blankRow = (key: number): Row => ({ key, name: "", email: "", showEmail: false, status: "idle" });

/** Phones get their share sheet; elsewhere WhatsApp (web or desktop) is the target. */
function canShareNatively(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: coarse)").matches === true
  );
}

const whatsappUrl = (message: string) => `https://wa.me/?text=${encodeURIComponent(message)}`;

export interface CoPlannerInvitesProps {
  tripId: string;
  tripTitle: string;
  /** Which surface asked, for the event. */
  surface: "first_day_prompt" | "invite_tab";
  /** After each invite goes out. */
  onSent?: (channel: CoPlannerChannel) => void;
}

export default function CoPlannerInvites({ tripId, tripTitle, surface, onSent }: CoPlannerInvitesProps) {
  const t = useTranslations("common.share.coplanners");
  const [rows, setRows] = useState<Row[]>([blankRow(0), blankRow(1)]);

  const update = (key: number, patch: Partial<Row>) =>
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const markSent = (row: Row, channel: CoPlannerChannel, message?: string) => {
    update(row.key, { status: "sent", channel, ...(message ? { message } : {}) });
    onSent?.(channel);
    void captureCoPlannerInviteSent({ trip_id: tripId, channel, surface }).catch(() => {});
  };

  /**
   * Hands the message to the share sheet or WhatsApp. Either can refuse once
   * the tap that started the request has gone stale (or the sheet is closed),
   * so a refusal leaves the row ready, with buttons for a fresh tap.
   */
  const deliver = async (row: Row, message: string, via: "auto" | "native" | "whatsapp") => {
    if (via === "native" || (via === "auto" && canShareNatively())) {
      try {
        await navigator.share({ text: message });
        markSent(row, "native", message);
        return;
      } catch {
        update(row.key, { status: "ready", message });
        return;
      }
    }
    const opened = window.open(whatsappUrl(message), "_blank", "noopener,noreferrer");
    if (opened || via === "whatsapp") markSent(row, "whatsapp", message);
    else update(row.key, { status: "ready", message });
  };

  const send = async (row: Row) => {
    const name = row.name.trim();
    if (!name || row.status === "sending") return;
    const email = row.showEmail ? row.email.trim() : "";
    update(row.key, { status: "sending" });
    try {
      const res = await fetch(`/api/trips/${tripId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(email ? { role: "editor", recipientEmail: email } : { role: "editor" }),
      });
      if (!res.ok) throw new Error(`invite failed: ${res.status}`);
      const data = (await res.json()) as { invite?: { inviteUrl?: string }; emailOutcome?: string };
      const url = data.invite?.inviteUrl;
      if (!url) throw new Error("invite response had no url");
      const message = t("message", { name, title: tripTitle, url });
      // An email we could not send still leaves a working link to hand over.
      if (email && data.emailOutcome === "sent") markSent(row, "email", message);
      else if (email) update(row.key, { status: "ready", message });
      else await deliver(row, message, "auto");
    } catch {
      update(row.key, { status: "failed" });
    }
  };

  const copy = async (row: Row) => {
    if (!row.message) return;
    try {
      await navigator.clipboard.writeText(row.message);
      if (row.status !== "sent") markSent(row, "copy");
      update(row.key, { copied: true });
      setTimeout(() => update(row.key, { copied: false }), 2000);
    } catch {
      // Clipboard blocked: the WhatsApp and share buttons still work.
    }
  };

  return (
    <div className="space-y-3" data-testid="coplanner-invites">
      <div className="text-center">
        <h3 className="text-lg font-semibold text-slate-900">{t("title")}</h3>
        <p className="mt-1 text-sm text-slate-600">{t("subtitle")}</p>
      </div>

      <ul className="space-y-2">
        {rows.map((row, i) => (
          <li key={row.key} className="rounded-xl border border-slate-200 bg-white p-2" data-testid="coplanner-row">
            {row.status === "sent" ? (
              <div className="flex items-center justify-between gap-2 px-1 py-1.5">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-emerald-700">
                  <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">
                    {t(row.channel === "email" ? "emailed" : "sent", { name: row.name.trim() })}
                  </span>
                </span>
                {row.channel !== "email" && (
                  <button
                    type="button"
                    onClick={() => void copy(row)}
                    className="shrink-0 text-xs font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
                  >
                    {row.copied ? t("copied") : t("copy")}
                  </button>
                )}
              </div>
            ) : row.status === "ready" ? (
              <div className="flex flex-wrap items-center gap-2 px-1 py-1">
                <span className="mr-auto truncate text-sm font-medium text-slate-900">{row.name.trim()}</span>
                {canShareNatively() && (
                  <button
                    type="button"
                    onClick={() => row.message && void deliver(row, row.message, "native")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
                  >
                    <Share2 className="h-4 w-4" aria-hidden="true" />
                    {t("share")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => row.message && void deliver(row, row.message, "whatsapp")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
                >
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  {t("whatsapp")}
                </button>
                <button
                  type="button"
                  onClick={() => void copy(row)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
                >
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  {row.copied ? t("copied") : t("copy")}
                </button>
              </div>
            ) : (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(row);
                }}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) => update(row.key, { name: e.target.value, status: "idle" })}
                    placeholder={t("namePlaceholder")}
                    aria-label={t("nameLabel", { n: i + 1 })}
                    maxLength={60}
                    autoComplete="off"
                    disabled={row.status === "sending"}
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                  />
                  <button
                    type="submit"
                    disabled={!row.name.trim() || row.status === "sending"}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--primary)]/90 disabled:opacity-50"
                  >
                    {row.status === "sending" ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : row.showEmail ? (
                      <Mail className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Send className="h-4 w-4" aria-hidden="true" />
                    )}
                    {row.status === "sending" ? t("sending") : t("send")}
                  </button>
                </div>
                {row.showEmail ? (
                  <input
                    type="email"
                    value={row.email}
                    onChange={(e) => update(row.key, { email: e.target.value })}
                    placeholder={t("emailPlaceholder")}
                    aria-label={t("emailLabel", { n: i + 1 })}
                    autoComplete="off"
                    disabled={row.status === "sending"}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => update(row.key, { showEmail: true })}
                    className="px-1 text-xs font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
                  >
                    {t("emailInstead")}
                  </button>
                )}
                {row.status === "failed" && (
                  <p role="alert" className="px-1 text-xs text-red-600">
                    {t("failed")}
                  </p>
                )}
              </form>
            )}
          </li>
        ))}
      </ul>

      {rows.length < MAX_ROWS && (
        <button
          type="button"
          onClick={() => setRows((current) => [...current, blankRow(Math.max(...current.map((r) => r.key)) + 1)])}
          className="inline-flex items-center gap-1.5 px-1 text-sm font-medium text-slate-700 hover:text-slate-900"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("addSomeone")}
        </button>
      )}
    </div>
  );
}
