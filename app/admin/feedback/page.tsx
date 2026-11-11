import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin";
import { logReadError } from "@/lib/supabase/log-read-error";
import { latestWentAnswers } from "@/lib/feedback/went";
import { NEED_ANSWERS, latestNeedAnswers } from "@/lib/feedback/need";
import { getTranslations } from "next-intl/server";

export const metadata = {
  // Root layout appends " | MonkeyTravel" — don't double it.
  title: "Feedback",
  description: "Demand-discovery survey responses",
};

interface FeedbackRow {
  id: string;
  user_id: string | null;
  source: string;
  uses_for: string | null;
  almost_stopped: string | null;
  last_booked_where: string | null;
  would_book_through_us: string | null;
  open_to_chat: boolean;
  contact_email: string | null;
  extra: Record<string, unknown> | null;
  created_at: string;
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        highlight ? "border-[var(--primary)] bg-[var(--primary)]/5" : "border-slate-200 bg-white"
      }`}
    >
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

export default async function AdminFeedbackPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login?redirect=/admin/feedback");
  if (!isAdmin(user.email)) redirect("/");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_feedback")
    .select(
      "id, user_id, source, uses_for, almost_stopped, last_booked_where, would_book_through_us, open_to_chat, contact_email, extra, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(500);
  // A refused read is not "No responses yet".
  if (error) throw error;
  const rows = (data ?? []) as FeedbackRow[];

  // Exact total — the row fetch is capped at 500, so rows.length silently
  // under-counts once the table grows past the cap.
  const { count: totalCount } = logReadError("admin feedback: total", await admin
    .from("user_feedback")
    .select("id", { count: "exact", head: true }));
  const total = totalCount ?? rows.length;
  const truncated = total > rows.length;

  // A yes to being written to about what a trip still needs carries no address:
  // the account's own is the one the reminder went to.
  const writeBackIds = [
    ...new Set(
      rows
        .filter((r) => r.open_to_chat && !r.contact_email && r.user_id && typeof r.extra?.need === "string")
        .map((r) => r.user_id as string)
    ),
  ];
  const accountEmails = new Map<string, string>();
  if (writeBackIds.length > 0) {
    const { data: accounts } = logReadError("admin feedback: write-back accounts", await admin
      .from("users")
      .select("id, email")
      .in("id", writeBackIds));
    for (const account of (accounts ?? []) as { id: string; email: string | null }[]) {
      if (account.email) accountEmails.set(account.id, account.email);
    }
  }
  const contactOf = (r: FeedbackRow): string | null =>
    r.contact_email ??
    (r.open_to_chat && r.user_id && typeof r.extra?.need === "string" ? accountEmails.get(r.user_id) ?? null : null);

  const leads = rows.filter((r) => r.open_to_chat && contactOf(r));
  const countBook = (v: string) => rows.filter((r) => r.would_book_through_us === v).length;
  const wentAnswers = [...latestWentAnswers(rows).values()];
  const countWent = (v: string) => wentAnswers.filter((answer) => answer === v).length;
  // What travellers still need before a trip: each trip's newest answer.
  const needAnswers = [...latestNeedAnswers(rows).values()];
  const needLabel = await getTranslations({ locale: "en", namespace: "common.tripReminderEmail.needAsk" });
  const needNotes = rows.filter((r) => typeof r.extra?.need_note === "string");
  const fmtDate = (s: string) => new Date(s).toISOString().slice(0, 10);

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Link prefetch={false} href="/admin" className="flex items-center gap-2">
                <Image src="/images/logo.png" alt="MonkeyTravel" width={32} height={32} className="h-8 w-8" />
                <span className="font-semibold text-lg text-[var(--foreground)]">MonkeyTravel</span>
              </Link>
              <span className="text-slate-300">|</span>
              <span className="text-[var(--primary-ink)] font-medium">Feedback</span>
            </div>
            <Link prefetch={false} href="/admin" className="text-sm text-[var(--primary-ink)] hover:underline">
              Back to Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <Stat label="Responses" value={total} />
          <Stat label="Open to chat" value={leads.length} highlight />
          <Stat label="Would book: yes" value={countBook("yes")} />
          <Stat label="Would book: maybe" value={countBook("maybe")} />
          <Stat label="Would book: no" value={countBook("no")} />
          <Stat label="Trips: went" value={countWent("yes")} />
          <Stat label="Trips: didn't go" value={countWent("no")} />
        </div>

        {leads.length > 0 && (
          <section className="rounded-2xl border border-[var(--primary)]/30 bg-[var(--primary)]/5 p-5">
            <h2 className="text-lg font-bold text-slate-900 mb-1">
              Open to a chat — email these {leads.length}
            </h2>
            <p className="text-sm text-slate-600 mb-4">
              These users left their email and want to help. Email them personally from your own
              inbox. This is the conversation the survey was built to recruit.
            </p>
            <ul className="space-y-2">
              {leads.map((l) => (
                <li key={l.id} className="text-sm">
                  <a href={`mailto:${contactOf(l)}`} className="font-medium text-[var(--primary-ink)] hover:underline">
                    {contactOf(l)}
                  </a>
                  {l.uses_for && <span className="text-slate-600"> — &ldquo;{l.uses_for}&rdquo;</span>}
                  {typeof l.extra?.need === "string" && (
                    <span className="text-slate-600">
                      {" "}
                      — needs: {needLabel(l.extra.need)}
                      {typeof l.extra.need_note === "string" ? `: “${l.extra.need_note}”` : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-bold text-slate-900 mb-1">
            Still needed before the trip — {needAnswers.length} {needAnswers.length === 1 ? "trip" : "trips"}
          </h2>
          <p className="text-sm text-slate-600 mb-4">
            The reminders before a trip ask &ldquo;{needLabel("question")}&rdquo; until the trip&apos;s owner
            answers. Each trip counts once, with its newest answer.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {NEED_ANSWERS.map((need) => (
              <Stat key={need} label={needLabel(need)} value={needAnswers.filter((answer) => answer === need).length} />
            ))}
          </div>
          {needNotes.length > 0 && (
            <ul className="mt-4 space-y-2">
              {needNotes.map((r) => (
                <li key={r.id} className="text-sm text-slate-800">
                  <span className="text-slate-500">{fmtDate(r.created_at)}</span>{" "}
                  <span className="font-medium">{needLabel(String(r.extra?.need))}:</span> &ldquo;{String(r.extra?.need_note)}&rdquo;
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-lg font-bold text-slate-900 mb-3">
            All responses ({truncated ? `newest ${rows.length} of ${total}` : rows.length})
          </h2>
          {rows.length === 0 ? (
            <p className="text-sm text-slate-500">
              No responses yet. The in-app survey shows to users with at least one trip; responses
              will appear here.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">About a trip</th>
                    <th className="px-3 py-2 font-medium">Uses it for</th>
                    <th className="px-3 py-2 font-medium">Almost stopped</th>
                    <th className="px-3 py-2 font-medium">Booked at</th>
                    <th className="px-3 py-2 font-medium">Would book?</th>
                    <th className="px-3 py-2 font-medium">Contact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="px-3 py-2 whitespace-nowrap text-slate-500">{fmtDate(r.created_at)}</td>
                      <td className="px-3 py-2 text-slate-800 max-w-xs">
                        {[
                          r.extra?.went && `went: ${r.extra.went}`,
                          r.extra?.went_reason,
                          r.extra?.went_note,
                          r.extra?.need && `needs: ${r.extra.need}`,
                          r.extra?.need_note,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-800 max-w-xs">{r.uses_for || "—"}</td>
                      <td className="px-3 py-2 text-slate-800 max-w-xs">{r.almost_stopped || "—"}</td>
                      <td className="px-3 py-2 text-slate-800">{r.last_booked_where || "—"}</td>
                      <td className="px-3 py-2">
                        {r.would_book_through_us ? (
                          <span
                            className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                              r.would_book_through_us === "yes"
                                ? "bg-green-100 text-green-700"
                                : r.would_book_through_us === "maybe"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {r.would_book_through_us}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.open_to_chat && contactOf(r) ? (
                          <a href={`mailto:${contactOf(r)}`} className="text-[var(--primary-ink)] hover:underline">
                            {contactOf(r)}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
