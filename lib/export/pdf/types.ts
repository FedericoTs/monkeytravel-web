import type jsPDF from "jspdf";
import type { PremiumTripForExport, RGB, ActivityTypeConfig } from "@/types";

// Re-export for backward compatibility
export type { PremiumTripForExport, RGB, ActivityTypeConfig } from "@/types";

/**
 * PDF configuration - matches PDF_CONFIG in config.ts
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
    subtle: RGB;
    light: RGB;
    cardBg: RGB;
    white: RGB;
    border: RGB;
    eat: RGB;
    see: RGB;
    do: RGB;
    go: RGB;
    stay: RGB;
    coverGradientStart: RGB;
    coverGradientEnd: RGB;
  };

  // Fonts
  fonts: {
    display: string;
    body: string;
  };

  // Typography settings
  typography: {
    coverTitle: { size: number; lineHeight: number };
    coverSubtitle: { size: number; lineHeight: number };
    sectionTitle: { size: number; lineHeight: number };
    dayHeader: { size: number; lineHeight: number };
    cardTitle: { size: number; lineHeight: number };
    cardBody: { size: number; lineHeight: number };
    cardMeta: { size: number; lineHeight: number };
    statValue: { size: number; lineHeight: number };
    statLabel: { size: number; lineHeight: number };
    badge: { size: number; lineHeight: number };
    timeBadge: { size: number; lineHeight: number };
    footer: { size: number; lineHeight: number };
    pageNumber: { size: number; lineHeight: number };
  };

  // Layout settings
  layout: {
    pageWidth: number;
    pageHeight: number;
    margin: number;
    marginSmall: number;
    marginLarge: number;
    contentWidth: number;
    coverImageHeight: number;
    coverOverlayStart: number;
    dayHeaderHeight: number;
    heroImageHeight: number;
    activityCardHeight: number;
    activityImageHeight: number;
    cardGap: number;
    cardPadding: number;
    cardRadius: number;
    columnGap: number;
    rowGap: number;
    timelineDotSize: number;
    timelineLineWidth: number;
  };
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
  lineHeight: number;
}

// ActivityTypeConfig is now imported from @/types
