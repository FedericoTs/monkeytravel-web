/**
 * Localized copy for emails (en / es / it / pt).
 *
 * Emails render in contexts that are OUTSIDE the next-intl request scope —
 * the Supabase "Send Email" auth hook, the notification cron, and the
 * standalone preview script. So rather than next-intl's `useTranslations`,
 * email copy lives here as plain per-locale dictionaries that any of those
 * callers can resolve synchronously. This mirrors the string-prop design of
 * TripReminder.tsx.
 *
 * Keep these locales in lockstep with `routing.locales`. Portuguese was added
 * to the app — routing, 84 translated blog posts, localized landing pages —
 * but not here, so every transactional email fell back to English for pt users
 * even where the message copy itself had been translated. Because each block
 * below is a `Record<EmailLocale, …>`, widening the type is what forces a
 * Portuguese entry to exist everywhere rather than silently defaulting.
 *
 * Portuguese here is pt-BR, matching the rest of the product.
 */

export type EmailLocale = "en" | "es" | "it" | "pt";

export function normalizeEmailLocale(input: unknown): EmailLocale {
  return input === "es" || input === "it" || input === "pt" ? input : "en";
}

interface LayoutCopy {
  tagline: string;
  footerReason: string;
  manage: string;
}

export const layoutCopy: Record<EmailLocale, LayoutCopy> = {
  en: {
    tagline: "AI-powered trip planning",
    footerReason:
      "You're receiving this because you have an active MonkeyTravel account.",
    manage: "Manage preferences",
  },
  es: {
    tagline: "Planificación de viajes con IA",
    footerReason:
      "Recibes este correo porque tienes una cuenta activa en MonkeyTravel.",
    manage: "Gestionar preferencias",
  },
  it: {
    tagline: "Pianificazione viaggi con IA",
    footerReason:
      "Ricevi questa email perché hai un account MonkeyTravel attivo.",
    manage: "Gestisci le preferenze",
  },
  pt: {
    tagline: "Planejamento de viagens com IA",
    footerReason:
      "Você está recebendo este e-mail porque tem uma conta ativa no MonkeyTravel.",
    manage: "Gerenciar preferências",
  },
};

interface ConfirmSignupCopy {
  subject: string;
  welcome: string; // no name
  welcomeNamed: (name: string) => string;
  lead: string;
  cta: string;
  body: string;
  linkFallback: string;
  ignore: string;
}

export const confirmSignupCopy: Record<EmailLocale, ConfirmSignupCopy> = {
  en: {
    subject: "Confirm your email — MonkeyTravel",
    welcome: "Welcome aboard! 🐵",
    welcomeNamed: (n) => `Welcome aboard, ${n}! 🐵`,
    lead: "You're one tap away from AI-powered trip planning. Confirm your email to activate your account.",
    cta: "Confirm my email",
    body: "Once you're in, just drop a destination and we'll build you a personalized day-by-day itinerary — flights, stays, and things to do, all in one place.",
    linkFallback:
      "If the button doesn't work, copy this link into your browser:",
    ignore:
      "Didn't create a MonkeyTravel account? You can safely ignore this email — no account will be created without confirmation.",
  },
  es: {
    subject: "Confirma tu correo — MonkeyTravel",
    welcome: "¡Bienvenido a bordo! 🐵",
    welcomeNamed: (n) => `¡Bienvenido a bordo, ${n}! 🐵`,
    lead: "Estás a un clic de la planificación de viajes con IA. Confirma tu correo para activar tu cuenta.",
    cta: "Confirmar mi correo",
    body: "Una vez dentro, solo elige un destino y crearemos un itinerario personalizado día a día: vuelos, alojamientos y actividades, todo en un solo lugar.",
    linkFallback:
      "Si el botón no funciona, copia este enlace en tu navegador:",
    ignore:
      "¿No creaste una cuenta en MonkeyTravel? Puedes ignorar este correo: no se creará ninguna cuenta sin confirmación.",
  },
  it: {
    subject: "Conferma la tua email — MonkeyTravel",
    welcome: "Benvenuto a bordo! 🐵",
    welcomeNamed: (n) => `Benvenuto a bordo, ${n}! 🐵`,
    lead: "Sei a un passo dalla pianificazione viaggi con IA. Conferma la tua email per attivare l'account.",
    cta: "Conferma la mia email",
    body: "Una volta dentro, scegli una destinazione e creeremo un itinerario personalizzato giorno per giorno: voli, alloggi e cose da fare, tutto in un unico posto.",
    linkFallback:
      "Se il pulsante non funziona, copia questo link nel browser:",
    ignore:
      "Non hai creato un account MonkeyTravel? Puoi ignorare questa email: nessun account verrà creato senza conferma.",
  },
  pt: {
    subject: "Confirme seu e-mail — MonkeyTravel",
    welcome: "Bem-vindo a bordo! 🐵",
    welcomeNamed: (n) => `Bem-vindo a bordo, ${n}! 🐵`,
    lead: "Você está a um toque do planejamento de viagens com IA. Confirme seu e-mail para ativar sua conta.",
    cta: "Confirmar meu e-mail",
    body: "Depois de entrar, é só escolher um destino e criaremos um roteiro personalizado dia a dia: voos, hospedagens e o que fazer, tudo em um só lugar.",
    linkFallback:
      "Se o botão não funcionar, copie este link no seu navegador:",
    ignore:
      "Não criou uma conta no MonkeyTravel? Pode ignorar este e-mail — nenhuma conta será criada sem confirmação.",
  },
};

export type AuthActionKind =
  | "recovery"
  | "magiclink"
  | "email_change"
  | "reauthentication"
  | "invite";

interface AuthActionCopy {
  subject: string;
  heading: string;
  lead: string;
  cta: string;
  footer?: string;
}

interface AuthSharedCopy {
  linkFallback: string;
  codeLabel: string;
}

export const authSharedCopy: Record<EmailLocale, AuthSharedCopy> = {
  en: {
    linkFallback:
      "If the button doesn't work, copy this link into your browser:",
    codeLabel: "Or enter this code:",
  },
  es: {
    linkFallback: "Si el botón no funciona, copia este enlace en tu navegador:",
    codeLabel: "O ingresa este código:",
  },
  it: {
    linkFallback: "Se il pulsante non funziona, copia questo link nel browser:",
    codeLabel: "Oppure inserisci questo codice:",
  },
  pt: {
    linkFallback: "Se o botão não funcionar, copie este link no seu navegador:",
    codeLabel: "Ou insira este código:",
  },
};

interface BlogEmailCopy {
  // Digest
  digestSubject: string;
  digestHeading: string;
  digestIntro: string;
  // Single-post announce
  announceSubject: (title: string) => string;
  announcePreview: (title: string) => string;
  newPostLabel: string;
  // Shared
  readArticle: string;
  browseAll: string;
  minRead: (n: number) => string;
}

export const blogEmailCopy: Record<EmailLocale, BlogEmailCopy> = {
  en: {
    digestSubject: "This week on MonkeyTravel ✈️",
    digestHeading: "Fresh from the blog",
    digestIntro:
      "A few new reads to fuel your next adventure — tips, guides, and destination inspiration.",
    announceSubject: (t) => `New on the blog: ${t}`,
    announcePreview: (t) => `Just published — ${t}`,
    newPostLabel: "New on the blog",
    readArticle: "Read article →",
    browseAll: "Browse all articles",
    minRead: (n) => `${n} min read`,
  },
  es: {
    digestSubject: "Esta semana en MonkeyTravel ✈️",
    digestHeading: "Novedades del blog",
    digestIntro:
      "Algunas lecturas nuevas para inspirar tu próxima aventura: consejos, guías e ideas de destinos.",
    announceSubject: (t) => `Nuevo en el blog: ${t}`,
    announcePreview: (t) => `Recién publicado — ${t}`,
    newPostLabel: "Nuevo en el blog",
    readArticle: "Leer artículo →",
    browseAll: "Ver todos los artículos",
    minRead: (n) => `${n} min de lectura`,
  },
  it: {
    digestSubject: "Questa settimana su MonkeyTravel ✈️",
    digestHeading: "Novità dal blog",
    digestIntro:
      "Qualche nuova lettura per ispirare la tua prossima avventura: consigli, guide e idee di viaggio.",
    announceSubject: (t) => `Nuovo sul blog: ${t}`,
    announcePreview: (t) => `Appena pubblicato — ${t}`,
    newPostLabel: "Nuovo sul blog",
    readArticle: "Leggi l'articolo →",
    browseAll: "Sfoglia tutti gli articoli",
    minRead: (n) => `${n} min di lettura`,
  },
  pt: {
    digestSubject: "Esta semana no MonkeyTravel ✈️",
    digestHeading: "Novidades do blog",
    digestIntro:
      "Algumas leituras novas para inspirar sua próxima aventura: dicas, guias e ideias de destinos.",
    announceSubject: (t) => `Novo no blog: ${t}`,
    announcePreview: (t) => `Acabou de sair — ${t}`,
    newPostLabel: "Novo no blog",
    readArticle: "Ler artigo →",
    browseAll: "Ver todos os artigos",
    minRead: (n) => `${n} min de leitura`,
  },
};

export const authActionCopy: Record<
  EmailLocale,
  Record<AuthActionKind, AuthActionCopy>
> = {
  en: {
    recovery: {
      subject: "Reset your MonkeyTravel password",
      heading: "Reset your password 🔑",
      lead: "We got a request to reset your MonkeyTravel password. Tap below to choose a new one.",
      cta: "Reset my password",
      footer:
        "Didn't ask to reset your password? You can safely ignore this email — your password won't change.",
    },
    magiclink: {
      subject: "Your MonkeyTravel magic link",
      heading: "Your magic link ✨",
      lead: "Tap below to securely sign in to MonkeyTravel. No password needed.",
      cta: "Sign in to MonkeyTravel",
      footer: "Didn't try to sign in? You can safely ignore this email.",
    },
    email_change: {
      subject: "Confirm your new MonkeyTravel email",
      heading: "Confirm your new email 📧",
      lead: "Confirm this address to finish updating the email on your MonkeyTravel account.",
      cta: "Confirm new email",
      footer:
        "Didn't request this change? Please secure your account and contact support.",
    },
    reauthentication: {
      subject: "Confirm it's you — MonkeyTravel",
      heading: "Confirm it's you 🔒",
      lead: "Use the code below to confirm this sensitive change on your MonkeyTravel account.",
      cta: "Confirm",
      footer: "Didn't request this? You can safely ignore this email.",
    },
    invite: {
      subject: "You're invited to MonkeyTravel",
      heading: "You've been invited to MonkeyTravel 🐵",
      lead: "Tap below to accept your invitation and start planning trips with AI.",
      cta: "Accept invitation",
    },
  },
  es: {
    recovery: {
      subject: "Restablece tu contraseña de MonkeyTravel",
      heading: "Restablece tu contraseña 🔑",
      lead: "Recibimos una solicitud para restablecer tu contraseña de MonkeyTravel. Toca abajo para elegir una nueva.",
      cta: "Restablecer contraseña",
      footer:
        "¿No solicitaste restablecer tu contraseña? Puedes ignorar este correo: tu contraseña no cambiará.",
    },
    magiclink: {
      subject: "Tu enlace mágico de MonkeyTravel",
      heading: "Tu enlace mágico ✨",
      lead: "Toca abajo para iniciar sesión de forma segura en MonkeyTravel. Sin contraseña.",
      cta: "Iniciar sesión en MonkeyTravel",
      footer: "¿No intentaste iniciar sesión? Puedes ignorar este correo.",
    },
    email_change: {
      subject: "Confirma tu nuevo correo de MonkeyTravel",
      heading: "Confirma tu nuevo correo 📧",
      lead: "Confirma esta dirección para terminar de actualizar el correo de tu cuenta de MonkeyTravel.",
      cta: "Confirmar nuevo correo",
      footer:
        "¿No solicitaste este cambio? Protege tu cuenta y contacta con soporte.",
    },
    reauthentication: {
      subject: "Confirma que eres tú — MonkeyTravel",
      heading: "Confirma que eres tú 🔒",
      lead: "Usa el código de abajo para confirmar este cambio importante en tu cuenta de MonkeyTravel.",
      cta: "Confirmar",
      footer: "¿No solicitaste esto? Puedes ignorar este correo.",
    },
    invite: {
      subject: "Estás invitado a MonkeyTravel",
      heading: "Te han invitado a MonkeyTravel 🐵",
      lead: "Toca abajo para aceptar tu invitación y empezar a planificar viajes con IA.",
      cta: "Aceptar invitación",
    },
  },
  it: {
    recovery: {
      subject: "Reimposta la password di MonkeyTravel",
      heading: "Reimposta la password 🔑",
      lead: "Abbiamo ricevuto una richiesta di reimpostare la tua password MonkeyTravel. Tocca qui sotto per sceglierne una nuova.",
      cta: "Reimposta la password",
      footer:
        "Non hai richiesto la reimpostazione? Puoi ignorare questa email: la tua password non cambierà.",
    },
    magiclink: {
      subject: "Il tuo magic link di MonkeyTravel",
      heading: "Il tuo magic link ✨",
      lead: "Tocca qui sotto per accedere in sicurezza a MonkeyTravel. Senza password.",
      cta: "Accedi a MonkeyTravel",
      footer: "Non hai provato ad accedere? Puoi ignorare questa email.",
    },
    email_change: {
      subject: "Conferma la tua nuova email di MonkeyTravel",
      heading: "Conferma la tua nuova email 📧",
      lead: "Conferma questo indirizzo per completare l'aggiornamento dell'email del tuo account MonkeyTravel.",
      cta: "Conferma nuova email",
      footer:
        "Non hai richiesto questa modifica? Proteggi il tuo account e contatta l'assistenza.",
    },
    reauthentication: {
      subject: "Conferma che sei tu — MonkeyTravel",
      heading: "Conferma che sei tu 🔒",
      lead: "Usa il codice qui sotto per confermare questa modifica importante sul tuo account MonkeyTravel.",
      cta: "Conferma",
      footer: "Non hai richiesto questo? Puoi ignorare questa email.",
    },
    invite: {
      subject: "Sei invitato su MonkeyTravel",
      heading: "Sei stato invitato su MonkeyTravel 🐵",
      lead: "Tocca qui sotto per accettare l'invito e iniziare a pianificare viaggi con IA.",
      cta: "Accetta l'invito",
    },
  },
  pt: {
    recovery: {
      subject: "Redefina sua senha do MonkeyTravel",
      heading: "Redefina sua senha 🔑",
      lead: "Recebemos um pedido para redefinir sua senha do MonkeyTravel. Toque abaixo para escolher uma nova.",
      cta: "Redefinir minha senha",
      footer:
        "Não pediu para redefinir a senha? Pode ignorar este e-mail — sua senha não será alterada.",
    },
    magiclink: {
      subject: "Seu link mágico do MonkeyTravel",
      heading: "Seu link mágico ✨",
      lead: "Toque abaixo para entrar no MonkeyTravel com segurança. Sem senha.",
      cta: "Entrar no MonkeyTravel",
      footer: "Não tentou entrar? Pode ignorar este e-mail.",
    },
    email_change: {
      subject: "Confirme seu novo e-mail do MonkeyTravel",
      heading: "Confirme seu novo e-mail 📧",
      lead: "Confirme este endereço para concluir a atualização do e-mail da sua conta MonkeyTravel.",
      cta: "Confirmar novo e-mail",
      footer:
        "Não solicitou esta alteração? Proteja sua conta e entre em contato com o suporte.",
    },
    reauthentication: {
      subject: "Confirme que é você — MonkeyTravel",
      heading: "Confirme que é você 🔒",
      lead: "Use o código abaixo para confirmar esta alteração importante na sua conta MonkeyTravel.",
      cta: "Confirmar",
      footer: "Não solicitou isto? Pode ignorar este e-mail.",
    },
    invite: {
      subject: "Você foi convidado para o MonkeyTravel",
      heading: "Você foi convidado para o MonkeyTravel 🐵",
      lead: "Toque abaixo para aceitar o convite e começar a planejar viagens com IA.",
      cta: "Aceitar convite",
    },
  },
};

// ── Collaboration notifications: trip invite ────────────────────────────

type InviteRole = "editor" | "voter" | "viewer";

interface InviteEmailCopy {
  heading: (inviterName: string) => string;
  roleDescription: Record<InviteRole, string>;
  cta: string;
  copyLink: string;
  subject: (inviterName: string, destination: string) => string;
}

export const inviteCopy: Record<EmailLocale, InviteEmailCopy> = {
  en: {
    heading: (n) => `${n} invited you to a trip`,
    roleDescription: {
      editor: "You'll be able to add, remove, and rearrange activities.",
      voter:
        "You'll be able to vote on activities and suggest new ones — the trip owner has final say.",
      viewer: "You'll be able to see the trip details, but can't make changes.",
    },
    cta: "Open the trip",
    copyLink: "Or copy this link:",
    subject: (n, d) => `${n} invited you to plan ${d}`,
  },
  es: {
    heading: (n) => `${n} te ha invitado a un viaje`,
    roleDescription: {
      editor: "Podrás añadir, eliminar y reorganizar actividades.",
      voter:
        "Podrás votar actividades y sugerir nuevas; la última palabra la tiene el organizador del viaje.",
      viewer: "Podrás ver los detalles del viaje, pero no hacer cambios.",
    },
    cta: "Abrir el viaje",
    copyLink: "O copia este enlace:",
    subject: (n, d) => `${n} te invitó a planear ${d}`,
  },
  it: {
    heading: (n) => `${n} ti ha invitato a un viaggio`,
    roleDescription: {
      editor: "Potrai aggiungere, rimuovere e riorganizzare le attività.",
      voter:
        "Potrai votare le attività e suggerirne di nuove; la decisione finale spetta all'organizzatore del viaggio.",
      viewer:
        "Potrai vedere i dettagli del viaggio, ma non potrai apportare modifiche.",
    },
    cta: "Apri il viaggio",
    copyLink: "Oppure copia questo link:",
    subject: (n, d) => `${n} ti ha invitato a organizzare ${d}`,
  },
  pt: {
    heading: (n) => `${n} convidou você para uma viagem`,
    roleDescription: {
      editor: "Você poderá adicionar, remover e reorganizar atividades.",
      voter:
        "Você poderá votar nas atividades e sugerir novas; a palavra final é de quem organiza a viagem.",
      viewer:
        "Você poderá ver os detalhes da viagem, mas não fazer alterações.",
    },
    cta: "Abrir a viagem",
    copyLink: "Ou copie este link:",
    subject: (n, d) => `${n} convidou você para planejar ${d}`,
  },
};

// ── Research outreach: feedback request ─────────────────────────────────

interface FeedbackOutreachCopy {
  subject: (firstName?: string) => string;
  preview: string;
  /** Greeting — handles the no-name case gracefully. */
  heading: (firstName?: string) => string;
  lead: string;
  body: string;
  cta: string;
  copyLink: string;
}

export const feedbackOutreachCopy: Record<EmailLocale, FeedbackOutreachCopy> = {
  en: {
    subject: () => "What should we build next?",
    preview: "You've actually used MonkeyTravel — your honest take would mean a lot.",
    heading: (n) => (n ? `Hi ${n}, can I ask a quick favor?` : "Can I ask a quick favor?"),
    lead: "You've actually planned a trip with MonkeyTravel — which makes your opinion the one we trust most.",
    body: "We're deciding what to build next, and we'd rather hear it from you than guess. Two minutes of honest feedback — what works, what's annoying, what you wish it did — would genuinely shape where this goes.",
    cta: "Share your feedback",
    copyLink: "Or copy this link into your browser:",
  },
  es: {
    subject: () => "¿Qué construimos ahora?",
    preview: "Ya has usado MonkeyTravel — tu opinión sincera significaría mucho.",
    heading: (n) => (n ? `Hola ${n}, ¿te pido un favor rápido?` : "¿Te pido un favor rápido?"),
    lead: "Has planeado un viaje con MonkeyTravel, así que tu opinión es la que más nos importa.",
    body: "Estamos decidiendo qué construir a continuación y preferimos escucharte a ti antes que adivinar. Dos minutos de comentarios sinceros — qué funciona, qué te molesta, qué te gustaría que hiciera — marcarían de verdad el rumbo del proyecto.",
    cta: "Compartir mi opinión",
    copyLink: "O copia este enlace en tu navegador:",
  },
  it: {
    subject: () => "Cosa costruiamo adesso?",
    preview: "Hai già usato MonkeyTravel — la tua opinione sincera conterebbe molto.",
    heading: (n) => (n ? `Ciao ${n}, posso chiederti un favore veloce?` : "Posso chiederti un favore veloce?"),
    lead: "Hai organizzato un viaggio con MonkeyTravel, quindi la tua opinione è quella che ci interessa di più.",
    body: "Stiamo decidendo cosa costruire dopo e preferiamo sentirlo da te piuttosto che tirare a indovinare. Due minuti di feedback sincero — cosa funziona, cosa ti dà fastidio, cosa vorresti che facesse — farebbero davvero la differenza sulla direzione del progetto.",
    cta: "Condividi il tuo parere",
    copyLink: "Oppure copia questo link nel browser:",
  },
  pt: {
    subject: () => "O que a gente constrói agora?",
    preview: "Você já usou o MonkeyTravel — sua opinião sincera valeria muito.",
    heading: (n) => (n ? `Oi ${n}, posso te pedir um favor rápido?` : "Posso te pedir um favor rápido?"),
    lead: "Você planejou uma viagem com o MonkeyTravel, então sua opinião é a que mais importa para nós.",
    body: "Estamos decidindo o que construir a seguir e preferimos ouvir você a ficar adivinhando. Dois minutos de feedback sincero — o que funciona, o que incomoda, o que você gostaria que ele fizesse — mudariam de verdade o rumo do projeto.",
    cta: "Compartilhar minha opinião",
    copyLink: "Ou copie este link no seu navegador:",
  },
};

// ── Collaboration notifications: vote cast ──────────────────────────────

type VoteType = "love" | "flexible" | "concerns" | "no";

interface VoteCastEmailCopy {
  heading: string;
  votePhrase: Record<VoteType, string>;
  lead: (voterName: string, phrase: string) => string;
  cta: string;
  turnOffPrefix: string;
  turnOffLink: string;
  subject: (destination: string) => string;
}

export const voteCastCopy: Record<EmailLocale, VoteCastEmailCopy> = {
  en: {
    heading: "New activity feedback",
    votePhrase: {
      love: "loved",
      flexible: "is flexible on",
      concerns: "raised concerns about",
      no: "voted no on",
    },
    lead: (n, p) => `${n} ${p} an activity in your trip.`,
    cta: "See the trip",
    turnOffPrefix: "Don't want these? You can turn them off in",
    turnOffLink: "notification settings",
    subject: (d) => `New feedback on your ${d} trip`,
  },
  es: {
    heading: "Nuevos comentarios sobre una actividad",
    votePhrase: {
      love: "le encantó",
      flexible: "es flexible con",
      concerns: "expresó dudas sobre",
      no: "votó no a",
    },
    lead: (n, p) => `${n} ${p} una actividad de tu viaje.`,
    cta: "Ver el viaje",
    turnOffPrefix: "¿No quieres recibirlos? Puedes desactivarlos en",
    turnOffLink: "los ajustes de notificaciones",
    subject: (d) => `Nuevos comentarios sobre tu viaje a ${d}`,
  },
  it: {
    heading: "Nuovo feedback su un'attività",
    votePhrase: {
      love: "ha adorato",
      flexible: "è flessibile su",
      concerns: "ha sollevato dubbi su",
      no: "ha votato no su",
    },
    lead: (n, p) => `${n} ${p} un'attività del tuo viaggio.`,
    cta: "Vedi il viaggio",
    turnOffPrefix: "Non vuoi riceverle? Puoi disattivarle nelle",
    turnOffLink: "impostazioni di notifica",
    subject: (d) => `Nuovi commenti sul tuo viaggio a ${d}`,
  },
  pt: {
    heading: "Novo feedback sobre uma atividade",
    votePhrase: {
      love: "amou",
      flexible: "está tranquilo com",
      concerns: "levantou dúvidas sobre",
      no: "votou não em",
    },
    lead: (n, p) => `${n} ${p} uma atividade da sua viagem.`,
    cta: "Ver a viagem",
    turnOffPrefix: "Não quer receber estes e-mails? Você pode desativá-los em",
    turnOffLink: "configurações de notificação",
    subject: (d) => `Novo feedback na sua viagem para ${d}`,
  },
};
