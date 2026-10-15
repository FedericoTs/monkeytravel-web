"use client";

import { useState } from "react";
import { canShareNatively, openWhatsApp } from "@/lib/share/channels";
import { captureDayPlanSent } from "@/lib/posthog/events";

export interface SendDayToGroupLabels {
  title: string;
  body: string;
  cta: string;
  sending: string;
  whatsapp: string;
  share: string;
  copy: string;
  copied: string;
  error: string;
}

interface SendDayToGroupProps {
  tripId: string;
  date: string;
  dayNumber: number;
  /** The day's send key from the digest link (lib/trips/day-link.ts). */
  sendKey: string;
  /** The message up to the link: heading, the day's plan, then the link label. */
  messagePrefix: string;
  labels: SendDayToGroupLabels;
}

/**
 * "Send to the group" on the signed day page: the owner hands the day's plan,
 * with the trip's share link, to the group chat. The link is fetched (and, on
 * a trip never shared, created) on the tap, never on page load. A phone then
 * opens its share sheet; elsewhere the message is copied. The buttons stay for
 * another tap when the browser refuses the automatic step.
 */
export default function SendDayToGroup({ tripId, date, dayNumber, sendKey, messagePrefix, labels }: SendDayToGroupProps) {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const messageFor = (link: string) => `${messagePrefix}${link}`;
  const sent = (channel: "native" | "whatsapp" | "copy") =>
    void captureDayPlanSent({ trip_id: tripId, day: dayNumber, channel });

  async function sendNatively(link: string) {
    try {
      await navigator.share({ text: messageFor(link) });
      sent("native");
    } catch {
      // Closed, or the tap went stale while the link loaded: the buttons stay.
    }
  }

  function sendOnWhatsApp(link: string) {
    if (openWhatsApp(messageFor(link))) sent("whatsapp");
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(messageFor(link));
      setCopied(true);
      sent("copy");
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      // Clipboard blocked: the message below is selectable.
    }
  }

  async function start() {
    if (state === "loading") return;
    setState("loading");
    try {
      const res = await fetch(`/api/day/${tripId}/${date}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ s: sendKey }),
      });
      const json = res.ok ? await res.json() : null;
      const link = typeof json?.url === "string" ? json.url : null;
      if (!link) throw new Error(`share link: ${res.status}`);
      setUrl(link);
      setState("ready");
      if (canShareNatively()) void sendNatively(link);
      else void copy(link);
    } catch {
      setState("error");
    }
  }

  const button =
    "inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50";

  return (
    <section id="send" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5" data-testid="send-day-to-group">
      <h2 className="text-lg font-semibold text-[var(--foreground)]">{labels.title}</h2>
      <p className="mt-1 text-sm text-[var(--foreground-muted)]">{labels.body}</p>

      {state === "ready" && url ? (
        <div className="mt-4 flex flex-col gap-3">
          <p className="whitespace-pre-line rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700 select-all break-words">
            {messageFor(url)}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => sendOnWhatsApp(url)} className={button}>
              {labels.whatsapp}
            </button>
            {canShareNatively() && (
              <button type="button" onClick={() => void sendNatively(url)} className={button}>
                {labels.share}
              </button>
            )}
            <button type="button" onClick={() => void copy(url)} className={button}>
              {copied ? labels.copied : labels.copy}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => void start()}
            disabled={state === "loading"}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-70 sm:w-auto"
          >
            {state === "loading" ? labels.sending : labels.cta}
          </button>
          {state === "error" && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {labels.error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
