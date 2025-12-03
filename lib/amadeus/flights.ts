/**
 * Flight Search Service
 *
 * Provides flight search, price confirmation, and booking functionality
 * using the Amadeus Flight Offers Search API.
 *
 * @see https://developers.amadeus.com/self-service/category/flights/api-doc/flight-offers-search
 */

import { getAmadeusClient, withAmadeusErrorHandling } from './client';
import { enqueueRequest } from './rate-limiter';
import { getCacheKey, getFromCache, setCache, withCache } from './cache';
import type {
  FlightSearchParams,
  FlightOffer,
  FlightSearchResponse,
  FlightOfferDisplay,
  TravelerInfo,
  ContactInfo,
} from './types';
import { AIRLINE_NAMES } from './types';
import { parseDuration, formatDuration, formatDateTime } from './utils';

/**
 * Search for flight offers
 *
 * @param params - Flight search parameters
 * @returns Flight offers with dictionaries for lookup
 */
export async function searchFlights(params: FlightSearchParams): Promise<{
  data: FlightOffer[];
  dictionaries: FlightSearchResponse['dictionaries'];
  cached: boolean;
}> {
  // Check cache first
  const cacheKey = getCacheKey('flights', params as unknown as Record<string, unknown>);
  const cached = getFromCache<{ data: FlightOffer[]; dictionaries: FlightSearchResponse['dictionaries'] }>(cacheKey);

  if (cached) {
    return { ...cached, cached: true };
  }

  // Make API request with rate limiting
  const result = await enqueueRequest(async () => {
    return withAmadeusErrorHandling(async () => {
      const amadeus = getAmadeusClient();

      const response = await amadeus.shopping.flightOffersSearch.get({
        originLocationCode: params.origin,
        destinationLocationCode: params.destination,
        departureDate: params.departureDate,
        returnDate: params.returnDate,
        adults: params.adults.toString(),
        ...(params.children && { children: params.children.toString() }),
        ...(params.infants && { infants: params.infants.toString() }),
        ...(params.travelClass && { travelClass: params.travelClass }),
        ...(params.nonStop !== undefined && { nonStop: params.nonStop }),
        ...(params.maxPrice && { maxPrice: params.maxPrice }),
        ...(params.currencyCode && { currencyCode: params.currencyCode }),
        max: params.max || 10, // Limit results to conserve API quota
      });

      return {
        data: response.data as FlightOffer[],
        dictionaries: response.result?.dictionaries,
      };
    }, 'searchFlights');
  });

  // Cache the result
  setCache(cacheKey, result, 'flights');

  return { ...result, cached: false };
}

/**
 * Confirm the price of a flight offer before booking
 * Prices can change between search and booking, so confirmation is required
 *
 * @param flightOffer - The flight offer to confirm
 * @returns Confirmed offer with updated pricing
 */
export async function confirmFlightPrice(flightOffer: FlightOffer): Promise<{
  data: FlightOffer;
  priceChanged: boolean;
  originalPrice: string;
  confirmedPrice: string;
}> {
  const originalPrice = flightOffer.price.grandTotal;

  const result = await enqueueRequest(async () => {
    return withAmadeusErrorHandling(async () => {
      const amadeus = getAmadeusClient();

      const response = await amadeus.shopping.flightOffers.pricing.post(
        JSON.stringify({
          data: {
            type: 'flight-offers-pricing',
            flightOffers: [flightOffer],
          },
        })
      );

      const responseData = response.data as { flightOffers: FlightOffer[] };
      return responseData.flightOffers[0];
    }, 'confirmFlightPrice');
  });

  const confirmedPrice = result.price.grandTotal;
  const priceChanged = confirmedPrice !== originalPrice;

  return {
    data: result,
    priceChanged,
    originalPrice,
    confirmedPrice,
  };
}

/**
 * Create a flight order (booking)
 * Phase 2 feature - requires consolidator partnership
 *
 * @param flightOffer - The confirmed flight offer
 * @param travelers - Traveler information
 * @param contact - Contact information
 * @returns Booking reference
 */
export async function createFlightOrder(
  flightOffer: FlightOffer,
  travelers: TravelerInfo[],
  contact: ContactInfo
): Promise<{
  orderId: string;
  reference: string;
  associatedRecords: Array<{ reference: string; creationDate: string; originSystemCode: string }>;
}> {
  return enqueueRequest(async () => {
    return withAmadeusErrorHandling(async () => {
      const amadeus = getAmadeusClient();

      const response = await amadeus.booking.flightOrders.post(
        JSON.stringify({
          data: {
            type: 'flight-order',
            flightOffers: [flightOffer],
            travelers,
            remarks: {
              general: [
                {
                  subType: 'GENERAL_MISCELLANEOUS',
                  text: 'MONKEYTRAVEL BOOKING',
                },
              ],
            },
            ticketingAgreement: {
              option: 'DELAY_TO_QUEUE',
            },
            contacts: [contact],
          },
        })
      );

      const responseData = response.data as {
        id: string;
        associatedRecords: Array<{ reference: string; creationDate: string; originSystemCode: string }>;
      };
      return {
        orderId: responseData.id,
        reference: responseData.associatedRecords[0]?.reference || '',
        associatedRecords: responseData.associatedRecords,
      };
    }, 'createFlightOrder');
  });
}

/**
 * Transform raw Amadeus flight offer to display-friendly format
 *
 * @param offer - Raw flight offer from API
 * @param dictionaries - Lookup dictionaries for codes
 * @returns Display-friendly flight offer
 */
export function transformFlightOffer(
  offer: FlightOffer,
  dictionaries?: FlightSearchResponse['dictionaries']
): FlightOfferDisplay {
  const outboundItinerary = offer.itineraries[0];
  const inboundItinerary = offer.itineraries[1];

  const firstSegment = outboundItinerary.segments[0];
  const lastOutboundSegment = outboundItinerary.segments[outboundItinerary.segments.length - 1];

  // Get airline name from dictionaries or fallback
  const airlineCode = offer.validatingAirlineCodes[0] || firstSegment.carrierCode;
  const airlineName = dictionaries?.carriers?.[airlineCode] ||
    (AIRLINE_NAMES as Record<string, string>)[airlineCode] ||
    airlineCode;

  // Calculate total stops
  const outboundStops = outboundItinerary.segments.length - 1;

  return {
    id: offer.id,
    airline: airlineCode,
    airlineName,
    flightNumber: `${firstSegment.carrierCode}${firstSegment.number}`,
    departureTime: firstSegment.departure.at,
    arrivalTime: lastOutboundSegment.arrival.at,
    departureAirport: firstSegment.departure.iataCode,
    arrivalAirport: lastOutboundSegment.arrival.iataCode,
    duration: outboundItinerary.duration,
    stops: outboundStops,
    price: parseFloat(offer.price.grandTotal),
    currency: offer.price.currency,
    cabin: offer.travelerPricings[0]?.fareDetailsBySegment[0]?.cabin || 'ECONOMY',
    seatsAvailable: offer.numberOfBookableSeats,
    isOneWay: offer.oneWay,
    outbound: {
      departure: {
        time: formatDateTime(firstSegment.departure.at),
        airport: firstSegment.departure.iataCode,
        terminal: firstSegment.departure.terminal,
      },
      arrival: {
        time: formatDateTime(lastOutboundSegment.arrival.at),
        airport: lastOutboundSegment.arrival.iataCode,
        terminal: lastOutboundSegment.arrival.terminal,
      },
      duration: formatDuration(outboundItinerary.duration),
      segments: outboundItinerary.segments.map((seg) => ({
        airline: seg.carrierCode,
        flightNumber: `${seg.carrierCode}${seg.number}`,
        aircraft: dictionaries?.aircraft?.[seg.aircraft.code] || seg.aircraft.code,
        departure: {
          time: formatDateTime(seg.departure.at),
          airport: seg.departure.iataCode,
          terminal: seg.departure.terminal,
        },
        arrival: {
          time: formatDateTime(seg.arrival.at),
          airport: seg.arrival.iataCode,
          terminal: seg.arrival.terminal,
        },
        duration: formatDuration(seg.duration),
      })),
    },
    inbound: inboundItinerary
      ? {
          departure: {
            time: formatDateTime(inboundItinerary.segments[0].departure.at),
            airport: inboundItinerary.segments[0].departure.iataCode,
            terminal: inboundItinerary.segments[0].departure.terminal,
          },
          arrival: {
            time: formatDateTime(
              inboundItinerary.segments[inboundItinerary.segments.length - 1].arrival.at
            ),
            airport: inboundItinerary.segments[inboundItinerary.segments.length - 1].arrival.iataCode,
            terminal: inboundItinerary.segments[inboundItinerary.segments.length - 1].arrival.terminal,
          },
          duration: formatDuration(inboundItinerary.duration),
          segments: inboundItinerary.segments.map((seg) => ({
            airline: seg.carrierCode,
            flightNumber: `${seg.carrierCode}${seg.number}`,
            aircraft: dictionaries?.aircraft?.[seg.aircraft.code] || seg.aircraft.code,
            departure: {
              time: formatDateTime(seg.departure.at),
              airport: seg.departure.iataCode,
              terminal: seg.departure.terminal,
            },
            arrival: {
              time: formatDateTime(seg.arrival.at),
              airport: seg.arrival.iataCode,
              terminal: seg.arrival.terminal,
            },
            duration: formatDuration(seg.duration),
          })),
        }
      : undefined,
  };
}

/**
 * Get the cheapest flight from search results
 */
export function getCheapestFlight(offers: FlightOffer[]): FlightOffer | null {
  if (offers.length === 0) return null;

  return offers.reduce((cheapest, current) => {
    const cheapestPrice = parseFloat(cheapest.price.grandTotal);
    const currentPrice = parseFloat(current.price.grandTotal);
    return currentPrice < cheapestPrice ? current : cheapest;
  });
}

/**
 * Get the fastest flight from search results
 */
export function getFastestFlight(offers: FlightOffer[]): FlightOffer | null {
  if (offers.length === 0) return null;

  return offers.reduce((fastest, current) => {
    const fastestDuration = parseDuration(fastest.itineraries[0].duration);
    const currentDuration = parseDuration(current.itineraries[0].duration);
    return currentDuration < fastestDuration ? current : fastest;
  });
}

/**
 * Filter flights by number of stops
 */
export function filterByStops(
  offers: FlightOffer[],
  maxStops: number
): FlightOffer[] {
  return offers.filter((offer) => {
    const outboundStops = offer.itineraries[0].segments.length - 1;
    const inboundStops = offer.itineraries[1]
      ? offer.itineraries[1].segments.length - 1
      : 0;
    return outboundStops <= maxStops && inboundStops <= maxStops;
  });
}

/**
 * Sort flights by price, duration, or departure time
 */
export function sortFlights(
  offers: FlightOffer[],
  sortBy: 'price' | 'duration' | 'departure'
): FlightOffer[] {
  return [...offers].sort((a, b) => {
    switch (sortBy) {
      case 'price':
        return parseFloat(a.price.grandTotal) - parseFloat(b.price.grandTotal);
      case 'duration':
        return (
          parseDuration(a.itineraries[0].duration) -
          parseDuration(b.itineraries[0].duration)
        );
      case 'departure':
        return (
          new Date(a.itineraries[0].segments[0].departure.at).getTime() -
          new Date(b.itineraries[0].segments[0].departure.at).getTime()
        );
      default:
        return 0;
    }
  });
}
