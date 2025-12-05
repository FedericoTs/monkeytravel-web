# Premium PDF Implementation Plan

## File Structure

```
lib/export/
├── pdf.ts                    # Main export (backward compatible)
├── pdf/
│   ├── index.ts              # Re-exports
│   ├── types.ts              # PDF-specific types
│   ├── config.ts             # Colors, fonts, dimensions
│   ├── generator.ts          # Main PDF generator class
│   ├── pages/
│   │   ├── cover.ts          # Cover page with hero image
│   │   ├── overview.ts       # Trip overview stats
│   │   ├── day-spread.ts     # Day itinerary pages
│   │   ├── activity-card.ts  # Activity card component
│   │   └── final.ts          # Closing page with CTA
│   ├── components/
│   │   ├── header.ts         # Page header
│   │   ├── footer.ts         # Page footer with numbers
│   │   ├── stat-box.ts       # Stat display box
│   │   └── type-badge.ts     # Activity type badge
│   └── utils/
│       ├── images.ts         # Image fetching & processing
│       ├── typography.ts     # Text utilities
│       └── layout.ts         # Grid & spacing helpers
```

## Core Types

```typescript
// lib/export/pdf/types.ts

import type { ItineraryDay, TripMeta, Activity } from "@/types";

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
  activityTypes: Record<string, { label: string; color: RGB; icon: string }>;
}

export type RGB = [number, number, number];

export interface ImageCache {
  [url: string]: string; // URL -> base64
}

export interface PageContext {
  doc: jsPDF;
  config: PDFConfig;
  yPosition: number;
  pageNumber: number;
  imageCache: ImageCache;
}
```

## Configuration

```typescript
// lib/export/pdf/config.ts

import type { PDFConfig, RGB } from "./types";

export const PDF_CONFIG: PDFConfig = {
  // A4 dimensions
  pageWidth: 210,
  pageHeight: 297,
  margin: 15,
  contentWidth: 180, // 210 - 15*2

  colors: {
    primary: [255, 107, 107],      // #FF6B6B - Coral
    accent: [255, 217, 61],        // #FFD93D - Gold
    text: [45, 52, 54],            // #2D3436 - Charcoal
    muted: [99, 110, 114],         // #636E72 - Muted
    background: [250, 250, 250],   // #FAFAFA - Warm white
    cardBg: [248, 250, 252],       // #F8FAFC - Light slate
    border: [226, 232, 240],       // #E2E8F0 - Light border
  },

  fonts: {
    display: "helvetica", // Will use bold for headers
    body: "helvetica",
  },

  activityTypes: {
    attraction: { label: "See", color: [0, 180, 166], icon: "eye" },
    restaurant: { label: "Eat", color: [255, 159, 67], icon: "utensils" },
    food: { label: "Eat", color: [255, 159, 67], icon: "utensils" },
    cafe: { label: "Cafe", color: [139, 90, 43], icon: "coffee" },
    activity: { label: "Do", color: [108, 92, 231], icon: "star" },
    transport: { label: "Go", color: [99, 110, 114], icon: "car" },
    cultural: { label: "Culture", color: [155, 89, 182], icon: "landmark" },
    museum: { label: "Museum", color: [52, 73, 94], icon: "building" },
    nature: { label: "Nature", color: [39, 174, 96], icon: "tree" },
    shopping: { label: "Shop", color: [241, 196, 15], icon: "bag" },
    nightlife: { label: "Night", color: [142, 68, 173], icon: "moon" },
    wellness: { label: "Relax", color: [26, 188, 156], icon: "spa" },
  },
};

// Typography scale
export const TYPOGRAPHY = {
  coverTitle: { size: 32, style: "bold" },
  coverSubtitle: { size: 14, style: "normal" },
  sectionTitle: { size: 18, style: "bold" },
  dayHeader: { size: 16, style: "bold" },
  activityName: { size: 12, style: "bold" },
  bodyText: { size: 10, style: "normal" },
  caption: { size: 8, style: "normal" },
  meta: { size: 7, style: "normal" },
};
```

## Image Utilities

```typescript
// lib/export/pdf/utils/images.ts

import type { ImageCache } from "../types";

/**
 * Fetch image and convert to base64 for PDF embedding
 */
export async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Pre-fetch all images for the trip
 */
export async function prefetchTripImages(
  coverUrl?: string,
  activities?: Array<{ image_url?: string }>
): Promise<ImageCache> {
  const cache: ImageCache = {};
  const urls: string[] = [];

  if (coverUrl) urls.push(coverUrl);

  activities?.forEach((activity) => {
    if (activity.image_url) urls.push(activity.image_url);
  });

  // Fetch in parallel with limit
  const BATCH_SIZE = 5;
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (url) => {
        const base64 = await fetchImageAsBase64(url);
        return { url, base64 };
      })
    );

    results.forEach(({ url, base64 }) => {
      if (base64) cache[url] = base64;
    });
  }

  return cache;
}

/**
 * Generate gradient placeholder for missing images
 */
export function getPlaceholderGradient(type: string): string {
  // Returns a simple colored rectangle instruction
  // Colors based on activity type
  const gradients: Record<string, [number, number, number]> = {
    attraction: [0, 180, 166],
    restaurant: [255, 159, 67],
    activity: [108, 92, 231],
    default: [255, 107, 107],
  };

  return `gradient:${JSON.stringify(gradients[type] || gradients.default)}`;
}
```

## Page Generators

### Cover Page

```typescript
// lib/export/pdf/pages/cover.ts

import type { jsPDF } from "jspdf";
import type { PremiumTripForExport, PageContext, PDFConfig } from "../types";
import { TYPOGRAPHY } from "../config";

export function renderCoverPage(
  ctx: PageContext,
  trip: PremiumTripForExport
): void {
  const { doc, config, imageCache } = ctx;
  const { pageWidth, pageHeight, colors } = config;

  // === FULL BLEED HERO IMAGE ===
  const coverImage = trip.coverImageUrl && imageCache[trip.coverImageUrl];

  if (coverImage) {
    // Add image covering full page
    doc.addImage(
      coverImage,
      "JPEG",
      0,
      0,
      pageWidth,
      pageHeight * 0.7, // 70% of page height
      undefined,
      "MEDIUM"
    );
  } else {
    // Gradient fallback
    doc.setFillColor(...colors.primary);
    doc.rect(0, 0, pageWidth, pageHeight * 0.7, "F");
  }

  // === GRADIENT OVERLAY ===
  // Create darkening gradient at bottom
  for (let i = 0; i < 50; i++) {
    const opacity = (i / 50) * 0.8;
    doc.setFillColor(0, 0, 0);
    doc.setGState(new doc.GState({ opacity }));
    doc.rect(0, pageHeight * 0.4 + i * 2, pageWidth, 2, "F");
  }
  doc.setGState(new doc.GState({ opacity: 1 }));

  // === CONTENT OVERLAY ===
  const contentY = pageHeight * 0.55;

  // Brand logo (text-based)
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont(config.fonts.display, "bold");
  doc.text("MONKEYTRAVEL", config.margin, contentY);

  // Trip title
  doc.setFontSize(TYPOGRAPHY.coverTitle.size);
  doc.setFont(config.fonts.display, "bold");
  const titleLines = doc.splitTextToSize(trip.title, config.contentWidth);
  doc.text(titleLines.slice(0, 2), config.margin, contentY + 15);

  // Destination
  doc.setFontSize(TYPOGRAPHY.coverSubtitle.size);
  doc.setFont(config.fonts.body, "normal");
  doc.text(trip.destination, config.margin, contentY + 35);

  // Date range and stats
  const startDate = formatDate(trip.startDate);
  const endDate = formatDate(trip.endDate);
  const totalActivities = trip.itinerary.reduce(
    (sum, day) => sum + day.activities.length,
    0
  );

  doc.setFontSize(11);
  doc.text(
    `${startDate} - ${endDate}  |  ${trip.itinerary.length} Days  |  ${totalActivities} Activities`,
    config.margin,
    contentY + 45
  );

  // === BOTTOM INFO BAR ===
  doc.setFillColor(255, 255, 255);
  doc.rect(0, pageHeight - 25, pageWidth, 25, "F");

  // Budget pill
  if (trip.budget) {
    doc.setFillColor(...colors.accent);
    doc.roundedRect(config.margin, pageHeight - 20, 45, 12, 2, 2, "F");
    doc.setTextColor(...colors.text);
    doc.setFontSize(9);
    doc.setFont(config.fonts.body, "bold");
    doc.text(
      `${trip.budget.currency} ${trip.budget.total.toLocaleString()}`,
      config.margin + 4,
      pageHeight - 12
    );
  }

  // Weather note
  if (trip.meta?.weather_note) {
    doc.setTextColor(...colors.muted);
    doc.setFontSize(8);
    doc.text(
      trip.meta.weather_note.substring(0, 50),
      pageWidth - config.margin - 60,
      pageHeight - 12
    );
  }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
```

### Overview Page

```typescript
// lib/export/pdf/pages/overview.ts

import type { PageContext, PremiumTripForExport } from "../types";
import { TYPOGRAPHY } from "../config";

export function renderOverviewPage(
  ctx: PageContext,
  trip: PremiumTripForExport
): void {
  const { doc, config } = ctx;
  const { margin, contentWidth, colors } = config;

  doc.addPage();
  let y = margin;

  // === PAGE HEADER ===
  doc.setFillColor(...colors.primary);
  doc.rect(0, 0, config.pageWidth, 8, "F");

  // === SECTION TITLE ===
  y += 20;
  doc.setTextColor(...colors.text);
  doc.setFontSize(TYPOGRAPHY.sectionTitle.size);
  doc.setFont(config.fonts.display, "bold");
  doc.text("YOUR JOURNEY AT A GLANCE", margin, y);

  // === STATS GRID ===
  y += 15;
  const statBoxWidth = (contentWidth - 10) / 2;
  const statBoxHeight = 35;

  const totalActivities = trip.itinerary.reduce(
    (sum, day) => sum + day.activities.length,
    0
  );

  const stats = [
    { label: "DAYS", value: trip.itinerary.length.toString() },
    { label: "ACTIVITIES", value: totalActivities.toString() },
    { label: "BUDGET", value: trip.budget
      ? `${trip.budget.currency} ${trip.budget.total.toLocaleString()}`
      : "N/A"
    },
    { label: "WEATHER", value: parseWeather(trip.meta?.weather_note) },
  ];

  stats.forEach((stat, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = margin + col * (statBoxWidth + 10);
    const boxY = y + row * (statBoxHeight + 8);

    // Box background
    doc.setFillColor(...colors.cardBg);
    doc.roundedRect(x, boxY, statBoxWidth, statBoxHeight, 3, 3, "F");

    // Accent line
    doc.setFillColor(...colors.primary);
    doc.rect(x, boxY, 3, statBoxHeight, "F");

    // Label
    doc.setTextColor(...colors.muted);
    doc.setFontSize(8);
    doc.setFont(config.fonts.body, "normal");
    doc.text(stat.label, x + 10, boxY + 12);

    // Value
    doc.setTextColor(...colors.text);
    doc.setFontSize(16);
    doc.setFont(config.fonts.display, "bold");
    doc.text(stat.value, x + 10, boxY + 26);
  });

  y += statBoxHeight * 2 + 25;

  // === HIGHLIGHTS ===
  if (trip.meta?.highlights?.length) {
    doc.setTextColor(...colors.text);
    doc.setFontSize(12);
    doc.setFont(config.fonts.display, "bold");
    doc.text("HIGHLIGHTS", margin, y);

    y += 8;
    doc.setFontSize(10);
    doc.setFont(config.fonts.body, "normal");

    trip.meta.highlights.slice(0, 5).forEach((highlight) => {
      // Bullet
      doc.setFillColor(...colors.accent);
      doc.circle(margin + 3, y + 1, 2, "F");

      // Text
      doc.setTextColor(...colors.text);
      const lines = doc.splitTextToSize(highlight, contentWidth - 15);
      doc.text(lines, margin + 10, y + 4);
      y += lines.length * 5 + 4;
    });
  }

  y += 15;

  // === PACKING SUGGESTIONS ===
  if (trip.meta?.packing_suggestions?.length) {
    doc.setFillColor(...colors.cardBg);
    doc.roundedRect(margin, y, contentWidth, 40, 3, 3, "F");

    doc.setTextColor(...colors.muted);
    doc.setFontSize(8);
    doc.text("PACKING SUGGESTIONS", margin + 8, y + 10);

    doc.setTextColor(...colors.text);
    doc.setFontSize(9);
    const packingText = trip.meta.packing_suggestions.slice(0, 5).join(" • ");
    const packingLines = doc.splitTextToSize(packingText, contentWidth - 16);
    doc.text(packingLines, margin + 8, y + 22);
  }
}

function parseWeather(note?: string): string {
  if (!note) return "Check forecast";
  // Extract temperature if present
  const tempMatch = note.match(/(\d+[-–]\d+°[CF]|\d+°[CF])/);
  return tempMatch ? tempMatch[1] : "See notes";
}
```

### Day Spread

```typescript
// lib/export/pdf/pages/day-spread.ts

import type { PageContext, PremiumTripForExport } from "../types";
import type { ItineraryDay, Activity } from "@/types";
import { TYPOGRAPHY, PDF_CONFIG } from "../config";
import { renderActivityCard } from "./activity-card";

export function renderDayPage(
  ctx: PageContext,
  day: ItineraryDay,
  trip: PremiumTripForExport
): void {
  const { doc, config, imageCache } = ctx;
  const { margin, contentWidth, pageHeight, colors } = config;

  doc.addPage();
  let y = margin;

  // === DAY HEADER ===
  doc.setFillColor(...colors.primary);
  doc.roundedRect(margin, y, contentWidth, 22, 3, 3, "F");

  // Day number
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(TYPOGRAPHY.dayHeader.size);
  doc.setFont(config.fonts.display, "bold");
  doc.text(`DAY ${day.day_number}`, margin + 8, y + 10);

  // Theme
  if (day.theme) {
    doc.setFontSize(10);
    doc.setFont(config.fonts.body, "normal");
    doc.text(day.theme, margin + 8, y + 18);
  }

  // Date on right
  const dateStr = new Date(day.date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  doc.setFontSize(10);
  doc.text(dateStr, config.pageWidth - margin - 35, y + 14);

  y += 30;

  // === HERO IMAGE (First activity with image) ===
  const heroActivity = day.activities.find((a) => a.image_url && imageCache[a.image_url]);

  if (heroActivity && heroActivity.image_url) {
    const heroImage = imageCache[heroActivity.image_url];
    if (heroImage) {
      doc.addImage(
        heroImage,
        "JPEG",
        margin,
        y,
        contentWidth,
        50,
        undefined,
        "MEDIUM"
      );
      y += 55;
    }
  }

  // === ACTIVITIES GRID ===
  // 2-column layout for activities
  const colWidth = (contentWidth - 8) / 2;
  let col = 0;
  let rowY = y;

  day.activities.forEach((activity, idx) => {
    const cardHeight = 55; // Estimated card height

    // Check if we need a new page
    if (rowY + cardHeight > pageHeight - 30) {
      doc.addPage();
      rowY = margin + 10;
      col = 0;
    }

    const x = margin + col * (colWidth + 8);

    renderActivityCard(
      ctx,
      activity,
      x,
      rowY,
      colWidth,
      trip.budget?.currency || "USD"
    );

    // Move to next position
    col++;
    if (col >= 2) {
      col = 0;
      rowY += cardHeight + 8;
    }
  });

  // Adjust y after grid
  y = rowY + (col > 0 ? 65 : 10);

  // === DAILY BUDGET SUMMARY ===
  if (day.daily_budget && y < pageHeight - 25) {
    doc.setFillColor(...colors.cardBg);
    doc.roundedRect(margin, pageHeight - 22, contentWidth, 12, 2, 2, "F");

    doc.setTextColor(...colors.muted);
    doc.setFontSize(8);
    doc.text(
      `Day ${day.day_number} Estimated: ${trip.budget?.currency || "USD"} ${day.daily_budget.total}`,
      margin + 5,
      pageHeight - 14
    );
  }
}
```

### Activity Card

```typescript
// lib/export/pdf/pages/activity-card.ts

import type { PageContext } from "../types";
import type { Activity } from "@/types";
import { PDF_CONFIG, TYPOGRAPHY } from "../config";

export function renderActivityCard(
  ctx: PageContext,
  activity: Activity,
  x: number,
  y: number,
  width: number,
  currency: string
): void {
  const { doc, config, imageCache } = ctx;
  const { colors } = config;

  const cardHeight = 55;
  const imageHeight = 25;
  const padding = 4;

  // === CARD BACKGROUND ===
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...colors.border);
  doc.roundedRect(x, y, width, cardHeight, 2, 2, "FD");

  // === ACTIVITY IMAGE ===
  const activityImage = activity.image_url && imageCache[activity.image_url];

  if (activityImage) {
    // Clip to rounded corners (approximate)
    doc.addImage(
      activityImage,
      "JPEG",
      x + 1,
      y + 1,
      width - 2,
      imageHeight,
      undefined,
      "MEDIUM"
    );
  } else {
    // Placeholder with activity type color
    const typeConfig = config.activityTypes[activity.type] ||
      { color: colors.muted, label: "See" };
    doc.setFillColor(...typeConfig.color);
    doc.rect(x + 1, y + 1, width - 2, imageHeight, "F");

    // Type label in center
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont(config.fonts.body, "bold");
    doc.text(typeConfig.label.toUpperCase(), x + width / 2, y + imageHeight / 2 + 3, {
      align: "center",
    });
  }

  // === TIME BADGE ===
  doc.setFillColor(...colors.accent);
  doc.roundedRect(x + padding, y + padding, 18, 7, 1, 1, "F");
  doc.setTextColor(...colors.text);
  doc.setFontSize(6);
  doc.setFont(config.fonts.body, "bold");
  doc.text(activity.start_time, x + padding + 2, y + padding + 5);

  // === TYPE BADGE ===
  const typeConfig = config.activityTypes[activity.type] ||
    { color: colors.muted, label: "See" };
  doc.setFillColor(...typeConfig.color);
  doc.roundedRect(x + padding + 20, y + padding, 14, 7, 1, 1, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(5);
  doc.text(typeConfig.label, x + padding + 22, y + padding + 5);

  // === CONTENT SECTION ===
  const contentY = y + imageHeight + 3;

  // Activity name
  doc.setTextColor(...colors.text);
  doc.setFontSize(9);
  doc.setFont(config.fonts.display, "bold");
  const nameText = activity.name.length > 25
    ? activity.name.substring(0, 25) + "..."
    : activity.name;
  doc.text(nameText, x + padding, contentY + 5);

  // Duration
  doc.setTextColor(...colors.muted);
  doc.setFontSize(6);
  doc.setFont(config.fonts.body, "normal");
  doc.text(
    `${activity.duration_minutes} min`,
    x + width - padding - 12,
    contentY + 5
  );

  // Description (truncated)
  const descY = contentY + 10;
  doc.setFontSize(7);
  const descText = activity.description.length > 60
    ? activity.description.substring(0, 60) + "..."
    : activity.description;
  const descLines = doc.splitTextToSize(descText, width - padding * 2);
  doc.text(descLines.slice(0, 2), x + padding, descY);

  // === FOOTER ROW ===
  const footerY = y + cardHeight - 6;

  // Location indicator
  doc.setFillColor(...colors.primary);
  doc.circle(x + padding + 2, footerY - 1, 1.5, "F");

  doc.setTextColor(...colors.muted);
  doc.setFontSize(6);
  const location = (activity.address || activity.location).substring(0, 30);
  doc.text(location, x + padding + 6, footerY);

  // Cost
  const costText = activity.estimated_cost.amount === 0
    ? "Free"
    : `${currency} ${activity.estimated_cost.amount}`;
  doc.setTextColor(...colors.text);
  doc.setFont(config.fonts.body, "bold");
  doc.text(costText, x + width - padding - 15, footerY);
}
```

### Final Page

```typescript
// lib/export/pdf/pages/final.ts

import type { PageContext, PremiumTripForExport } from "../types";

export function renderFinalPage(
  ctx: PageContext,
  trip: PremiumTripForExport
): void {
  const { doc, config, imageCache } = ctx;
  const { margin, contentWidth, pageWidth, pageHeight, colors } = config;

  doc.addPage();

  // === GALLERY STRIP ===
  const galleryHeight = 60;
  const photos = trip.galleryPhotos?.slice(0, 3) || [];

  if (photos.length > 0) {
    const photoWidth = contentWidth / 3 - 4;

    photos.forEach((photo, idx) => {
      const photoImage = imageCache[photo.url] || imageCache[photo.thumbnailUrl];
      const x = margin + idx * (photoWidth + 6);

      if (photoImage) {
        doc.addImage(
          photoImage,
          "JPEG",
          x,
          margin,
          photoWidth,
          galleryHeight,
          undefined,
          "MEDIUM"
        );
      } else {
        doc.setFillColor(...colors.cardBg);
        doc.rect(x, margin, photoWidth, galleryHeight, "F");
      }
    });
  }

  let y = margin + galleryHeight + 20;

  // === CLOSING MESSAGE ===
  doc.setTextColor(...colors.text);
  doc.setFontSize(24);
  doc.setFont(config.fonts.display, "bold");
  doc.text("Have an Amazing Trip!", pageWidth / 2, y, { align: "center" });

  y += 15;

  doc.setFontSize(11);
  doc.setFont(config.fonts.body, "normal");
  doc.setTextColor(...colors.muted);
  const closingText = `Your ${trip.itinerary.length}-day adventure to ${trip.destination} awaits. This itinerary was crafted with AI precision to match your travel style.`;
  const closingLines = doc.splitTextToSize(closingText, contentWidth - 40);
  doc.text(closingLines, pageWidth / 2, y, { align: "center" });

  y += 30;

  // === SHARE HASHTAGS ===
  doc.setFillColor(...colors.cardBg);
  doc.roundedRect(margin + 30, y, contentWidth - 60, 25, 3, 3, "F");

  doc.setTextColor(...colors.muted);
  doc.setFontSize(8);
  doc.text("Share your journey:", pageWidth / 2, y + 10, { align: "center" });

  doc.setTextColor(...colors.primary);
  doc.setFontSize(10);
  doc.setFont(config.fonts.body, "bold");
  const destination = trip.destination.replace(/[^a-zA-Z]/g, "");
  const hashtags = `#MonkeyTravel #${destination}${new Date(trip.startDate).getFullYear()}`;
  doc.text(hashtags, pageWidth / 2, y + 18, { align: "center" });

  // === BRAND FOOTER ===
  const footerY = pageHeight - 45;

  doc.setFillColor(...colors.primary);
  doc.roundedRect(margin + 40, footerY, contentWidth - 80, 35, 4, 4, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont(config.fonts.display, "bold");
  doc.text("MonkeyTravel", pageWidth / 2, footerY + 12, { align: "center" });

  doc.setFontSize(9);
  doc.setFont(config.fonts.body, "normal");
  doc.text("monkeytravel.app", pageWidth / 2, footerY + 20, { align: "center" });

  doc.setFontSize(8);
  doc.text("Plan your next adventure", pageWidth / 2, footerY + 28, { align: "center" });

  // === GENERATION DATE ===
  doc.setTextColor(...colors.muted);
  doc.setFontSize(7);
  doc.text(
    `Generated on ${new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric"
    })}`,
    pageWidth / 2,
    pageHeight - 8,
    { align: "center" }
  );
}
```

## Main Generator

```typescript
// lib/export/pdf/generator.ts

import jsPDF from "jspdf";
import type { PremiumTripForExport, PageContext, ImageCache } from "./types";
import { PDF_CONFIG } from "./config";
import { prefetchTripImages } from "./utils/images";
import { renderCoverPage } from "./pages/cover";
import { renderOverviewPage } from "./pages/overview";
import { renderDayPage } from "./pages/day-spread";
import { renderFinalPage } from "./pages/final";

export async function generatePremiumTripPDF(
  trip: PremiumTripForExport
): Promise<Blob> {
  // Initialize PDF
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  // Pre-fetch all images
  const allActivities = trip.itinerary.flatMap((day) => day.activities);
  const galleryUrls = trip.galleryPhotos?.flatMap((p) => [p.url, p.thumbnailUrl]) || [];

  const imageCache: ImageCache = await prefetchTripImages(
    trip.coverImageUrl,
    allActivities
  );

  // Also fetch gallery photos
  for (const url of galleryUrls) {
    if (!imageCache[url]) {
      const { fetchImageAsBase64 } = await import("./utils/images");
      const base64 = await fetchImageAsBase64(url);
      if (base64) imageCache[url] = base64;
    }
  }

  // Create page context
  const ctx: PageContext = {
    doc,
    config: PDF_CONFIG,
    yPosition: PDF_CONFIG.margin,
    pageNumber: 1,
    imageCache,
  };

  // === RENDER PAGES ===

  // 1. Cover Page
  renderCoverPage(ctx, trip);

  // 2. Overview Page
  renderOverviewPage(ctx, trip);

  // 3. Day Pages
  trip.itinerary.forEach((day) => {
    renderDayPage(ctx, day, trip);
  });

  // 4. Final Page
  renderFinalPage(ctx, trip);

  // Add page numbers to all pages except cover
  const totalPages = doc.getNumberOfPages();
  for (let i = 2; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setTextColor(...PDF_CONFIG.colors.muted);
    doc.setFontSize(8);
    doc.text(
      `${i - 1} / ${totalPages - 1}`,
      PDF_CONFIG.pageWidth - PDF_CONFIG.margin,
      PDF_CONFIG.pageHeight - 8,
      { align: "right" }
    );
  }

  return doc.output("blob");
}
```

## Integration with Existing Code

```typescript
// lib/export/pdf.ts (updated)

import jsPDF from "jspdf";
import type { ItineraryDay, TripMeta } from "@/types";

// Re-export premium generator
export { generatePremiumTripPDF } from "./pdf/generator";
export type { PremiumTripForExport } from "./pdf/types";

// Keep existing interface for backward compatibility
interface TripForExport {
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  budget?: { total: number; currency: string } | null;
  itinerary: ItineraryDay[];
}

// Existing basic PDF generation (kept for backward compatibility)
export async function generateTripPDF(trip: TripForExport): Promise<Blob> {
  // ... existing implementation
}

// Premium download function
export async function downloadPremiumPDF(
  trip: PremiumTripForExport
): Promise<void> {
  const { generatePremiumTripPDF } = await import("./pdf/generator");
  const blob = await generatePremiumTripPDF(trip);

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${trip.title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-premium-itinerary.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
```

---

## Implementation Checklist

### Phase 1: Foundation
- [ ] Create `lib/export/pdf/` directory structure
- [ ] Implement `types.ts` and `config.ts`
- [ ] Implement `utils/images.ts` for image fetching
- [ ] Test image fetching with sample URLs

### Phase 2: Core Pages
- [ ] Implement `pages/cover.ts`
- [ ] Implement `pages/overview.ts`
- [ ] Implement `pages/activity-card.ts`
- [ ] Implement `pages/day-spread.ts`
- [ ] Implement `pages/final.ts`

### Phase 3: Integration
- [ ] Implement `generator.ts`
- [ ] Update `lib/export/pdf.ts` exports
- [ ] Add premium download button to UI
- [ ] Test with real trip data

### Phase 4: Polish
- [ ] Fine-tune spacing and typography
- [ ] Add loading state during generation
- [ ] Handle edge cases (missing images, long text)
- [ ] Performance optimization for large itineraries

---

*Implementation Plan v1.0 - MonkeyTravel Premium PDF*
*Created: December 5, 2025*
