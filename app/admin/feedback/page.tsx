import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin";

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
  const { data } = await admin
    .from("user_feedback")
    .select(
      "id, user_id, source, uses_for, almost_stopped, last_booked_where, would_book_through_us, open_to_chat, contact_email, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(500);
  const rows = (data ?? []) as FeedbackRow[];

  // Exact total — the row fetch is capped at 500, so rows.length silently
  // under-counts once the table grows past the cap.
  const { count: totalCount } = await admin
    .from("user_feedback")
    .select("id", { count: "exact", head: true });
  const total = totalCount ?? rows.length;
  const truncated = total > rows.length;

  const leads = rows.filter((r) => r.open_to_chat && r.contact_email);
  const countBook = (v: string) => rows.filter((r) => r.would_book_through_us === v).length;
  const fmtDate = (s: string) => new Date(s).toISOString().slice(0, 10);

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <a href="/admin" className="flex items-center gap-2">
                <img src="/images/logo.png" alt="MonkeyTravel" className="h-8 w-8" />
                <span className="font-semibold text-lg text-[var(--foreground)]">MonkeyTravel</span>
              </a>
              <span className="text-slate-300">|</span>
              <span className="text-[var(--primary)] font-medium">Feedback</span>
            </div>
            <a href="/admin" className="text-sm text-[var(--primary)] hover:underline">
              Back to Dashboard
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Stat label="Responses" value={total} />
          <Stat label="Open to chat" value={leads.length} highlight />
          <Stat label="Would book: yes" value={countBook("yes")} />
          <Stat label="Would book: maybe" value={countBook("maybe")} />
          <Stat label="Would book: no" value={countBook("no")} />
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
                  <a href={`mailto:${l.contact_email}`} className="font-medium text-[var(--primary)] hover:underline">
                    {l.contact_email}
                  </a>
                  {l.uses_for && <span className="text-slate-600"> — &ldquo;{l.uses_for}&rdquo;</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

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
                        {r.open_to_chat && r.contact_email ? (
                          <a href={`mailto:${r.contact_email}`} className="text-[var(--primary)] hover:underline">
                            {r.contact_email}
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
