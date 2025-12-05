/**
 * Premium PDF Configuration
 * Magazine-style design system with sophisticated colors and typography
 */

// ============================================================================
// COLOR PALETTE - Sophisticated, premium travel magazine aesthetic
// ============================================================================
export const COLORS = {
  // Primary brand colors
  primary: [10, 75, 115] as [number, number, number],      // #0A4B73 - Deep ocean blue
  accent: [242, 198, 65] as [number, number, number],      // #F2C641 - Warm gold
  secondary: [0, 180, 166] as [number, number, number],    // #00B4A6 - Teal

  // Neutral palette
  text: [30, 41, 59] as [number, number, number],          // #1e293b - Slate 800
  muted: [100, 116, 139] as [number, number, number],      // #64748b - Slate 500
  subtle: [148, 163, 184] as [number, number, number],     // #94a3b8 - Slate 400
  light: [226, 232, 240] as [number, number, number],      // #e2e8f0 - Slate 200
  cardBg: [248, 250, 252] as [number, number, number],     // #f8fafc - Slate 50
  white: [255, 255, 255] as [number, number, number],

  // Border colors
  border: [226, 232, 240] as [number, number, number],     // #e2e8f0

  // Activity type colors - Rich and vibrant
  eat: [239, 68, 68] as [number, number, number],          // #ef4444 - Red 500
  see: [34, 197, 94] as [number, number, number],          // #22c55e - Green 500
  do: [168, 85, 247] as [number, number, number],          // #a855f7 - Purple 500
  go: [59, 130, 246] as [number, number, number],          // #3b82f6 - Blue 500
  stay: [249, 115, 22] as [number, number, number],        // #f97316 - Orange 500

  // Gradient colors for cover
  coverGradientStart: [102, 126, 234] as [number, number, number],  // #667eea
  coverGradientEnd: [118, 75, 162] as [number, number, number],     // #764ba2
};

// ============================================================================
// TYPOGRAPHY - Magazine-style hierarchy
// ============================================================================
export const TYPOGRAPHY = {
  // Display fonts for headlines
  coverTitle: { size: 42, lineHeight: 1.1 },
  coverSubtitle: { size: 14, lineHeight: 1.4 },
  sectionTitle: { size: 24, lineHeight: 1.2 },
  dayHeader: { size: 28, lineHeight: 1.1 },

  // Body fonts
  cardTitle: { size: 12, lineHeight: 1.3 },
  cardBody: { size: 9, lineHeight: 1.4 },
  cardMeta: { size: 8, lineHeight: 1.3 },

  // Stats and labels
  statValue: { size: 32, lineHeight: 1 },
  statLabel: { size: 9, lineHeight: 1.3 },

  // Badges
  badge: { size: 7, lineHeight: 1 },
  timeBadge: { size: 8, lineHeight: 1 },

  // Footer
  footer: { size: 8, lineHeight: 1.3 },
  pageNumber: { size: 8, lineHeight: 1 },
};

// ============================================================================
// LAYOUT - Magazine grid system
// ============================================================================
export const LAYOUT = {
  // Page dimensions (A4)
  pageWidth: 210,
  pageHeight: 297,

  // Margins
  margin: 15,
  marginSmall: 10,
  marginLarge: 20,

  // Content areas
  get contentWidth() { return this.pageWidth - (this.margin * 2); },

  // Cover page
  coverImageHeight: 180,
  coverOverlayStart: 120,

  // Day pages
  dayHeaderHeight: 22,
  heroImageHeight: 60,

  // Activity cards
  activityCardHeight: 52,
  activityImageHeight: 28,
  cardGap: 6,
  cardPadding: 6,
  cardRadius: 4,

  // Grid system
  columnGap: 8,
  rowGap: 8,

  // Timeline
  timelineDotSize: 6,
  timelineLineWidth: 2,
};

// ============================================================================
// ACTIVITY TYPE CONFIGURATION
// ============================================================================
export interface ActivityTypeConfig {
  label: string;
  color: [number, number, number];
  icon: string;
  bgLight: [number, number, number];
}

export const ACTIVITY_TYPES: Record<string, ActivityTypeConfig> = {
  eat: {
    label: "EAT",
    color: COLORS.eat,
    icon: "🍽️",
    bgLight: [254, 242, 242], // red-50
  },
  see: {
    label: "SEE",
    color: COLORS.see,
    icon: "👁️",
    bgLight: [240, 253, 244], // green-50
  },
  do: {
    label: "DO",
    color: COLORS.do,
    icon: "⚡",
    bgLight: [250, 245, 255], // purple-50
  },
  go: {
    label: "GO",
    color: COLORS.go,
    icon: "🚗",
    bgLight: [239, 246, 255], // blue-50
  },
  stay: {
    label: "STAY",
    color: COLORS.stay,
    icon: "🏨",
    bgLight: [255, 247, 237], // orange-50
  },
};

export function getActivityTypeConfig(type: string): ActivityTypeConfig {
  const normalized = type?.toLowerCase() || "see";
  return ACTIVITY_TYPES[normalized] || ACTIVITY_TYPES.see;
}

// ============================================================================
// PDF CONFIG - Complete configuration object
// ============================================================================
export const PDF_CONFIG = {
  // Page setup
  pageWidth: LAYOUT.pageWidth,
  pageHeight: LAYOUT.pageHeight,
  margin: LAYOUT.margin,
  contentWidth: LAYOUT.contentWidth,

  // Colors
  colors: COLORS,

  // Fonts
  fonts: {
    display: "helvetica",
    body: "helvetica",
  },

  // Typography
  typography: TYPOGRAPHY,

  // Layout
  layout: LAYOUT,
};

export type PDFConfig = typeof PDF_CONFIG;
