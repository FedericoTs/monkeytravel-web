import type jsPDF from "jspdf";
import type { PageContext } from "../types";
import type { Activity } from "@/types";
import { getActivityTypeConfig, COLORS, LAYOUT } from "../config";
import { getImageFormat, hasImage } from "../utils/images";

/**
 * Format duration nicely
 */
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Render a premium activity card with image
 */
export function renderActivityCard(
  ctx: PageContext,
  activity: Activity,
  x: number,
  y: number,
  width: number,
  currency: string
): number {
  const { doc, config, imageCache } = ctx;

  const hasActivityImage = hasImage(imageCache, activity.image_url);
  const cardHeight = LAYOUT.activityCardHeight;
  const imageWidth = hasActivityImage ? 45 : 0;
  const contentX = x + (hasActivityImage ? imageWidth + 6 : 0);
  const contentWidth = width - (hasActivityImage ? imageWidth + 6 : 0);
  const padding = LAYOUT.cardPadding;
  const typeConfig = getActivityTypeConfig(activity.type);

  // === CARD SHADOW & BACKGROUND ===
  // Subtle shadow effect
  doc.setFillColor(230, 230, 230);
  doc.roundedRect(x + 1, y + 1, width, cardHeight, LAYOUT.cardRadius, LAYOUT.cardRadius, "F");

  // Main card
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(x, y, width, cardHeight, LAYOUT.cardRadius, LAYOUT.cardRadius, "F");

  // === ACTIVITY IMAGE OR TYPE GRADIENT ===
  if (hasActivityImage && activity.image_url) {
    const imageData = imageCache[activity.image_url];
    const format = getImageFormat(imageData);

    try {
      // Clip rounded corners
      doc.addImage(
        imageData,
        format,
        x + 2,
        y + 2,
        imageWidth - 4,
        cardHeight - 4,
        undefined,
        "MEDIUM"
      );

      // Overlay gradient for text readability at bottom of image
      doc.setFillColor(...typeConfig.color);
      doc.rect(x + 2, y + cardHeight - 12, imageWidth - 4, 10, "F");

    } catch {
      // Fallback to gradient placeholder
      renderGradientPlaceholder(doc, x + 2, y + 2, imageWidth - 4, cardHeight - 4, typeConfig);
    }
  } else if (imageWidth > 0) {
    renderGradientPlaceholder(doc, x + 2, y + 2, imageWidth - 4, cardHeight - 4, typeConfig);
  }

  // === LEFT ACCENT BAR (if no image) ===
  if (!hasActivityImage) {
    doc.setFillColor(...typeConfig.color);
    doc.rect(x, y, 4, cardHeight, "F");
  }

  // === TIME BADGE ===
  const timeX = hasActivityImage ? x + 4 : x + padding + 4;
  const timeY = hasActivityImage ? y + cardHeight - 10 : y + padding;

  if (hasActivityImage) {
    // Time badge on image
    doc.setTextColor(255, 255, 255);
  } else {
    doc.setFillColor(...typeConfig.color);
    doc.roundedRect(timeX - 2, timeY - 4, 22, 8, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
  }
  doc.setFontSize(8);
  doc.setFont(config.fonts.body, "bold");
  doc.text(activity.start_time, timeX, timeY);

  // === TYPE BADGE ===
  const typeBadgeX = hasActivityImage ? x + 24 : timeX + 24;
  const typeBadgeY = hasActivityImage ? y + cardHeight - 10 : y + padding;

  if (!hasActivityImage) {
    doc.setFillColor(...typeConfig.bgLight);
    doc.roundedRect(typeBadgeX - 2, typeBadgeY - 4, 16, 8, 2, 2, "F");
    doc.setTextColor(...typeConfig.color);
  } else {
    doc.setTextColor(255, 255, 255);
  }
  doc.setFontSize(6);
  doc.setFont(config.fonts.body, "bold");
  doc.text(typeConfig.label, typeBadgeX, typeBadgeY);

  // === ACTIVITY NAME ===
  const nameY = y + padding + 2;
  doc.setTextColor(...COLORS.text);
  doc.setFontSize(11);
  doc.setFont(config.fonts.display, "bold");
  const maxNameWidth = contentWidth - padding * 2 - 25;
  let activityName = activity.name;
  while (doc.getTextWidth(activityName) > maxNameWidth && activityName.length > 10) {
    activityName = activityName.substring(0, activityName.length - 4) + "...";
  }
  doc.text(activityName, contentX + padding, nameY + 6);

  // === DURATION (top right) ===
  doc.setTextColor(...COLORS.muted);
  doc.setFontSize(8);
  doc.setFont(config.fonts.body, "normal");
  doc.text(formatDuration(activity.duration_minutes), x + width - padding, nameY + 6, { align: "right" });

  // === DESCRIPTION ===
  doc.setTextColor(...COLORS.muted);
  doc.setFontSize(8);
  doc.setFont(config.fonts.body, "normal");
  const descMaxWidth = contentWidth - padding * 2;
  let description = activity.description;
  if (description.length > 100) {
    description = description.substring(0, 97) + "...";
  }
  const descLines = doc.splitTextToSize(description, descMaxWidth);
  doc.text(descLines.slice(0, 2), contentX + padding, nameY + 16);

  // === FOOTER: LOCATION + COST ===
  const footerY = y + cardHeight - padding - 2;

  // Location pin icon (small dot)
  doc.setFillColor(...COLORS.primary);
  doc.circle(contentX + padding + 1.5, footerY - 1.5, 1.5, "F");

  // Location text
  doc.setTextColor(...COLORS.subtle);
  doc.setFontSize(7);
  const location = activity.address || activity.location;
  let locationText = location;
  const maxLocationWidth = contentWidth - padding * 2 - 40;
  while (doc.getTextWidth(locationText) > maxLocationWidth && locationText.length > 10) {
    locationText = locationText.substring(0, locationText.length - 4) + "...";
  }
  doc.text(locationText, contentX + padding + 5, footerY);

  // Cost (right side)
  const cost = activity.estimated_cost.amount;
  const costText = cost === 0 ? "Free" : `${currency} ${cost}`;
  const costColor = cost === 0 ? COLORS.secondary : COLORS.text;
  doc.setTextColor(...costColor);
  doc.setFontSize(9);
  doc.setFont(config.fonts.body, "bold");
  doc.text(costText, x + width - padding, footerY, { align: "right" });

  return cardHeight;
}

/**
 * Render gradient placeholder for missing images
 */
function renderGradientPlaceholder(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
  typeConfig: { color: [number, number, number]; label: string }
): void {
  // Create gradient effect
  const steps = 8;
  for (let i = 0; i < steps; i++) {
    const ratio = i / steps;
    const r = Math.min(255, typeConfig.color[0] + 50 * ratio);
    const g = Math.min(255, typeConfig.color[1] + 50 * ratio);
    const b = Math.min(255, typeConfig.color[2] + 50 * ratio);

    doc.setFillColor(r, g, b);
    doc.rect(x, y + (height / steps) * i, width, height / steps + 1, "F");
  }

  // Type label centered
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(typeConfig.label, x + width / 2, y + height / 2 + 4, { align: "center" });
}

/**
 * Render a compact activity row (for days with many activities)
 */
export function renderCompactActivityCard(
  ctx: PageContext,
  activity: Activity,
  x: number,
  y: number,
  width: number,
  currency: string
): number {
  const { doc, config } = ctx;
  const cardHeight = 20;
  const padding = 4;
  const typeConfig = getActivityTypeConfig(activity.type);

  // Card background
  doc.setFillColor(...COLORS.cardBg);
  doc.roundedRect(x, y, width, cardHeight, 2, 2, "F");

  // Type color bar
  doc.setFillColor(...typeConfig.color);
  doc.rect(x, y, 4, cardHeight, "F");

  // Time
  doc.setTextColor(...COLORS.text);
  doc.setFontSize(8);
  doc.setFont(config.fonts.body, "bold");
  doc.text(activity.start_time, x + 8, y + 8);

  // Type badge
  doc.setFillColor(...typeConfig.bgLight);
  doc.roundedRect(x + 28, y + 3, 14, 6, 1, 1, "F");
  doc.setTextColor(...typeConfig.color);
  doc.setFontSize(5);
  doc.text(typeConfig.label, x + 30, y + 7);

  // Activity name
  doc.setTextColor(...COLORS.text);
  doc.setFontSize(9);
  doc.setFont(config.fonts.display, "bold");
  let name = activity.name;
  if (name.length > 30) name = name.substring(0, 27) + "...";
  doc.text(name, x + 46, y + 8);

  // Duration
  doc.setTextColor(...COLORS.subtle);
  doc.setFontSize(7);
  doc.setFont(config.fonts.body, "normal");
  doc.text(formatDuration(activity.duration_minutes), x + 46, y + 15);

  // Location
  const location = (activity.address || activity.location).substring(0, 30);
  doc.text(location, x + 80, y + 15);

  // Cost
  const cost = activity.estimated_cost.amount;
  const costText = cost === 0 ? "Free" : `${currency} ${cost}`;
  const compactCostColor = cost === 0 ? COLORS.secondary : COLORS.text;
  doc.setTextColor(...compactCostColor);
  doc.setFontSize(8);
  doc.setFont(config.fonts.body, "bold");
  doc.text(costText, x + width - padding, y + 12, { align: "right" });

  return cardHeight;
}
