"use client";

import { useState, type FormEvent } from "react";
import type { CreditEstimate } from "@/lib/ops/gemini-credit";

const money = (usd: number) => `$${usd.toFixed(2)}`;

export function GeminiCreditPanel({ credit, onSaved }: { credit: CreditEstimate | null; onSaved: () => void }) {
  const [balance, setBalance] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFailed(false);
    try {
      const response = await fetch("/api/admin/costs/credit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usd: Number(balance) }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setBalance("");
      onSaved();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-[var(--foreground-light)]/20 p-6 flex flex-col lg:flex-row lg:items-center gap-4">
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">Gemini credit</h3>
        {credit ? (
          <>
            <p className={`mt-1 text-lg font-semibold ${credit.low ? "text-[var(--error)]" : "text-[var(--foreground)]"}`}>
              {`About ${money(credit.usd)} left${credit.lasts ? `, ${credit.lasts}` : ""}`}
            </p>
            {credit.low && <p className="text-sm text-[var(--error)]">Running low: at $0 every AI call stops.</p>}
            <p data-testid="gemini-credit-from" className="mt-1 text-xs text-[var(--foreground-muted)]">
              The {money(credit.reading.usd)} AI Studio showed on {credit.reading.at.slice(0, 10)}, less{" "}
              {money(credit.spentUsd)} logged since, going at the last week&apos;s {money(credit.perDayUsd)} a day. Test runs
              aren&apos;t logged, so it can be less.
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-[var(--foreground-muted)]">
            Google shows the balance only in AI Studio, and at $0 every AI call stops. Type the balance it shows: this tab
            then keeps an estimate, and you get an email when about a week is left.
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <form onSubmit={save} className="flex items-center gap-2">
          <label htmlFor="gemini-balance" className="text-xs text-[var(--foreground-muted)]">
            Balance in AI Studio, $
          </label>
          <input
            id="gemini-balance"
            type="number"
            required
            min="0"
            max="5000"
            step="0.01"
            value={balance}
            onChange={(event) => setBalance(event.target.value)}
            className="w-24 px-3 py-1.5 text-sm rounded-xl border border-[var(--foreground-light)]/40 bg-white text-[var(--foreground)]"
          />
          <button
            type="submit"
            disabled={saving}
            className="px-3 py-1.5 text-xs font-medium bg-[var(--background-warm)] text-[var(--foreground-muted)] rounded-xl disabled:opacity-50"
          >
            Save
          </button>
        </form>
        <a
          href="https://aistudio.google.com/billing"
          target="_blank"
          rel="noreferrer"
          className="text-xs underline text-[var(--foreground-muted)]"
        >
          Open AI Studio billing
        </a>
        {failed && (
          <p role="alert" className="text-xs text-[var(--error)]">
            The balance wasn&apos;t saved. Try again.
          </p>
        )}
      </div>
    </div>
  );
}
