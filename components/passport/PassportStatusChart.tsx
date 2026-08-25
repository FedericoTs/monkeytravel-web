/**
 * Proportional breakdown of what a passport gets you, by status.
 *
 * WHY A BAR AND NOT A WORLD MAP (yet)
 * A geographic map is the eventual goal and the data contract for it already
 * exists — `PassportSummary.statusByIso2` is a ~4KB iso2 -> status object built
 * for exactly that. What is missing is the country-path asset: a world
 * TopoJSON/SVG is 100KB+, carries its own licence, and the CSP blocks fetching
 * one at runtime, so which asset to vendor is a decision worth making
 * deliberately rather than in passing.
 *
 * This ships the same information today with no asset, no licence question and
 * no client JavaScript — it is a server component. The map replaces this block
 * without touching the page or the data layer.
 *
 * Deliberately not a pie chart: six categories with a long tail read badly as
 * wedges, and the thing a reader wants is "how much of the world is open to
 * me", which a single proportional bar answers at a glance.
 */

interface Props {
  counts: Record<string, number>;
  total: number;
  /** status -> localized label, resolved by the page so this stays server-only. */
  labels: Record<string, string>;
}

/**
 * Colour per status, ordered least-to-most paperwork. Semantic, not the brand
 * accent: green reads as "go", amber as "some paperwork", slate as "apply
 * first", red as "closed".
 */
const COLOURS: Record<string, string> = {
  "visa free": "bg-emerald-500",
  "visa on arrival": "bg-teal-500",
  eta: "bg-amber-400",
  "e-visa": "bg-orange-400",
  "visa required": "bg-slate-400",
  "no admission": "bg-rose-500",
};

const ORDER = [
  "visa free",
  "visa on arrival",
  "eta",
  "e-visa",
  "visa required",
  "no admission",
];

export default function PassportStatusChart({ counts, total, labels }: Props) {
  const present = ORDER.filter((s) => (counts[s] ?? 0) > 0);
  if (total <= 0 || present.length === 0) return null;

  return (
    <div className="mt-8">
      <div
        className="flex h-4 w-full overflow-hidden rounded-full bg-slate-100"
        role="img"
        aria-label={present
          .map((s) => `${labels[s] ?? s}: ${counts[s]}`)
          .join(", ")}
      >
        {present.map((s) => (
          <div
            key={s}
            className={COLOURS[s] ?? "bg-slate-300"}
            style={{ width: `${((counts[s] ?? 0) / total) * 100}%` }}
          />
        ))}
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        {present.map((s) => (
          <li key={s} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden="true"
              className={`inline-block h-2.5 w-2.5 rounded-sm ${COLOURS[s] ?? "bg-slate-300"}`}
            />
            <span className="text-slate-700">{labels[s] ?? s}</span>
            <span className="font-semibold text-slate-900 tabular-nums">
              {counts[s]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
