/**
 * Amadeus API Type Definitions
 * Based on Amadeus Self-Service APIs documentation
 */

// =============================================================================
// FLIGHT TYPES
// =============================================================================

/** Flight search request parameters */
export interface FlightSearchParams {
  origin: string;           // IATA code (e.g., "JFK")
  destination: string;      // IATA code (e.g., "CDG")
  departureDate: string;    // YYYY-MM-DD
  returnDate?: string;      // YYYY-MM-DD (optional for one-way)
  adults: number;           // 1-9
  children?: number;        // 0-8
  infants?: number;         // 0-8
  travelClass?: TravelClass;
  nonStop?: boolean;
  maxPrice?: number;
  max?: number;             // Max results (default 250)
  currencyCode?: string;    // e.g., "USD"
}

export type TravelClass = 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';

/** Full flight offer from Amadeus API */
export interface FlightOffer {
  type: 'flight-offer';
  id: string;
  source: string;
  instantTicketingRequired: boolean;
  nonHomogeneous: boolean;
  oneWay: boolean;
  lastTicketingDate: string;
  numberOfBookableSeats: number;
  itineraries: Itinerary[];
  price: FlightPrice;
  pricingOptions: PricingOptions;
  validatingAirlineCodes: string[];
  travelerPricings: TravelerPricing[];
}

export interface Itinerary {
  duration: string;         // ISO 8601 (e.g., "PT12H30M")
  segments: FlightSegment[];
}

export interface FlightSegment {
  departure: FlightEndpoint;
  arrival: FlightEndpoint;
  carrierCode: string;      // e.g., "AF" for Air France
  number: string;           // Flight number
  aircraft: {
    code: string;           // e.g., "777" for Boeing 777
  };
  operating?: {
    carrierCode: string;    // Operating carrier (if different from marketing)
  };
  duration: string;         // ISO 8601 duration
  id: string;
  numberOfStops: number;
  blacklistedInEU: boolean;
}

export interface FlightEndpoint {
  iataCode: string;
  terminal?: string;
  at: string;               // ISO 8601 datetime
}

export interface FlightPrice {
  currency: string;
  total: string;
  base: string;
  fees?: FeeDetail[];
  grandTotal: string;
  additionalServices?: AdditionalService[];
}

export interface FeeDetail {
  amount: string;
  type: string;
}

export interface AdditionalService {
  amount: string;
  type: string;
}

export interface PricingOptions {
  fareType: string[];
  includedCheckedBagsOnly: boolean;
}

export interface TravelerPricing {
  travelerId: string;
  fareOption: string;
  travelerType: 'ADULT' | 'CHILD' | 'SEATED_INFANT' | 'HELD_INFANT';
  price: {
    currency: string;
    total: string;
    base: string;
  };
  fareDetailsBySegment: FareDetails[];
}

export interface FareDetails {
  segmentId: string;
  cabin: TravelClass;
  fareBasis: string;
  class: string;
  includedCheckedBags?: {
    weight?: number;
    weightUnit?: string;
    quantity?: number;
  };
}

/** Simplified flight offer for display */
export interface FlightOfferDisplay {
  id: string;
  airline: string;
  airlineName?: string;
  flightNumber: string;
  departureTime: string;
  arrivalTime: string;
  departureAirport: string;
  arrivalAirport: string;
  duration: string;
  stops: number;
  price: number;
  currency: string;
  cabin: TravelClass;
  seatsAvailable: number;
  isOneWay: boolean;
  outbound: FlightLegDisplay;
  inbound?: FlightLegDisplay;
}

export interface FlightLegDisplay {
  departure: {
    time: string;
    airport: string;
    terminal?: string;
  };
  arrival: {
    time: string;
    airport: string;
    terminal?: string;
  };
  duration: string;
  segments: SegmentDisplay[];
}

export interface SegmentDisplay {
  airline: string;
  flightNumber: string;
  aircraft: string;
  departure: {
    time: string;
    airport: string;
    terminal?: string;
  };
  arrival: {
    time: string;
    airport: string;
    terminal?: string;
  };
  duration: string;
}

// =============================================================================
// HOTEL TYPES
// =============================================================================

/** Hotel search request parameters */
export interface HotelSearchParams {
  cityCode?: string;        // IATA city code
  latitude?: number;        // For geo search
  longitude?: number;
  radius?: number;          // km
  radiusUnit?: 'KM' | 'MILE';
  hotelIds?: string[];      // Specific hotel IDs
  checkInDate: string;      // YYYY-MM-DD
  checkOutDate: string;
  adults: number;
  roomQuantity?: number;
  priceRange?: string;      // "100-200"
  currency?: string;
  ratings?: string[];       // ["4", "5"]
  amenities?: HotelAmenity[];
  boardType?: BoardType;
  includeClosed?: boolean;
  bestRateOnly?: boolean;
  lang?: string;            // e.g., "EN"
}

export type HotelAmenity =
  | 'SWIMMING_POOL'
  | 'SPA'
  | 'FITNESS_CENTER'
  | 'AIR_CONDITIONING'
  | 'RESTAURANT'
  | 'PARKING'
  | 'PETS_ALLOWED'
  | 'AIRPORT_SHUTTLE'
  | 'BUSINESS_CENTER'
  | 'DISABLED_FACILITIES'
  | 'WIFI'
  | 'MEETING_ROOMS'
  | 'NO_KID_ALLOWED'
  | 'TENNIS'
  | 'GOLF'
  | 'KITCHEN'
  | 'BABY_SITTING'
  | 'BEACH'
  | 'CASINO'
  | 'JACUZZI'
  | 'SAUNA'
  | 'SOLARIUM'
  | 'MASSAGE'
  | 'VALET_PARKING'
  | 'BAR'
  | 'LOUNGE'
  | 'MINIBAR'
  | 'TELEVISION'
  | 'ROOM_SERVICE'
  | 'GUARDED_PARKG'
  | 'SERV_SPEC_MENU';

export type BoardType =
  | 'ROOM_ONLY'
  | 'BREAKFAST'
  | 'HALF_BOARD'
  | 'FULL_BOARD'
  | 'ALL_INCLUSIVE';

/** Hotel from hotel list (basic info) */
export interface HotelBasic {
  chainCode?: string;
  iataCode: string;
  dupeId: number;
  name: string;
  hotelId: string;
  geoCode: {
    latitude: number;
    longitude: number;
  };
  address: {
    countryCode: string;
  };
  lastUpdate?: string;
}

/** Full hotel offer with room options */
export interface HotelOffer {
  type: 'hotel-offers';
  hotel: HotelInfo;
  available: boolean;
  offers: RoomOffer[];
  self?: string;
}

export interface HotelInfo {
  type: string;
  hotelId: string;
  chainCode?: string;
  dupeId?: string;
  name: string;
  cityCode: string;
  latitude: number;
  longitude: number;
  address?: HotelAddress;
  contact?: HotelContact;
  description?: {
    lang: string;
    text: string;
  };
  amenities?: string[];
  rating?: string;
  media?: HotelMedia[];
}

export interface HotelAddress {
  lines?: string[];
  postalCode?: string;
  cityName?: string;
  countryCode?: string;
}

export interface HotelContact {
  phone?: string;
  fax?: string;
  email?: string;
}

export interface HotelMedia {
  uri: string;
  category: 'EXTERIOR' | 'GUEST_ROOM' | 'LOBBY' | 'SWIMMING_POOL' | 'OTHER';
}

export interface RoomOffer {
  id: string;
  checkInDate: string;
  checkOutDate: string;
  rateCode: string;
  rateFamilyEstimated?: {
    code: string;
    type: string;
  };
  category?: string;
  description?: {
    text: string;
    lang?: string;
  };
  commission?: {
    percentage?: string;
    amount?: string;
  };
  boardType?: BoardType;
  room: RoomDetails;
  guests: {
    adults: number;
    childAges?: number[];
  };
  price: HotelPrice;
  policies?: RoomPolicies;
  self?: string;
}

export interface RoomDetails {
  type?: string;
  typeEstimated?: {
    category?: string;
    beds?: number;
    bedType?: string;
  };
  description?: {
    text: string;
    lang?: string;
  };
}

export interface HotelPrice {
  currency: string;
  base?: string;
  total: string;
  sellingTotal?: string;
  taxes?: TaxInfo[];
  markups?: MarkupInfo[];
  variations?: {
    average?: {
      base?: string;
      total?: string;
    };
    changes?: PriceChange[];
  };
}

export interface TaxInfo {
  amount: string;
  currency: string;
  code?: string;
  percentage?: string;
  included?: boolean;
  description?: string;
  pricingFrequency?: string;
  pricingMode?: string;
}

export interface MarkupInfo {
  amount: string;
}

export interface PriceChange {
  startDate: string;
  endDate: string;
  base?: string;
  total?: string;
}

export interface RoomPolicies {
  paymentType?: 'GUARANTEE' | 'DEPOSIT' | 'PREPAY' | 'HOLDTIME';
  cancellation?: {
    type?: string;
    description?: {
      text: string;
    };
    amount?: string;
    numberOfNights?: number;
    percentage?: string;
    deadline?: string;
  };
  guarantee?: {
    acceptedPayments: {
      creditCards?: string[];
      methods?: string[];
    };
  };
  deposit?: {
    amount?: string;
    deadline?: string;
    acceptedPayments?: {
      creditCards?: string[];
      methods?: string[];
    };
  };
  prepay?: {
    amount?: string;
    deadline?: string;
    acceptedPayments?: {
      creditCards?: string[];
      methods?: string[];
    };
  };
  holdTime?: {
    deadline: string;
  };
  checkInOut?: {
    checkIn?: string;
    checkInDescription?: {
      text: string;
    };
    checkOut?: string;
    checkOutDescription?: {
      text: string;
    };
  };
}

/** Simplified hotel offer for display */
export interface HotelOfferDisplay {
  id: string;
  hotelId: string;
  name: string;
  address: string;
  rating: number;
  latitude: number;
  longitude: number;
  pricePerNight: number;
  totalPrice: number;
  currency: string;
  roomType: string;
  bedType: string;
  bedCount: number;
  boardType?: string;
  cancellationPolicy?: string;
  amenities: string[];
  image?: string;
  checkIn: string;
  checkOut: string;
}

// =============================================================================
// LOCATION TYPES
// =============================================================================

/** Location/Airport search result */
export interface LocationResult {
  type: 'location';
  subType: 'AIRPORT' | 'CITY' | 'POINT_OF_INTEREST' | 'DISTRICT';
  name: string;
  detailedName?: string;
  id: string;
  self?: {
    href: string;
    methods: string[];
  };
  timeZoneOffset?: string;
  iataCode: string;
  geoCode: {
    latitude: number;
    longitude: number;
  };
  address: {
    cityName: string;
    cityCode: string;
    countryName: string;
    countryCode: string;
    stateCode?: string;
    regionCode?: string;
  };
  analytics?: {
    travelers: {
      score: number;
    };
  };
}

// =============================================================================
// TRAVELER & BOOKING TYPES
// =============================================================================

export interface TravelerInfo {
  id: string;
  dateOfBirth: string;        // YYYY-MM-DD
  name: {
    firstName: string;
    lastName: string;
  };
  gender: 'MALE' | 'FEMALE';
  contact: {
    emailAddress: string;
    phones: Phone[];
  };
  documents?: TravelerDocument[];
}

export interface Phone {
  deviceType: 'MOBILE' | 'LANDLINE';
  countryCallingCode: string;
  number: string;
}

export interface TravelerDocument {
  documentType: 'PASSPORT' | 'IDENTITY_CARD' | 'VISA';
  birthPlace?: string;
  issuanceLocation?: string;
  issuanceDate?: string;
  number: string;
  expiryDate: string;
  issuanceCountry: string;
  validityCountry?: string;
  nationality: string;
  holder: boolean;
}

export interface ContactInfo {
  emailAddress: string;
  phones: Phone[];
  companyName?: string;
  purpose: 'STANDARD' | 'INVOICE' | 'STANDARD_WITHOUT_EMAIL';
}

// =============================================================================
// API RESPONSE TYPES
// =============================================================================

export interface AmadeusError {
  status: number;
  code: number;
  title: string;
  detail: string;
  source?: {
    pointer?: string;
    parameter?: string;
    example?: string;
  };
}

export interface FlightSearchResponse {
  data: FlightOffer[];
  dictionaries?: {
    locations?: Record<string, LocationDictionary>;
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
}

export interface LocationDictionary {
  cityCode: string;
  countryCode: string;
}

export interface HotelSearchResponse {
  data: HotelOffer[];
  meta?: {
    count: number;
    links?: {
      self: string;
    };
  };
}

export interface LocationSearchResponse {
  data: LocationResult[];
  meta?: {
    count: number;
    links?: {
      self: string;
    };
  };
}

// =============================================================================
// BOOKING STATUS TYPES
// =============================================================================

export type BookingStatus =
  | 'selected'          // User has selected this option
  | 'price_confirmed'   // Price has been confirmed with Amadeus
  | 'booked'           // Booking completed
  | 'cancelled'        // Booking was cancelled
  | 'expired';         // Offer expired before booking

export interface TripBooking {
  id: string;
  tripId: string;
  bookingType: 'flight' | 'hotel';
  provider: 'amadeus';
  offerData: FlightOffer | HotelOffer;
  priceConfirmed: boolean;
  confirmedPrice?: FlightPrice | HotelPrice;
  bookingReference?: string;
  bookingStatus: BookingStatus;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

/** Common IATA codes for major cities */
export const MAJOR_AIRPORTS: Record<string, string> = {
  // United States
  'New York': 'JFK',
  'Los Angeles': 'LAX',
  'Chicago': 'ORD',
  'San Francisco': 'SFO',
  'Miami': 'MIA',
  'Boston': 'BOS',
  'Seattle': 'SEA',
  'Las Vegas': 'LAS',
  'Denver': 'DEN',
  'Atlanta': 'ATL',

  // Europe
  'London': 'LHR',
  'Paris': 'CDG',
  'Amsterdam': 'AMS',
  'Frankfurt': 'FRA',
  'Rome': 'FCO',
  'Madrid': 'MAD',
  'Barcelona': 'BCN',
  'Berlin': 'BER',
  'Munich': 'MUC',
  'Milan': 'MXP',
  'Zurich': 'ZRH',
  'Vienna': 'VIE',
  'Dublin': 'DUB',
  'Lisbon': 'LIS',

  // Asia
  'Tokyo': 'NRT',
  'Seoul': 'ICN',
  'Singapore': 'SIN',
  'Hong Kong': 'HKG',
  'Bangkok': 'BKK',
  'Dubai': 'DXB',
  'Shanghai': 'PVG',
  'Beijing': 'PEK',
  'Taipei': 'TPE',
  'Mumbai': 'BOM',
  'Delhi': 'DEL',

  // Oceania
  'Sydney': 'SYD',
  'Melbourne': 'MEL',
  'Auckland': 'AKL',

  // Americas
  'Toronto': 'YYZ',
  'Vancouver': 'YVR',
  'Mexico City': 'MEX',
  'Sao Paulo': 'GRU',
  'Buenos Aires': 'EZE',
  'Lima': 'LIM',
  'Bogota': 'BOG',
  'Santiago': 'SCL',
};

/** Airline codes to names mapping */
export const AIRLINE_NAMES: Record<string, string> = {
  'AA': 'American Airlines',
  'UA': 'United Airlines',
  'DL': 'Delta Air Lines',
  'WN': 'Southwest Airlines',
  'B6': 'JetBlue Airways',
  'AS': 'Alaska Airlines',
  'NK': 'Spirit Airlines',
  'F9': 'Frontier Airlines',
  'BA': 'British Airways',
  'AF': 'Air France',
  'LH': 'Lufthansa',
  'KL': 'KLM Royal Dutch',
  'IB': 'Iberia',
  'AZ': 'ITA Airways',
  'LX': 'Swiss',
  'OS': 'Austrian Airlines',
  'SN': 'Brussels Airlines',
  'EI': 'Aer Lingus',
  'TP': 'TAP Air Portugal',
  'SK': 'SAS Scandinavian',
  'AY': 'Finnair',
  'LO': 'LOT Polish',
  'EK': 'Emirates',
  'QR': 'Qatar Airways',
  'EY': 'Etihad Airways',
  'TK': 'Turkish Airlines',
  'SQ': 'Singapore Airlines',
  'CX': 'Cathay Pacific',
  'JL': 'Japan Airlines',
  'NH': 'All Nippon Airways',
  'KE': 'Korean Air',
  'OZ': 'Asiana Airlines',
  'CI': 'China Airlines',
  'BR': 'EVA Air',
  'TG': 'Thai Airways',
  'MH': 'Malaysia Airlines',
  'GA': 'Garuda Indonesia',
  'VN': 'Vietnam Airlines',
  'QF': 'Qantas',
  'NZ': 'Air New Zealand',
  'AC': 'Air Canada',
  'AM': 'Aeromexico',
  'LA': 'LATAM Airlines',
  'AV': 'Avianca',
};
