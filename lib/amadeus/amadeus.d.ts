/**
 * Type declarations for the Amadeus npm package
 *
 * @see https://github.com/amadeus4dev/amadeus-node
 */

declare module 'amadeus' {
  interface AmadeusOptions {
    clientId: string;
    clientSecret: string;
    hostname?: 'test' | 'production';
    logLevel?: 'debug' | 'warn' | 'silent';
    customAppId?: string;
    customAppVersion?: string;
  }

  interface AmadeusResponse<T = unknown> {
    data: T;
    result: {
      dictionaries?: {
        locations?: Record<string, { cityCode: string; countryCode: string }>;
        aircraft?: Record<string, string>;
        currencies?: Record<string, string>;
        carriers?: Record<string, string>;
      };
      meta?: {
        count: number;
        links?: {
          self: string;
        };
      };
    };
    statusCode: number;
    body: string;
    parsed: boolean;
  }

  interface ReferenceDataLocations {
    get(params: {
      keyword: string;
      subType: string;
      countryCode?: string;
      'page[limit]'?: number;
    }): Promise<AmadeusResponse>;
  }

  interface ReferenceDataLocationsHotelsByCity {
    get(params: {
      cityCode: string;
      radius?: number;
      radiusUnit?: 'KM' | 'MILE';
      ratings?: string[];
      amenities?: string[];
    }): Promise<AmadeusResponse>;
  }

  interface ReferenceDataLocationsHotelsByGeocode {
    get(params: {
      latitude: number;
      longitude: number;
      radius?: number;
      radiusUnit?: 'KM' | 'MILE';
      ratings?: string[];
    }): Promise<AmadeusResponse>;
  }

  interface ShoppingFlightOffersSearch {
    get(params: {
      originLocationCode: string;
      destinationLocationCode: string;
      departureDate: string;
      returnDate?: string;
      adults: string;
      children?: string;
      infants?: string;
      travelClass?: string;
      nonStop?: boolean;
      maxPrice?: number;
      currencyCode?: string;
      max?: number;
    }): Promise<AmadeusResponse>;
  }

  interface ShoppingFlightOffersPricing {
    post(body: string): Promise<AmadeusResponse>;
  }

  interface ShoppingHotelOffersSearch {
    get(params: {
      hotelIds: string;
      adults: string;
      checkInDate: string;
      checkOutDate: string;
      roomQuantity?: string;
      currency?: string;
      priceRange?: string;
      boardType?: string;
      bestRateOnly?: boolean;
    }): Promise<AmadeusResponse>;
  }

  interface ShoppingHotelOfferSearch {
    get(): Promise<AmadeusResponse>;
  }

  interface BookingFlightOrders {
    post(body: string): Promise<AmadeusResponse>;
  }

  interface BookingHotelBookings {
    post(body: string): Promise<AmadeusResponse>;
  }

  class Amadeus {
    constructor(options: AmadeusOptions);

    referenceData: {
      locations: ReferenceDataLocations & {
        hotels: {
          byCity: ReferenceDataLocationsHotelsByCity;
          byGeocode: ReferenceDataLocationsHotelsByGeocode;
        };
      };
    };

    shopping: {
      flightOffersSearch: ShoppingFlightOffersSearch;
      flightOffers: {
        pricing: ShoppingFlightOffersPricing;
      };
      hotelOffersSearch: ShoppingHotelOffersSearch;
      hotelOfferSearch(offerId: string): ShoppingHotelOfferSearch;
    };

    booking: {
      flightOrders: BookingFlightOrders;
      hotelBookings: BookingHotelBookings;
    };
  }

  export = Amadeus;
}
