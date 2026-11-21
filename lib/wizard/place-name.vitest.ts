import { describe, expect, it } from "vitest";
import { tidyTypedPlace } from "./place-name";

/**
 * The cities typed into a route become the plan's day headings and its transfer
 * cards ("Train to Kyoto"), so a name typed all in lower case is written the
 * way the place is written.
 */

describe("tidyTypedPlace", () => {
  it("capitalises a name typed in lower case", () => {
    expect(tidyTypedPlace("kyoto")).toBe("Kyoto");
    expect(tidyTypedPlace("ho chi minh city")).toBe("Ho Chi Minh City");
    expect(tidyTypedPlace("halong bay")).toBe("Halong Bay");
    expect(tidyTypedPlace("são paulo")).toBe("São Paulo");
    expect(tidyTypedPlace("москва")).toBe("Москва");
  });

  it("keeps the small words of a name small, except where the name starts", () => {
    expect(tidyTypedPlace("monaco di baviera")).toBe("Monaco di Baviera");
    expect(tidyTypedPlace("rio de janeiro")).toBe("Rio de Janeiro");
    expect(tidyTypedPlace("foz do iguaçu")).toBe("Foz do Iguaçu");
    expect(tidyTypedPlace("isle of skye")).toBe("Isle of Skye");
    expect(tidyTypedPlace("frankfurt am main")).toBe("Frankfurt am Main");
    expect(tidyTypedPlace("aix-en-provence")).toBe("Aix-en-Provence");
    expect(tidyTypedPlace("stratford-upon-avon")).toBe("Stratford-upon-Avon");
    expect(tidyTypedPlace("la paz")).toBe("La Paz");
    expect(tidyTypedPlace("the hague")).toBe("The Hague");
  });

  it("starts again after a comma, and writes the short forms in capitals", () => {
    expect(tidyTypedPlace("la paz, bolivia")).toBe("La Paz, Bolivia");
    expect(tidyTypedPlace("logroño, la rioja")).toBe("Logroño, La Rioja");
    expect(tidyTypedPlace("london, uk")).toBe("London, UK");
    expect(tidyTypedPlace("washington dc")).toBe("Washington DC");
    expect(tidyTypedPlace("dubai, uae")).toBe("Dubai, UAE");
  });

  it("follows an apostrophe the way Italian names do", () => {
    expect(tidyTypedPlace("l'aquila")).toBe("L'Aquila");
    expect(tidyTypedPlace("cortina d'ampezzo")).toBe("Cortina d'Ampezzo");
    expect(tidyTypedPlace("castell'arquato")).toBe("Castell'Arquato");
    expect(tidyTypedPlace("reggio nell'emilia")).toBe("Reggio nell'Emilia");
  });

  it("leaves a name typed with any capital as it was typed, only trimmed", () => {
    expect(tidyTypedPlace("brigton UK")).toBe("brigton UK");
    expect(tidyTypedPlace("Kuala lumpur")).toBe("Kuala lumpur");
    expect(tidyTypedPlace("  Athens  or Greek Island ")).toBe("Athens or Greek Island");
  });

  it("trims and closes up the spaces of a name it tidies", () => {
    expect(tidyTypedPlace("  new   york ")).toBe("New York");
    expect(tidyTypedPlace("京都")).toBe("京都");
  });
});
