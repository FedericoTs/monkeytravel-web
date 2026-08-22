/**
 * Comparison-page data ("<competitor> alternative" pages).
 *
 * WHY THIS FILE EXISTS
 * The programmatic landing pages (multi-city-trip-planner et al.) inline all
 * four locales in a per-page META record and run ~550 lines each. That's fine
 * for one-offs, but comparison pages are a SET that grows — so the copy lives
 * here as data and app/[locale]/compare/[competitor]/page.tsx renders it.
 * Adding a competitor should be a data edit, never a new 550-line page.
 *
 * ACCURACY RULES — read before adding anything
 * These pages make public factual claims about named companies, so:
 *   1. Every `them` claim must trace to dated, verifiable research. Wanderlog's
 *      come from docs/WANDERLOG_TEARDOWN_2026_07.md (web-verified, sourced).
 *   2. `theyWin` is NOT optional. A comparison page that pretends the
 *      competitor has no strengths reads as marketing and converts worse than
 *      an honest one — and invites a correction we'd deserve.
 *   3. `researchedAt` is rendered on the page. Competitor features change;
 *      a visible as-of date is what keeps a true claim from silently rotting
 *      into a false one.
 *   4. No pricing claim without the as-of date attached in the same sentence.
 *
 * DO NOT add a competitor you have not actually researched. An invented
 * feature matrix is worse than no page.
 */

export type CompareLocale = "en" | "es" | "it" | "pt";

/** A cell is either a yes/no, or a short qualifying phrase per locale. */
export type Cell = boolean | Record<CompareLocale, string>;

export interface ComparisonRow {
  label: Record<CompareLocale, string>;
  us: Cell;
  them: Cell;
}

export interface Faq {
  q: string;
  a: string;
}

export interface Competitor {
  /** URL segment: /compare/<slug> — keeps the search phrase in the path. */
  slug: string;
  /** Display name, used in headings and schema. */
  name: string;
  /** ISO date of the last verification pass. Rendered on the page. */
  researchedAt: string;
  /** Repo-relative research doc backing the claims. */
  sourceDoc: string;
  meta: Record<CompareLocale, { title: string; description: string }>;
  hero: Record<CompareLocale, { h1: string; sub: string }>;
  /** Honest "who each product is for" — shown above the table. */
  verdict: Record<CompareLocale, { usFor: string; themFor: string }>;
  rows: ComparisonRow[];
  /** Where the competitor genuinely wins. Required. */
  theyWin: Record<CompareLocale, string[]>;
  weWin: Record<CompareLocale, string[]>;
  faqs: Record<CompareLocale, Faq[]>;
}

const YES_NO = (
  usVal: Cell,
  themVal: Cell,
  label: Record<CompareLocale, string>
): ComparisonRow => ({ label, us: usVal, them: themVal });

/* ------------------------------------------------------------------ */
/* Wanderlog                                                           */
/* Claims re-verified hands-on 2026-08-18. Wanderlog CHANGED since the    */
/* July teardown: creating a trip no longer requires an account (the      */
/* signup modal now offers "Salta e registrati piu tardi" and skipping    */
/* lands you in a real planner). Sharing is still gated - the Condividi   */
/* wall has no skip. Two claims were corrected in this pass; see          */
/* docs/WANDERLOG_TEARDOWN_2026_07.md for the older, now-partly-stale run.*/
/* ------------------------------------------------------------------ */

const wanderlog: Competitor = {
  slug: "wanderlog-alternative",
  name: "Wanderlog",
  // Bumped to 2026-08-18 only AFTER re-walking the competitor's real flow and
  // correcting the two claims that pass proved false. The field is rendered to
  // visitors as "when we checked", so it may never run ahead of the evidence:
  // it sat at 2026-07-03 until this verification existed to justify moving it.
  researchedAt: "2026-08-18",
  sourceDoc: "docs/WANDERLOG_TEARDOWN_2026_07.md",

  meta: {
    en: {
      title: "Wanderlog Alternative — AI Itineraries in Minutes, No Signup",
      description:
        "Wanderlog is a great manual planner, but it takes hours and gates sharing behind an account. MonkeyTravel generates a full itinerary in minutes, free — share the link and let your group vote, no signup.",
    },
    es: {
      title: "Alternativa a Wanderlog — Itinerarios con AI, sin registro",
      description:
        "Wanderlog es un gran planificador manual, pero lleva horas y exige cuenta para compartir. MonkeyTravel genera el itinerario completo en minutos, gratis — comparte el enlace y que tu grupo vote, sin registro.",
    },
    it: {
      title: "Alternativa a Wanderlog — Itinerari con AI, senza registrazione",
      description:
        "Wanderlog è un ottimo pianificatore manuale, ma richiede ore e un account per condividere. MonkeyTravel genera l'itinerario completo in pochi minuti, gratis — condividi il link e fai votare il tuo gruppo, senza registrazione.",
    },
    pt: {
      title: "Alternativa ao Wanderlog — Roteiros com AI, sem cadastro",
      description:
        "O Wanderlog é um ótimo planejador manual, mas leva horas e exige conta para compartilhar. O MonkeyTravel gera o roteiro completo em minutos, grátis — compartilhe o link e deixe seu grupo votar, sem cadastro.",
    },
  },

  hero: {
    en: {
      h1: "The Wanderlog alternative that plans the trip for you",
      sub: "Wanderlog gives you an excellent empty notebook. MonkeyTravel hands you a finished first draft in minutes — then lets you and your crew change it.",
    },
    es: {
      h1: "La alternativa a Wanderlog que planifica el viaje por ti",
      sub: "Wanderlog te da un cuaderno vacío excelente. MonkeyTravel te entrega un primer borrador terminado en minutos — y luego tú y tu grupo lo cambiáis.",
    },
    it: {
      h1: "L'alternativa a Wanderlog che pianifica il viaggio al posto tuo",
      sub: "Wanderlog ti dà un ottimo quaderno vuoto. MonkeyTravel ti consegna una prima bozza già pronta in pochi minuti — poi tu e il tuo gruppo la cambiate.",
    },
    pt: {
      h1: "A alternativa ao Wanderlog que planeja a viagem por você",
      sub: "O Wanderlog te dá um caderno vazio excelente. O MonkeyTravel entrega um primeiro rascunho pronto em minutos — e depois você e seu grupo mudam o que quiserem.",
    },
  },

  verdict: {
    en: {
      themFor:
        "Wanderlog is for the planner who enjoys building a trip by hand, place by place, and wants deep manual control plus polished native apps.",
      usFor:
        "MonkeyTravel is for the traveller who wants a complete plan to react to instead of a blank page — especially when a group has to agree on it.",
    },
    es: {
      themFor:
        "Wanderlog es para quien disfruta construyendo el viaje a mano, sitio por sitio, y quiere control manual profundo y apps nativas pulidas.",
      usFor:
        "MonkeyTravel es para quien prefiere reaccionar a un plan completo en vez de a una página en blanco — sobre todo cuando el grupo tiene que ponerse de acuerdo.",
    },
    it: {
      themFor:
        "Wanderlog è per chi ama costruire il viaggio a mano, tappa per tappa, e vuole controllo manuale profondo e app native curate.",
      usFor:
        "MonkeyTravel è per chi preferisce reagire a un piano completo invece che a una pagina bianca — soprattutto quando deve decidere un gruppo.",
    },
    pt: {
      themFor:
        "O Wanderlog é para quem gosta de montar a viagem à mão, lugar por lugar, e quer controle manual profundo e apps nativos caprichados.",
      usFor:
        "O MonkeyTravel é para quem prefere reagir a um plano completo em vez de a uma página em branco — principalmente quando um grupo precisa concordar.",
    },
  },

  rows: [
    YES_NO(
      {
        en: "Minutes, not an afternoon",
        es: "Minutos, no una tarde",
        it: "Minuti, non un pomeriggio",
        pt: "Minutos, não uma tarde",
      },
      {
        en: "Full draft itinerary generated",
        es: "Borrador completo generado",
        it: "Bozza completa generata",
        pt: "Rascunho completo gerado",
      },
      {
        en: "Built by hand, place by place",
        es: "Se construye a mano, sitio por sitio",
        it: "Costruito a mano, tappa per tappa",
        pt: "Montado à mão, lugar por lugar",
      }
    ),
    // them:true since 2026-08-18. This said false and was CORRECT in July, when
    // an account was required before any trip. Wanderlog has since softened it:
    // the signup modal carries "Salta e registrati piu tardi" and skipping
    // really does open a working planner. Verified by doing it. Kept as a
    // parity row rather than deleted - a table that only lists wins is an
    // advert, and the honest row is what makes the losing rows believable.
    YES_NO(true, true, {
      en: "Try it without creating an account",
      es: "Pruébalo sin crear cuenta",
      it: "Provalo senza creare un account",
      pt: "Teste sem criar conta",
    }),
    YES_NO(
      {
        en: "Edits your itinerary directly",
        es: "Edita tu itinerario directamente",
        it: "Modifica direttamente l'itinerario",
        pt: "Edita seu roteiro diretamente",
      },
      {
        en: "Suggests only, you add manually",
        es: "Solo sugiere, tú añades a mano",
        it: "Solo suggerimenti, aggiungi a mano",
        pt: "Só sugere, você adiciona à mão",
      },
      {
        en: "What the AI can actually do",
        es: "Qué puede hacer la AI realmente",
        it: "Cosa sa fare davvero l'AI",
        pt: "O que a AI realmente faz",
      }
    ),
    YES_NO(true, false, {
      en: "Group votes on activities — no account needed",
      es: "El grupo vota actividades — sin cuenta",
      it: "Il gruppo vota le attività — senza account",
      pt: "O grupo vota nas atividades — sem conta",
    }),
    // Added 2026-08-18 with the anonymous share loop. Deliberately placed
    // directly after the voting row so the three no-account rows read as one
    // escalating block: try it -> share it -> your group votes on it. That
    // sequence is the whole crew loop, and the account wall blocks all three.
    // "the trip itself" distinguishes this from the "Try it without creating
    // an account" row above, which is about generating rather than sending.
    // `them: false` verified hands-on 2026-08-18, NOT inferred: created a trip
    // anonymously (skipping the soft signup modal), then clicked Condividi on
    // it. That raised "Registrati per salvare le modifiche" with Facebook /
    // Google / email and NO skip affordance, and produced no link. The create
    // wall bends; the share wall does not. This is the one gate that still
    // holds, which is precisely why it is the row worth having.
    YES_NO(true, false, {
      en: "Share the trip itself — no account needed to send the link",
      es: "Comparte el viaje — sin cuenta para enviar el enlace",
      it: "Condividi il viaggio — nessun account per inviare il link",
      pt: "Compartilhe a viagem — sem conta para enviar o link",
    }),
    YES_NO(true, false, {
      en: "Plan around fixed commitments (a wedding, booked flights)",
      es: "Planifica alrededor de citas fijas (una boda, vuelos ya reservados)",
      it: "Pianifica attorno a impegni fissi (un matrimonio, voli già prenotati)",
      pt: "Planeje em torno de compromissos fixos (um casamento, voos já reservados)",
    }),
    YES_NO(true, false, {
      en: "Copy someone else's trip and make it yours",
      es: "Copia el viaje de otra persona y hazlo tuyo",
      it: "Copia il viaggio di un altro e rendilo tuo",
      pt: "Copie a viagem de outra pessoa e torne-a sua",
    }),
    YES_NO(
      {
        en: "Free",
        es: "Gratis",
        it: "Gratis",
        pt: "Grátis",
      },
      {
        en: "Paid plan",
        es: "Plan de pago",
        it: "Piano a pagamento",
        pt: "Plano pago",
      },
      {
        en: "Route optimisation, offline access and dark mode",
        es: "Optimización de ruta, acceso offline y modo oscuro",
        it: "Ottimizzazione percorso, accesso offline e modalità scura",
        pt: "Otimização de rota, acesso offline e modo escuro",
      }
    ),
    YES_NO(
      {
        en: "English, Spanish, Italian, Portuguese",
        es: "Inglés, español, italiano, portugués",
        it: "Inglese, spagnolo, italiano, portoghese",
        pt: "Inglês, espanhol, italiano, português",
      },
      {
        en: "English-centric",
        es: "Centrado en inglés",
        it: "Incentrato sull'inglese",
        pt: "Centrado no inglês",
      },
      {
        en: "Languages",
        es: "Idiomas",
        it: "Lingue",
        pt: "Idiomas",
      }
    ),
    YES_NO(false, true, {
      en: "Real-time co-editing with your travel companions",
      es: "Edición simultánea en tiempo real con tus compañeros",
      it: "Modifica in tempo reale insieme ai compagni di viaggio",
      pt: "Edição em tempo real com seus companheiros de viagem",
    }),
    YES_NO(false, true, {
      en: "Native iOS and Android apps",
      es: "Apps nativas de iOS y Android",
      it: "App native iOS e Android",
      pt: "Apps nativos de iOS e Android",
    }),
  ],

  theyWin: {
    en: [
      "Real-time collaborative editing — several people editing the same trip at once. It is their most-praised feature and we do not match it yet.",
      "Polished native iOS and Android apps with a long review history.",
      "Deep manual control: if you want to place every stop yourself, their editor is better than ours.",
      "Importing booking confirmation emails into a trip.",
      "A very large library of community itineraries built up over years.",
    ],
    es: [
      "Edición colaborativa en tiempo real — varias personas editando el mismo viaje a la vez. Es su función más elogiada y todavía no la igualamos.",
      "Apps nativas de iOS y Android pulidas, con años de reseñas.",
      "Control manual profundo: si quieres colocar cada parada tú mismo, su editor es mejor que el nuestro.",
      "Importación de correos de confirmación de reservas.",
      "Una biblioteca enorme de itinerarios de la comunidad acumulada durante años.",
    ],
    it: [
      "Modifica collaborativa in tempo reale — più persone che lavorano sullo stesso viaggio insieme. È la funzione più apprezzata e non la eguagliamo ancora.",
      "App native iOS e Android curate, con anni di recensioni.",
      "Controllo manuale profondo: se vuoi posizionare ogni tappa a mano, il loro editor è migliore del nostro.",
      "Importazione delle email di conferma delle prenotazioni.",
      "Una libreria enorme di itinerari della community costruita negli anni.",
    ],
    pt: [
      "Edição colaborativa em tempo real — várias pessoas editando a mesma viagem ao mesmo tempo. É o recurso mais elogiado deles e ainda não igualamos.",
      "Apps nativos de iOS e Android caprichados, com anos de avaliações.",
      "Controle manual profundo: se você quer posicionar cada parada, o editor deles é melhor que o nosso.",
      "Importação de e-mails de confirmação de reservas.",
      "Uma biblioteca enorme de roteiros da comunidade construída ao longo de anos.",
    ],
  },

  weWin: {
    en: [
      "You get a complete itinerary in minutes instead of building one over an afternoon.",
      "Nothing to sign up for until you want to save the trip.",
      "The AI edits the plan for you — move a day, swap a restaurant, add a stop — and asks you to confirm before it changes anything.",
      "Your group votes on individual activities without anyone creating an account.",
      "You can pin fixed commitments — a wedding, a flight you already booked — and the plan is built around them.",
      "Route optimisation, offline access and dark mode are free.",
      "Full Spanish, Italian and Portuguese, not just a translated menu.",
    ],
    es: [
      "Obtienes un itinerario completo en minutos en vez de construirlo durante una tarde.",
      "No hay que registrarse hasta que quieras guardar el viaje.",
      "La AI edita el plan por ti — mueve un día, cambia un restaurante, añade una parada — y pide confirmación antes de tocar nada.",
      "Tu grupo vota actividades concretas sin que nadie cree una cuenta.",
      "Puedes fijar compromisos inamovibles — una boda, un vuelo ya reservado — y el plan se construye alrededor.",
      "Optimización de ruta, acceso offline y modo oscuro son gratis.",
      "Español, italiano y portugués completos, no solo un menú traducido.",
    ],
    it: [
      "Ottieni un itinerario completo in pochi minuti invece di costruirlo in un pomeriggio.",
      "Non devi registrarti finché non vuoi salvare il viaggio.",
      "L'AI modifica il piano per te — sposta un giorno, cambia un ristorante, aggiunge una tappa — e chiede conferma prima di toccare qualcosa.",
      "Il tuo gruppo vota le singole attività senza che nessuno crei un account.",
      "Puoi fissare impegni immutabili — un matrimonio, un volo già prenotato — e il piano si costruisce attorno.",
      "Ottimizzazione del percorso, accesso offline e modalità scura sono gratis.",
      "Spagnolo, italiano e portoghese completi, non solo un menu tradotto.",
    ],
    pt: [
      "Você recebe um roteiro completo em minutos em vez de montá-lo ao longo de uma tarde.",
      "Nada de cadastro até você querer salvar a viagem.",
      "A AI edita o plano por você — move um dia, troca um restaurante, adiciona uma parada — e pede confirmação antes de mudar qualquer coisa.",
      "Seu grupo vota em atividades específicas sem ninguém criar conta.",
      "Você pode fixar compromissos inegociáveis — um casamento, um voo já reservado — e o plano é construído em volta.",
      "Otimização de rota, acesso offline e modo escuro são grátis.",
      "Espanhol, italiano e português completos, não só um menu traduzido.",
    ],
  },

  faqs: {
    en: [
      {
        q: "Is MonkeyTravel free?",
        a: "Yes. Generating and saving itineraries is free, and the features Wanderlog puts behind its paid plan — route optimisation, offline access, dark mode — are free here.",
      },
      {
        q: "Do I need an account to try it?",
        a: "No. You can generate a full itinerary without signing up. You only create an account when you want to save it.",
      },
      {
        q: "Can I move my Wanderlog trip over?",
        a: "There is no direct Wanderlog import. You can paste an existing plan as text and we will turn it into a structured itinerary, then fill the gaps around it.",
      },
      {
        q: "Is Wanderlog better for anything?",
        a: "Yes — real-time collaborative editing, native mobile apps and fine-grained manual control are all genuinely better there. If those matter most to you, use Wanderlog.",
      },
      {
        q: "Can my group help decide without signing up?",
        a: "Yes. Share a link and they can vote on individual activities without creating an account, which is the part most planners get wrong.",
      },
    ],
    es: [
      {
        q: "¿MonkeyTravel es gratis?",
        a: "Sí. Generar y guardar itinerarios es gratis, y las funciones que Wanderlog deja tras su plan de pago — optimización de ruta, acceso offline, modo oscuro — aquí son gratuitas.",
      },
      {
        q: "¿Necesito cuenta para probarlo?",
        a: "No. Puedes generar un itinerario completo sin registrarte. Solo creas cuenta cuando quieres guardarlo.",
      },
      {
        q: "¿Puedo traer mi viaje de Wanderlog?",
        a: "No hay importación directa desde Wanderlog. Puedes pegar un plan existente como texto y lo convertimos en un itinerario estructurado, rellenando los huecos alrededor.",
      },
      {
        q: "¿Wanderlog es mejor en algo?",
        a: "Sí — edición colaborativa en tiempo real, apps móviles nativas y control manual detallado son genuinamente mejores allí. Si eso es lo que más te importa, usa Wanderlog.",
      },
      {
        q: "¿Mi grupo puede decidir sin registrarse?",
        a: "Sí. Comparte un enlace y podrán votar actividades concretas sin crear cuenta, que es justo la parte que casi todos los planificadores hacen mal.",
      },
    ],
    it: [
      {
        q: "MonkeyTravel è gratis?",
        a: "Sì. Generare e salvare itinerari è gratis, e le funzioni che Wanderlog mette dietro il piano a pagamento — ottimizzazione del percorso, accesso offline, modalità scura — qui sono gratuite.",
      },
      {
        q: "Serve un account per provarlo?",
        a: "No. Puoi generare un itinerario completo senza registrarti. Crei un account solo quando vuoi salvarlo.",
      },
      {
        q: "Posso portare qui il mio viaggio da Wanderlog?",
        a: "Non c'è un'importazione diretta da Wanderlog. Puoi incollare un piano esistente come testo e lo trasformiamo in un itinerario strutturato, riempiendo i vuoti attorno.",
      },
      {
        q: "Wanderlog è migliore in qualcosa?",
        a: "Sì — modifica collaborativa in tempo reale, app mobile native e controllo manuale fine sono davvero migliori lì. Se ti servono soprattutto quelli, usa Wanderlog.",
      },
      {
        q: "Il mio gruppo può decidere senza registrarsi?",
        a: "Sì. Condividi un link e possono votare le singole attività senza creare un account — proprio la parte che quasi tutti i pianificatori sbagliano.",
      },
    ],
    pt: [
      {
        q: "O MonkeyTravel é grátis?",
        a: "Sim. Gerar e salvar roteiros é grátis, e os recursos que o Wanderlog deixa atrás do plano pago — otimização de rota, acesso offline, modo escuro — aqui são gratuitos.",
      },
      {
        q: "Preciso de conta para testar?",
        a: "Não. Você pode gerar um roteiro completo sem se cadastrar. Só cria conta quando quiser salvar.",
      },
      {
        q: "Posso trazer minha viagem do Wanderlog?",
        a: "Não há importação direta do Wanderlog. Você pode colar um plano existente como texto e nós o transformamos em um roteiro estruturado, preenchendo as lacunas em volta.",
      },
      {
        q: "O Wanderlog é melhor em alguma coisa?",
        a: "Sim — edição colaborativa em tempo real, apps móveis nativos e controle manual detalhado são realmente melhores lá. Se isso é o que mais importa para você, use o Wanderlog.",
      },
      {
        q: "Meu grupo pode decidir sem se cadastrar?",
        a: "Sim. Compartilhe um link e eles votam em atividades específicas sem criar conta — justamente a parte que quase todos os planejadores erram.",
      },
    ],
  },
};

export const COMPETITORS: Competitor[] = [wanderlog];

export function getCompetitor(slug: string): Competitor | undefined {
  return COMPETITORS.find((c) => c.slug === slug);
}

export function competitorSlugs(): string[] {
  return COMPETITORS.map((c) => c.slug);
}
