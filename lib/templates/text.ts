import { routing } from "@/lib/i18n/routing";

export interface TemplateText {
  title: string;
  short: string;
  full: string;
}

type Locale = (typeof routing.locales)[number];
type Translated = Exclude<Locale, "en">;

/**
 * The curated templates' texts in the other locales, by trip id. The rows in
 * the trips table carry the English; there are seven of them and no editor,
 * so the translations live here. A template without an entry shows English.
 */
const TEXT: Record<string, Record<Translated, TemplateText>> = {
  // Paris
  "c2a4acd9-c5be-4992-ae53-28aa599d2a02": {
    es: {
      title: "París romántico: la Ciudad de la Luz y del amor",
      short: "Un viaje romántico de 7 días por la Ciudad de la Luz, que combina monumentos icónicos con tesoros locales escondidos",
      full: "Vive la magia de París durante 7 días encantadores. Pasea entre monumentos icónicos, descubre jardines escondidos, saborea una cocina de primer nivel y enamórate de la ciudad más romántica del mundo. De la Torre Eiffel brillando de noche a las calles adoquinadas de Montmartre, este itinerario combina las visitas imprescindibles con experiencias locales íntimas.",
    },
    it: {
      title: "Parigi romantica: la Ville Lumière e l'amore",
      short: "Un viaggio romantico di 7 giorni nella Ville Lumière, tra monumenti iconici e tesori locali nascosti",
      full: "Vivi la magia di Parigi in 7 giorni incantevoli. Passeggia tra i monumenti più famosi, scopri giardini nascosti, assapora una cucina di livello mondiale e innamorati della città più romantica del mondo. Dalla Tour Eiffel che scintilla di notte alle stradine acciottolate di Montmartre, questo itinerario unisce le attrazioni imperdibili a esperienze locali intime.",
    },
    pt: {
      title: "Paris romântica: a Cidade Luz e o amor",
      short: "Uma viagem romântica de 7 dias pela Cidade Luz, unindo marcos icônicos a tesouros locais escondidos",
      full: "Viva a magia de Paris em 7 dias encantadores. Passeie por marcos icônicos, descubra jardins escondidos, saboreie uma gastronomia de classe mundial e apaixone-se pela cidade mais romântica do mundo. Da Torre Eiffel brilhando à noite às ruas de paralelepípedos de Montmartre, este roteiro combina as atrações imperdíveis com experiências locais íntimas.",
    },
  },
  // Tokyo
  "b1a2c3d4-e5f6-4a5b-9c8d-7e6f5a4b3c2d": {
    es: {
      title: "Tokio al descubierto: tradición y futuro",
      short: "Un viaje de 7 días por los templos antiguos de Tokio, sus barrios futuristas y una cocina de primer nivel",
      full: "Vive el fascinante contraste entre templos milenarios y rascacielos iluminados con neón en una de las ciudades más apasionantes del mundo",
    },
    it: {
      title: "Tokyo svelata: dove la tradizione incontra il futuro",
      short: "Un viaggio di 7 giorni tra i templi antichi di Tokyo, i quartieri futuristici e una cucina di livello mondiale",
      full: "Vivi il contrasto affascinante tra templi antichi e grattacieli al neon in una delle città più sorprendenti del mondo",
    },
    pt: {
      title: "Tóquio revelada: tradição e futuro",
      short: "Uma viagem de 7 dias pelos templos antigos de Tóquio, bairros futuristas e uma gastronomia de classe mundial",
      full: "Viva o contraste fascinante entre templos milenares e arranha-céus iluminados por neon em uma das cidades mais surpreendentes do mundo",
    },
  },
  // Barcelona
  "c2b3d4e5-f6a7-5b6c-0d9e-8f7a6b5c4d3e": {
    es: {
      title: "Barcelona: magia mediterránea",
      short: "Arquitectura de Gaudí, rutas de tapas, el Barrio Gótico y playas mediterráneas",
      full: "Vive la vibrante cultura de Cataluña con una arquitectura impresionante, cocina de primer nivel y playas preciosas. De las obras maestras de Gaudí al encanto del Barrio Gótico.",
    },
    it: {
      title: "Barcellona: magia mediterranea",
      short: "L'architettura di Gaudí, i giri di tapas, il Barrio Gotico e le spiagge del Mediterraneo",
      full: "Vivi la cultura vibrante della Catalogna tra architettura straordinaria, cucina di livello mondiale e spiagge bellissime. Dai capolavori di Gaudí al fascino del Barrio Gotico.",
    },
    pt: {
      title: "Barcelona: magia mediterrânea",
      short: "Arquitetura de Gaudí, roteiros de tapas, Bairro Gótico e praias do Mediterrâneo",
      full: "Viva a cultura vibrante da Catalunha com uma arquitetura deslumbrante, gastronomia de classe mundial e praias lindas. Das obras-primas de Gaudí ao charme do Bairro Gótico.",
    },
  },
  // New York City
  "d3c4e5f6-a7b8-6c7d-1e0f-9a8b7c6d5e4f": {
    es: {
      title: "Nueva York: la experiencia definitiva",
      short: "Espectáculos de Broadway, Central Park, museos de primer nivel y experiencias icónicas de Nueva York",
      full: "De los monumentos icónicos a los rincones escondidos, vive la energía de la ciudad que nunca duerme. Espectáculos de Broadway, museos de primer nivel, cocinas de todo el mundo y vistas inolvidables del skyline.",
    },
    it: {
      title: "New York: l'esperienza definitiva",
      short: "Spettacoli di Broadway, Central Park, musei di livello mondiale ed esperienze iconiche di New York",
      full: "Dai monumenti iconici agli angoli nascosti, vivi l'energia della città che non dorme mai. Spettacoli di Broadway, musei di livello mondiale, cucine di ogni paese e viste indimenticabili sullo skyline.",
    },
    pt: {
      title: "Nova York: a experiência definitiva",
      short: "Espetáculos da Broadway, Central Park, museus de classe mundial e experiências icônicas de Nova York",
      full: "Dos marcos icônicos aos cantos escondidos, viva a energia da cidade que nunca dorme. Espetáculos da Broadway, museus de classe mundial, cozinhas do mundo inteiro e vistas inesquecíveis do skyline.",
    },
  },
  // Rome
  "e4d5f6a7-b8c9-7d8e-2f1a-0b9c8d7e6f5a": {
    es: {
      title: "Roma: la Ciudad Eterna al descubierto",
      short: "Coliseo, Museos Vaticanos, ruinas antiguas y auténtica cocina italiana",
      full: "Recorre 3.000 años de historia en una de las ciudades más bellas del mundo. Ruinas antiguas, arte renacentista, una cocina famosa en el mundo entero y la dolce vita.",
    },
    it: {
      title: "Roma: la Città Eterna svelata",
      short: "Colosseo, Musei Vaticani, rovine antiche e cucina italiana autentica",
      full: "Cammina attraverso 3.000 anni di storia in una delle città più belle del mondo. Rovine antiche, arte rinascimentale, una cucina famosa in tutto il mondo e la dolce vita.",
    },
    pt: {
      title: "Roma: a Cidade Eterna revelada",
      short: "Coliseu, Museus do Vaticano, ruínas antigas e autêntica cozinha italiana",
      full: "Caminhe por 3.000 anos de história em uma das cidades mais belas do mundo. Ruínas antigas, arte renascentista, uma gastronomia famosa no mundo inteiro e la dolce vita.",
    },
  },
  // Bali
  "f5e6a7b8-c9d0-8e9f-3a2b-1c0d9e8f7a6b": {
    es: {
      title: "Bali: la isla de los dioses",
      short: "Templos sagrados, terrazas de arroz, retiros de bienestar y playas vírgenes",
      full: "Descubre el paraíso en Indonesia. Templos sagrados, exuberantes terrazas de arroz, surf de primer nivel, retiros de bienestar y atardeceres inolvidables en las distintas regiones de la isla.",
    },
    it: {
      title: "Bali: l'isola degli dei",
      short: "Templi sacri, terrazze di riso, ritiri benessere e spiagge incontaminate",
      full: "Scopri il paradiso in Indonesia. Templi sacri, terrazze di riso lussureggianti, surf di livello mondiale, ritiri benessere e tramonti indimenticabili nelle diverse regioni dell'isola.",
    },
    pt: {
      title: "Bali: a ilha dos deuses",
      short: "Templos sagrados, terraços de arroz, retiros de bem-estar e praias intocadas",
      full: "Descubra o paraíso na Indonésia. Templos sagrados, terraços de arroz exuberantes, surfe de classe mundial, retiros de bem-estar e pores do sol inesquecíveis pelas diversas regiões da ilha.",
    },
  },
  // Santorini
  "6c40f334-6ef5-4d59-839c-d4eeed8921e4": {
    es: {
      title: "Santorini: sueños y atardeceres en el Egeo",
      short: "Una escapada romántica de 5 días a la impresionante isla griega, con atardeceres icónicos, playas volcánicas y vinos de primer nivel",
      full: "Descubre la magia de Santorini durante 5 días inolvidables. De las icónicas iglesias de cúpulas azules de Oia a las playas volcánicas escondidas, este paraíso griego ofrece atardeceres de infarto, vinos de primer nivel y ruinas antiguas. Disfruta de hoteles de lujo sobre el acantilado, tabernas tradicionales y la cálida hospitalidad de las Cícladas.",
    },
    it: {
      title: "Santorini: sogni e tramonti sull'Egeo",
      short: "Una fuga romantica di 5 giorni nella splendida isola greca, tra tramonti iconici, spiagge vulcaniche e vini di livello mondiale",
      full: "Scopri la magia di Santorini in 5 giorni indimenticabili. Dalle iconiche chiese dalle cupole blu di Oia alle spiagge vulcaniche nascoste, questo paradiso greco offre tramonti mozzafiato, vini di livello mondiale e rovine antiche. Vivi hotel di lusso a picco sul mare, taverne tradizionali e la calda ospitalità delle Cicladi.",
    },
    pt: {
      title: "Santorini: sonhos e pores do sol no Egeu",
      short: "Uma escapada romântica de 5 dias à deslumbrante ilha grega, com pores do sol icônicos, praias vulcânicas e vinhos de classe mundial",
      full: "Descubra a magia de Santorini em 5 dias inesquecíveis. Das icônicas igrejas de cúpulas azuis de Oia às praias vulcânicas escondidas, este paraíso grego oferece pores do sol de tirar o fôlego, vinhos de classe mundial e ruínas antigas. Viva hotéis de luxo no alto das falésias, tavernas tradicionais e a calorosa hospitalidade das Cíclades.",
    },
  },
};

/** The ids with translations, for the completeness test. */
export const TRANSLATED_TEMPLATE_IDS = Object.keys(TEXT);

/** A supported locale, or English for anything else (a query parameter, say). */
export function templateLocale(value: string | null | undefined): Locale {
  return (routing.locales as readonly string[]).includes(value ?? "") ? (value as Locale) : "en";
}

/** A template's title and descriptions in `locale`, or the English ones its row stores. */
export function templateText(id: string, locale: string, english: TemplateText): TemplateText {
  if (locale === "en") return english;
  return TEXT[id]?.[locale as Translated] ?? english;
}

/** A country's name in `locale` from its ISO code, or the stored name when there is none. */
export function countryName(code: string, locale: string, fallback: string): string {
  if (!code) return fallback;
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code.toUpperCase()) ?? fallback;
  } catch {
    return fallback;
  }
}
