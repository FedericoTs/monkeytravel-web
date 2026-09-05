import { describe, expect, it } from "vitest";
import { detectLanguage, itineraryDayText, tokenize } from "./detect-language";

const EN =
  "Start the morning at the Jerónimos Monastery, one of the most striking examples of Manueline architecture in the city. " +
  "Then stroll along the river to the Belém Tower and enjoy a pastel de nata from the famous bakery before lunch.";
const ES =
  "Comienza la mañana en el Monasterio de los Jerónimos, uno de los ejemplos más impresionantes de la arquitectura manuelina de la ciudad. " +
  "Luego pasea por el río hasta la Torre de Belém y disfruta de un pastel de nata en la famosa pastelería antes del almuerzo.";
const IT =
  "Inizia la mattina al Monastero dos Jerónimos, uno degli esempi più sorprendenti di architettura manuelina della città. " +
  "Poi passeggia lungo il fiume fino alla Torre di Belém e goditi un pastel de nata nella famosa pasticceria prima di pranzo.";
const PT =
  "Comece a manhã no Mosteiro dos Jerónimos, um dos exemplos mais impressionantes da arquitetura manuelina da cidade. " +
  "Depois passeie pelo rio até à Torre de Belém e aproveite um pastel de nata na famosa pastelaria antes do almoço.";

describe("detectLanguage", () => {
  it("separates the four languages on itinerary-style prose", () => {
    expect(detectLanguage(EN).language).toBe("en");
    expect(detectLanguage(ES).language).toBe("es");
    expect(detectLanguage(IT).language).toBe("it");
    expect(detectLanguage(PT).language).toBe("pt");
  });

  it("returns null on too little text", () => {
    expect(detectLanguage("Museo del Prado").language).toBeNull();
    expect(detectLanguage("").language).toBeNull();
  });

  it("returns null on a list of proper nouns with no function words", () => {
    const names = "Alfama Belém Sintra Cascais Bairro Alto Chiado Baixa Graça Estrela Lapa Campo Ourique";
    expect(detectLanguage(names).language).toBeNull();
  });

  it("tokenizes accents and apostrophes without splitting words", () => {
    expect(tokenize("L'après-midi, città è più bella.")).toEqual(["l'après-midi", "città", "è", "più", "bella"]);
  });
});

describe("itineraryDayText", () => {
  it("collects day prose and activity descriptions, not names or locations", () => {
    const day = {
      day: 5,
      title: "Belém e il fiume",
      activities: [
        { name: "Torre de Belém", location: "Belém", description: "Visita la torre e goditi la vista sul fiume." },
        { name: "Pastéis de Belém", description: "Assaggia il famoso pastel de nata.", tips: "Arriva prima delle 10." },
      ],
    };
    const text = itineraryDayText(day);
    expect(text).toContain("Belém e il fiume");
    expect(text).toContain("goditi la vista");
    expect(text).toContain("Arriva prima");
    expect(text).not.toContain("Torre de Belém");
    expect(detectLanguage(text).language).toBe("it");
  });

  it("is safe on junk", () => {
    expect(itineraryDayText(null)).toBe("");
    expect(itineraryDayText({ activities: "nope" })).toBe("");
  });
});
