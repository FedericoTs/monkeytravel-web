/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { isUsablePhoto, pickImages, plainArtist, searchQueries, thumbAt, travelSectionImages, type CommonsFile } from "./wikimedia";

/**
 * Which Commons photos may become a destination's cover or gallery: a free
 * licence, a landscape JPEG big enough for the hero, and a view of the place
 * rather than a map, a flag or an airport.
 */

const file = (name: string, extra: Partial<CommonsFile> = {}): CommonsFile => ({
  name,
  thumb: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${name.replace(/ /g, "_")}/1280px-${name.replace(/ /g, "_")}`,
  width: 4000,
  height: 2600,
  mime: "image/jpeg",
  license: "CC BY-SA 4.0",
  artist: "A Photographer",
  restrictions: "",
  ...extra,
});

describe("isUsablePhoto", () => {
  it("takes a large landscape JPEG under a free licence", () => {
    for (const license of ["CC BY-SA 4.0", "CC BY 2.0", "CC0", "Public domain"]) {
      expect(isUsablePhoto(file("Cathedral Rock.jpg", { license })), license).toBe(true);
    }
  });

  it("leaves out portraits, small files, other formats and other licences", () => {
    expect(isUsablePhoto(file("Tower.jpg", { width: 2000, height: 3000 }))).toBe(false);
    expect(isUsablePhoto(file("Square.jpg", { width: 1000, height: 600 }))).toBe(false);
    expect(isUsablePhoto(file("Lisboa837.png", { mime: "image/png" }))).toBe(false);
    expect(isUsablePhoto(file("Poster.jpg", { license: "Fair use" }))).toBe(false);
    expect(isUsablePhoto(file("Logo.jpg", { restrictions: "trademarked" }))).toBe(false);
  });

  it("needs an author it can name under an attribution licence, not under public domain", () => {
    expect(isUsablePhoto(file("Manarola.jpg", { artist: "" }))).toBe(false);
    expect(isUsablePhoto(file("Manarola.jpg", { artist: "", license: "CC BY 2.0" }))).toBe(false);
    expect(isUsablePhoto(file("Sedona.jpg", { artist: "", license: "Public domain" }))).toBe(true);
    expect(isUsablePhoto(file("Sedona.jpg", { artist: "", license: "CC0" }))).toBe(true);
  });

  it("leaves out maps, flags and transport hubs, but not a word that merely contains one", () => {
    for (const name of ["Pombaline Baixa Lisbon map 1756.jpg", "Aeroporto Lisboa - panoramio.jpg", "Airport_in_Tivat.jpg", "2018 Medellín - buseta en la calle 45.jpg"]) {
      expect(isUsablePhoto(file(name)), name).toBe(false);
    }
    expect(isUsablePhoto(file("Maple Leaf Gardens.jpg"))).toBe(true);
  });
});

describe("travelSectionImages", () => {
  const wikitext = [
    "== Understand ==",
    "[[File:Lisboa - Vista Geral2.jpg|thumb|Lisbon]]",
    "== Get in ==",
    "[[File:Aeroporto Lisboa - panoramio.jpg|thumb|The airport]]",
    "== See ==",
    "=== Castles ===",
    "* {{see | name=São Jorge Castle | image=LisbonCastle.jpg | lat= }}",
    "[[Image:Belem_Tower.jpg|thumb]] and again [[File:LisbonCastle.jpg]]",
    "== Sleep ==",
    "[[File:Hotel lobby.jpg]]",
  ].join("\n");

  it("takes the See, Do and Understand sections, sub-sections included, in order", () => {
    expect(travelSectionImages(wikitext)).toEqual(["Lisboa - Vista Geral2.jpg", "LisbonCastle.jpg", "Belem_Tower.jpg"]);
  });
});

describe("plainArtist", () => {
  it("reads the name out of Commons' HTML", () => {
    expect(plainArtist('<a href="//commons.wikimedia.org/wiki/User:X">Luis90f</a>')).toBe("Luis90f");
    expect(plainArtist("This image is a work by Mercy.\nWhen reusing, credit...")).toBe("This image is a work by Mercy.");
  });

  it("takes the name out of an author's note, which can start on a later line", () => {
    const note =
      '<table class="toccolours">\n\n<tbody><tr>\n<td>This Photo was taken by A. B. Photographer . Feel free to use my photos, but please mention me as the author.</td></tr></tbody></table>';
    expect(plainArtist(note)).toBe("A. B. Photographer");
    expect(plainArtist("\n<span>Short Name</span>")).toBe("Short Name");
    expect(plainArtist("A very long note that never says who took the picture, only how it may be used.")).toBe("");
  });

  it("is empty when the field names nobody", () => {
    expect(plainArtist("No machine-readable author provided. Sudo assumed.")).toBe("");
    expect(plainArtist("")).toBe("");
  });
});

describe("thumbAt", () => {
  it("swaps the width of a Commons thumbnail URL", () => {
    expect(thumbAt("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/1280px-X.jpg", 330)).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/330px-X.jpg",
    );
  });
});

describe("searchQueries", () => {
  it("searches the whole destination, then its first place", () => {
    expect(searchQueries("Medellín, Colombia")).toEqual(["Medellín, Colombia", "Medellín"]);
    expect(searchQueries("Tokyo, Kyoto & Hiroshima")).toEqual(["Tokyo, Kyoto & Hiroshima", "Tokyo"]);
    expect(searchQueries(" Bali ")).toEqual(["Bali"]);
  });
});

describe("pickImages", () => {
  it("covers with the Wikidata or lead image when usable, then fills the gallery", () => {
    const files = [file("Panorama.jpg"), file("Castle.jpg"), file("Square.jpg"), file("Bridge.jpg"), file("River.jpg"), file("Tram.jpg")];
    const picked = pickImages(files, (f) => f.name === "Panorama.jpg");
    expect(picked?.cover.name).toBe("Panorama.jpg");
    expect(picked?.gallery.map((f) => f.name)).toEqual(["Castle.jpg", "Square.jpg", "Bridge.jpg", "River.jpg"]);
  });

  it("covers with the first usable photo when the Wikidata image is not", () => {
    const picked = pickImages([file("Lisboa837.png", { mime: "image/png" }), file("Castle.jpg")], (f) => f.name === "Lisboa837.png");
    expect(picked?.cover.name).toBe("Castle.jpg");
    expect(picked?.gallery).toEqual([]);
  });

  it("is null with no usable photo", () => {
    expect(pickImages([file("Courthouse.jpg", { width: 1200, height: 1600 })], () => true)).toBeNull();
  });
});
