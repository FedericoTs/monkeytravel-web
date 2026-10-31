/**
 * Search links to book a trip's flights and stays, built by the server.
 * Pure (types and a date helper only), so the multi-city and anchored merges
 * can use it.
 */
import type { BookingLink, GeneratedItinerary, TripCreationParams } from "@/types";
import { addIsoDays } from "@/lib/dates/iso-date";

type TripDates = Pick<TripCreationParams, "destination" | "startDate" | "endDate">;

/**
 * A Google Flights search, which reads a sentence: the destination and the
 * dates, from wherever the traveller is. Without a return date it is one way.
 */
export function flightLink(destination: string, start: string, end?: string): BookingLink {
  const q = end ? `Flights to ${destination} on ${start} through ${end}` : `One way flights to ${destination} on ${start}`;
  return { provider: "Google Flights", url: `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`, label: "Search on Google Flights" };
}

/** Booking.com and Airbnb searches for a stay of at least one night. */
export function hotelLinks(place: string, checkin: string, checkout: string, city?: string): BookingLink[] {
  const encoded = encodeURIComponent(place);
  const out = checkout > checkin ? checkout : (addIsoDays(checkin, 1) ?? checkout);
  const where = city ? { city } : {};
  return [
    { provider: "Booking.com", url: `https://www.booking.com/searchresults.html?ss=${encoded}&checkin=${checkin}&checkout=${out}`, label: "Find hotels on Booking.com", ...where },
    { provider: "Airbnb", url: `https://www.airbnb.com/s/${encoded}/homes?checkin=${checkin}&checkout=${out}`, label: "Browse Airbnb stays", ...where },
  ];
}

/** The links to book flights and stays for a trip. */
export function bookingLinksFor(params: TripDates): NonNullable<GeneratedItinerary["booking_links"]> {
  return {
    flights: [flightLink(params.destination, params.startDate, params.endDate)],
    hotels: hotelLinks(params.destination, params.startDate, params.endDate),
  };
}
