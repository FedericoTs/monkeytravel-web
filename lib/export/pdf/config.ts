import type { PDFConfig, TypographyScale } from "./types";

/**
 * Main PDF configuration
 * Based on Fresh Voyager brand colors and premium magazine aesthetics
 */
export const PDF_CONFIG: PDFConfig = {
  // A4 dimensions in mm
  pageWidth: 210,
  pageHeight: 297,
  margin: 15,
  contentWidth: 180, // 210 - 15*2

  colors: {
    // Brand colors
    primary: [255, 107, 107],      // #FF6B6B - Coral (brand primary)
    accent: [255, 217, 61],        // #FFD93D - Gold (premium highlight)
    secondary: [0, 180, 166],      // #00B4A6 - Teal (secondary accent)

    // Text colors
    text: [45, 52, 54],            // #2D3436 - Charcoal (primary text)
    muted: [99, 110, 114],         // #636E72 - Gray (secondary text)

    // Background colors
    background: [250, 250, 250],   // #FAFAFA - Warm white
    cardBg: [248, 250, 252],       // #F8FAFC - Light slate
    border: [226, 232, 240],       // #E2E8F0 - Light border
  },

  fonts: {
    display: "helvetica",
    body: "helvetica",
  },

  activityTypes: {
    // Core types
    attraction: { label: "See", color: [0, 180, 166] },       // Teal
    restaurant: { label: "Eat", color: [255, 159, 67] },      // Orange
    activity: { label: "Do", color: [108, 92, 231] },         // Purple
    transport: { label: "Go", color: [99, 110, 114] },        // Gray

    // Extended types
    food: { label: "Eat", color: [255, 159, 67] },
    cafe: { label: "Cafe", color: [139, 90, 43] },
    bar: { label: "Drinks", color: [156, 89, 182] },
    foodie: { label: "Taste", color: [230, 126, 34] },
    market: { label: "Market", color: [243, 156, 18] },
    shopping: { label: "Shop", color: [241, 196, 15] },
    cultural: { label: "Culture", color: [155, 89, 182] },
    museum: { label: "Museum", color: [52, 73, 94] },
    landmark: { label: "Landmark", color: [41, 128, 185] },
    spa: { label: "Spa", color: [26, 188, 156] },
    wellness: { label: "Relax", color: [26, 188, 156] },
    entertainment: { label: "Fun", color: [231, 76, 60] },
    nightlife: { label: "Night", color: [142, 68, 173] },
    nature: { label: "Nature", color: [39, 174, 96] },
    park: { label: "Park", color: [46, 204, 113] },
    event: { label: "Event", color: [241, 90, 34] },
  },
};

/**
 * Typography scale for consistent text sizing
 */
export const TYPOGRAPHY: Record<string, TypographyScale> = {
  coverTitle: { size: 28, style: "bold" },
  coverSubtitle: { size: 12, style: "normal" },
  sectionTitle: { size: 16, style: "bold" },
  dayHeader: { size: 14, style: "bold" },
  activityName: { size: 10, style: "bold" },
  bodyText: { size: 9, style: "normal" },
  caption: { size: 8, style: "normal" },
  meta: { size: 7, style: "normal" },
  tiny: { size: 6, style: "normal" },
};

/**
 * Layout constants
 */
export const LAYOUT = {
  // Card dimensions
  activityCardHeight: 48,
  activityImageHeight: 22,

  // Spacing
  sectionGap: 15,
  cardGap: 6,
  lineHeight: 1.4,

  // Cover page
  coverImageRatio: 0.65, // 65% of page height for cover image
  coverGradientStart: 0.45, // Gradient starts at 45% of page height

  // Day page
  dayHeaderHeight: 20,
  heroImageHeight: 45,
};

/**
 * Get activity type configuration with fallback
 */
export function getActivityTypeConfig(type: string): { label: string; color: [number, number, number] } {
  return PDF_CONFIG.activityTypes[type] || { label: "See", color: [99, 110, 114] };
}
