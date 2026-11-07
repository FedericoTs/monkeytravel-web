/**
 * The match's photos, tall and large enough to fill a phone or a story, chosen
 * by hand from Pexels. Served from Pexels' own image CDN at the size each use
 * needs, so they cost nothing to host. Safe for the browser.
 */
export interface PlacePhoto {
  id: number;
  by: string;
}

export const PLACE_PHOTOS: Readonly<Record<string, PlacePhoto>> = {
  paris: { id: 18455482, by: "Joan Costa" },
  rome: { id: 18001118, by: "C1 Superstar" },
  barcelona: { id: 2567935, by: "Mario Cuadros" },
  tokyo: { id: 20257063, by: "Albin Ejupi" },
  "new-york": { id: 35566809, by: "Constanze Marie" },
  london: { id: 16124533, by: "Mathias Reding" },
  amsterdam: { id: 31173363, by: "Mathias Reding" },
  prague: { id: 18613239, by: "Roberto Belelli" },
  lisbon: { id: 20197709, by: "Alexander Ruiz" },
  vienna: { id: 30279319, by: "Sandin Redzo" },
  berlin: { id: 37243910, by: "Adrian Smarrelli" },
  bangkok: { id: 26847891, by: "Johan Van Geijl" },
  bali: { id: 2088019, by: "Atlantic Ambience" },
  seoul: { id: 37821273, by: "Rüveyda Akkaya" },
  singapore: { id: 36601501, by: "Gatsby Yang" },
  cancun: { id: 31475559, by: "Reese McKenna" },
  "rio-de-janeiro": { id: 38731293, by: "Nathan Martins" },
  dubai: { id: 38866155, by: "Irshad Ahmad" },
  istanbul: { id: 14886478, by: "Kübra Aslan" },
  marrakech: { id: 32523931, by: "ubeyonroad" },
  benidorm: { id: 34975828, by: "ronyescobarhn" },
  "hong-kong": { id: 17922844, by: "Chris" },
  taipei: { id: 1717931, by: "Timo Volz" },
  lima: { id: 39406160, by: "Leandra FF" },
  nairobi: { id: 33650703, by: "Alex Ning" },
  budapest: { id: 16356279, by: "Incze Sándor Zoltán" },
  bordeaux: { id: 13642040, by: "Ertabbt" },
  kyoto: { id: 37124835, by: "Audrey Bory" },
  osaka: { id: 35905534, by: "Ricardo Mayoral" },
  madrid: { id: 37526384, by: "Joshuan Barboza" },
  santorini: { id: 16563668, by: "AXP Photography" },
};

/** The picture behind each question. */
export const QUESTION_PHOTOS = [
  PLACE_PHOTOS.cancun.id,
  PLACE_PHOTOS.tokyo.id,
  PLACE_PHOTOS.kyoto.id,
  PLACE_PHOTOS.lisbon.id,
  23844219, // "Who's coming?": people on a hill at sunset
  PLACE_PHOTOS.santorini.id,
] as const;

export const START_PHOTOS = [PLACE_PHOTOS.santorini.id, PLACE_PHOTOS.tokyo.id, PLACE_PHOTOS.lisbon.id, PLACE_PHOTOS.bali.id] as const;

export function photoUrl(id: number, width: number, height: number): string {
  return `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${width}&h=${height}&fit=crop`;
}
