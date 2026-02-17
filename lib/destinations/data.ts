import type { Destination } from "./types";

export const destinations: Destination[] = [
  // =========================================================================
  // PARIS
  // =========================================================================
  {
    slug: "paris",
    name: { en: "Paris", es: "París", it: "Parigi" },
    country: { en: "France", es: "Francia", it: "Francia" },
    countryCode: "FR",
    continent: "europe",
    coordinates: { lat: 48.8566, lng: 2.3522 },
    stats: { avgStayDays: 4, bestMonths: [4, 5, 6, 9, 10], budgetLevel: 3 },
    tags: ["romantic", "cultural", "foodie", "urban"],
    content: {
      tagline: {
        en: "The City of Light awaits your perfect itinerary",
        es: "La Ciudad de la Luz espera tu itinerario perfecto",
        it: "La Città della Luce attende il tuo itinerario perfetto",
      },
      description: {
        en: "From the Eiffel Tower to hidden bistros in Le Marais, Paris offers an endless blend of art, history, and gastronomy. Let AI craft a day-by-day plan that balances iconic landmarks with local gems only Parisians know.",
        es: "Desde la Torre Eiffel hasta bistrós escondidos en Le Marais, París ofrece una mezcla infinita de arte, historia y gastronomía. Deja que la IA cree un plan día a día que equilibre monumentos icónicos con joyas locales que solo los parisinos conocen.",
        it: "Dalla Torre Eiffel ai bistrot nascosti nel Marais, Parigi offre un mix infinito di arte, storia e gastronomia. Lascia che l'IA crei un piano giorno per giorno che bilanci monumenti iconici con gemme locali che solo i parigini conoscono.",
      },
      highlights: [
        {
          icon: "🗼",
          title: {
            en: "Iconic Landmarks",
            es: "Monumentos Icónicos",
            it: "Monumenti Iconici",
          },
          description: {
            en: "Eiffel Tower, Louvre, Notre-Dame, and Arc de Triomphe — all optimally scheduled to avoid crowds",
            es: "Torre Eiffel, Louvre, Notre-Dame y Arco del Triunfo — todo programado para evitar multitudes",
            it: "Torre Eiffel, Louvre, Notre-Dame e Arco di Trionfo — tutto programmato per evitare la folla",
          },
        },
        {
          icon: "🥐",
          title: {
            en: "World-Class Cuisine",
            es: "Gastronomía de Clase Mundial",
            it: "Cucina di Classe Mondiale",
          },
          description: {
            en: "From croissants at dawn to Michelin-starred dinners — our AI picks restaurants matching your taste and budget",
            es: "Desde croissants al amanecer hasta cenas con estrellas Michelin — nuestra IA elige restaurantes según tu gusto y presupuesto",
            it: "Dai croissant all'alba alle cene stellate Michelin — la nostra IA sceglie ristoranti in base ai tuoi gusti e budget",
          },
        },
        {
          icon: "🎨",
          title: {
            en: "Art & Culture",
            es: "Arte y Cultura",
            it: "Arte e Cultura",
          },
          description: {
            en: "Beyond the big museums: street art in Belleville, jazz in Saint-Germain, and galleries in the Marais",
            es: "Más allá de los grandes museos: arte callejero en Belleville, jazz en Saint-Germain y galerías en el Marais",
            it: "Oltre i grandi musei: street art a Belleville, jazz a Saint-Germain e gallerie nel Marais",
          },
        },
        {
          icon: "🌸",
          title: {
            en: "Charming Neighborhoods",
            es: "Barrios con Encanto",
            it: "Quartieri Affascinanti",
          },
          description: {
            en: "Montmartre's cobblestones, the Latin Quarter's bookshops, and Saint-Martin canal walks",
            es: "Los adoquines de Montmartre, las librerías del Barrio Latino y paseos por el canal Saint-Martin",
            it: "I ciottoli di Montmartre, le librerie del Quartiere Latino e passeggiate lungo il canale Saint-Martin",
          },
        },
      ],
      sampleDay: {
        activities: [
          {
            time: "08:30",
            type: "breakfast",
            title: {
              en: "Breakfast at a local boulangerie",
              es: "Desayuno en una boulangerie local",
              it: "Colazione in una boulangerie locale",
            },
            description: {
              en: "Fresh croissants and café crème in the Marais",
              es: "Croissants frescos y café crème en el Marais",
              it: "Croissant freschi e café crème nel Marais",
            },
          },
          {
            time: "10:00",
            type: "museum",
            title: {
              en: "Musée d'Orsay",
              es: "Museo de Orsay",
              it: "Museo d'Orsay",
            },
            description: {
              en: "Impressionist masterpieces in a stunning former train station",
              es: "Obras maestras impresionistas en una impresionante antigua estación de tren",
              it: "Capolavori impressionisti in una splendida ex stazione ferroviaria",
            },
          },
          {
            time: "13:00",
            type: "lunch",
            title: {
              en: "Lunch in Saint-Germain",
              es: "Almuerzo en Saint-Germain",
              it: "Pranzo a Saint-Germain",
            },
            description: {
              en: "Classic French bistro with a prix fixe menu",
              es: "Bistró francés clásico con menú prix fixe",
              it: "Bistrot francese classico con menu prix fixe",
            },
          },
          {
            time: "15:00",
            type: "walk",
            title: {
              en: "Seine River walk to Notre-Dame",
              es: "Paseo por el Sena hasta Notre-Dame",
              it: "Passeggiata lungo la Senna fino a Notre-Dame",
            },
            description: {
              en: "Stroll along the Left Bank bookstalls to Île de la Cité",
              es: "Paseo por los puestos de libros del margen izquierdo hasta Île de la Cité",
              it: "Passeggiata tra le bancarelle di libri della Rive Gauche fino all'Île de la Cité",
            },
          },
          {
            time: "17:30",
            type: "sightseeing",
            title: {
              en: "Eiffel Tower at sunset",
              es: "Torre Eiffel al atardecer",
              it: "Torre Eiffel al tramonto",
            },
            description: {
              en: "Golden hour views from Trocadéro or the summit",
              es: "Vistas de la hora dorada desde el Trocadéro o la cima",
              it: "Viste dell'ora dorata dal Trocadéro o dalla cima",
            },
          },
          {
            time: "20:00",
            type: "dinner",
            title: {
              en: "Dinner in Montmartre",
              es: "Cena en Montmartre",
              it: "Cena a Montmartre",
            },
            description: {
              en: "Cozy restaurant with views over the twinkling city",
              es: "Restaurante acogedor con vistas a la ciudad iluminada",
              it: "Ristorante accogliente con vista sulla città scintillante",
            },
          },
        ],
      },
      faqs: [
        {
          question: {
            en: "How many days do I need in Paris?",
            es: "¿Cuántos días necesito en París?",
            it: "Quanti giorni servono a Parigi?",
          },
          answer: {
            en: "We recommend 3-5 days to see the highlights comfortably. Our AI creates itineraries for any length, but 4 days is the sweet spot for first-time visitors to cover major landmarks, enjoy the food scene, and explore charming neighborhoods.",
            es: "Recomendamos 3-5 días para ver los highlights cómodamente. Nuestra IA crea itinerarios de cualquier duración, pero 4 días es ideal para visitantes primerizos que quieran cubrir los principales monumentos, disfrutar de la gastronomía y explorar barrios con encanto.",
            it: "Consigliamo 3-5 giorni per vedere i punti salienti comodamente. La nostra IA crea itinerari di qualsiasi durata, ma 4 giorni sono ideali per i visitatori alla prima visita per coprire i principali monumenti, godersi la scena gastronomica ed esplorare quartieri affascinanti.",
          },
        },
        {
          question: {
            en: "What is the best time to visit Paris?",
            es: "¿Cuál es la mejor época para visitar París?",
            it: "Qual è il periodo migliore per visitare Parigi?",
          },
          answer: {
            en: "April to June and September to October offer the best weather, fewer crowds, and lower prices than peak summer. Spring brings cherry blossoms, while autumn offers golden foliage along the Seine.",
            es: "De abril a junio y de septiembre a octubre ofrecen el mejor clima, menos multitudes y precios más bajos que el verano. La primavera trae cerezos en flor, mientras que el otoño ofrece follaje dorado a lo largo del Sena.",
            it: "Da aprile a giugno e da settembre a ottobre offrono il miglior clima, meno folla e prezzi più bassi rispetto all'estate. La primavera porta i ciliegi in fiore, mentre l'autunno offre fogliame dorato lungo la Senna.",
          },
        },
        {
          question: {
            en: "Is Paris expensive to visit?",
            es: "¿Es caro visitar París?",
            it: "Parigi è cara da visitare?",
          },
          answer: {
            en: "Paris can fit any budget. Our AI offers Budget, Balanced, and Premium itinerary options. Budget travelers can enjoy Paris for $80-120/day with free museum days, picnics, and affordable bistros. A balanced trip runs $150-250/day.",
            es: "París se adapta a cualquier presupuesto. Nuestra IA ofrece opciones de itinerario Económico, Equilibrado y Premium. Los viajeros con presupuesto pueden disfrutar de París por $80-120/día con días de museo gratis, picnics y bistrós asequibles.",
            it: "Parigi si adatta a qualsiasi budget. La nostra IA offre opzioni di itinerario Economico, Equilibrato e Premium. I viaggiatori con budget possono godersi Parigi per $80-120/giorno con giorni di museo gratuiti, picnic e bistrot accessibili.",
          },
        },
      ],
      ctaText: {
        en: "Ready to explore Paris?",
        es: "¿Listo para explorar París?",
        it: "Pronto per esplorare Parigi?",
      },
    },
  },

  // =========================================================================
  // ROME
  // =========================================================================
  {
    slug: "rome",
    name: { en: "Rome", es: "Roma", it: "Roma" },
    country: { en: "Italy", es: "Italia", it: "Italia" },
    countryCode: "IT",
    continent: "europe",
    coordinates: { lat: 41.9028, lng: 12.4964 },
    stats: { avgStayDays: 4, bestMonths: [4, 5, 9, 10], budgetLevel: 2 },
    tags: ["cultural", "foodie", "romantic", "historical"],
    content: {
      tagline: {
        en: "All roads lead to your perfect Roman holiday",
        es: "Todos los caminos llevan a tus vacaciones romanas perfectas",
        it: "Tutte le strade portano alla tua vacanza romana perfetta",
      },
      description: {
        en: "Walk through 2,000 years of history from the Colosseum to the Vatican, then refuel with the world's best pasta and gelato. Our AI builds itineraries that balance ancient wonders with Rome's vibrant modern life.",
        es: "Camina a través de 2.000 años de historia desde el Coliseo hasta el Vaticano, y recarga energías con la mejor pasta y gelato del mundo. Nuestra IA construye itinerarios que equilibran maravillas antiguas con la vibrante vida moderna de Roma.",
        it: "Cammina attraverso 2.000 anni di storia dal Colosseo al Vaticano, poi rifocillati con la migliore pasta e gelato del mondo. La nostra IA costruisce itinerari che bilanciano meraviglie antiche con la vibrante vita moderna di Roma.",
      },
      highlights: [
        {
          icon: "🏛️",
          title: {
            en: "Ancient Wonders",
            es: "Maravillas Antiguas",
            it: "Meraviglie Antiche",
          },
          description: {
            en: "Colosseum, Roman Forum, and Pantheon — timed to beat the queues",
            es: "Coliseo, Foro Romano y Panteón — programados para evitar colas",
            it: "Colosseo, Foro Romano e Pantheon — programmati per evitare le code",
          },
        },
        {
          icon: "🍝",
          title: {
            en: "Authentic Roman Cuisine",
            es: "Cocina Romana Auténtica",
            it: "Cucina Romana Autentica",
          },
          description: {
            en: "Cacio e pepe in Trastevere, supplì at the market, gelato by the Trevi Fountain",
            es: "Cacio e pepe en Trastevere, supplì en el mercado, gelato junto a la Fontana di Trevi",
            it: "Cacio e pepe a Trastevere, supplì al mercato, gelato alla Fontana di Trevi",
          },
        },
        {
          icon: "⛪",
          title: {
            en: "Vatican & Sacred Sites",
            es: "Vaticano y Sitios Sagrados",
            it: "Vaticano e Siti Sacri",
          },
          description: {
            en: "St. Peter's Basilica, Sistine Chapel, and hundreds of churches with free masterpieces",
            es: "Basílica de San Pedro, Capilla Sixtina y cientos de iglesias con obras maestras gratuitas",
            it: "Basilica di San Pietro, Cappella Sistina e centinaia di chiese con capolavori gratuiti",
          },
        },
      ],
      sampleDay: {
        activities: [
          {
            time: "08:00",
            type: "breakfast",
            title: {
              en: "Cornetto and cappuccino at a Roman bar",
              es: "Cornetto y cappuccino en un bar romano",
              it: "Cornetto e cappuccino al bar",
            },
            description: {
              en: "Start the day like a local with a standing breakfast",
              es: "Empieza el día como un local con un desayuno de pie",
              it: "Inizia la giornata come un locale con una colazione al banco",
            },
          },
          {
            time: "09:00",
            type: "sightseeing",
            title: {
              en: "Colosseum & Roman Forum",
              es: "Coliseo y Foro Romano",
              it: "Colosseo e Foro Romano",
            },
            description: {
              en: "Early entry to beat the crowds at Rome's ancient heart",
              es: "Entrada temprana para evitar multitudes en el corazón antiguo de Roma",
              it: "Ingresso anticipato per evitare la folla nel cuore antico di Roma",
            },
          },
          {
            time: "12:30",
            type: "lunch",
            title: {
              en: "Lunch in Trastevere",
              es: "Almuerzo en Trastevere",
              it: "Pranzo a Trastevere",
            },
            description: {
              en: "Traditional Roman trattoria with handmade pasta",
              es: "Trattoria romana tradicional con pasta hecha a mano",
              it: "Trattoria romana tradizionale con pasta fatta a mano",
            },
          },
          {
            time: "14:30",
            type: "sightseeing",
            title: {
              en: "Trevi Fountain & Spanish Steps",
              es: "Fontana di Trevi y Escalinata de España",
              it: "Fontana di Trevi e Scalinata di Trinità dei Monti",
            },
            description: {
              en: "Walk through the historic center's most photogenic spots",
              es: "Paseo por los lugares más fotogénicos del centro histórico",
              it: "Passeggiata nei punti più fotogenici del centro storico",
            },
          },
          {
            time: "16:30",
            type: "museum",
            title: {
              en: "Pantheon & Piazza Navona",
              es: "Panteón y Piazza Navona",
              it: "Pantheon e Piazza Navona",
            },
            description: {
              en: "Marvel at the ancient dome, then enjoy an aperitivo in the piazza",
              es: "Admira la cúpula antigua, luego disfruta un aperitivo en la piazza",
              it: "Ammira la cupola antica, poi goditi un aperitivo in piazza",
            },
          },
          {
            time: "20:00",
            type: "dinner",
            title: {
              en: "Dinner near Campo de' Fiori",
              es: "Cena cerca de Campo de' Fiori",
              it: "Cena vicino a Campo de' Fiori",
            },
            description: {
              en: "Roman specialties as the piazza comes alive at night",
              es: "Especialidades romanas mientras la piazza cobra vida por la noche",
              it: "Specialità romane mentre la piazza si anima di sera",
            },
          },
        ],
      },
      faqs: [
        {
          question: {
            en: "How many days do I need in Rome?",
            es: "¿Cuántos días necesito en Roma?",
            it: "Quanti giorni servono a Roma?",
          },
          answer: {
            en: "3-4 days covers the essentials: the Colosseum, Vatican, historic center, and Trastevere. Add a 5th day for day trips to Tivoli or the Appian Way. Our AI optimizes routing so you see more in less time.",
            es: "3-4 días cubren lo esencial: el Coliseo, el Vaticano, el centro histórico y Trastevere. Añade un 5to día para excursiones a Tívoli o la Vía Apia. Nuestra IA optimiza las rutas para que veas más en menos tiempo.",
            it: "3-4 giorni coprono l'essenziale: il Colosseo, il Vaticano, il centro storico e Trastevere. Aggiungi un 5° giorno per gite a Tivoli o la Via Appia. La nostra IA ottimizza i percorsi per farti vedere di più in meno tempo.",
          },
        },
        {
          question: {
            en: "What is the best time to visit Rome?",
            es: "¿Cuál es la mejor época para visitar Roma?",
            it: "Qual è il periodo migliore per visitare Roma?",
          },
          answer: {
            en: "April-May and September-October offer mild weather (18-25°C), thinner crowds, and great light for photos. Summer is hot (35°C+) but has long days. Winter is quiet with short lines but some outdoor sites close earlier.",
            es: "Abril-mayo y septiembre-octubre ofrecen clima suave (18-25°C), menos multitudes y gran luz para fotos. El verano es caluroso (35°C+) pero tiene días largos. El invierno es tranquilo con filas cortas.",
            it: "Aprile-maggio e settembre-ottobre offrono clima mite (18-25°C), meno folla e ottima luce per le foto. L'estate è calda (35°C+) ma ha giornate lunghe. L'inverno è tranquillo con file corte.",
          },
        },
        {
          question: {
            en: "Do I need to book tickets in advance for Rome attractions?",
            es: "¿Necesito reservar entradas con antelación para las atracciones de Roma?",
            it: "Devo prenotare i biglietti in anticipo per le attrazioni di Roma?",
          },
          answer: {
            en: "Yes, for the Colosseum and Vatican Museums, advance booking is essential (often sold out days ahead). The Pantheon now requires free timed reservations. Our itinerary reminds you what to book and when.",
            es: "Sí, para el Coliseo y los Museos Vaticanos, la reserva anticipada es esencial (a menudo agotados con días de antelación). El Panteón ahora requiere reservas gratuitas con horario. Nuestro itinerario te recuerda qué reservar y cuándo.",
            it: "Sì, per il Colosseo e i Musei Vaticani, la prenotazione anticipata è essenziale (spesso esauriti con giorni di anticipo). Il Pantheon ora richiede prenotazioni gratuite con orario. Il nostro itinerario ti ricorda cosa prenotare e quando.",
          },
        },
      ],
      ctaText: {
        en: "Ready to explore Rome?",
        es: "¿Listo para explorar Roma?",
        it: "Pronto per esplorare Roma?",
      },
    },
  },

  // =========================================================================
  // BARCELONA
  // =========================================================================
  {
    slug: "barcelona",
    name: { en: "Barcelona", es: "Barcelona", it: "Barcellona" },
    country: { en: "Spain", es: "España", it: "Spagna" },
    countryCode: "ES",
    continent: "europe",
    coordinates: { lat: 41.3874, lng: 2.1686 },
    stats: { avgStayDays: 4, bestMonths: [5, 6, 9, 10], budgetLevel: 2 },
    tags: ["cultural", "foodie", "urban", "beach"],
    content: {
      tagline: {
        en: "Gaudí, tapas, and Mediterranean vibes in one itinerary",
        es: "Gaudí, tapas y vibraciones mediterráneas en un itinerario",
        it: "Gaudí, tapas e vibrazioni mediterranee in un itinerario",
      },
      description: {
        en: "Barcelona blends Gaudí's surreal architecture, world-class beaches, and some of Europe's best food into a city you'll never want to leave. Our AI plans around opening times, siesta hours, and late Spanish dinners.",
        es: "Barcelona fusiona la arquitectura surrealista de Gaudí, playas de clase mundial y algo de la mejor comida de Europa en una ciudad que nunca querrás dejar. Nuestra IA planifica según horarios de apertura, siestas y cenas españolas tardías.",
        it: "Barcellona fonde l'architettura surreale di Gaudí, spiagge di classe mondiale e parte del miglior cibo d'Europa in una città che non vorrai mai lasciare. La nostra IA pianifica in base agli orari di apertura, alla siesta e alle cene spagnole tardive.",
      },
      highlights: [
        {
          icon: "⛪",
          title: {
            en: "Gaudí's Masterpieces",
            es: "Obras Maestras de Gaudí",
            it: "Capolavori di Gaudí",
          },
          description: {
            en: "Sagrada Família, Park Güell, Casa Batlló — timed tickets and optimal visit order",
            es: "Sagrada Família, Park Güell, Casa Batlló — entradas con horario y orden óptimo de visita",
            it: "Sagrada Família, Park Güell, Casa Batlló — biglietti con orario e ordine di visita ottimale",
          },
        },
        {
          icon: "🏖️",
          title: {
            en: "Beach & City Combined",
            es: "Playa y Ciudad Combinadas",
            it: "Spiaggia e Città Insieme",
          },
          description: {
            en: "Morning at Barceloneta beach, afternoon exploring Gothic Quarter — the best of both worlds",
            es: "Mañana en la playa de la Barceloneta, tarde explorando el Barrio Gótico — lo mejor de ambos mundos",
            it: "Mattina alla spiaggia della Barceloneta, pomeriggio esplorando il Quartiere Gotico — il meglio di entrambi",
          },
        },
        {
          icon: "🍷",
          title: {
            en: "Tapas & Wine Culture",
            es: "Cultura de Tapas y Vino",
            it: "Cultura delle Tapas e del Vino",
          },
          description: {
            en: "From La Boqueria market to pintxos bars in El Born — a foodie's paradise",
            es: "Del mercado de La Boqueria a bares de pintxos en El Born — un paraíso para foodies",
            it: "Dal mercato della Boqueria ai bar di pintxos a El Born — un paradiso per i foodie",
          },
        },
      ],
      sampleDay: {
        activities: [
          {
            time: "09:00",
            type: "breakfast",
            title: {
              en: "Breakfast at La Boqueria Market",
              es: "Desayuno en el Mercado de La Boqueria",
              it: "Colazione al Mercato della Boqueria",
            },
            description: {
              en: "Fresh juice, jamón ibérico, and people-watching on Las Ramblas",
              es: "Zumo fresco, jamón ibérico y observar gente en Las Ramblas",
              it: "Succo fresco, jamón ibérico e osservare la gente sulle Ramblas",
            },
          },
          {
            time: "10:30",
            type: "sightseeing",
            title: {
              en: "Sagrada Família",
              es: "Sagrada Família",
              it: "Sagrada Família",
            },
            description: {
              en: "Gaudí's unfinished masterpiece — morning light through stained glass is magical",
              es: "La obra maestra inacabada de Gaudí — la luz matutina a través de los vitrales es mágica",
              it: "Il capolavoro incompiuto di Gaudí — la luce mattutina attraverso le vetrate è magica",
            },
          },
          {
            time: "13:00",
            type: "lunch",
            title: {
              en: "Tapas lunch in El Born",
              es: "Almuerzo de tapas en El Born",
              it: "Pranzo a base di tapas a El Born",
            },
            description: {
              en: "Patatas bravas, croquetas, and a glass of cava",
              es: "Patatas bravas, croquetas y una copa de cava",
              it: "Patatas bravas, croquetas e un bicchiere di cava",
            },
          },
          {
            time: "15:00",
            type: "walk",
            title: {
              en: "Gothic Quarter exploration",
              es: "Exploración del Barrio Gótico",
              it: "Esplorazione del Quartiere Gotico",
            },
            description: {
              en: "Medieval streets, hidden plazas, and the Barcelona Cathedral",
              es: "Calles medievales, plazas escondidas y la Catedral de Barcelona",
              it: "Strade medievali, piazze nascoste e la Cattedrale di Barcellona",
            },
          },
          {
            time: "17:00",
            type: "activity",
            title: {
              en: "Barceloneta Beach",
              es: "Playa de la Barceloneta",
              it: "Spiaggia della Barceloneta",
            },
            description: {
              en: "Relax on the sand or stroll the waterfront promenade",
              es: "Relájate en la arena o pasea por el paseo marítimo",
              it: "Rilassati sulla sabbia o passeggia sul lungomare",
            },
          },
          {
            time: "21:00",
            type: "dinner",
            title: {
              en: "Seafood dinner in Barceloneta",
              es: "Cena de mariscos en la Barceloneta",
              it: "Cena di pesce alla Barceloneta",
            },
            description: {
              en: "Fresh paella with a sea breeze — dinner starts late in Spain",
              es: "Paella fresca con brisa marina — la cena empieza tarde en España",
              it: "Paella fresca con brezza marina — la cena inizia tardi in Spagna",
            },
          },
        ],
      },
      faqs: [
        {
          question: {
            en: "How many days do I need in Barcelona?",
            es: "¿Cuántos días necesito en Barcelona?",
            it: "Quanti giorni servono a Barcellona?",
          },
          answer: {
            en: "3-5 days is perfect. You need at least 3 days for Gaudí sites, the Gothic Quarter, and beach time. Add days 4-5 for Montjuïc, day trips to Montserrat, or deeper food exploration.",
            es: "3-5 días es perfecto. Necesitas al menos 3 días para los sitios de Gaudí, el Barrio Gótico y tiempo de playa. Añade los días 4-5 para Montjuïc, excursiones a Montserrat o exploración gastronómica.",
            it: "3-5 giorni sono perfetti. Servono almeno 3 giorni per i siti di Gaudí, il Quartiere Gotico e il tempo in spiaggia. Aggiungi i giorni 4-5 per Montjuïc, gite a Montserrat o esplorazione gastronomica.",
          },
        },
        {
          question: {
            en: "Do I need to book Sagrada Família tickets in advance?",
            es: "¿Necesito reservar entradas para la Sagrada Família con antelación?",
            it: "Devo prenotare i biglietti per la Sagrada Família in anticipo?",
          },
          answer: {
            en: "Absolutely — Sagrada Família sells out days in advance, especially in summer. Book online 2-3 weeks ahead. Same goes for Park Güell and Casa Batlló. Our itinerary includes booking reminders.",
            es: "Absolutamente — la Sagrada Família se agota con días de antelación, especialmente en verano. Reserva online 2-3 semanas antes. Lo mismo para Park Güell y Casa Batlló. Nuestro itinerario incluye recordatorios de reserva.",
            it: "Assolutamente — la Sagrada Família si esaurisce con giorni di anticipo, specialmente in estate. Prenota online 2-3 settimane prima. Lo stesso per Park Güell e Casa Batlló. Il nostro itinerario include promemoria di prenotazione.",
          },
        },
        {
          question: {
            en: "Is Barcelona safe for tourists?",
            es: "¿Es Barcelona segura para turistas?",
            it: "Barcellona è sicura per i turisti?",
          },
          answer: {
            en: "Barcelona is generally very safe. The main concern is pickpocketing on Las Ramblas and in crowded tourist areas. Keep valuables in front pockets, use hotel safes, and you'll be fine. Our AI avoids sketchy areas at night.",
            es: "Barcelona es generalmente muy segura. La principal preocupación son los carteristas en Las Ramblas y zonas turísticas concurridas. Mantén los objetos de valor en bolsillos delanteros, usa cajas fuertes del hotel y estarás bien.",
            it: "Barcellona è generalmente molto sicura. La principale preoccupazione sono i borseggiatori sulle Ramblas e nelle aree turistiche affollate. Tieni gli oggetti di valore nelle tasche anteriori, usa le cassaforti dell'hotel e starai bene.",
          },
        },
      ],
      ctaText: {
        en: "Ready to explore Barcelona?",
        es: "¿Listo para explorar Barcelona?",
        it: "Pronto per esplorare Barcellona?",
      },
    },
  },

  // =========================================================================
  // TOKYO
  // =========================================================================
  {
    slug: "tokyo",
    name: { en: "Tokyo", es: "Tokio", it: "Tokyo" },
    country: { en: "Japan", es: "Japón", it: "Giappone" },
    countryCode: "JP",
    continent: "asia",
    coordinates: { lat: 35.6762, lng: 139.6503 },
    stats: { avgStayDays: 5, bestMonths: [3, 4, 10, 11], budgetLevel: 3 },
    tags: ["cultural", "foodie", "urban", "offbeat"],
    content: {
      tagline: {
        en: "Where ancient temples meet neon-lit streets",
        es: "Donde templos antiguos se encuentran con calles iluminadas de neón",
        it: "Dove templi antichi incontrano strade illuminate al neon",
      },
      description: {
        en: "Tokyo is a city of contrasts — serene shrines next to electric Shibuya, Michelin-starred sushi beside ¥500 ramen. Our AI navigates the world's largest metro system to create seamless day plans across this extraordinary city.",
        es: "Tokio es una ciudad de contrastes — santuarios serenos junto al eléctrico Shibuya, sushi con estrella Michelin junto a ramen de ¥500. Nuestra IA navega el sistema de metro más grande del mundo para crear planes diarios fluidos.",
        it: "Tokyo è una città di contrasti — santuari sereni accanto all'elettrica Shibuya, sushi stellato Michelin accanto a ramen da ¥500. La nostra IA naviga la più grande metropolitana del mondo per creare piani giornalieri fluidi.",
      },
      highlights: [
        {
          icon: "⛩️",
          title: {
            en: "Temples & Tradition",
            es: "Templos y Tradición",
            it: "Templi e Tradizione",
          },
          description: {
            en: "Senso-ji, Meiji Shrine, and traditional tea ceremonies — peaceful moments in the urban rush",
            es: "Senso-ji, Santuario Meiji y ceremonias del té — momentos de paz en la prisa urbana",
            it: "Senso-ji, Santuario Meiji e cerimonie del tè — momenti di pace nella frenesia urbana",
          },
        },
        {
          icon: "🍣",
          title: {
            en: "Food Capital of the World",
            es: "Capital Gastronómica del Mundo",
            it: "Capitale Gastronomica del Mondo",
          },
          description: {
            en: "More Michelin stars than any city — from $10 ramen to omakase experiences of a lifetime",
            es: "Más estrellas Michelin que cualquier ciudad — desde ramen de $10 hasta experiencias omakase únicas",
            it: "Più stelle Michelin di qualsiasi città — dal ramen da $10 a esperienze omakase uniche",
          },
        },
        {
          icon: "🌸",
          title: {
            en: "Pop Culture & Innovation",
            es: "Cultura Pop e Innovación",
            it: "Cultura Pop e Innovazione",
          },
          description: {
            en: "Akihabara's anime shops, Harajuku's fashion, and robot restaurants — the future is now",
            es: "Tiendas de anime en Akihabara, moda en Harajuku y restaurantes de robots — el futuro es ahora",
            it: "Negozi di anime ad Akihabara, moda a Harajuku e ristoranti di robot — il futuro è adesso",
          },
        },
        {
          icon: "🏙️",
          title: {
            en: "Vibrant Neighborhoods",
            es: "Barrios Vibrantes",
            it: "Quartieri Vibranti",
          },
          description: {
            en: "Each area has its own personality — trendy Shimokitazawa, luxe Ginza, electric Shinjuku",
            es: "Cada zona tiene su propia personalidad — el trendy Shimokitazawa, el lujoso Ginza, el eléctrico Shinjuku",
            it: "Ogni zona ha la sua personalità — la trendy Shimokitazawa, la lussuosa Ginza, l'elettrica Shinjuku",
          },
        },
      ],
      sampleDay: {
        activities: [
          {
            time: "07:30",
            type: "sightseeing",
            title: {
              en: "Tsukiji Outer Market breakfast",
              es: "Desayuno en el Mercado Exterior de Tsukiji",
              it: "Colazione al Mercato Esterno di Tsukiji",
            },
            description: {
              en: "Fresh sushi, tamagoyaki, and matcha at the famous fish market",
              es: "Sushi fresco, tamagoyaki y matcha en el famoso mercado de pescado",
              it: "Sushi fresco, tamagoyaki e matcha al famoso mercato del pesce",
            },
          },
          {
            time: "09:30",
            type: "sightseeing",
            title: {
              en: "Senso-ji Temple in Asakusa",
              es: "Templo Senso-ji en Asakusa",
              it: "Tempio Senso-ji ad Asakusa",
            },
            description: {
              en: "Tokyo's oldest temple and the vibrant Nakamise shopping street",
              es: "El templo más antiguo de Tokio y la vibrante calle comercial Nakamise",
              it: "Il tempio più antico di Tokyo e la vivace via commerciale Nakamise",
            },
          },
          {
            time: "12:00",
            type: "lunch",
            title: {
              en: "Ramen in Shinjuku",
              es: "Ramen en Shinjuku",
              it: "Ramen a Shinjuku",
            },
            description: {
              en: "Legendary tonkotsu ramen from a vending-machine-order shop",
              es: "Ramen tonkotsu legendario pedido por máquina expendedora",
              it: "Leggendario ramen tonkotsu ordinato tramite distributore automatico",
            },
          },
          {
            time: "14:00",
            type: "walk",
            title: {
              en: "Harajuku & Meiji Shrine",
              es: "Harajuku y Santuario Meiji",
              it: "Harajuku e Santuario Meiji",
            },
            description: {
              en: "From serene forest shrine to Takeshita Street's colorful chaos",
              es: "Del sereno santuario en el bosque al colorido caos de la calle Takeshita",
              it: "Dal sereno santuario nella foresta al colorato caos di Takeshita Street",
            },
          },
          {
            time: "17:00",
            type: "sightseeing",
            title: {
              en: "Shibuya Crossing at rush hour",
              es: "Cruce de Shibuya en hora punta",
              it: "Incrocio di Shibuya nell'ora di punta",
            },
            description: {
              en: "Watch the world's busiest intersection from Shibuya Sky or a café above",
              es: "Observa la intersección más transitada del mundo desde Shibuya Sky o un café",
              it: "Osserva l'incrocio più trafficato del mondo da Shibuya Sky o un caffè",
            },
          },
          {
            time: "19:30",
            type: "dinner",
            title: {
              en: "Izakaya dinner in Yurakucho",
              es: "Cena en izakaya en Yurakucho",
              it: "Cena in izakaya a Yurakucho",
            },
            description: {
              en: "Yakitori and highballs under the train tracks — a true Tokyo experience",
              es: "Yakitori y highballs bajo las vías del tren — una verdadera experiencia tokiota",
              it: "Yakitori e highball sotto i binari del treno — una vera esperienza di Tokyo",
            },
          },
        ],
      },
      faqs: [
        {
          question: {
            en: "How many days do I need in Tokyo?",
            es: "¿Cuántos días necesito en Tokio?",
            it: "Quanti giorni servono a Tokyo?",
          },
          answer: {
            en: "5-7 days lets you explore Tokyo properly. The city is enormous with dozens of unique neighborhoods. 5 days covers the highlights; 7 days lets you add day trips to Hakone, Kamakura, or Nikko.",
            es: "5-7 días te permiten explorar Tokio correctamente. La ciudad es enorme con docenas de barrios únicos. 5 días cubren los highlights; 7 días permiten añadir excursiones a Hakone, Kamakura o Nikko.",
            it: "5-7 giorni permettono di esplorare Tokyo adeguatamente. La città è enorme con dozzine di quartieri unici. 5 giorni coprono i punti salienti; 7 giorni permettono gite a Hakone, Kamakura o Nikko.",
          },
        },
        {
          question: {
            en: "Is Tokyo expensive to visit?",
            es: "¿Es caro visitar Tokio?",
            it: "Tokyo è cara da visitare?",
          },
          answer: {
            en: "Tokyo can be surprisingly affordable. Incredible ramen costs $8-12, convenience store food is excellent, and many shrines/temples are free. Budget $80-150/day is doable. Our AI offers Budget, Balanced, and Premium options.",
            es: "Tokio puede ser sorprendentemente asequible. Un increíble ramen cuesta $8-12, la comida de tiendas de conveniencia es excelente y muchos santuarios/templos son gratuitos. Un presupuesto de $80-150/día es factible.",
            it: "Tokyo può essere sorprendentemente accessibile. Un incredibile ramen costa $8-12, il cibo dei convenience store è eccellente e molti santuari/templi sono gratuiti. Un budget di $80-150/giorno è fattibile.",
          },
        },
        {
          question: {
            en: "Do I need to speak Japanese to visit Tokyo?",
            es: "¿Necesito hablar japonés para visitar Tokio?",
            it: "Devo parlare giapponese per visitare Tokyo?",
          },
          answer: {
            en: "No! Tokyo is very tourist-friendly. Signs in train stations are in English, Google Translate works great for menus, and locals are incredibly helpful. Our itinerary includes useful Japanese phrases for each situation.",
            es: "¡No! Tokio es muy amigable para turistas. Las señales en las estaciones de tren están en inglés, Google Translate funciona genial para menús y los locales son increíblemente serviciales.",
            it: "No! Tokyo è molto turista-friendly. I cartelli nelle stazioni sono in inglese, Google Translate funziona benissimo per i menu e i locali sono incredibilmente disponibili.",
          },
        },
      ],
      ctaText: {
        en: "Ready to explore Tokyo?",
        es: "¿Listo para explorar Tokio?",
        it: "Pronto per esplorare Tokyo?",
      },
    },
  },

  // =========================================================================
  // NEW YORK
  // =========================================================================
  {
    slug: "new-york",
    name: { en: "New York", es: "Nueva York", it: "New York" },
    country: {
      en: "United States",
      es: "Estados Unidos",
      it: "Stati Uniti",
    },
    countryCode: "US",
    continent: "americas",
    coordinates: { lat: 40.7128, lng: -74.006 },
    stats: { avgStayDays: 5, bestMonths: [4, 5, 9, 10, 12], budgetLevel: 3 },
    tags: ["urban", "cultural", "foodie", "nightlife"],
    content: {
      tagline: {
        en: "The city that never sleeps, planned to perfection",
        es: "La ciudad que nunca duerme, planificada a la perfección",
        it: "La città che non dorme mai, pianificata alla perfezione",
      },
      description: {
        en: "From Central Park to Brooklyn's food scene, Broadway to hidden speakeasies — NYC packs more into one block than most cities have total. Our AI helps you navigate the five boroughs without missing a beat.",
        es: "Desde Central Park hasta la escena gastronómica de Brooklyn, de Broadway a speakeasies ocultos — NYC concentra más en una manzana que la mayoría de ciudades en total. Nuestra IA te ayuda a navegar los cinco distritos sin perderte nada.",
        it: "Da Central Park alla scena gastronomica di Brooklyn, da Broadway agli speakeasy nascosti — NYC concentra più in un isolato di quanto la maggior parte delle città abbiano in totale. La nostra IA ti aiuta a navigare i cinque distretti senza perdere un colpo.",
      },
      highlights: [
        {
          icon: "🗽",
          title: {
            en: "Iconic Landmarks",
            es: "Monumentos Icónicos",
            it: "Monumenti Iconici",
          },
          description: {
            en: "Statue of Liberty, Empire State, Times Square, Brooklyn Bridge — see them all without the tourist traps",
            es: "Estatua de la Libertad, Empire State, Times Square, Puente de Brooklyn — véelos todos sin trampas turísticas",
            it: "Statua della Libertà, Empire State, Times Square, Ponte di Brooklyn — vedili tutti senza trappole per turisti",
          },
        },
        {
          icon: "🎭",
          title: {
            en: "Arts & Entertainment",
            es: "Arte y Entretenimiento",
            it: "Arte e Intrattenimento",
          },
          description: {
            en: "Broadway shows, MoMA, Met Museum, and live music every night of the week",
            es: "Espectáculos de Broadway, MoMA, Met Museum y música en vivo todas las noches",
            it: "Spettacoli di Broadway, MoMA, Met Museum e musica dal vivo ogni sera della settimana",
          },
        },
        {
          icon: "🌮",
          title: {
            en: "World's Best Food Scene",
            es: "La Mejor Escena Gastronómica del Mundo",
            it: "La Migliore Scena Gastronomica del Mondo",
          },
          description: {
            en: "Pizza, bagels, dim sum, tacos — every cuisine on Earth is here, from $1 slices to Michelin stars",
            es: "Pizza, bagels, dim sum, tacos — cada cocina del mundo está aquí, desde porciones de $1 hasta estrellas Michelin",
            it: "Pizza, bagel, dim sum, tacos — ogni cucina del mondo è qui, dalle fette da $1 alle stelle Michelin",
          },
        },
      ],
      sampleDay: {
        activities: [
          {
            time: "08:00",
            type: "breakfast",
            title: {
              en: "Bagels on the Upper West Side",
              es: "Bagels en el Upper West Side",
              it: "Bagel nell'Upper West Side",
            },
            description: {
              en: "Classic New York bagel with lox and cream cheese",
              es: "Bagel clásico de Nueva York con salmón ahumado y queso crema",
              it: "Classico bagel newyorkese con salmone affumicato e crema di formaggio",
            },
          },
          {
            time: "09:30",
            type: "walk",
            title: {
              en: "Central Park morning walk",
              es: "Paseo matutino por Central Park",
              it: "Passeggiata mattutina a Central Park",
            },
            description: {
              en: "Bethesda Fountain, Bow Bridge, and Strawberry Fields",
              es: "Fuente Bethesda, Bow Bridge y Strawberry Fields",
              it: "Fontana di Bethesda, Bow Bridge e Strawberry Fields",
            },
          },
          {
            time: "11:30",
            type: "museum",
            title: {
              en: "Metropolitan Museum of Art",
              es: "Museo Metropolitano de Arte",
              it: "Metropolitan Museum of Art",
            },
            description: {
              en: "World-class art collection — the AI highlights must-see rooms for your interests",
              es: "Colección de arte de clase mundial — la IA destaca las salas imperdibles según tus intereses",
              it: "Collezione d'arte di classe mondiale — l'IA evidenzia le sale da non perdere per i tuoi interessi",
            },
          },
          {
            time: "13:30",
            type: "lunch",
            title: {
              en: "Lunch in Chelsea Market",
              es: "Almuerzo en Chelsea Market",
              it: "Pranzo al Chelsea Market",
            },
            description: {
              en: "Dozens of food vendors in a converted factory",
              es: "Docenas de puestos de comida en una fábrica convertida",
              it: "Dozzine di venditori di cibo in una fabbrica riconvertita",
            },
          },
          {
            time: "15:00",
            type: "walk",
            title: {
              en: "High Line to Hudson Yards",
              es: "High Line hasta Hudson Yards",
              it: "High Line fino a Hudson Yards",
            },
            description: {
              en: "Walk the elevated park with street art and skyline views",
              es: "Pasea por el parque elevado con arte callejero y vistas del skyline",
              it: "Passeggia nel parco sopraelevato con street art e viste sullo skyline",
            },
          },
          {
            time: "19:00",
            type: "dinner",
            title: {
              en: "Dinner & drinks in the West Village",
              es: "Cena y tragos en West Village",
              it: "Cena e drink nel West Village",
            },
            description: {
              en: "Farm-to-table dinner followed by a jazz club or speakeasy",
              es: "Cena de la granja a la mesa seguida de un club de jazz o speakeasy",
              it: "Cena farm-to-table seguita da un jazz club o speakeasy",
            },
          },
        ],
      },
      faqs: [
        {
          question: {
            en: "How many days do I need in New York?",
            es: "¿Cuántos días necesito en Nueva York?",
            it: "Quanti giorni servono a New York?",
          },
          answer: {
            en: "4-6 days is ideal. Manhattan's highlights take 3 days, then add time for Brooklyn, a Broadway show, and neighborhood exploring. A week lets you truly feel the city's rhythm.",
            es: "4-6 días es ideal. Los highlights de Manhattan toman 3 días, luego añade tiempo para Brooklyn, un show de Broadway y explorar barrios. Una semana te permite sentir el ritmo de la ciudad.",
            it: "4-6 giorni sono ideali. I punti salienti di Manhattan richiedono 3 giorni, poi aggiungi tempo per Brooklyn, uno spettacolo di Broadway e l'esplorazione dei quartieri. Una settimana ti permette di sentire il ritmo della città.",
          },
        },
        {
          question: {
            en: "What's the best way to get around NYC?",
            es: "¿Cuál es la mejor forma de moverse por NYC?",
            it: "Qual è il modo migliore per spostarsi a NYC?",
          },
          answer: {
            en: "The subway is the fastest and cheapest way ($2.90/ride, unlimited weekly pass $34). Walk when possible — NYC is a great walking city. Our AI plans routes that minimize transfers and maximize walking through interesting areas.",
            es: "El metro es la forma más rápida y barata ($2.90/viaje, pase semanal ilimitado $34). Camina cuando sea posible — NYC es una gran ciudad para caminar. Nuestra IA planifica rutas que minimizan transbordos.",
            it: "La metropolitana è il modo più veloce e economico ($2.90/corsa, pass settimanale illimitato $34). Cammina quando possibile — NYC è una grande città da camminare. La nostra IA pianifica percorsi che minimizzano i trasferimenti.",
          },
        },
        {
          question: {
            en: "Is New York safe for tourists?",
            es: "¿Es Nueva York segura para turistas?",
            it: "New York è sicura per i turisti?",
          },
          answer: {
            en: "NYC is one of the safest large cities in the US. Tourist areas like Midtown, SoHo, and the Village are very safe day and night. Use common sense, stay aware in the subway late at night, and enjoy the city.",
            es: "NYC es una de las grandes ciudades más seguras de EE.UU. Las zonas turísticas como Midtown, SoHo y el Village son muy seguras día y noche. Usa el sentido común y disfruta la ciudad.",
            it: "NYC è una delle grandi città più sicure degli USA. Le zone turistiche come Midtown, SoHo e il Village sono molto sicure giorno e notte. Usa il buon senso e goditi la città.",
          },
        },
      ],
      ctaText: {
        en: "Ready to explore New York?",
        es: "¿Listo para explorar Nueva York?",
        it: "Pronto per esplorare New York?",
      },
    },
  },

  // =========================================================================
  // LONDON
  // =========================================================================
  {
    slug: "london",
    name: { en: "London", es: "Londres", it: "Londra" },
    country: { en: "United Kingdom", es: "Reino Unido", it: "Regno Unito" },
    countryCode: "GB",
    continent: "europe",
    coordinates: { lat: 51.5074, lng: -0.1278 },
    stats: { avgStayDays: 4, bestMonths: [5, 6, 7, 9], budgetLevel: 3 },
    tags: ["cultural", "urban", "historical", "foodie"],
    content: {
      tagline: {
        en: "Royal palaces, world-class museums, and endless charm",
        es: "Palacios reales, museos de clase mundial y encanto infinito",
        it: "Palazzi reali, musei di classe mondiale e fascino infinito",
      },
      description: {
        en: "From the Tower of London to Camden Market, Big Ben to Borough Market — London seamlessly blends centuries of history with cutting-edge culture. Our AI plans around free museums, Oyster card routes, and the best pub stops.",
        es: "Desde la Torre de Londres hasta Camden Market, Big Ben hasta Borough Market — Londres fusiona siglos de historia con cultura de vanguardia. Nuestra IA planifica rutas con museos gratuitos, trayectos en Oyster card y las mejores paradas en pubs.",
        it: "Dalla Torre di Londra a Camden Market, Big Ben a Borough Market — Londra fonde secoli di storia con cultura all'avanguardia. La nostra IA pianifica percorsi con musei gratuiti, tragitti con Oyster card e le migliori soste nei pub.",
      },
      highlights: [
        { icon: "👑", title: { en: "Royal Heritage", es: "Herencia Real", it: "Patrimonio Reale" }, description: { en: "Buckingham Palace, Tower of London, and Westminster Abbey — centuries of royal history", es: "Palacio de Buckingham, Torre de Londres y Abadía de Westminster — siglos de historia real", it: "Buckingham Palace, Torre di Londra e Abbazia di Westminster — secoli di storia reale" } },
        { icon: "🏛️", title: { en: "Free World-Class Museums", es: "Museos Gratuitos de Clase Mundial", it: "Musei Gratuiti di Classe Mondiale" }, description: { en: "British Museum, Tate Modern, Natural History Museum — all free to enter", es: "Museo Británico, Tate Modern, Museo de Historia Natural — todos con entrada gratuita", it: "British Museum, Tate Modern, Museo di Storia Naturale — tutti ad ingresso gratuito" } },
        { icon: "🎭", title: { en: "West End & Nightlife", es: "West End y Vida Nocturna", it: "West End e Vita Notturna" }, description: { en: "World-famous theatre, live music, and vibrant nightlife across the city", es: "Teatro de fama mundial, música en vivo y vibrante vida nocturna por toda la ciudad", it: "Teatro di fama mondiale, musica dal vivo e vibrante vita notturna in tutta la città" } },
      ],
      sampleDay: {
        activities: [
          { time: "09:00", type: "sightseeing", title: { en: "Westminster & Big Ben", es: "Westminster y Big Ben", it: "Westminster e Big Ben" }, description: { en: "Walk past the Houses of Parliament and Westminster Abbey", es: "Paseo junto a las Casas del Parlamento y la Abadía de Westminster", it: "Passeggiata davanti alle Houses of Parliament e l'Abbazia di Westminster" } },
          { time: "10:30", type: "sightseeing", title: { en: "Buckingham Palace", es: "Palacio de Buckingham", it: "Buckingham Palace" }, description: { en: "Catch the Changing of the Guard ceremony", es: "Presencia el Cambio de Guardia", it: "Assisti al Cambio della Guardia" } },
          { time: "12:30", type: "lunch", title: { en: "Borough Market lunch", es: "Almuerzo en Borough Market", it: "Pranzo al Borough Market" }, description: { en: "London's oldest food market with stalls from around the world", es: "El mercado de comida más antiguo de Londres con puestos de todo el mundo", it: "Il mercato alimentare più antico di Londra con bancarelle da tutto il mondo" } },
          { time: "14:00", type: "museum", title: { en: "Tate Modern", es: "Tate Modern", it: "Tate Modern" }, description: { en: "Free contemporary art in a converted power station", es: "Arte contemporáneo gratuito en una central eléctrica convertida", it: "Arte contemporanea gratuita in una centrale elettrica riconvertita" } },
          { time: "16:30", type: "walk", title: { en: "South Bank to Tower Bridge", es: "South Bank hasta Tower Bridge", it: "South Bank fino a Tower Bridge" }, description: { en: "Riverside walk with views of the city skyline", es: "Paseo junto al río con vistas del skyline de la ciudad", it: "Passeggiata lungo il fiume con viste sullo skyline della città" } },
          { time: "19:30", type: "dinner", title: { en: "Dinner in Soho", es: "Cena en Soho", it: "Cena a Soho" }, description: { en: "Diverse dining scene from Chinatown to modern British", es: "Escena gastronómica diversa desde Chinatown hasta cocina británica moderna", it: "Scena gastronomica diversificata da Chinatown alla cucina britannica moderna" } },
        ],
      },
      faqs: [
        { question: { en: "How many days do I need in London?", es: "¿Cuántos días necesito en Londres?", it: "Quanti giorni servono a Londra?" }, answer: { en: "4-5 days covers the main sights comfortably. London has so much to offer that a week lets you explore neighborhoods like Notting Hill, Camden, and Greenwich in depth.", es: "4-5 días cubren las principales atracciones cómodamente. Londres tiene tanto que ofrecer que una semana te permite explorar barrios como Notting Hill, Camden y Greenwich.", it: "4-5 giorni coprono le principali attrazioni comodamente. Londra ha così tanto da offrire che una settimana permette di esplorare quartieri come Notting Hill, Camden e Greenwich." } },
        { question: { en: "Is London expensive?", es: "¿Es Londres cara?", it: "Londra è cara?" }, answer: { en: "London can be pricey, but most major museums are free. Use an Oyster card for transport ($8/day cap), eat at markets and pubs, and budget $100-180/day comfortably.", es: "Londres puede ser cara, pero la mayoría de los museos principales son gratuitos. Usa una Oyster card para transporte (límite de $8/día), come en mercados y pubs.", it: "Londra può essere costosa, ma la maggior parte dei musei principali è gratuita. Usa una Oyster card per i trasporti (limite di $8/giorno), mangia ai mercati e nei pub." } },
        { question: { en: "What's the best way to get around London?", es: "¿Cuál es la mejor forma de moverse por Londres?", it: "Qual è il modo migliore per spostarsi a Londra?" }, answer: { en: "The Tube (Underground) and buses are excellent. Get an Oyster card or use contactless payment. Walking is great in central London. Our AI plans routes that minimize transfers.", es: "El metro y los autobuses son excelentes. Consigue una Oyster card o usa pago contactless. Caminar es genial en el centro de Londres.", it: "La metropolitana e gli autobus sono eccellenti. Prendi una Oyster card o usa il pagamento contactless. Camminare è ottimo nel centro di Londra." } },
      ],
      ctaText: { en: "Ready to explore London?", es: "¿Listo para explorar Londres?", it: "Pronto per esplorare Londra?" },
    },
  },

  // =========================================================================
  // AMSTERDAM
  // =========================================================================
  {
    slug: "amsterdam",
    name: { en: "Amsterdam", es: "Ámsterdam", it: "Amsterdam" },
    country: { en: "Netherlands", es: "Países Bajos", it: "Paesi Bassi" },
    countryCode: "NL",
    continent: "europe",
    coordinates: { lat: 52.3676, lng: 4.9041 },
    stats: { avgStayDays: 3, bestMonths: [4, 5, 6, 9], budgetLevel: 2 },
    tags: ["cultural", "urban", "romantic", "offbeat"],
    content: {
      tagline: {
        en: "Canals, culture, and cozy cafés — pure Dutch charm",
        es: "Canales, cultura y cafés acogedores — puro encanto holandés",
        it: "Canali, cultura e caffè accoglienti — puro fascino olandese",
      },
      description: {
        en: "Amsterdam's canal ring, world-class art museums, and bike-friendly streets make it one of Europe's most lovable cities. Our AI plans cycling routes, museum visits timed to skip lines, and the best brown cafés.",
        es: "Los canales de Ámsterdam, museos de arte de clase mundial y calles amigables para bicicletas la convierten en una de las ciudades más encantadoras de Europa.",
        it: "I canali di Amsterdam, i musei d'arte di classe mondiale e le strade bike-friendly la rendono una delle città più amabili d'Europa.",
      },
      highlights: [
        { icon: "🎨", title: { en: "Art & Museums", es: "Arte y Museos", it: "Arte e Musei" }, description: { en: "Rijksmuseum, Van Gogh Museum, and Anne Frank House — book ahead for skip-the-line access", es: "Rijksmuseum, Museo Van Gogh y Casa de Ana Frank — reserva con antelación", it: "Rijksmuseum, Museo Van Gogh e Casa di Anna Frank — prenota in anticipo" } },
        { icon: "🚲", title: { en: "Bike-Friendly City", es: "Ciudad para Bicicletas", it: "Città per Biciclette" }, description: { en: "Rent a bike and explore like a local — the best way to see Amsterdam's neighborhoods", es: "Alquila una bicicleta y explora como un local — la mejor forma de ver los barrios de Ámsterdam", it: "Noleggia una bici ed esplora come un locale — il modo migliore per vedere i quartieri di Amsterdam" } },
        { icon: "🏘️", title: { en: "Canal District", es: "Distrito de los Canales", it: "Quartiere dei Canali" }, description: { en: "UNESCO-listed canal ring with charming houseboats, bridges, and waterside terraces", es: "Anillo de canales patrimonio UNESCO con encantadoras casas flotantes, puentes y terrazas junto al agua", it: "Anello di canali patrimonio UNESCO con affascinanti houseboat, ponti e terrazze sull'acqua" } },
      ],
      sampleDay: {
        activities: [
          { time: "09:00", type: "museum", title: { en: "Anne Frank House", es: "Casa de Ana Frank", it: "Casa di Anna Frank" }, description: { en: "Powerful history in the heart of the canal district", es: "Historia poderosa en el corazón del distrito de canales", it: "Storia potente nel cuore del quartiere dei canali" } },
          { time: "11:00", type: "walk", title: { en: "Jordaan neighborhood stroll", es: "Paseo por el barrio Jordaan", it: "Passeggiata nel quartiere Jordaan" }, description: { en: "Boutique shops, art galleries, and cozy cafés", es: "Tiendas boutique, galerías de arte y cafés acogedores", it: "Negozi boutique, gallerie d'arte e caffè accoglienti" } },
          { time: "13:00", type: "lunch", title: { en: "Lunch at Foodhallen", es: "Almuerzo en Foodhallen", it: "Pranzo al Foodhallen" }, description: { en: "Amsterdam's indoor food market with diverse cuisines", es: "El mercado de comida cubierto de Ámsterdam con cocinas diversas", it: "Il mercato alimentare coperto di Amsterdam con cucine diverse" } },
          { time: "14:30", type: "museum", title: { en: "Rijksmuseum", es: "Rijksmuseum", it: "Rijksmuseum" }, description: { en: "Dutch Golden Age masterpieces including Rembrandt's Night Watch", es: "Obras maestras de la Edad de Oro holandesa incluyendo la Ronda de Noche de Rembrandt", it: "Capolavori dell'Età dell'Oro olandese inclusa la Ronda di Notte di Rembrandt" } },
          { time: "17:00", type: "activity", title: { en: "Canal cruise", es: "Crucero por los canales", it: "Crociera sui canali" }, description: { en: "See Amsterdam from the water as the sun sets", es: "Ve Ámsterdam desde el agua mientras se pone el sol", it: "Vedi Amsterdam dall'acqua mentre il sole tramonta" } },
          { time: "19:30", type: "dinner", title: { en: "Dinner in De Pijp", es: "Cena en De Pijp", it: "Cena a De Pijp" }, description: { en: "Amsterdam's most diverse neighborhood with global cuisine", es: "El barrio más diverso de Ámsterdam con cocina global", it: "Il quartiere più diverso di Amsterdam con cucina globale" } },
        ],
      },
      faqs: [
        { question: { en: "How many days do I need in Amsterdam?", es: "¿Cuántos días necesito en Ámsterdam?", it: "Quanti giorni servono ad Amsterdam?" }, answer: { en: "3-4 days is perfect. Day 1 for museums, Day 2 for neighborhoods and canals, Day 3 for day trips to Zaanse Schans or Haarlem.", es: "3-4 días es perfecto. Día 1 para museos, Día 2 para barrios y canales, Día 3 para excursiones a Zaanse Schans o Haarlem.", it: "3-4 giorni sono perfetti. Giorno 1 per i musei, Giorno 2 per quartieri e canali, Giorno 3 per gite a Zaanse Schans o Haarlem." } },
        { question: { en: "Is Amsterdam walkable?", es: "¿Se puede recorrer Ámsterdam a pie?", it: "Amsterdam è percorribile a piedi?" }, answer: { en: "Very walkable! The city center is compact and flat. Even better, rent a bike — it's the Dutch way. Our AI includes cycling-friendly routes.", es: "¡Muy caminable! El centro es compacto y plano. Mejor aún, alquila una bicicleta — es la forma holandesa.", it: "Molto percorribile! Il centro è compatto e piatto. Ancora meglio, noleggia una bici — è il modo olandese." } },
      ],
      ctaText: { en: "Ready to explore Amsterdam?", es: "¿Listo para explorar Ámsterdam?", it: "Pronto per esplorare Amsterdam?" },
    },
  },

  // =========================================================================
  // PRAGUE
  // =========================================================================
  {
    slug: "prague",
    name: { en: "Prague", es: "Praga", it: "Praga" },
    country: { en: "Czech Republic", es: "República Checa", it: "Repubblica Ceca" },
    countryCode: "CZ",
    continent: "europe",
    coordinates: { lat: 50.0755, lng: 14.4378 },
    stats: { avgStayDays: 3, bestMonths: [4, 5, 9, 10], budgetLevel: 1 },
    tags: ["cultural", "historical", "romantic", "nightlife"],
    content: {
      tagline: { en: "Fairy-tale architecture at unbeatable prices", es: "Arquitectura de cuento de hadas a precios inmejorables", it: "Architettura da fiaba a prezzi imbattibili" },
      description: { en: "Prague's Gothic spires, cobblestone streets, and legendary beer halls make it one of Europe's most enchanting and affordable capitals. Our AI navigates the Old Town maze and finds the best Czech cuisine.", es: "Las agujas góticas de Praga, calles adoquinadas y legendarias cervecerías la convierten en una de las capitales más encantadoras y asequibles de Europa.", it: "Le guglie gotiche di Praga, le strade acciottolate e le leggendarie birrerie la rendono una delle capitali più incantevoli e accessibili d'Europa." },
      highlights: [
        { icon: "🏰", title: { en: "Prague Castle", es: "Castillo de Praga", it: "Castello di Praga" }, description: { en: "The world's largest ancient castle complex with stunning city views", es: "El complejo de castillo antiguo más grande del mundo con impresionantes vistas", it: "Il più grande complesso di castello antico del mondo con viste mozzafiato" } },
        { icon: "🌉", title: { en: "Charles Bridge", es: "Puente de Carlos", it: "Ponte Carlo" }, description: { en: "14th-century bridge lined with baroque statues — magical at sunrise", es: "Puente del siglo XIV con estatuas barrocas — mágico al amanecer", it: "Ponte del XIV secolo con statue barocche — magico all'alba" } },
        { icon: "🍺", title: { en: "World's Best Beer", es: "La Mejor Cerveza del Mundo", it: "La Migliore Birra del Mondo" }, description: { en: "Birthplace of Pilsner — incredible beer for less than $2 a pint", es: "Cuna de la Pilsner — cerveza increíble por menos de $2 la pinta", it: "Patria della Pilsner — birra incredibile per meno di $2 a pinta" } },
      ],
      sampleDay: {
        activities: [
          { time: "08:30", type: "breakfast", title: { en: "Café in Old Town Square", es: "Café en la Plaza de la Ciudad Vieja", it: "Caffè nella Piazza della Città Vecchia" }, description: { en: "Watch the Astronomical Clock while enjoying Czech pastries", es: "Observa el Reloj Astronómico mientras disfrutas de pasteles checos", it: "Osserva l'Orologio Astronomico gustando dolci cechi" } },
          { time: "10:00", type: "sightseeing", title: { en: "Prague Castle complex", es: "Complejo del Castillo de Praga", it: "Complesso del Castello di Praga" }, description: { en: "St. Vitus Cathedral, Golden Lane, and panoramic views", es: "Catedral de San Vito, Callejón del Oro y vistas panorámicas", it: "Cattedrale di San Vito, Vicolo d'Oro e viste panoramiche" } },
          { time: "13:00", type: "lunch", title: { en: "Traditional Czech lunch", es: "Almuerzo checo tradicional", it: "Pranzo ceco tradizionale" }, description: { en: "Svíčková and dumplings at a local hospoda", es: "Svíčková y dumplings en una hospoda local", it: "Svíčková e gnocchi in una hospoda locale" } },
          { time: "14:30", type: "walk", title: { en: "Charles Bridge to Malá Strana", es: "Puente de Carlos a Malá Strana", it: "Ponte Carlo fino a Malá Strana" }, description: { en: "Cross the iconic bridge and explore the charming lesser quarter", es: "Cruza el icónico puente y explora el encantador barrio pequeño", it: "Attraversa l'iconico ponte ed esplora l'affascinante quartiere piccolo" } },
          { time: "17:00", type: "activity", title: { en: "Beer tasting", es: "Degustación de cerveza", it: "Degustazione di birra" }, description: { en: "Czech craft beer tour in historic cellars", es: "Tour de cerveza artesanal checa en bodegas históricas", it: "Tour della birra artigianale ceca in cantine storiche" } },
          { time: "19:30", type: "dinner", title: { en: "Dinner with Vltava views", es: "Cena con vistas al Moldava", it: "Cena con vista sulla Moldava" }, description: { en: "Riverside dining as Prague Castle lights up", es: "Cena junto al río mientras el Castillo de Praga se ilumina", it: "Cena lungo il fiume mentre il Castello di Praga si illumina" } },
        ],
      },
      faqs: [
        { question: { en: "How many days do I need in Prague?", es: "¿Cuántos días necesito en Praga?", it: "Quanti giorni servono a Praga?" }, answer: { en: "3 days covers the highlights perfectly. Add a day for Kutná Hora or Český Krumlov day trips.", es: "3 días cubren los highlights perfectamente. Añade un día para excursiones a Kutná Hora o Český Krumlov.", it: "3 giorni coprono i punti salienti perfettamente. Aggiungi un giorno per gite a Kutná Hora o Český Krumlov." } },
        { question: { en: "Is Prague safe?", es: "¿Es Praga segura?", it: "Praga è sicura?" }, answer: { en: "Prague is one of Europe's safest capitals. Watch for pickpockets in tourist areas like Old Town Square and on trams.", es: "Praga es una de las capitales más seguras de Europa. Cuidado con los carteristas en zonas turísticas.", it: "Praga è una delle capitali più sicure d'Europa. Attenzione ai borseggiatori nelle zone turistiche." } },
      ],
      ctaText: { en: "Ready to explore Prague?", es: "¿Listo para explorar Praga?", it: "Pronto per esplorare Praga?" },
    },
  },

  // =========================================================================
  // LISBON
  // =========================================================================
  {
    slug: "lisbon",
    name: { en: "Lisbon", es: "Lisboa", it: "Lisbona" },
    country: { en: "Portugal", es: "Portugal", it: "Portogallo" },
    countryCode: "PT",
    continent: "europe",
    coordinates: { lat: 38.7223, lng: -9.1393 },
    stats: { avgStayDays: 4, bestMonths: [4, 5, 6, 9, 10], budgetLevel: 1 },
    tags: ["cultural", "foodie", "urban", "romantic"],
    content: {
      tagline: { en: "Sun-drenched hills, pastel tiles, and custard tarts", es: "Colinas bañadas de sol, azulejos pastel y pasteles de nata", it: "Colline baciate dal sole, piastrelle pastello e pastéis de nata" },
      description: { en: "Lisbon's colorful neighborhoods cascade down seven hills to the Tagus River. From Belém's monuments to Alfama's fado bars, this is Europe's sunniest and most underrated capital.", es: "Los coloridos barrios de Lisboa descienden en cascada por siete colinas hasta el río Tajo. Desde los monumentos de Belém hasta los bares de fado de Alfama, esta es la capital más soleada y subestimada de Europa.", it: "I colorati quartieri di Lisbona scendono a cascata lungo sette colli fino al fiume Tago. Dai monumenti di Belém ai bar di fado di Alfama, questa è la capitale più soleggiata e sottovalutata d'Europa." },
      highlights: [
        { icon: "🏠", title: { en: "Colorful Neighborhoods", es: "Barrios Coloridos", it: "Quartieri Colorati" }, description: { en: "Alfama's winding alleys, Bairro Alto's nightlife, and Mouraria's multicultural charm", es: "Los callejones sinuosos de Alfama, la vida nocturna de Bairro Alto y el encanto multicultural de Mouraria", it: "I vicoli tortuosi di Alfama, la vita notturna di Bairro Alto e il fascino multiculturale di Mouraria" } },
        { icon: "🥧", title: { en: "Pastéis de Nata & More", es: "Pastéis de Nata y Más", it: "Pastéis de Nata e Altro" }, description: { en: "Portuguese cuisine is a hidden gem — seafood, wine, and the world's best custard tarts", es: "La cocina portuguesa es una joya oculta — mariscos, vino y los mejores pasteles de nata del mundo", it: "La cucina portoghese è una gemma nascosta — frutti di mare, vino e le migliori crostatine alla crema del mondo" } },
        { icon: "🎵", title: { en: "Fado Music", es: "Música Fado", it: "Musica Fado" }, description: { en: "Hauntingly beautiful traditional music in intimate Alfama restaurants", es: "Música tradicional de belleza cautivadora en íntimos restaurantes de Alfama", it: "Musica tradizionale di bellezza struggente in intimi ristoranti di Alfama" } },
      ],
      sampleDay: {
        activities: [
          { time: "09:00", type: "breakfast", title: { en: "Pastéis de Belém", es: "Pastéis de Belém", it: "Pastéis de Belém" }, description: { en: "The original custard tart bakery — worth the queue", es: "La pastelería original de pastéis de nata — vale la cola", it: "La pasticceria originale dei pastéis de nata — vale la coda" } },
          { time: "10:30", type: "sightseeing", title: { en: "Belém Tower & Jerónimos", es: "Torre de Belém y Jerónimos", it: "Torre di Belém e Jerónimos" }, description: { en: "Maritime monuments from Portugal's Age of Discovery", es: "Monumentos marítimos de la Era de los Descubrimientos", it: "Monumenti marittimi dell'Era delle Scoperte" } },
          { time: "13:00", type: "lunch", title: { en: "Time Out Market", es: "Time Out Market", it: "Time Out Market" }, description: { en: "Lisbon's best chefs under one roof by the river", es: "Los mejores chefs de Lisboa bajo un techo junto al río", it: "I migliori chef di Lisbona sotto un unico tetto lungo il fiume" } },
          { time: "14:30", type: "transport", title: { en: "Tram 28 through Alfama", es: "Tranvía 28 por Alfama", it: "Tram 28 attraverso Alfama" }, description: { en: "The famous yellow tram winds through the oldest neighborhood", es: "El famoso tranvía amarillo serpentea por el barrio más antiguo", it: "Il famoso tram giallo si snoda attraverso il quartiere più antico" } },
          { time: "16:00", type: "walk", title: { en: "Miradouros (viewpoints)", es: "Miradouros (miradores)", it: "Miradouros (belvedere)" }, description: { en: "Sunset views from Graça and Santa Luzia viewpoints", es: "Vistas del atardecer desde los miradores de Graça y Santa Luzia", it: "Viste del tramonto dai belvedere di Graça e Santa Luzia" } },
          { time: "20:00", type: "dinner", title: { en: "Fado dinner in Alfama", es: "Cena con fado en Alfama", it: "Cena con fado ad Alfama" }, description: { en: "Traditional Portuguese cuisine with live fado music", es: "Cocina portuguesa tradicional con música fado en vivo", it: "Cucina portoghese tradizionale con musica fado dal vivo" } },
        ],
      },
      faqs: [
        { question: { en: "How many days do I need in Lisbon?", es: "¿Cuántos días necesito en Lisboa?", it: "Quanti giorni servono a Lisbona?" }, answer: { en: "3-4 days covers the main neighborhoods and sights. Add a day for Sintra's fairy-tale palaces (30 min by train).", es: "3-4 días cubren los principales barrios y atracciones. Añade un día para los palacios de cuento de hadas de Sintra (30 min en tren).", it: "3-4 giorni coprono i principali quartieri e attrazioni. Aggiungi un giorno per i palazzi da fiaba di Sintra (30 min in treno)." } },
        { question: { en: "Is Lisbon hilly?", es: "¿Es Lisboa montañosa?", it: "Lisbona è collinare?" }, answer: { en: "Yes! Lisbon is built on seven hills. Wear comfortable shoes, take Tram 28, and use elevators like Santa Justa. Our AI plans downhill walking routes.", es: "¡Sí! Lisboa está construida sobre siete colinas. Usa zapatos cómodos, toma el Tranvía 28 y usa elevadores como Santa Justa.", it: "Sì! Lisbona è costruita su sette colli. Indossa scarpe comode, prendi il Tram 28 e usa ascensori come Santa Justa." } },
      ],
      ctaText: { en: "Ready to explore Lisbon?", es: "¿Listo para explorar Lisboa?", it: "Pronto per esplorare Lisbona?" },
    },
  },

  // =========================================================================
  // VIENNA
  // =========================================================================
  {
    slug: "vienna",
    name: { en: "Vienna", es: "Viena", it: "Vienna" },
    country: { en: "Austria", es: "Austria", it: "Austria" },
    countryCode: "AT",
    continent: "europe",
    coordinates: { lat: 48.2082, lng: 16.3738 },
    stats: { avgStayDays: 3, bestMonths: [4, 5, 6, 9, 10], budgetLevel: 2 },
    tags: ["cultural", "romantic", "foodie", "historical"],
    content: {
      tagline: { en: "Imperial grandeur meets coffee house culture", es: "Grandeza imperial se encuentra con cultura de cafés", it: "Grandezza imperiale incontra la cultura dei caffè" },
      description: { en: "Vienna's imperial palaces, world-famous opera, and legendary coffee houses create an atmosphere of old-world elegance. Our AI schedules concert tickets, palace visits, and the best Sachertorte stops.", es: "Los palacios imperiales de Viena, la ópera de fama mundial y los legendarios cafés crean una atmósfera de elegancia del viejo mundo.", it: "I palazzi imperiali di Vienna, l'opera di fama mondiale e i leggendari caffè creano un'atmosfera di eleganza del vecchio mondo." },
      highlights: [
        { icon: "🏛️", title: { en: "Imperial Palaces", es: "Palacios Imperiales", it: "Palazzi Imperiali" }, description: { en: "Schönbrunn Palace, Hofburg, and Belvedere — Habsburg splendor at every turn", es: "Palacio de Schönbrunn, Hofburg y Belvedere — esplendor de los Habsburgo en cada esquina", it: "Palazzo di Schönbrunn, Hofburg e Belvedere — splendore asburgico ad ogni angolo" } },
        { icon: "☕", title: { en: "Coffee House Culture", es: "Cultura de los Cafés", it: "Cultura dei Caffè" }, description: { en: "UNESCO-listed tradition — Sachertorte, melange, and newspapers in grand cafés", es: "Tradición patrimonio UNESCO — Sachertorte, melange y periódicos en grandes cafés", it: "Tradizione patrimonio UNESCO — Sachertorte, melange e giornali nei grandi caffè" } },
        { icon: "🎵", title: { en: "City of Music", es: "Ciudad de la Música", it: "Città della Musica" }, description: { en: "Mozart, Beethoven, Strauss — attend a concert at the Vienna State Opera or Musikverein", es: "Mozart, Beethoven, Strauss — asiste a un concierto en la Ópera Estatal o el Musikverein", it: "Mozart, Beethoven, Strauss — assisti a un concerto all'Opera di Stato o al Musikverein" } },
      ],
      sampleDay: {
        activities: [
          { time: "09:00", type: "sightseeing", title: { en: "Schönbrunn Palace", es: "Palacio de Schönbrunn", it: "Palazzo di Schönbrunn" }, description: { en: "Habsburg imperial residence and stunning gardens", es: "Residencia imperial de los Habsburgo y jardines impresionantes", it: "Residenza imperiale degli Asburgo e giardini mozzafiato" } },
          { time: "12:00", type: "lunch", title: { en: "Naschmarkt lunch", es: "Almuerzo en Naschmarkt", it: "Pranzo al Naschmarkt" }, description: { en: "Vienna's famous food market with Viennese and international stalls", es: "El famoso mercado de comida de Viena con puestos vieneses e internacionales", it: "Il famoso mercato alimentare di Vienna con bancarelle viennesi e internazionali" } },
          { time: "14:00", type: "museum", title: { en: "Kunsthistorisches Museum", es: "Museo de Historia del Arte", it: "Museo di Storia dell'Arte" }, description: { en: "World-class art collection in a palace-like setting", es: "Colección de arte de clase mundial en un entorno palaciego", it: "Collezione d'arte di classe mondiale in un ambiente da palazzo" } },
          { time: "16:30", type: "breakfast", title: { en: "Café Central", es: "Café Central", it: "Café Central" }, description: { en: "Sachertorte and melange in Vienna's most famous coffee house", es: "Sachertorte y melange en el café más famoso de Viena", it: "Sachertorte e melange nel caffè più famoso di Vienna" } },
          { time: "19:30", type: "activity", title: { en: "Vienna State Opera", es: "Ópera Estatal de Viena", it: "Opera di Stato di Vienna" }, description: { en: "World-class performance in one of the finest opera houses", es: "Actuación de clase mundial en una de las mejores óperas", it: "Performance di classe mondiale in uno dei più grandi teatri d'opera" } },
        ],
      },
      faqs: [
        { question: { en: "How many days do I need in Vienna?", es: "¿Cuántos días necesito en Viena?", it: "Quanti giorni servono a Vienna?" }, answer: { en: "3-4 days is ideal. Palaces, museums, and coffee houses fill 3 days easily. Add a day for the Vienna Woods or a Danube cruise.", es: "3-4 días es ideal. Palacios, museos y cafés llenan 3 días fácilmente.", it: "3-4 giorni sono ideali. Palazzi, musei e caffè riempiono facilmente 3 giorni." } },
      ],
      ctaText: { en: "Ready to explore Vienna?", es: "¿Listo para explorar Viena?", it: "Pronto per esplorare Vienna?" },
    },
  },

  // =========================================================================
  // BERLIN
  // =========================================================================
  {
    slug: "berlin",
    name: { en: "Berlin", es: "Berlín", it: "Berlino" },
    country: { en: "Germany", es: "Alemania", it: "Germania" },
    countryCode: "DE",
    continent: "europe",
    coordinates: { lat: 52.52, lng: 13.405 },
    stats: { avgStayDays: 4, bestMonths: [5, 6, 7, 9], budgetLevel: 1 },
    tags: ["cultural", "urban", "nightlife", "offbeat"],
    content: {
      tagline: { en: "History, art, and the world's best nightlife", es: "Historia, arte y la mejor vida nocturna del mundo", it: "Storia, arte e la migliore vita notturna del mondo" },
      description: { en: "Berlin is raw, creative, and constantly reinventing itself. Cold War history, world-class galleries, legendary clubs, and some of Europe's best street food — all at remarkably affordable prices.", es: "Berlín es cruda, creativa y en constante reinvención. Historia de la Guerra Fría, galerías de clase mundial, clubes legendarios y la mejor comida callejera de Europa.", it: "Berlino è cruda, creativa e in costante reinvenzione. Storia della Guerra Fredda, gallerie di classe mondiale, club leggendari e il miglior street food d'Europa." },
      highlights: [
        { icon: "🧱", title: { en: "Cold War History", es: "Historia de la Guerra Fría", it: "Storia della Guerra Fredda" }, description: { en: "Berlin Wall, Checkpoint Charlie, and the East Side Gallery — history you can touch", es: "Muro de Berlín, Checkpoint Charlie y la East Side Gallery — historia que puedes tocar", it: "Muro di Berlino, Checkpoint Charlie e la East Side Gallery — storia che puoi toccare" } },
        { icon: "🎨", title: { en: "Art & Street Culture", es: "Arte y Cultura Callejera", it: "Arte e Cultura di Strada" }, description: { en: "Museum Island, Kreuzberg street art, and independent galleries everywhere", es: "Isla de los Museos, arte callejero en Kreuzberg y galerías independientes por todas partes", it: "Isola dei Musei, street art a Kreuzberg e gallerie indipendenti ovunque" } },
        { icon: "🎶", title: { en: "Legendary Nightlife", es: "Vida Nocturna Legendaria", it: "Vita Notturna Leggendaria" }, description: { en: "World-famous clubs, underground bars, and a scene that never sleeps", es: "Clubes de fama mundial, bares underground y una escena que nunca duerme", it: "Club di fama mondiale, bar underground e una scena che non dorme mai" } },
      ],
      sampleDay: {
        activities: [
          { time: "09:00", type: "sightseeing", title: { en: "Brandenburg Gate & Reichstag", es: "Puerta de Brandenburgo y Reichstag", it: "Porta di Brandeburgo e Reichstag" }, description: { en: "Germany's most iconic landmarks side by side", es: "Los monumentos más icónicos de Alemania lado a lado", it: "I monumenti più iconici della Germania fianco a fianco" } },
          { time: "11:00", type: "museum", title: { en: "Museum Island", es: "Isla de los Museos", it: "Isola dei Musei" }, description: { en: "Five world-class museums on one UNESCO-listed island", es: "Cinco museos de clase mundial en una isla patrimonio UNESCO", it: "Cinque musei di classe mondiale su un'isola patrimonio UNESCO" } },
          { time: "13:30", type: "lunch", title: { en: "Currywurst at Curry 36", es: "Currywurst en Curry 36", it: "Currywurst da Curry 36" }, description: { en: "Berlin's iconic street food — you have to try it", es: "La comida callejera icónica de Berlín — tienes que probarla", it: "Lo street food iconico di Berlino — devi provarlo" } },
          { time: "15:00", type: "walk", title: { en: "East Side Gallery", es: "East Side Gallery", it: "East Side Gallery" }, description: { en: "1.3km of Berlin Wall covered in street art murals", es: "1,3 km del Muro de Berlín cubierto de murales de arte callejero", it: "1,3 km del Muro di Berlino coperto di murales di street art" } },
          { time: "17:30", type: "walk", title: { en: "Kreuzberg exploration", es: "Exploración de Kreuzberg", it: "Esplorazione di Kreuzberg" }, description: { en: "Berlin's most creative neighborhood — cafés, vintage shops, galleries", es: "El barrio más creativo de Berlín — cafés, tiendas vintage, galerías", it: "Il quartiere più creativo di Berlino — caffè, negozi vintage, gallerie" } },
          { time: "20:00", type: "dinner", title: { en: "Dinner in Neukölln", es: "Cena en Neukölln", it: "Cena a Neukölln" }, description: { en: "Trendy restaurants and bars in Berlin's hippest neighborhood", es: "Restaurantes y bares de moda en el barrio más hip de Berlín", it: "Ristoranti e bar alla moda nel quartiere più hip di Berlino" } },
        ],
      },
      faqs: [
        { question: { en: "How many days do I need in Berlin?", es: "¿Cuántos días necesito en Berlín?", it: "Quanti giorni servono a Berlino?" }, answer: { en: "4-5 days lets you explore properly. Berlin is spread out with distinct neighborhoods, each worth a full day. Add a day for Potsdam.", es: "4-5 días te permiten explorar correctamente. Berlín está extendida con barrios distintos, cada uno vale un día completo.", it: "4-5 giorni permettono di esplorare adeguatamente. Berlino è estesa con quartieri distinti, ognuno vale un giorno intero." } },
      ],
      ctaText: { en: "Ready to explore Berlin?", es: "¿Listo para explorar Berlín?", it: "Pronto per esplorare Berlino?" },
    },
  },

  // =========================================================================
  // BANGKOK
  // =========================================================================
  {
    slug: "bangkok",
    name: { en: "Bangkok", es: "Bangkok", it: "Bangkok" },
    country: { en: "Thailand", es: "Tailandia", it: "Thailandia" },
    countryCode: "TH",
    continent: "asia",
    coordinates: { lat: 13.7563, lng: 100.5018 },
    stats: { avgStayDays: 4, bestMonths: [11, 12, 1, 2], budgetLevel: 1 },
    tags: ["cultural", "foodie", "urban", "adventure"],
    content: {
      tagline: { en: "Golden temples, street food heaven, and endless energy", es: "Templos dorados, paraíso de comida callejera y energía infinita", it: "Templi dorati, paradiso dello street food e energia infinita" },
      description: { en: "Bangkok is a sensory overload in the best way — ornate temples, floating markets, rooftop bars, and the world's best street food. Our AI navigates the BTS, river boats, and tuk-tuks to build perfect Bangkok days.", es: "Bangkok es una sobrecarga sensorial de la mejor manera — templos ornamentados, mercados flotantes, bares en azoteas y la mejor comida callejera del mundo.", it: "Bangkok è un sovraccarico sensoriale nel modo migliore — templi ornati, mercati galleggianti, bar sui tetti e il miglior street food del mondo." },
      highlights: [
        { icon: "🛕", title: { en: "Magnificent Temples", es: "Templos Magníficos", it: "Templi Magnifici" }, description: { en: "Wat Phra Kaew, Wat Pho, and Wat Arun — golden spires and giant Buddhas", es: "Wat Phra Kaew, Wat Pho y Wat Arun — agujas doradas y Budas gigantes", it: "Wat Phra Kaew, Wat Pho e Wat Arun — guglie dorate e Buddha giganti" } },
        { icon: "🍜", title: { en: "Street Food Capital", es: "Capital del Street Food", it: "Capitale dello Street Food" }, description: { en: "Pad thai, mango sticky rice, and som tam — incredible meals for $1-3", es: "Pad thai, mango sticky rice y som tam — comidas increíbles por $1-3", it: "Pad thai, mango sticky rice e som tam — pasti incredibili per $1-3" } },
        { icon: "🌃", title: { en: "Rooftop & Nightlife", es: "Azoteas y Vida Nocturna", it: "Rooftop e Vita Notturna" }, description: { en: "Sky bars with panoramic views and vibrant night markets", es: "Bares en azoteas con vistas panorámicas y vibrantes mercados nocturnos", it: "Sky bar con viste panoramiche e vivaci mercati notturni" } },
      ],
      sampleDay: {
        activities: [
          { time: "08:00", type: "sightseeing", title: { en: "Grand Palace & Wat Phra Kaew", es: "Gran Palacio y Wat Phra Kaew", it: "Gran Palazzo e Wat Phra Kaew" }, description: { en: "Thailand's most sacred temple — arrive early to beat the heat", es: "El templo más sagrado de Tailandia — llega temprano para evitar el calor", it: "Il tempio più sacro della Thailandia — arriva presto per evitare il caldo" } },
          { time: "10:30", type: "sightseeing", title: { en: "Wat Pho", es: "Wat Pho", it: "Wat Pho" }, description: { en: "The famous Reclining Buddha and traditional Thai massage", es: "El famoso Buda Reclinado y masaje tailandés tradicional", it: "Il famoso Buddha Sdraiato e massaggio thai tradizionale" } },
          { time: "12:30", type: "lunch", title: { en: "Street food lunch in Chinatown", es: "Almuerzo callejero en Chinatown", it: "Pranzo di street food a Chinatown" }, description: { en: "Yaowarat Road — Bangkok's best food street", es: "Yaowarat Road — la mejor calle de comida de Bangkok", it: "Yaowarat Road — la migliore strada del cibo di Bangkok" } },
          { time: "14:30", type: "activity", title: { en: "Chao Phraya river boat", es: "Barco por el río Chao Phraya", it: "Battello sul fiume Chao Phraya" }, description: { en: "Cross the river to Wat Arun for sunset photos", es: "Cruza el río hacia Wat Arun para fotos del atardecer", it: "Attraversa il fiume verso Wat Arun per foto al tramonto" } },
          { time: "17:00", type: "shopping", title: { en: "Chatuchak Weekend Market", es: "Mercado de Chatuchak", it: "Mercato di Chatuchak" }, description: { en: "The world's largest outdoor market — 15,000+ stalls", es: "El mercado al aire libre más grande del mundo — más de 15.000 puestos", it: "Il più grande mercato all'aperto del mondo — oltre 15.000 bancarelle" } },
          { time: "19:30", type: "dinner", title: { en: "Rooftop dinner & drinks", es: "Cena y tragos en azotea", it: "Cena e drink sul rooftop" }, description: { en: "Sky bar with views over the Bangkok skyline", es: "Bar en azotea con vistas del skyline de Bangkok", it: "Sky bar con viste sullo skyline di Bangkok" } },
        ],
      },
      faqs: [
        { question: { en: "How many days do I need in Bangkok?", es: "¿Cuántos días necesito en Bangkok?", it: "Quanti giorni servono a Bangkok?" }, answer: { en: "3-4 days covers temples, food, and markets. Add days for floating markets, cooking classes, or day trips to Ayutthaya.", es: "3-4 días cubren templos, comida y mercados. Añade días para mercados flotantes, clases de cocina o excursiones a Ayutthaya.", it: "3-4 giorni coprono templi, cibo e mercati. Aggiungi giorni per mercati galleggianti, corsi di cucina o gite ad Ayutthaya." } },
      ],
      ctaText: { en: "Ready to explore Bangkok?", es: "¿Listo para explorar Bangkok?", it: "Pronto per esplorare Bangkok?" },
    },
  },

  // =========================================================================
  // BALI
  // =========================================================================
  {
    slug: "bali",
    name: { en: "Bali", es: "Bali", it: "Bali" },
    country: { en: "Indonesia", es: "Indonesia", it: "Indonesia" },
    countryCode: "ID",
    continent: "asia",
    coordinates: { lat: -8.3405, lng: 115.092 },
    stats: { avgStayDays: 7, bestMonths: [4, 5, 6, 7, 8, 9], budgetLevel: 1 },
    tags: ["nature", "wellness", "cultural", "adventure"],
    content: {
      tagline: { en: "Rice terraces, temples, and tropical paradise", es: "Terrazas de arroz, templos y paraíso tropical", it: "Terrazze di riso, templi e paradiso tropicale" },
      description: { en: "Bali offers everything from cliff-top temples and emerald rice paddies to world-class surf and wellness retreats. Our AI plans multi-area itineraries connecting Ubud's culture with Seminyak's beaches and Uluwatu's cliffs.", es: "Bali ofrece todo, desde templos en acantilados y arrozales esmeralda hasta surf de clase mundial y retiros de bienestar.", it: "Bali offre tutto, dai templi sulle scogliere e risaie smeraldo al surf di classe mondiale e ritiri benessere." },
      highlights: [
        { icon: "🌾", title: { en: "Rice Terraces", es: "Terrazas de Arroz", it: "Terrazze di Riso" }, description: { en: "Tegallalang and Jatiluwih — UNESCO-listed subak irrigation landscapes", es: "Tegallalang y Jatiluwih — paisajes de irrigación subak patrimonio UNESCO", it: "Tegallalang e Jatiluwih — paesaggi di irrigazione subak patrimonio UNESCO" } },
        { icon: "🧘", title: { en: "Wellness & Yoga", es: "Bienestar y Yoga", it: "Benessere e Yoga" }, description: { en: "Ubud is the world capital of yoga retreats, healing, and mindfulness", es: "Ubud es la capital mundial de retiros de yoga, sanación y mindfulness", it: "Ubud è la capitale mondiale dei ritiri yoga, guarigione e mindfulness" } },
        { icon: "🏄", title: { en: "Surf & Beaches", es: "Surf y Playas", it: "Surf e Spiagge" }, description: { en: "From beginner waves at Kuta to epic breaks at Uluwatu", es: "Desde olas para principiantes en Kuta hasta rompientes épicas en Uluwatu", it: "Dalle onde per principianti a Kuta alle epic breaks a Uluwatu" } },
      ],
      sampleDay: {
        activities: [
          { time: "06:00", type: "activity", title: { en: "Sunrise at Mount Batur", es: "Amanecer en el Monte Batur", it: "Alba sul Monte Batur" }, description: { en: "Trek to the volcano summit for a breathtaking sunrise", es: "Caminata a la cima del volcán para un amanecer impresionante", it: "Trekking sulla cima del vulcano per un'alba mozzafiato" } },
          { time: "10:00", type: "sightseeing", title: { en: "Tegallalang Rice Terraces", es: "Terrazas de Arroz de Tegallalang", it: "Terrazze di Riso di Tegallalang" }, description: { en: "Walk through the iconic cascading green terraces", es: "Paseo por las icónicas terrazas verdes en cascada", it: "Passeggiata attraverso le iconiche terrazze verdi a cascata" } },
          { time: "12:30", type: "lunch", title: { en: "Lunch overlooking the jungle", es: "Almuerzo con vista a la selva", it: "Pranzo con vista sulla giungla" }, description: { en: "Organic Balinese cuisine in an open-air pavilion", es: "Cocina balinesa orgánica en un pabellón al aire libre", it: "Cucina balinese biologica in un padiglione all'aperto" } },
          { time: "14:30", type: "walk", title: { en: "Ubud Monkey Forest", es: "Bosque de los Monos de Ubud", it: "Foresta delle Scimmie di Ubud" }, description: { en: "Ancient temple ruins in a lush jungle setting", es: "Ruinas de templos antiguos en un exuberante entorno selvático", it: "Rovine di templi antichi in un lussureggiante ambiente di giungla" } },
          { time: "17:00", type: "sightseeing", title: { en: "Tanah Lot Temple at sunset", es: "Templo Tanah Lot al atardecer", it: "Tempio Tanah Lot al tramonto" }, description: { en: "Sea temple perched on a rock — iconic Bali sunset spot", es: "Templo marino sobre una roca — icónico lugar para el atardecer en Bali", it: "Tempio sul mare su una roccia — iconico punto tramonto di Bali" } },
          { time: "20:00", type: "dinner", title: { en: "Beach dinner in Seminyak", es: "Cena en la playa de Seminyak", it: "Cena sulla spiaggia a Seminyak" }, description: { en: "Seafood dinner with toes in the sand", es: "Cena de mariscos con los pies en la arena", it: "Cena di pesce con i piedi nella sabbia" } },
        ],
      },
      faqs: [
        { question: { en: "How many days do I need in Bali?", es: "¿Cuántos días necesito en Bali?", it: "Quanti giorni servono a Bali?" }, answer: { en: "7-10 days is ideal to cover Ubud, the beaches, and temples without rushing. Minimum 5 days if you focus on one area.", es: "7-10 días es ideal para cubrir Ubud, las playas y templos sin prisa. Mínimo 5 días si te enfocas en una zona.", it: "7-10 giorni sono ideali per coprire Ubud, le spiagge e i templi senza fretta. Minimo 5 giorni se ti concentri su una zona." } },
      ],
      ctaText: { en: "Ready to explore Bali?", es: "¿Listo para explorar Bali?", it: "Pronto per esplorare Bali?" },
    },
  },

  // =========================================================================
  // SEOUL
  // =========================================================================
  {
    slug: "seoul",
    name: { en: "Seoul", es: "Seúl", it: "Seul" },
    country: { en: "South Korea", es: "Corea del Sur", it: "Corea del Sud" },
    countryCode: "KR",
    continent: "asia",
    coordinates: { lat: 37.5665, lng: 126.978 },
    stats: { avgStayDays: 4, bestMonths: [3, 4, 5, 9, 10], budgetLevel: 2 },
    tags: ["cultural", "foodie", "urban", "offbeat"],
    content: {
      tagline: { en: "K-culture, ancient palaces, and next-level food", es: "K-culture, palacios antiguos y comida del siguiente nivel", it: "K-culture, palazzi antichi e cibo di livello superiore" },
      description: { en: "Seoul seamlessly blends 600-year-old palaces with K-pop culture, neon-lit streets, and some of Asia's best food. Our AI plans around palace opening times, the best Korean BBQ spots, and trending neighborhoods.", es: "Seúl fusiona palacios de 600 años con cultura K-pop, calles iluminadas por neón y la mejor comida de Asia.", it: "Seul fonde palazzi di 600 anni con la cultura K-pop, strade illuminate al neon e parte del miglior cibo dell'Asia." },
      highlights: [
        { icon: "🏯", title: { en: "Historic Palaces", es: "Palacios Históricos", it: "Palazzi Storici" }, description: { en: "Gyeongbokgung, Changdeokgung, and traditional hanok villages", es: "Gyeongbokgung, Changdeokgung y pueblos hanok tradicionales", it: "Gyeongbokgung, Changdeokgung e villaggi hanok tradizionali" } },
        { icon: "🥘", title: { en: "Korean Food Scene", es: "Escena Gastronómica Coreana", it: "Scena Gastronomica Coreana" }, description: { en: "Korean BBQ, bibimbap, tteokbokki, and soju — from street stalls to Michelin stars", es: "BBQ coreano, bibimbap, tteokbokki y soju — desde puestos callejeros hasta estrellas Michelin", it: "BBQ coreano, bibimbap, tteokbokki e soju — dalle bancarelle alle stelle Michelin" } },
        { icon: "🎤", title: { en: "K-Pop & Modern Culture", es: "K-Pop y Cultura Moderna", it: "K-Pop e Cultura Moderna" }, description: { en: "Gangnam, Hongdae's live music scene, and cutting-edge fashion", es: "Gangnam, la escena musical en vivo de Hongdae y moda de vanguardia", it: "Gangnam, la scena musicale dal vivo di Hongdae e moda all'avanguardia" } },
      ],
      sampleDay: {
        activities: [
          { time: "09:00", type: "sightseeing", title: { en: "Gyeongbokgung Palace", es: "Palacio Gyeongbokgung", it: "Palazzo Gyeongbokgung" }, description: { en: "Seoul's grandest palace — rent a hanbok for free admission", es: "El palacio más grandioso de Seúl — alquila un hanbok para entrada gratuita", it: "Il palazzo più grandioso di Seul — noleggia un hanbok per l'ingresso gratuito" } },
          { time: "11:30", type: "walk", title: { en: "Bukchon Hanok Village", es: "Pueblo Hanok de Bukchon", it: "Villaggio Hanok di Bukchon" }, description: { en: "Traditional Korean houses on a hillside with city views", es: "Casas coreanas tradicionales en una ladera con vistas a la ciudad", it: "Case coreane tradizionali su una collina con vista sulla città" } },
          { time: "13:00", type: "lunch", title: { en: "Korean BBQ lunch", es: "Almuerzo de BBQ coreano", it: "Pranzo BBQ coreano" }, description: { en: "Grill your own meat at a traditional Korean BBQ restaurant", es: "Asa tu propia carne en un restaurante de BBQ coreano tradicional", it: "Griglia la tua carne in un ristorante BBQ coreano tradizionale" } },
          { time: "15:00", type: "shopping", title: { en: "Myeongdong shopping", es: "Compras en Myeongdong", it: "Shopping a Myeongdong" }, description: { en: "K-beauty products, street food, and Korean fashion", es: "Productos K-beauty, comida callejera y moda coreana", it: "Prodotti K-beauty, street food e moda coreana" } },
          { time: "17:30", type: "sightseeing", title: { en: "N Seoul Tower", es: "Torre N de Seúl", it: "N Seoul Tower" }, description: { en: "Panoramic city views from Namsan Mountain", es: "Vistas panorámicas de la ciudad desde la montaña Namsan", it: "Viste panoramiche della città dalla montagna Namsan" } },
          { time: "20:00", type: "dinner", title: { en: "Hongdae night scene", es: "Escena nocturna de Hongdae", it: "Scena notturna di Hongdae" }, description: { en: "Street performers, late-night food, and live music", es: "Artistas callejeros, comida nocturna y música en vivo", it: "Artisti di strada, cibo notturno e musica dal vivo" } },
        ],
      },
      faqs: [
        { question: { en: "How many days do I need in Seoul?", es: "¿Cuántos días necesito en Seúl?", it: "Quanti giorni servono a Seul?" }, answer: { en: "4-5 days covers palaces, food, and neighborhoods well. Add a day for the DMZ tour or day trip to Nami Island.", es: "4-5 días cubren palacios, comida y barrios bien. Añade un día para el tour a la DMZ o excursión a Isla Nami.", it: "4-5 giorni coprono palazzi, cibo e quartieri bene. Aggiungi un giorno per il tour alla DMZ o gita all'Isola Nami." } },
      ],
      ctaText: { en: "Ready to explore Seoul?", es: "¿Listo para explorar Seúl?", it: "Pronto per esplorare Seul?" },
    },
  },

  // =========================================================================
  // SINGAPORE
  // =========================================================================
  {
    slug: "singapore",
    name: { en: "Singapore", es: "Singapur", it: "Singapore" },
    country: { en: "Singapore", es: "Singapur", it: "Singapore" },
    countryCode: "SG",
    continent: "asia",
    coordinates: { lat: 1.3521, lng: 103.8198 },
    stats: { avgStayDays: 3, bestMonths: [2, 3, 4, 7, 8], budgetLevel: 3 },
    tags: ["urban", "foodie", "cultural", "nature"],
    content: {
      tagline: { en: "A futuristic garden city with the world's best hawker food", es: "Una ciudad jardín futurista con la mejor comida hawker del mundo", it: "Una città giardino futuristica con il miglior cibo hawker del mondo" },
      description: { en: "Singapore packs incredible diversity into a tiny island — futuristic Gardens by the Bay, historic shophouses, Michelin-starred hawker stalls, and lush nature reserves. Our AI maximizes your time in this efficient city-state.", es: "Singapur concentra una diversidad increíble en una pequeña isla — los futuristas Gardens by the Bay, shophouses históricos, puestos hawker con estrella Michelin y reservas naturales.", it: "Singapore concentra un'incredibile diversità in una piccola isola — i futuristici Gardens by the Bay, shophouse storiche, bancarelle hawker stellate Michelin e riserve naturali." },
      highlights: [
        { icon: "🌳", title: { en: "Gardens by the Bay", es: "Gardens by the Bay", it: "Gardens by the Bay" }, description: { en: "Supertree Grove, Cloud Forest, and the Flower Dome — sci-fi meets nature", es: "Supertree Grove, Cloud Forest y el Flower Dome — ciencia ficción y naturaleza", it: "Supertree Grove, Cloud Forest e il Flower Dome — fantascienza incontra natura" } },
        { icon: "🍲", title: { en: "Hawker Food Culture", es: "Cultura Hawker", it: "Cultura Hawker" }, description: { en: "UNESCO-listed food culture — Michelin-starred meals for $3 at hawker centers", es: "Cultura gastronómica patrimonio UNESCO — comidas con estrella Michelin por $3 en centros hawker", it: "Cultura gastronomica patrimonio UNESCO — pasti stellati Michelin per $3 nei centri hawker" } },
        { icon: "🏙️", title: { en: "Modern Architecture", es: "Arquitectura Moderna", it: "Architettura Moderna" }, description: { en: "Marina Bay Sands, Jewel Changi Airport, and the futuristic skyline", es: "Marina Bay Sands, Jewel Changi Airport y el skyline futurista", it: "Marina Bay Sands, Jewel Changi Airport e lo skyline futuristico" } },
      ],
      sampleDay: {
        activities: [
          { time: "08:30", type: "breakfast", title: { en: "Kaya toast breakfast", es: "Desayuno de kaya toast", it: "Colazione con kaya toast" }, description: { en: "Traditional Singaporean breakfast with soft-boiled eggs and kopi", es: "Desayuno tradicional singapurense con huevos pasados por agua y kopi", it: "Colazione tradizionale singaporiana con uova alla coque e kopi" } },
          { time: "10:00", type: "sightseeing", title: { en: "Gardens by the Bay", es: "Gardens by the Bay", it: "Gardens by the Bay" }, description: { en: "Cloud Forest dome and Supertree Grove walkway", es: "Cúpula Cloud Forest y pasarela Supertree Grove", it: "Cupola Cloud Forest e passerella Supertree Grove" } },
          { time: "12:30", type: "lunch", title: { en: "Maxwell Food Centre", es: "Maxwell Food Centre", it: "Maxwell Food Centre" }, description: { en: "Hawker center with the famous Tian Tian chicken rice", es: "Centro hawker con el famoso arroz con pollo Tian Tian", it: "Centro hawker con il famoso riso con pollo Tian Tian" } },
          { time: "14:00", type: "walk", title: { en: "Chinatown & Little India", es: "Chinatown y Little India", it: "Chinatown e Little India" }, description: { en: "Explore Singapore's diverse cultural neighborhoods", es: "Explora los diversos barrios culturales de Singapur", it: "Esplora i diversi quartieri culturali di Singapore" } },
          { time: "17:00", type: "sightseeing", title: { en: "Marina Bay Sands SkyPark", es: "Marina Bay Sands SkyPark", it: "Marina Bay Sands SkyPark" }, description: { en: "Sunset views from the iconic rooftop infinity pool area", es: "Vistas del atardecer desde la icónica zona de la piscina infinita", it: "Viste del tramonto dall'iconica zona piscina infinity" } },
          { time: "19:30", type: "dinner", title: { en: "Lau Pa Sat hawker dinner", es: "Cena hawker en Lau Pa Sat", it: "Cena hawker a Lau Pa Sat" }, description: { en: "Satay street and diverse Asian cuisines in a Victorian market", es: "Calle de satay y diversas cocinas asiáticas en un mercado victoriano", it: "Strada del satay e diverse cucine asiatiche in un mercato vittoriano" } },
        ],
      },
      faqs: [
        { question: { en: "How many days do I need in Singapore?", es: "¿Cuántos días necesito en Singapur?", it: "Quanti giorni servono a Singapore?" }, answer: { en: "3-4 days covers the highlights well. Singapore is compact and efficient, so you can see a lot in a short time.", es: "3-4 días cubren los highlights bien. Singapur es compacto y eficiente, así que puedes ver mucho en poco tiempo.", it: "3-4 giorni coprono bene i punti salienti. Singapore è compatta ed efficiente, quindi puoi vedere molto in poco tempo." } },
      ],
      ctaText: { en: "Ready to explore Singapore?", es: "¿Listo para explorar Singapur?", it: "Pronto per esplorare Singapore?" },
    },
  },

  // =========================================================================
  // CANCUN
  // =========================================================================
  {
    slug: "cancun",
    name: { en: "Cancun", es: "Cancún", it: "Cancun" },
    country: { en: "Mexico", es: "México", it: "Messico" },
    countryCode: "MX",
    continent: "americas",
    coordinates: { lat: 21.1619, lng: -86.8515 },
    stats: { avgStayDays: 5, bestMonths: [12, 1, 2, 3, 4], budgetLevel: 2 },
    tags: ["beach", "adventure", "cultural", "nature"],
    content: {
      tagline: { en: "Caribbean beaches meet ancient Mayan ruins", es: "Playas caribeñas se encuentran con ruinas mayas antiguas", it: "Spiagge caraibiche incontrano antiche rovine Maya" },
      description: { en: "Cancun offers turquoise Caribbean waters, ancient Mayan archaeological sites, and vibrant Mexican culture. Our AI plans beach days, Chichén Itzá trips, and cenote adventures into perfect vacation days.", es: "Cancún ofrece aguas caribeñas turquesas, sitios arqueológicos mayas antiguos y vibrante cultura mexicana.", it: "Cancun offre acque caraibiche turchesi, antichi siti archeologici Maya e vibrante cultura messicana." },
      highlights: [
        { icon: "🏖️", title: { en: "World-Class Beaches", es: "Playas de Clase Mundial", it: "Spiagge di Classe Mondiale" }, description: { en: "Crystal-clear Caribbean water and white sand stretching for miles", es: "Aguas cristalinas del Caribe y arena blanca que se extiende por kilómetros", it: "Acque cristalline dei Caraibi e sabbia bianca che si estende per chilometri" } },
        { icon: "🏛️", title: { en: "Mayan Ruins", es: "Ruinas Mayas", it: "Rovine Maya" }, description: { en: "Chichén Itzá, Tulum, and Cobá — ancient wonders within day-trip distance", es: "Chichén Itzá, Tulum y Cobá — maravillas antiguas a distancia de excursión", it: "Chichén Itzá, Tulum e Cobá — meraviglie antiche raggiungibili in gita" } },
        { icon: "💧", title: { en: "Cenotes", es: "Cenotes", it: "Cenote" }, description: { en: "Swim in sacred underground pools unique to the Yucatán Peninsula", es: "Nada en piscinas subterráneas sagradas únicas de la Península de Yucatán", it: "Nuota in piscine sotterranee sacre uniche della Penisola dello Yucatán" } },
      ],
      sampleDay: {
        activities: [
          { time: "07:00", type: "activity", title: { en: "Snorkeling at Isla Mujeres", es: "Snorkel en Isla Mujeres", it: "Snorkeling a Isla Mujeres" }, description: { en: "Ferry to the island for crystal-clear reef snorkeling", es: "Ferry a la isla para snorkel en arrecifes cristalinos", it: "Traghetto per l'isola per snorkeling nelle barriere cristalline" } },
          { time: "12:00", type: "lunch", title: { en: "Fresh ceviche on the beach", es: "Ceviche fresco en la playa", it: "Ceviche fresco sulla spiaggia" }, description: { en: "Freshly caught seafood at a beachfront restaurant", es: "Mariscos recién pescados en un restaurante frente al mar", it: "Pesce fresco in un ristorante fronte mare" } },
          { time: "14:30", type: "activity", title: { en: "Cenote swimming", es: "Natación en cenote", it: "Nuotata nel cenote" }, description: { en: "Cool off in an underground cenote with stalactites", es: "Refréscate en un cenote subterráneo con estalactitas", it: "Rinfrescati in un cenote sotterraneo con stalattiti" } },
          { time: "17:00", type: "walk", title: { en: "Hotel Zone beach walk", es: "Paseo por la playa de la Zona Hotelera", it: "Passeggiata sulla spiaggia della Zona Hotel" }, description: { en: "Sunset stroll along the turquoise Caribbean coast", es: "Paseo al atardecer por la costa turquesa del Caribe", it: "Passeggiata al tramonto lungo la costa turchese dei Caraibi" } },
          { time: "20:00", type: "dinner", title: { en: "Mexican dinner downtown", es: "Cena mexicana en el centro", it: "Cena messicana in centro" }, description: { en: "Authentic tacos and mezcal in Cancún's local downtown area", es: "Tacos auténticos y mezcal en el centro local de Cancún", it: "Tacos autentici e mezcal nel centro locale di Cancun" } },
        ],
      },
      faqs: [
        { question: { en: "How many days do I need in Cancun?", es: "¿Cuántos días necesito en Cancún?", it: "Quanti giorni servono a Cancun?" }, answer: { en: "5-7 days is ideal. 2-3 days for beaches, 1 day for Chichén Itzá, 1 day for cenotes, and 1-2 for Isla Mujeres or Tulum.", es: "5-7 días es ideal. 2-3 días para playas, 1 día para Chichén Itzá, 1 día para cenotes y 1-2 para Isla Mujeres o Tulum.", it: "5-7 giorni sono ideali. 2-3 giorni per le spiagge, 1 giorno per Chichén Itzá, 1 giorno per i cenote e 1-2 per Isla Mujeres o Tulum." } },
      ],
      ctaText: { en: "Ready to explore Cancun?", es: "¿Listo para explorar Cancún?", it: "Pronto per esplorare Cancun?" },
    },
  },

  // =========================================================================
  // RIO DE JANEIRO
  // =========================================================================
  {
    slug: "rio-de-janeiro",
    name: { en: "Rio de Janeiro", es: "Río de Janeiro", it: "Rio de Janeiro" },
    country: { en: "Brazil", es: "Brasil", it: "Brasile" },
    countryCode: "BR",
    continent: "americas",
    coordinates: { lat: -22.9068, lng: -43.1729 },
    stats: { avgStayDays: 5, bestMonths: [3, 4, 5, 9, 10], budgetLevel: 2 },
    tags: ["beach", "cultural", "nature", "nightlife"],
    content: {
      tagline: { en: "Beaches, mountains, and samba — the Marvelous City", es: "Playas, montañas y samba — la Ciudad Maravillosa", it: "Spiagge, montagne e samba — la Città Meravigliosa" },
      description: { en: "Rio stuns with dramatic landscapes — Sugarloaf Mountain rising from the bay, Christ the Redeemer overlooking it all, and Copacabana's golden beach. Our AI plans around beach time, hiking, and the best churrascarias.", es: "Río impresiona con paisajes dramáticos — el Pan de Azúcar elevándose sobre la bahía, el Cristo Redentor supervisándolo todo y la playa dorada de Copacabana.", it: "Rio stupisce con paesaggi drammatici — il Pan di Zucchero che si eleva dalla baia, il Cristo Redentore che sovrasta tutto e la spiaggia dorata di Copacabana." },
      highlights: [
        { icon: "🗻", title: { en: "Stunning Landscapes", es: "Paisajes Impresionantes", it: "Paesaggi Mozzafiato" }, description: { en: "Sugarloaf Mountain, Christ the Redeemer, and Tijuca Forest — nature meets city", es: "Pan de Azúcar, Cristo Redentor y Bosque de Tijuca — naturaleza y ciudad", it: "Pan di Zucchero, Cristo Redentore e Foresta di Tijuca — natura e città" } },
        { icon: "🏖️", title: { en: "Legendary Beaches", es: "Playas Legendarias", it: "Spiagge Leggendarie" }, description: { en: "Copacabana, Ipanema, and hidden coves along the coast", es: "Copacabana, Ipanema y calas escondidas a lo largo de la costa", it: "Copacabana, Ipanema e calette nascoste lungo la costa" } },
        { icon: "💃", title: { en: "Samba & Culture", es: "Samba y Cultura", it: "Samba e Cultura" }, description: { en: "Live samba in Lapa, street art in Santa Teresa, and vibrant nightlife", es: "Samba en vivo en Lapa, arte callejero en Santa Teresa y vibrante vida nocturna", it: "Samba dal vivo a Lapa, street art a Santa Teresa e vibrante vita notturna" } },
      ],
      sampleDay: {
        activities: [
          { time: "08:00", type: "sightseeing", title: { en: "Christ the Redeemer", es: "Cristo Redentor", it: "Cristo Redentore" }, description: { en: "Beat the crowds with an early morning visit", es: "Evita las multitudes con una visita temprana", it: "Evita la folla con una visita mattutina" } },
          { time: "10:30", type: "walk", title: { en: "Santa Teresa neighborhood", es: "Barrio de Santa Teresa", it: "Quartiere di Santa Teresa" }, description: { en: "Bohemian hillside streets with art galleries and cafés", es: "Calles bohemias en la ladera con galerías de arte y cafés", it: "Strade bohémien in collina con gallerie d'arte e caffè" } },
          { time: "13:00", type: "lunch", title: { en: "Feijoada lunch", es: "Almuerzo de feijoada", it: "Pranzo con feijoada" }, description: { en: "Brazil's national dish — black bean stew with all the fixings", es: "El plato nacional de Brasil — guiso de frijoles negros con todos los acompañamientos", it: "Il piatto nazionale del Brasile — stufato di fagioli neri con tutti i contorni" } },
          { time: "15:00", type: "activity", title: { en: "Ipanema Beach", es: "Playa de Ipanema", it: "Spiaggia di Ipanema" }, description: { en: "Relax on the famous beach with a caipirinha", es: "Relájate en la famosa playa con una caipiriña", it: "Rilassati sulla famosa spiaggia con una caipirinha" } },
          { time: "17:30", type: "sightseeing", title: { en: "Sugarloaf Mountain sunset", es: "Atardecer en el Pan de Azúcar", it: "Tramonto al Pan di Zucchero" }, description: { en: "Cable car to the summit for panoramic sunset views", es: "Teleférico a la cima para vistas panorámicas del atardecer", it: "Funivia sulla cima per viste panoramiche del tramonto" } },
          { time: "21:00", type: "nightlife", title: { en: "Samba in Lapa", es: "Samba en Lapa", it: "Samba a Lapa" }, description: { en: "Live samba music under the Lapa Arches", es: "Música samba en vivo bajo los Arcos de Lapa", it: "Musica samba dal vivo sotto gli Archi di Lapa" } },
        ],
      },
      faqs: [
        { question: { en: "How many days do I need in Rio?", es: "¿Cuántos días necesito en Río?", it: "Quanti giorni servono a Rio?" }, answer: { en: "4-5 days covers the highlights: Christ the Redeemer, Sugarloaf, beaches, and neighborhoods. Add 2 more for day trips to Petrópolis or Búzios.", es: "4-5 días cubren los highlights: Cristo Redentor, Pan de Azúcar, playas y barrios.", it: "4-5 giorni coprono i punti salienti: Cristo Redentore, Pan di Zucchero, spiagge e quartieri." } },
      ],
      ctaText: { en: "Ready to explore Rio?", es: "¿Listo para explorar Río?", it: "Pronto per esplorare Rio?" },
    },
  },

  // =========================================================================
  // DUBAI
  // =========================================================================
  {
    slug: "dubai",
    name: { en: "Dubai", es: "Dubái", it: "Dubai" },
    country: { en: "UAE", es: "EAU", it: "EAU" },
    countryCode: "AE",
    continent: "middle-east",
    coordinates: { lat: 25.2048, lng: 55.2708 },
    stats: { avgStayDays: 4, bestMonths: [11, 12, 1, 2, 3], budgetLevel: 3 },
    tags: ["urban", "shopping", "adventure", "foodie"],
    content: {
      tagline: { en: "Where the future meets the desert", es: "Donde el futuro se encuentra con el desierto", it: "Dove il futuro incontra il deserto" },
      description: { en: "Dubai is a city of superlatives — the tallest building, largest mall, and most extravagant experiences. But beyond the glitz, there's rich Emirati culture, golden deserts, and incredible food from every corner of the world.", es: "Dubái es una ciudad de superlativos — el edificio más alto, el centro comercial más grande y las experiencias más extravagantes.", it: "Dubai è una città di superlativi — l'edificio più alto, il centro commerciale più grande e le esperienze più stravaganti." },
      highlights: [
        { icon: "🏗️", title: { en: "Record-Breaking Architecture", es: "Arquitectura Récord", it: "Architettura da Record" }, description: { en: "Burj Khalifa, Palm Jumeirah, and the Museum of the Future — engineering marvels", es: "Burj Khalifa, Palm Jumeirah y el Museo del Futuro — maravillas de ingeniería", it: "Burj Khalifa, Palm Jumeirah e il Museo del Futuro — meraviglie dell'ingegneria" } },
        { icon: "🏜️", title: { en: "Desert Adventures", es: "Aventuras en el Desierto", it: "Avventure nel Deserto" }, description: { en: "Desert safaris, dune bashing, camel rides, and Bedouin dinners under the stars", es: "Safaris en el desierto, dune bashing, paseos en camello y cenas beduinas bajo las estrellas", it: "Safari nel deserto, dune bashing, gite in cammello e cene beduine sotto le stelle" } },
        { icon: "🛍️", title: { en: "World-Class Shopping", es: "Compras de Clase Mundial", it: "Shopping di Classe Mondiale" }, description: { en: "Dubai Mall, Gold Souk, and luxury boutiques — from traditional markets to mega malls", es: "Dubai Mall, Gold Souk y boutiques de lujo — desde mercados tradicionales hasta mega centros comerciales", it: "Dubai Mall, Gold Souk e boutique di lusso — dai mercati tradizionali ai mega centri commerciali" } },
      ],
      sampleDay: {
        activities: [
          { time: "09:00", type: "sightseeing", title: { en: "Burj Khalifa observation deck", es: "Mirador del Burj Khalifa", it: "Terrazza panoramica del Burj Khalifa" }, description: { en: "Views from the world's tallest building — book sunrise slot", es: "Vistas desde el edificio más alto del mundo — reserva el turno del amanecer", it: "Viste dall'edificio più alto del mondo — prenota lo slot dell'alba" } },
          { time: "11:00", type: "shopping", title: { en: "Dubai Mall & Aquarium", es: "Dubai Mall y Acuario", it: "Dubai Mall e Acquario" }, description: { en: "The world's largest mall with an indoor aquarium and waterfall", es: "El centro comercial más grande del mundo con acuario y cascada interior", it: "Il centro commerciale più grande del mondo con acquario e cascata interna" } },
          { time: "13:30", type: "lunch", title: { en: "Al Fahidi Historic District", es: "Distrito Histórico Al Fahidi", it: "Quartiere Storico Al Fahidi" }, description: { en: "Traditional Emirati cuisine in Dubai's oldest neighborhood", es: "Cocina emiratí tradicional en el barrio más antiguo de Dubái", it: "Cucina emiratina tradizionale nel quartiere più antico di Dubai" } },
          { time: "15:30", type: "activity", title: { en: "Gold & Spice Souks", es: "Zocos de Oro y Especias", it: "Souk dell'Oro e delle Spezie" }, description: { en: "Traditional markets across Dubai Creek by abra boat", es: "Mercados tradicionales cruzando Dubai Creek en barco abra", it: "Mercati tradizionali attraversando Dubai Creek in barca abra" } },
          { time: "17:00", type: "activity", title: { en: "Desert safari", es: "Safari en el desierto", it: "Safari nel deserto" }, description: { en: "Dune bashing, sunset photos, and BBQ dinner under the stars", es: "Dune bashing, fotos del atardecer y cena BBQ bajo las estrellas", it: "Dune bashing, foto del tramonto e cena BBQ sotto le stelle" } },
        ],
      },
      faqs: [
        { question: { en: "How many days do I need in Dubai?", es: "¿Cuántos días necesito en Dubái?", it: "Quanti giorni servono a Dubai?" }, answer: { en: "3-5 days covers the highlights well. 3 days for city attractions, add 1-2 for desert safari and Abu Dhabi day trip.", es: "3-5 días cubren los highlights bien. 3 días para atracciones de la ciudad, añade 1-2 para safari en el desierto y excursión a Abu Dhabi.", it: "3-5 giorni coprono bene i punti salienti. 3 giorni per le attrazioni della città, aggiungi 1-2 per safari nel deserto e gita ad Abu Dhabi." } },
      ],
      ctaText: { en: "Ready to explore Dubai?", es: "¿Listo para explorar Dubái?", it: "Pronto per esplorare Dubai?" },
    },
  },

  // =========================================================================
  // ISTANBUL
  // =========================================================================
  {
    slug: "istanbul",
    name: { en: "Istanbul", es: "Estambul", it: "Istanbul" },
    country: { en: "Turkey", es: "Turquía", it: "Turchia" },
    countryCode: "TR",
    continent: "europe",
    coordinates: { lat: 41.0082, lng: 28.9784 },
    stats: { avgStayDays: 4, bestMonths: [4, 5, 9, 10], budgetLevel: 1 },
    tags: ["cultural", "foodie", "historical", "romantic"],
    content: {
      tagline: { en: "Where East meets West across the Bosphorus", es: "Donde Oriente se encuentra con Occidente a través del Bósforo", it: "Dove Oriente incontra Occidente attraverso il Bosforo" },
      description: { en: "Istanbul straddles two continents with a history spanning empires — Byzantine churches, Ottoman mosques, and bustling bazaars. The food scene rivals any in the Mediterranean, and a Bosphorus cruise is unforgettable.", es: "Estambul se extiende por dos continentes con una historia que abarca imperios — iglesias bizantinas, mezquitas otomanas y bazares bulliciosos.", it: "Istanbul si estende su due continenti con una storia che abbraccia imperi — chiese bizantine, moschee ottomane e bazar vivaci." },
      highlights: [
        { icon: "🕌", title: { en: "Historic Mosques", es: "Mezquitas Históricas", it: "Moschee Storiche" }, description: { en: "Hagia Sophia, Blue Mosque, and Süleymaniye — stunning Ottoman architecture", es: "Santa Sofía, Mezquita Azul y Süleymaniye — impresionante arquitectura otomana", it: "Santa Sofia, Moschea Blu e Süleymaniye — straordinaria architettura ottomana" } },
        { icon: "🧆", title: { en: "Incredible Food", es: "Comida Increíble", it: "Cibo Incredibile" }, description: { en: "Kebabs, mezes, baklava, and Turkish breakfast — a foodie's dream at great prices", es: "Kebabs, mezes, baklava y desayuno turco — un sueño para foodies a precios geniales", it: "Kebab, meze, baklava e colazione turca — un sogno per i foodie a prezzi ottimi" } },
        { icon: "🛥️", title: { en: "Bosphorus Strait", es: "Estrecho del Bósforo", it: "Stretto del Bosforo" }, description: { en: "Cruise between Europe and Asia with palace and fortress views", es: "Navega entre Europa y Asia con vistas a palacios y fortalezas", it: "Naviga tra Europa e Asia con viste su palazzi e fortezze" } },
      ],
      sampleDay: {
        activities: [
          { time: "09:00", type: "sightseeing", title: { en: "Hagia Sophia", es: "Santa Sofía", it: "Santa Sofia" }, description: { en: "1,500-year-old architectural wonder — church, mosque, museum, mosque again", es: "Maravilla arquitectónica de 1.500 años — iglesia, mezquita, museo, mezquita de nuevo", it: "Meraviglia architettonica di 1.500 anni — chiesa, moschea, museo, di nuovo moschea" } },
          { time: "11:00", type: "sightseeing", title: { en: "Topkapi Palace", es: "Palacio de Topkapi", it: "Palazzo Topkapi" }, description: { en: "Ottoman sultans' residence with treasury and harem", es: "Residencia de los sultanes otomanos con tesoro y harén", it: "Residenza dei sultani ottomani con tesoro e harem" } },
          { time: "13:00", type: "lunch", title: { en: "Turkish lunch near Grand Bazaar", es: "Almuerzo turco cerca del Gran Bazar", it: "Pranzo turco vicino al Gran Bazar" }, description: { en: "Kebabs, pide, and fresh pomegranate juice", es: "Kebabs, pide y zumo fresco de granada", it: "Kebab, pide e succo fresco di melograno" } },
          { time: "14:30", type: "shopping", title: { en: "Grand Bazaar", es: "Gran Bazar", it: "Gran Bazar" }, description: { en: "One of the world's oldest covered markets — 4,000+ shops", es: "Uno de los mercados cubiertos más antiguos del mundo — más de 4.000 tiendas", it: "Uno dei mercati coperti più antichi del mondo — oltre 4.000 negozi" } },
          { time: "17:00", type: "activity", title: { en: "Bosphorus cruise", es: "Crucero por el Bósforo", it: "Crociera sul Bosforo" }, description: { en: "Sail between two continents at sunset", es: "Navega entre dos continentes al atardecer", it: "Naviga tra due continenti al tramonto" } },
          { time: "20:00", type: "dinner", title: { en: "Dinner in Karaköy", es: "Cena en Karaköy", it: "Cena a Karaköy" }, description: { en: "Modern Turkish cuisine in Istanbul's trendiest district", es: "Cocina turca moderna en el distrito más trendy de Estambul", it: "Cucina turca moderna nel quartiere più trendy di Istanbul" } },
        ],
      },
      faqs: [
        { question: { en: "How many days do I need in Istanbul?", es: "¿Cuántos días necesito en Estambul?", it: "Quanti giorni servono a Istanbul?" }, answer: { en: "4-5 days covers both the European and Asian sides well. The historic peninsula needs 2 days, then add Bosphorus, Kadıköy, and bazaars.", es: "4-5 días cubren bien los lados europeo y asiático. La península histórica necesita 2 días.", it: "4-5 giorni coprono bene sia il lato europeo che quello asiatico. La penisola storica necessita di 2 giorni." } },
      ],
      ctaText: { en: "Ready to explore Istanbul?", es: "¿Listo para explorar Estambul?", it: "Pronto per esplorare Istanbul?" },
    },
  },

  // =========================================================================
  // MARRAKECH
  // =========================================================================
  {
    slug: "marrakech",
    name: { en: "Marrakech", es: "Marrakech", it: "Marrakech" },
    country: { en: "Morocco", es: "Marruecos", it: "Marocco" },
    countryCode: "MA",
    continent: "africa",
    coordinates: { lat: 31.6295, lng: -7.9811 },
    stats: { avgStayDays: 3, bestMonths: [3, 4, 5, 10, 11], budgetLevel: 1 },
    tags: ["cultural", "foodie", "offbeat", "romantic"],
    content: {
      tagline: { en: "Riads, souks, and Saharan magic", es: "Riads, zocos y magia sahariana", it: "Riad, souk e magia sahariana" },
      description: { en: "Marrakech is a feast for the senses — spice-filled souks, mosaic-tiled riads, and the electric energy of Jemaa el-Fnaa square. Our AI navigates the medina maze and finds the best hidden restaurants and rooftop terraces.", es: "Marrakech es un festín para los sentidos — zocos llenos de especias, riads con azulejos de mosaico y la energía eléctrica de la plaza Jemaa el-Fnaa.", it: "Marrakech è una festa per i sensi — souk pieni di spezie, riad con piastrelle a mosaico e l'energia elettrica di piazza Jemaa el-Fnaa." },
      highlights: [
        { icon: "🕌", title: { en: "Medina & Souks", es: "Medina y Zocos", it: "Medina e Souk" }, description: { en: "UNESCO-listed old city with labyrinthine markets, artisan workshops, and hidden gardens", es: "Ciudad antigua patrimonio UNESCO con mercados laberínticos, talleres artesanales y jardines ocultos", it: "Città antica patrimonio UNESCO con mercati labirintici, botteghe artigiane e giardini nascosti" } },
        { icon: "🏡", title: { en: "Stunning Riads", es: "Riads Impresionantes", it: "Riad Mozzafiato" }, description: { en: "Traditional courtyard houses turned boutique hotels — affordable luxury", es: "Casas con patio tradicional convertidas en hoteles boutique — lujo asequible", it: "Case con cortile tradizionale trasformate in boutique hotel — lusso accessibile" } },
        { icon: "🍲", title: { en: "Moroccan Cuisine", es: "Cocina Marroquí", it: "Cucina Marocchina" }, description: { en: "Tagines, couscous, pastilla, and mint tea — incredible flavors at every meal", es: "Tagines, cuscús, pastilla y té de menta — sabores increíbles en cada comida", it: "Tagine, couscous, pastilla e tè alla menta — sapori incredibili ad ogni pasto" } },
      ],
      sampleDay: {
        activities: [
          { time: "09:00", type: "sightseeing", title: { en: "Bahia Palace", es: "Palacio Bahia", it: "Palazzo Bahia" }, description: { en: "Stunning 19th-century palace with intricate tilework and gardens", es: "Impresionante palacio del siglo XIX con azulejos intrincados y jardines", it: "Splendido palazzo del XIX secolo con piastrelle elaborate e giardini" } },
          { time: "10:30", type: "shopping", title: { en: "Souk exploration", es: "Exploración del zoco", it: "Esplorazione del souk" }, description: { en: "Navigate the colorful markets — leather, spices, ceramics, and textiles", es: "Navega por los coloridos mercados — cuero, especias, cerámica y textiles", it: "Naviga nei colorati mercati — pelle, spezie, ceramiche e tessuti" } },
          { time: "13:00", type: "lunch", title: { en: "Rooftop lunch", es: "Almuerzo en azotea", it: "Pranzo sul terrazzo" }, description: { en: "Tagine with Atlas Mountain views from a medina rooftop", es: "Tagine con vistas a las montañas del Atlas desde una azotea de la medina", it: "Tagine con vista sulle montagne dell'Atlas da un terrazzo della medina" } },
          { time: "15:00", type: "sightseeing", title: { en: "Jardin Majorelle", es: "Jardín Majorelle", it: "Giardino Majorelle" }, description: { en: "Yves Saint Laurent's cobalt-blue garden oasis", es: "El oasis de jardín azul cobalto de Yves Saint Laurent", it: "L'oasi del giardino blu cobalto di Yves Saint Laurent" } },
          { time: "17:30", type: "activity", title: { en: "Hammam experience", es: "Experiencia de hammam", it: "Esperienza di hammam" }, description: { en: "Traditional Moroccan bath and scrub — ultimate relaxation", es: "Baño y exfoliación marroquí tradicional — relajación total", it: "Bagno e scrub marocchino tradizionale — relax totale" } },
          { time: "20:00", type: "dinner", title: { en: "Jemaa el-Fnaa food stalls", es: "Puestos de comida de Jemaa el-Fnaa", it: "Bancarelle di cibo di Jemaa el-Fnaa" }, description: { en: "The famous night market transforms into an open-air restaurant", es: "El famoso mercado nocturno se transforma en un restaurante al aire libre", it: "Il famoso mercato notturno si trasforma in un ristorante all'aperto" } },
        ],
      },
      faqs: [
        { question: { en: "How many days do I need in Marrakech?", es: "¿Cuántos días necesito en Marrakech?", it: "Quanti giorni servono a Marrakech?" }, answer: { en: "3-4 days for the city. Add 2 days for Atlas Mountains or Sahara Desert excursions.", es: "3-4 días para la ciudad. Añade 2 días para excursiones a las montañas del Atlas o el desierto del Sahara.", it: "3-4 giorni per la città. Aggiungi 2 giorni per escursioni sulle montagne dell'Atlas o nel deserto del Sahara." } },
      ],
      ctaText: { en: "Ready to explore Marrakech?", es: "¿Listo para explorar Marrakech?", it: "Pronto per esplorare Marrakech?" },
    },
  },
];

// ============================================================================
// Helper functions
// ============================================================================

export function getDestinationBySlug(slug: string): Destination | undefined {
  return destinations.find((d) => d.slug === slug);
}

export function getAllSlugs(): string[] {
  return destinations.map((d) => d.slug);
}

export function getDestinationsByContinent(continent: string): Destination[] {
  return destinations.filter((d) => d.continent === continent);
}

export function getRelatedDestinations(
  slug: string,
  limit = 6
): Destination[] {
  const current = getDestinationBySlug(slug);
  if (!current) return destinations.slice(0, limit);

  // Same continent first, then others
  const sameContinent = destinations.filter(
    (d) => d.continent === current.continent && d.slug !== slug
  );
  const otherContinent = destinations.filter(
    (d) => d.continent !== current.continent
  );

  return [...sameContinent, ...otherContinent].slice(0, limit);
}
