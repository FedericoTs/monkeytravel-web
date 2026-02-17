import type { DestinationFAQ as FAQType, Locale } from "@/lib/destinations/types";

interface DestinationFAQProps {
  faqs: FAQType[];
  locale: Locale;
  t: (key: string) => string;
}

export default function DestinationFAQ({
  faqs,
  locale,
  t,
}: DestinationFAQProps) {
  return (
    <section className="py-16 bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-3xl sm:text-4xl font-bold text-[var(--foreground)] mb-12 tracking-tight text-center">
          {t("sections.faq")}
        </h2>

        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <details
              key={index}
              className="group bg-[var(--background-alt)] rounded-2xl overflow-hidden"
            >
              <summary className="flex items-center justify-between p-6 cursor-pointer list-none">
                <span className="font-semibold text-[var(--foreground)] pr-4">
                  {faq.question[locale]}
                </span>
                <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shrink-0 group-open:bg-[var(--accent)] transition-colors shadow-sm">
                  <svg
                    className="w-4 h-4 text-[var(--foreground-muted)] group-open:text-[var(--primary-dark)] group-open:rotate-180 transition-all"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </div>
              </summary>
              <div className="px-6 pb-6">
                <p className="text-[var(--foreground-muted)] leading-relaxed">
                  {faq.answer[locale]}
                </p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
