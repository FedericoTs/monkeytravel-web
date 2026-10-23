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

  it("leaves out the district map of a Districts section, but not its photos", () => {
    const districts = [
      "==Districts==",
      "{{Regionlist",
      "|region1name=[[Prague/Old Town and Josefov|Old Town and Josefov]]",
      "}}",
      "[[File:Prague_districts_en_wv.jpg|thumb|250px|Map of the neighbourhoods of Prague]]",
      "[[File:Korea-Seoul-Cheonggyecheon-2008-01.jpg|300px|thumb|[[Seoul/Jung#Q495437|Cheonggyecheon creek]] in central Seoul]]",
      "== Understand ==",
      "[[File:Prague skyline view.jpg|thumb|left|250px|View along the Vltava River]]",
    ].join("\n");
    expect(travelSectionImages(districts)).toEqual(["Korea-Seoul-Cheonggyecheon-2008-01.jpg", "Prague skyline view.jpg"]);
  });
});

describe("plainArtist", () => {
  it("reads the name out of Commons' HTML", () => {
    expect(plainArtist('<a href="//commons.wikimedia.org/wiki/User:X">Luis90f</a>')).toBe("Luis90f");
    expect(plainArtist("This image is a work by Mercy.\nWhen reusing, credit...")).toBe("Mercy");
    expect(plainArtist("Rich Niewiroski Jr.")).toBe("Rich Niewiroski Jr.");
  });

  it("drops what Commons puts around the name", () => {
    const cases: [string, string][] = [
      ['<a href="https://www.flickr.com/people/72746018@N00">Jean-Pierre Dalbéra</a> from Paris, France', "Jean-Pierre Dalbéra"],
      ['Photograph by <a href="//commons.wikimedia.org/wiki/User:Mike_Peel">Mike Peel</a> (<a href="https://www.mikepeel.net/">www.mikepeel.net</a>).', "Mike Peel"],
      ['Photo by <a href="//commons.wikimedia.org/wiki/User:Kmf164">User:Kmf164</a>.', "Kmf164"],
      [
        'The original uploader was <a href="https://en.wikipedia.org/wiki/ja:User:K._Takeda">K. Takeda</a> at <a href="https://en.wikipedia.org/wiki/ja:">Japanese Wikipedia</a>.',
        "K. Takeda",
      ],
      ['<a href="https://en.wikipedia.org/wiki/User:Jgera5">Jgera5</a> (<a href="https://en.wikipedia.org/wiki/User_talk:Jgera5">talk</a>) (<a href="https://en.wikipedia.org/wiki/Special:ListFiles/Jgera5">Uploads</a>)', "Jgera5"],
      ['<a href="//commons.wikimedia.org/wiki/User:Alno">AlNo</a> <a href="//commons.wikimedia.org/wiki/User_talk:Alno">(discuter/talk/hablar/falar)</a>', "AlNo"],
      ['<a href="//commons.wikimedia.org/wiki/User:%C5%A0J%C5%AF">ŠJů</a> (<a href="https://cs.wikipedia.org/wiki/User:%C5%A0J%C5%AF">cs:ŠJů</a>)', "ŠJů"],
      ['Miguel Vieira <a href="https://www.flickr.com/photos/miguelvieira/">[2]</a>', "Miguel Vieira"],
      ['<b><a href="//commons.wikimedia.org/wiki/User:Der_Wolf_im_Wald">Thomas Wolf</a></b>, <small><a href="http://www.foto-tw.de">www.foto-tw.de</a></small>', "Thomas Wolf"],
      ['Flickr user: Max Grabert <a href="https://www.flickr.com/people/maxgrabert/">https://www.flickr.com/people/maxgrabert/</a>', "Max Grabert"],
      ['Source: <a href="//commons.wikimedia.org/wiki/User:Godot13">User:Godot13</a> <br> Derivative: <a href="//commons.wikimedia.org/wiki/User:MathKnight">User:MathKnight</a>', "Godot13"],
      [
        '<ul><li><a href="//commons.wikimedia.org/wiki/File:Chicago_River_ferry.jpg">File:Chicago River ferry.jpg</a>: <a href="https://www.flickr.com/people/21532476@N00">John Picken</a></li>\n<li>derivative work: Georgfotoart</li></ul>',
        "John Picken",
      ],
      ["J. Miers - User: (WT-shared) Jtesla16 at wts wikivoyage", "J. Miers"],
      ['<a href="https://en.wikivoyage.org/wiki/User:(WT-en)_Fabz">(WT-en) Fabz</a> at <a href="https://en.wikivoyage.org/wiki/">English Wikivoyage</a>', "Fabz"],
      ['<p>. </p> The original uploader was <a href="https://en.wikipedia.org/wiki/User:Abdominator">Abdominator</a> at English Wikipedia.', "Abdominator"],
      ['<a href="//commons.wikimedia.org/wiki/Special:Contributions/Yuezhi_Huang">User:Yuezhi_Huang</a>', "Yuezhi Huang"],
      ["Fcb981 ; Eric Baetscher (attribution required)", "Fcb981; Eric Baetscher"],
      ["U.S. Air Force photo by Yasuo Osakabe", "Yasuo Osakabe"],
      [
        '<a href="https://en.wikipedia.org/wiki/User:Simisa">Simisa</a> (<a href="https://en.wikipedia.org/wiki/User_talk:Simisa">talk</a> · <a href="https://en.wikipedia.org/wiki/Special:Contributions/Simisa">contribs</a>)',
        "Simisa",
      ],
      ['w00kie / <a href="https://www.flickr.com/photos/w00kie/">https://www.flickr.com/photos/w00kie/</a>', "w00kie"],
      [
        '<p><b>Original: </b> <a href="https://www.flickr.com/people/150102727@N06">Nina R</a> from Africa\n</p>\n<small><b>Derivative work: </b> <a href="//commons.wikimedia.org/wiki/User:UnpetitproleX">UnpetitproleX</a></small>',
        "Nina R",
      ],
      ['<a href="https://en.wikipedia.org/wiki/User:Atlantacitizen">w:User:Atlantacitizen</a>', "Atlantacitizen"],
      ['<a href="https://de.wikipedia.org/wiki/Benutzer:Olbertz">Olbertz</a> 23:14, 21. Dez. 2010 (CET)', "Olbertz"],
      ["Pumuckel42 (Reinhard Wolf) at de:Wikipedia", "Pumuckel42 (Reinhard Wolf)"],
      ["Franz Richter (User:FRZ)", "Franz Richter (FRZ)"],
      ["Nicholas Even (own work)", "Nicholas Even"],
    ];
    for (const [html, name] of cases) expect(plainArtist(html)).toBe(name);
  });

  it("keeps what is part of the name", () => {
    expect(plainArtist('Marc Ryckaert (<a href="//commons.wikimedia.org/wiki/User:MJJR">MJJR</a>)')).toBe("Marc Ryckaert (MJJR)");
    expect(plainArtist('<a href="//commons.wikimedia.org/wiki/User:Mariordo">Mariordo (Mario Roberto Durán Ortiz)</a>')).toBe(
      "Mariordo (Mario Roberto Durán Ortiz)",
    );
    expect(plainArtist('Brady Smith; <a href="https://www.flickr.com/people/42034606@N05">Coconino National Forest</a>')).toBe(
      "Brady Smith; Coconino National Forest",
    );
    expect(plainArtist("Byron Smith")).toBe("Byron Smith");
    expect(plainArtist("16:9clue")).toBe("16:9clue");
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
    expect(plainArtist('<a href="https://www.flickr.com/photos/12345678@N00/">https://www.flickr.com/photos/12345678@N00/</a>')).toBe("");
  });

  it("names the profile when the field is only a link to it", () => {
    expect(plainArtist('<a href="https://www.flickr.com/photos/adam_jones/">https://www.flickr.com/photos/adam_jones/</a>')).toBe("adam_jones");
    expect(plainArtist('<a href="http://en.wikipedia.org/wiki/User:DeliDumrul">http://en.wikipedia.org/wiki/User:DeliDumrul</a>')).toBe("DeliDumrul");
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
