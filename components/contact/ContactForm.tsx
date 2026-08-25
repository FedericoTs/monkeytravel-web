"use client";

import { useState, type FormEvent } from "react";
import { useTranslations, useLocale } from "next-intl";

const TOPICS = ["support", "partnership", "press", "feedback", "other"] as const;
type Topic = (typeof TOPICS)[number];

type Status = "idle" | "submitting" | "success" | "error" | "rate_limited";

export default function ContactForm() {
  const t = useTranslations("contact.form");
  const locale = useLocale();

  const [status, setStatus] = useState<Status>("idle");
  const [validationError, setValidationError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setValidationError(null);

    const form = e.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const email = String(data.get("email") || "").trim();
    const topic = String(data.get("topic") || "") as Topic;
    const message = String(data.get("message") || "").trim();
    const honeypot = String(data.get("website") || "");

    if (!name) return setValidationError(t("validationName"));
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return setValidationError(t("validationEmail"));
    if (message.length < 10) return setValidationError(t("validationMessage"));

    if (honeypot) {
      setStatus("success");
      form.reset();
      return;
    }

    setStatus("submitting");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, topic, message, locale }),
      });
      if (res.status === 429) {
        setStatus("rate_limited");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        return;
      }
      setStatus("success");
      form.reset();
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <h3 className="text-lg font-semibold text-emerald-900 mb-1">{t("successTitle")}</h3>
        <p className="text-emerald-800">{t("successBody")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div>
        <label htmlFor="contact-name" className="block text-sm font-medium text-slate-700 mb-1.5">
          {t("name")}
        </label>
        <input
          id="contact-name"
          name="name"
          type="text"
          required
          autoComplete="name"
          placeholder={t("namePlaceholder")}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
        />
      </div>

      <div>
        <label htmlFor="contact-email" className="block text-sm font-medium text-slate-700 mb-1.5">
          {t("email")}
        </label>
        <input
          id="contact-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder={t("emailPlaceholder")}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
        />
      </div>

      <div>
        <label htmlFor="contact-topic" className="block text-sm font-medium text-slate-700 mb-1.5">
          {t("topic")}
        </label>
        <select
          id="contact-topic"
          name="topic"
          required
          defaultValue=""
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
        >
          <option value="" disabled>
            {t("topicPlaceholder")}
          </option>
          {TOPICS.map((key) => (
            <option key={key} value={key}>
              {t(`topics.${key}`)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="contact-message" className="block text-sm font-medium text-slate-700 mb-1.5">
          {t("message")}
        </label>
        <textarea
          id="contact-message"
          name="message"
          required
          rows={6}
          minLength={10}
          placeholder={t("messagePlaceholder")}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
        />
      </div>

      {/* Honeypot — bots fill any field they see; humans never see this one. */}
      <div aria-hidden="true" className="absolute left-[-9999px] top-[-9999px]">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {validationError && (
        <p role="alert" className="text-sm text-rose-600">{validationError}</p>
      )}

      {status === "rate_limited" && (
        <p role="alert" className="text-sm text-amber-700">{t("rateLimited")}</p>
      )}

      {status === "error" && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm font-medium text-rose-900">{t("errorTitle")}</p>
          <p className="text-sm text-rose-800">{t("errorBody")}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--primary)] px-7 py-3 text-white font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity"
      >
        {status === "submitting" ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
