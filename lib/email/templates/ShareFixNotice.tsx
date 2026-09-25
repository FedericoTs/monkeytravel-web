/**
 * One-off notice (2026-09-25) to the owners of shared trips: sharing a trip
 * used to lock its owner out of editing it (fixed in #183/#184/#185).
 *
 * A message about the recipient's own trips, sent one by one through the
 * app's pipeline (lib/email/send.ts, template id "share_fix_notice") by
 * scripts/send-share-fix-notice.mts: opt-outs, the bounce/complaint list,
 * idempotency and email_log all apply. The recipient didn't trigger it, so
 * it is gated on marketingNotifications like other outreach. The greeting
 * has no name on purpose: display names are free text ("Baby", "Holiday",
 * handles), and a wrong one reads worse than none.
 */

import { Button, Heading, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { layoutCopy, type EmailLocale } from "../copy";

export interface ShareFixNoticeProps {
  locale?: EmailLocale;
  /**
   * One-click unsubscribe URL. Minted by the orchestrator when the
   * unsubscribe secret is configured; otherwise the notification settings.
   */
  unsubscribeUrl?: string;
}

interface NoticeCopy {
  subject: string;
  preview: string;
  greeting: string;
  intro: string;
  listHeading: string;
  points: string[];
  cta: string;
  closing: string;
  signature: string;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://monkeytravel.app";

export const shareFixCopy: Record<EmailLocale, NoticeCopy> = {
  en: {
    subject: "Your shared trip is editable again",
    preview: "Sharing a trip used to lock you out of it. That's fixed.",
    greeting: "Hi there,",
    intro:
      "If you shared a trip on MonkeyTravel, opening it afterwards may have shown you the same read-only page your friends see, with no way to edit it or stop sharing it. That was a bug on our side, and it's fixed.",
    listHeading: "What works now:",
    points: [
      "Open the trip from My Trips and you're back in the editor, shared or not.",
      "Friends who open your link can save their own copy, vote on activities and tell you they're coming.",
      "One invite link lets the whole group join. It used to stop after the first person.",
      "Trips friends invite you to appear in My Trips, under Shared with you.",
    ],
    cta: "Open My Trips",
    closing: "Sorry for the hassle, and happy planning.",
    signature: "— The MonkeyTravel Team",
  },
  es: {
    subject: "Ya puedes volver a editar tu viaje compartido",
    preview: "Compartir un viaje te dejaba sin poder editarlo. Ya está arreglado.",
    greeting: "¡Hola!",
    intro:
      "Si compartiste un viaje en MonkeyTravel, puede que al abrirlo después vieras la misma página de solo lectura que ven tus amigos, sin forma de editarlo ni de dejar de compartirlo. Era un error nuestro y ya está arreglado.",
    listHeading: "Lo que funciona ahora:",
    points: [
      "Abre el viaje desde Mis Viajes y vuelves al editor, esté compartido o no.",
      "Quien abra tu enlace puede guardar su propia copia, votar las actividades y avisarte de que se apunta.",
      "Un solo enlace de invitación sirve para todo el grupo. Antes dejaba de funcionar después de la primera persona.",
      "Los viajes a los que te invitan aparecen en Mis Viajes, en Compartidos contigo.",
    ],
    cta: "Abrir Mis Viajes",
    closing: "Perdona las molestias, y a seguir planeando.",
    signature: "— El equipo de MonkeyTravel",
  },
  it: {
    subject: "Il tuo viaggio condiviso è di nuovo modificabile",
    preview: "Condividere un viaggio ti impediva di modificarlo. Ora è risolto.",
    greeting: "Ciao!",
    intro:
      "Se hai condiviso un viaggio su MonkeyTravel, riaprendolo potresti aver visto la stessa pagina in sola lettura che vedono i tuoi amici, senza poterlo modificare né smettere di condividerlo. Era un errore nostro, e ora è risolto.",
    listHeading: "Cosa funziona adesso:",
    points: [
      "Apri il viaggio da I Miei Viaggi e torni nell'editor, condiviso o no.",
      "Chi apre il tuo link può salvarne una copia, votare le attività e dirti che viene.",
      "Un solo link di invito vale per tutto il gruppo. Prima si fermava dopo la prima persona.",
      "I viaggi a cui ti invitano compaiono in I Miei Viaggi, sotto Condivisi con te.",
    ],
    cta: "Apri I Miei Viaggi",
    closing: "Scusa per il disagio, e buona pianificazione.",
    signature: "— Il team di MonkeyTravel",
  },
  pt: {
    subject: "Sua viagem compartilhada pode ser editada de novo",
    preview: "Compartilhar uma viagem impedia você de editá-la. Já corrigimos.",
    greeting: "Olá!",
    intro:
      "Se você compartilhou uma viagem no MonkeyTravel, ao abri-la depois pode ter visto a mesma página só de leitura que seus amigos veem, sem como editá-la nem parar de compartilhar. Foi um erro nosso, e já está corrigido.",
    listHeading: "O que funciona agora:",
    points: [
      "Abra a viagem em Minhas Viagens e você volta ao editor, compartilhada ou não.",
      "Quem abre seu link pode salvar uma cópia, votar nas atividades e avisar que vai.",
      "Um só link de convite serve para o grupo todo. Antes ele parava depois da primeira pessoa.",
      "As viagens para as quais você é convidado aparecem em Minhas Viagens, em Compartilhados com você.",
    ],
    cta: "Abrir Minhas Viagens",
    closing: "Desculpe o transtorno, e bom planejamento.",
    signature: "— A equipe do MonkeyTravel",
  },
};

/** My Trips in the recipient's language, tagged for attribution. */
export function shareFixCtaUrl(locale: EmailLocale): string {
  const prefix = locale === "en" ? "" : `/${locale}`;
  return `${APP_URL}${prefix}/trips?utm_source=notice&utm_medium=email&utm_campaign=share_fix_2026_09`;
}

export function shareFixSubject(locale: EmailLocale = "en"): string {
  return shareFixCopy[locale].subject;
}

const settingsUrl = `${APP_URL}/profile/notifications`;

export default function ShareFixNotice({
  locale = "en",
  unsubscribeUrl = settingsUrl,
}: ShareFixNoticeProps) {
  const t = shareFixCopy[locale];
  return (
    <EmailLayout preview={t.preview} unsubscribeUrl={unsubscribeUrl} locale={locale}>
      <Heading as="h1" style={h1}>
        {t.subject}
      </Heading>
      <Text style={bodyText}>{t.greeting}</Text>
      <Text style={bodyText}>{t.intro}</Text>
      <Text style={listHeading}>{t.listHeading}</Text>
      {t.points.map((point) => (
        <Text key={point} style={pointText}>
          • {point}
        </Text>
      ))}
      <Section style={{ textAlign: "center", margin: "28px 0" }}>
        <Button href={shareFixCtaUrl(locale)} style={button}>
          {t.cta}
        </Button>
      </Section>
      <Text style={bodyText}>{t.closing}</Text>
      <Text style={signOff}>{t.signature}</Text>
    </EmailLayout>
  );
}

export function shareFixNoticeText({
  locale = "en",
  unsubscribeUrl = settingsUrl,
}: ShareFixNoticeProps): string {
  const t = shareFixCopy[locale];
  return [
    t.greeting,
    "",
    t.intro,
    "",
    t.listHeading,
    ...t.points.map((p) => `- ${p}`),
    "",
    `${t.cta}: ${shareFixCtaUrl(locale)}`,
    "",
    t.closing,
    t.signature,
    "",
    "—",
    `MonkeyTravel · ${layoutCopy[locale].tagline}`,
    unsubscribeUrl,
  ].join("\n");
}

const h1: React.CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  color: "#1A1A1A",
  margin: "0 0 16px",
  lineHeight: 1.3,
};

const bodyText: React.CSSProperties = {
  fontSize: "16px",
  color: "#334155",
  lineHeight: 1.6,
  margin: "0 0 14px",
};

const listHeading: React.CSSProperties = {
  fontSize: "16px",
  fontWeight: 600,
  color: "#1A1A1A",
  lineHeight: 1.6,
  margin: "8px 0 6px",
};

const pointText: React.CSSProperties = {
  fontSize: "15px",
  color: "#334155",
  lineHeight: 1.55,
  margin: "0 0 6px",
  paddingLeft: "4px",
};

const signOff: React.CSSProperties = {
  fontSize: "15px",
  color: "#475569",
  margin: "20px 0 0",
};

const button: React.CSSProperties = {
  backgroundColor: "#0F172A",
  color: "#FFFFFF",
  fontSize: "15px",
  fontWeight: 600,
  textDecoration: "none",
  padding: "14px 28px",
  borderRadius: "12px",
  display: "inline-block",
};
