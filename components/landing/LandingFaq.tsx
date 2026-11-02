/**
 * Classes for each background the section can sit on: the cards take the
 * other one, so the page keeps alternating.
 */
const SURFACES = {
  alt: {
    section: "py-24 bg-[var(--background-alt)]",
    card: "group bg-white rounded-2xl overflow-hidden shadow-sm",
    toggle: "w-8 h-8 rounded-full bg-[var(--background-alt)] flex items-center justify-center flex-shrink-0 group-open:bg-[var(--accent)] transition-colors shadow-sm",
  },
  white: {
    section: "py-24 bg-white",
    card: "group bg-[var(--background-alt)] rounded-2xl overflow-hidden",
    toggle: "w-8 h-8 rounded-full bg-white flex items-center justify-center flex-shrink-0 group-open:bg-[var(--accent)] transition-colors shadow-sm",
  },
} as const;

/**
 * The FAQ as open/close cards. `items` are the questions the page also puts
 * in its FAQPage structured data, so the two cannot drift apart.
 */
export default function LandingFaq({
  title,
  items,
  badge = "FAQ",
  surface = "alt",
}: {
  title: string;
  items: { question: string; answer: string }[];
  badge?: string;
  surface?: keyof typeof SURFACES;
}) {
  const classes = SURFACES[surface];
  return (
    <section className={classes.section}>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--primary)]/5 text-[var(--primary-ink)] text-sm font-semibold mb-6">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {badge}
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-[var(--foreground)] mb-4 tracking-tight">
            {title}
          </h2>
        </div>

        <div className="space-y-4">
          {items.map((item) => (
            <details key={item.question} className={classes.card}>
              <summary className="flex items-center justify-between p-6 cursor-pointer list-none">
                <h3 className="font-semibold text-[var(--foreground)] pr-4">
                  {item.question}
                </h3>
                <div className={classes.toggle}>
                  <svg
                    className="w-4 h-4 text-[var(--foreground-muted)] group-open:text-[var(--primary-ink)] group-open:rotate-180 transition-all"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </summary>
              <div className="px-6 pb-6">
                <p className="text-[var(--foreground-muted)] leading-relaxed">
                  {item.answer}
                </p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
