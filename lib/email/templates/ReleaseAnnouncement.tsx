/**
 * Release announcement email — reuses the shared branded EmailLayout
 * (logo lockup + rainbow stripe + white card on cream + footer) so it
 * matches the visual language of the auth + invite + notification emails.
 *
 * Content is the simplified 2026-05-30 release announcement: short
 * acknowledgment of the recent traffic spike, 5 top features, 3 blog
 * post links (localised), beta-app invitation, signed by "Monkey Travel
 * Team" (no individual founder signature).
 */

import { Button, Heading, Section, Text, Link } from "@react-email/components";
import { EmailLayout } from "./_layout";
import type { EmailLocale } from "../copy";

export interface ReleaseEmailProps {
  name: string;
  locale: EmailLocale;
}

interface ReleaseCopy {
  subject: string;
  preview: string;
  greeting: (n: string) => string;
  intro: string;
  apologyLead: string;
  apologyBody: string;
  featuresHeading: string;
  features: Array<{ name: string; desc: string }>;
  blogHeading: string;
  posts: Array<{ title: string; url: string; desc: string }>;
  betaNote: string;
  closing: string;
  signature: string;
  ctaLabel: string;
  ctaUrl: string;
}

const COPY: Record<Exclude<EmailLocale, "es">, ReleaseCopy> = {
  en: {
    subject: "What's new on MonkeyTravel (and a small confession)",
    preview: "Some features you asked for, and an apology for the slow week.",
    greeting: (n) => `Hi ${n},`,
    intro: "Quick note from the MonkeyTravel team.",
    apologyLead: "You may have noticed the site felt slow earlier this month.",
    apologyBody:
      "Organic traffic spiked faster than we expected, and a few corners hit their limits before we could scale them. We're sorry about the rough edges.",
    featuresHeading: "We used the moment to ship what you've been asking for:",
    features: [
      { name: "AI Concierge", desc: "in-trip chat with an assistant that already knows your itinerary" },
      { name: "Expense Ledger", desc: "track real spending per day, per category" },
      { name: "Live Travel Advisories", desc: "FCDO + US State Dept warnings on every trip page" },
      { name: "Per-day Route Maps", desc: "walking-time labels between every stop" },
      { name: "Free Tools", desc: "Packing List + Visa Checker, no signup required" },
    ],
    blogHeading: "Fresh on the blog:",
    posts: [
      {
        title: "Cheapest Countries in Asia 2026",
        url: "https://monkeytravel.app/blog/cheapest-destinations-in-asia",
        desc: "real $/day budgets from 15 countries",
      },
      {
        title: "Best AI Trip Planners 2026",
        url: "https://monkeytravel.app/blog/best-ai-trip-planners-2026-compared",
        desc: "7 tools honestly compared",
      },
      {
        title: "Northern Lights 2026",
        url: "https://monkeytravel.app/blog/best-places-to-see-northern-lights",
        desc: "12 spots ranked by clear-sky probability",
      },
    ],
    betaNote:
      "Native iOS + Android apps are in beta — reply to this email if you'd like early access.",
    closing: "Thanks for sticking with us.",
    signature: "— The Monkey Travel Team",
    ctaLabel: "Plan a trip",
    ctaUrl: "https://monkeytravel.app/trips/new",
  },
  it: {
    subject: "Novità su MonkeyTravel (e una piccola confessione)",
    preview: "Alcune funzionalità che ci avete chiesto, e una scusa per la settimana lenta.",
    greeting: (n) => `Ciao ${n},`,
    intro: "Un breve aggiornamento dal team MonkeyTravel.",
    apologyLead: "Forse hai notato che il sito è stato un po' lento all'inizio del mese.",
    apologyBody:
      "Il traffico organico è cresciuto più velocemente del previsto e alcune parti hanno raggiunto i loro limiti prima che riuscissimo a scalarle. Ci scusiamo per i bordi ruvidi.",
    featuresHeading: "Abbiamo colto l'occasione per rilasciare ciò che ci avete chiesto:",
    features: [
      { name: "AI Concierge", desc: "chat dentro ogni viaggio con un assistente che già conosce il tuo itinerario" },
      { name: "Registro Spese", desc: "traccia le spese reali per giorno e categoria" },
      { name: "Avvisi di Viaggio in Tempo Reale", desc: "FCDO + Dipartimento di Stato USA su ogni pagina viaggio" },
      { name: "Mappe con Percorso Giornaliero", desc: "tempi a piedi tra ogni tappa" },
      { name: "Strumenti Gratuiti", desc: "Lista Bagaglio + Visa Checker, senza registrazione" },
    ],
    blogHeading: "Novità sul blog:",
    posts: [
      {
        title: "Mete Estate 2026",
        url: "https://monkeytravel.app/it/blog/best-summer-destinations-2026",
        desc: "guida per chi vuole evitare il caldo",
      },
      {
        title: "Itinerario Sardegna in 7 giorni",
        url: "https://monkeytravel.app/it/blog/itinerario-sardegna-7-giorni",
        desc: "spiagge nascoste, cibo, distanze realistiche",
      },
      {
        title: "Itinerario Puglia in 5 giorni",
        url: "https://monkeytravel.app/it/blog/itinerario-puglia-5-giorni",
        desc: "Bari, Alberobello, Lecce e il Salento",
      },
    ],
    betaNote:
      "App native iOS + Android sono in beta — rispondi a questa email se vuoi accesso anticipato.",
    closing: "Grazie di esserci stato con noi.",
    signature: "— Il Team Monkey Travel",
    ctaLabel: "Pianifica un viaggio",
    ctaUrl: "https://monkeytravel.app/it/trips/new",
  },
};

export default function ReleaseEmail({ name, locale }: ReleaseEmailProps) {
  const t = locale === "it" ? COPY.it : COPY.en;

  return (
    <EmailLayout preview={t.preview} locale={locale === "es" ? "en" : locale}>
      <Heading as="h1" style={h1}>
        {t.greeting(name)}
      </Heading>

      <Text style={leadText}>{t.intro}</Text>

      <Text style={apologyLead}>{t.apologyLead}</Text>
      <Text style={apologyBody}>{t.apologyBody}</Text>

      <Text style={sectionHeading}>{t.featuresHeading}</Text>

      <Section style={featureSection}>
        {t.features.map((f) => (
          <Text key={f.name} style={featureItem}>
            <span style={featureDot}>●</span>
            <span style={featureName}>{f.name}</span>
            <span style={featureDesc}> — {f.desc}</span>
          </Text>
        ))}
      </Section>

      <Text style={sectionHeading}>{t.blogHeading}</Text>

      <Section style={blogSection}>
        {t.posts.map((p) => (
          <Text key={p.url} style={blogItem}>
            <span style={featureDot}>●</span>
            <Link href={p.url} style={blogLink}>
              {p.title}
            </Link>
            <span style={featureDesc}> — {p.desc}</span>
          </Text>
        ))}
      </Section>

      <Section style={{ textAlign: "center", margin: "32px 0 16px" }}>
        <Button href={t.ctaUrl} style={button}>
          {t.ctaLabel}
        </Button>
      </Section>

      <Text style={betaNoteStyle}>{t.betaNote}</Text>

      <Text style={closingStyle}>{t.closing}</Text>

      <Text style={signatureStyle}>{t.signature}</Text>
    </EmailLayout>
  );
}

export function releaseEmailSubject(locale: EmailLocale): string {
  return (locale === "it" ? COPY.it : COPY.en).subject;
}

export function releaseEmailText(props: ReleaseEmailProps): string {
  const t = props.locale === "it" ? COPY.it : COPY.en;
  return [
    t.greeting(props.name),
    "",
    t.intro,
    "",
    t.apologyLead,
    t.apologyBody,
    "",
    t.featuresHeading,
    ...t.features.map((f) => `  • ${f.name} — ${f.desc}`),
    "",
    t.blogHeading,
    ...t.posts.flatMap((p) => [`  • ${p.title} — ${p.desc}`, `    ${p.url}`]),
    "",
    t.betaNote,
    "",
    t.closing,
    "",
    t.signature,
    `${t.ctaLabel}: ${t.ctaUrl}`,
  ].join("\n");
}

// ── Inline styles — match AuthAction.tsx visual rhythm ────────────────

const h1: React.CSSProperties = {
  fontSize: "22px",
  fontWeight: 700,
  color: "#1A1A1A",
  margin: "0 0 12px",
  lineHeight: 1.3,
};

const leadText: React.CSSProperties = {
  fontSize: "16px",
  color: "#444444",
  margin: "0 0 16px",
  lineHeight: 1.6,
};

const apologyLead: React.CSSProperties = {
  fontSize: "16px",
  color: "#1A1A1A",
  fontWeight: 600,
  margin: "0 0 6px",
  lineHeight: 1.5,
};

const apologyBody: React.CSSProperties = {
  fontSize: "15px",
  color: "#555555",
  margin: "0 0 24px",
  lineHeight: 1.6,
};

const sectionHeading: React.CSSProperties = {
  fontSize: "15px",
  fontWeight: 700,
  color: "#2D3436",
  margin: "20px 0 8px",
  lineHeight: 1.4,
};

const featureSection: React.CSSProperties = {
  margin: "0 0 8px",
};

const blogSection: React.CSSProperties = {
  margin: "0 0 8px",
};

const featureItem: React.CSSProperties = {
  fontSize: "14.5px",
  color: "#333333",
  margin: "6px 0",
  lineHeight: 1.55,
};

const blogItem: React.CSSProperties = {
  fontSize: "14.5px",
  color: "#333333",
  margin: "8px 0",
  lineHeight: 1.55,
};

const featureDot: React.CSSProperties = {
  color: "#00B4A6",
  marginRight: "8px",
  fontSize: "10px",
  verticalAlign: "middle",
};

const featureName: React.CSSProperties = {
  fontWeight: 700,
  color: "#1A1A1A",
};

const featureDesc: React.CSSProperties = {
  color: "#555555",
};

const blogLink: React.CSSProperties = {
  color: "#FF6B6B",
  fontWeight: 600,
  textDecoration: "none",
};

const button: React.CSSProperties = {
  backgroundColor: "#FF6B6B",
  color: "#FFFFFF",
  padding: "14px 36px",
  borderRadius: "999px",
  textDecoration: "none",
  fontWeight: 700,
  fontSize: "16px",
  display: "inline-block",
  boxShadow: "0 4px 12px rgba(255,107,107,0.35)",
};

const betaNoteStyle: React.CSSProperties = {
  fontSize: "14px",
  color: "#636E72",
  fontStyle: "italic",
  margin: "16px 0 24px",
  lineHeight: 1.6,
  textAlign: "center",
};

const closingStyle: React.CSSProperties = {
  fontSize: "15px",
  color: "#333333",
  margin: "0 0 12px",
  lineHeight: 1.6,
};

const signatureStyle: React.CSSProperties = {
  fontSize: "15px",
  fontWeight: 700,
  color: "#1A1A1A",
  margin: "12px 0 0",
};
