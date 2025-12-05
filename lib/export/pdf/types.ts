import type jsPDF from "jspdf";
import type { ItineraryDay, TripMeta, Activity } from "@/types";

/**
 * Trip data structure for premium PDF export
 */
export interface PremiumTripForExport {
  // Basic info
  title: string;
  description?: string;
  destination: string;
  startDate: string;
  endDate: string;

  // Budget
  budget?: { total: number; currency: string } | null;

  // Itinerary
  itinerary: ItineraryDay[];

  // Meta (from TripMeta)
  meta?: TripMeta;

  // Images
  coverImageUrl?: string;
  galleryPhotos?: { url: string; thumbnailUrl: string }[];
}

/**
 * RGB color tuple
 */
export type RGB = [number, number, number];

/**
 * PDF configuration constants
 */
export interface PDFConfig {
  // Dimensions (mm)
  pageWidth: number;
  pageHeight: number;
  margin: number;
  contentWidth: number;

  // Colors
  colors: {
    primary: RGB;
    accent: RGB;
    secondary: RGB;
    text: RGB;
    muted: RGB;
    background: RGB;
    cardBg: RGB;
    border: RGB;
  };

  // Typography
  fonts: {
    display: string;
    body: string;
  };

  // Activity type config
  activityTypes: Record<string, { label: string; color: RGB }>;
}

/**
 * Cache for fetched images (URL -> base64)
 */
export interface ImageCache {
  [url: string]: string;
}

/**
 * Context passed to page renderers
 */
export interface PageContext {
  doc: jsPDF;
  config: PDFConfig;
  yPosition: number;
  pageNumber: number;
  imageCache: ImageCache;
}

/**
 * Typography scale definition
 */
export interface TypographyScale {
  size: number;
  style: "normal" | "bold" | "italic" | "bolditalic";
}

/**
 * Activity type display configuration
 */
export interface ActivityTypeConfig {
  label: string;
  color: RGB;
}
