import jsPDF from "jspdf";
import type { TripForExport } from "@/types";
import { formatDateFull } from "@/lib/datetime";

/**
 * Activity type configuration with colors and labels
 * Using visual indicators instead of emojis (jsPDF doesn't support Unicode emojis)
 */
const typeConfig: Record<string, { label: string; color: [number, number, number] }> = {
  attraction: { label: "See", color: [0, 180, 166] },      // Teal
  restaurant: { label: "Eat", color: [255, 159, 67] },     // Orange
  activity: { label: "Do", color: [108, 92, 231] },        // Purple
  transport: { label: "Go", color: [99, 110, 114] },       // Gray
};

/**
 * Generate PDF for a trip itinerary
 */
export async function generateTripPDF(trip: TripForExport): Promise<Blob> {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let yPosition = margin;

  // Colors - Fresh Voyager theme
  const primaryColor = [255, 107, 107] as [number, number, number]; // #FF6B6B (Coral)
  const accentColor = [255, 217, 61] as [number, number, number]; // #FFD93D (Gold)
  const secondaryColor = [0, 180, 166] as [number, number, number]; // #00B4A6 (Teal)
  const textColor = [45, 52, 54] as [number, number, number]; // #2D3436
  const mutedColor = [99, 110, 114] as [number, number, number]; // #636E72

  // Helper function to check if we need a new page
  const checkNewPage = (requiredSpace: number) => {
    if (yPosition + requiredSpace > pageHeight - margin) {
      doc.addPage();
      yPosition = margin;
      return true;
    }
    return false;
  };

  // ==================== COVER PAGE ====================

  // Header background
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, pageWidth, 60, "F");

  // Logo/Brand (text-based, no emoji)
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("MonkeyTravel", margin, 15);

  // Title
  doc.setFontSize(28);
  doc.setFont("helvetica", "bold");
  const titleLines = doc.splitTextToSize(trip.title, contentWidth);
  doc.text(titleLines, margin, 35);

  // Date range
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text(`${formatDateFull(trip.startDate)} - ${formatDateFull(trip.endDate)}`, margin, 50);

  yPosition = 75;

  // Trip summary box
  doc.setFillColor(248, 250, 252); // slate-50
  doc.roundedRect(margin, yPosition, contentWidth, 35, 3, 3, "F");

  doc.setTextColor(...textColor);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Trip Overview", margin + 5, yPosition + 8);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...mutedColor);

  const totalActivities = trip.itinerary.reduce((sum, day) => sum + day.activities.length, 0);

  doc.text(`${trip.itinerary.length} days`, margin + 5, yPosition + 18);
  doc.text(`${totalActivities} activities`, margin + 45, yPosition + 18);

  if (trip.budget) {
    doc.text(`${trip.budget.currency} ${trip.budget.total} estimated`, margin + 90, yPosition + 18);
  }

  if (trip.description) {
    const descLines = doc.splitTextToSize(trip.description, contentWidth - 10);
    doc.text(descLines.slice(0, 2), margin + 5, yPosition + 28);
  }

  yPosition += 50;

  // ==================== ITINERARY PAGES ====================

  trip.itinerary.forEach((day, dayIndex) => {
    // Check if we need a new page for this day
    checkNewPage(40);

    // Day header
    doc.setFillColor(...primaryColor);
    doc.roundedRect(margin, yPosition, contentWidth, 18, 2, 2, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(`Day ${day.day_number}`, margin + 5, yPosition + 7);

    if (day.theme) {
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(day.theme, margin + 5, yPosition + 13);
    }

    // Date on right
    doc.setFontSize(10);
    doc.text(formatDateFull(day.date), pageWidth - margin - 30, yPosition + 10);

    yPosition += 25;

    // Activities
    day.activities.forEach((activity, actIndex) => {
      // Check if we need a new page
      checkNewPage(35);

      // Activity card
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.roundedRect(margin, yPosition, contentWidth, 30, 2, 2, "FD");

      // Time badge
      doc.setFillColor(...accentColor);
      doc.roundedRect(margin + 3, yPosition + 3, 20, 8, 1, 1, "F");
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.text(activity.start_time, margin + 5, yPosition + 8);

      // Type badge (colored pill with label instead of emoji)
      const config = typeConfig[activity.type] || { label: "See", color: [99, 110, 114] };
      doc.setFillColor(...config.color);
      doc.roundedRect(margin + 26, yPosition + 3, 12, 6, 1, 1, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(6);
      doc.setFont("helvetica", "bold");
      doc.text(config.label, margin + 27.5, yPosition + 7);

      // Activity name
      doc.setTextColor(...textColor);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text(activity.name, margin + 41, yPosition + 9);

      // Duration
      doc.setTextColor(...mutedColor);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.text(`${activity.duration_minutes} min`, pageWidth - margin - 15, yPosition + 9);

      // Description (truncated)
      const descText = activity.description.length > 100
        ? activity.description.substring(0, 100) + "..."
        : activity.description;
      doc.setFontSize(8);
      doc.text(doc.splitTextToSize(descText, contentWidth - 30), margin + 5, yPosition + 16);

      // Location (small dot indicator instead of emoji)
      doc.setFillColor(...secondaryColor);
      doc.circle(margin + 7, yPosition + 25, 1.5, "F");
      doc.setTextColor(...mutedColor);
      doc.setFontSize(7);
      const locationText = activity.address || activity.location;
      doc.text(`${locationText.substring(0, 55)}${locationText.length > 55 ? "..." : ""}`, margin + 11, yPosition + 26);

      // Cost
      const costText = activity.estimated_cost.amount === 0
        ? "Free"
        : `${activity.estimated_cost.currency} ${activity.estimated_cost.amount}`;
      doc.text(costText, pageWidth - margin - 15, yPosition + 26);

      yPosition += 35;
    });

    // Day budget summary
    if (day.daily_budget) {
      checkNewPage(15);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(margin, yPosition, contentWidth, 10, 1, 1, "F");
      doc.setTextColor(...mutedColor);
      doc.setFontSize(8);
      doc.text(
        `Day ${day.day_number} estimated: ${trip.budget?.currency || "USD"} ${day.daily_budget.total}`,
        margin + 5,
        yPosition + 6
      );
      yPosition += 15;
    }

    yPosition += 5;
  });

  // ==================== FOOTER ====================
  checkNewPage(30);

  doc.setFillColor(248, 250, 252);
  doc.rect(0, pageHeight - 25, pageWidth, 25, "F");

  doc.setTextColor(...mutedColor);
  doc.setFontSize(8);
  doc.text(
    "Generated by MonkeyTravel - AI-powered travel planning",
    pageWidth / 2,
    pageHeight - 15,
    { align: "center" }
  );
  doc.text(
    `monkeytravel.app • ${new Date().toLocaleDateString()}`,
    pageWidth / 2,
    pageHeight - 10,
    { align: "center" }
  );

  // Return as blob
  return doc.output("blob");
}

/**
 * Download PDF file (basic version)
 */
export async function downloadPDF(trip: TripForExport): Promise<void> {
  const blob = await generateTripPDF(trip);
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `${trip.title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-itinerary.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ============================================================================
// PREMIUM PDF EXPORTS
// ============================================================================
// The premium PDF module provides magazine-style PDFs with images, beautiful
// typography, and professional layouts.
//
// Usage:
// ```typescript
// import { downloadPremiumPDF, PremiumTripForExport } from "@/lib/export/pdf";
//
// const tripData: PremiumTripForExport = {
//   title: "Barcelona Adventure",
//   destination: "Barcelona, Spain",
//   startDate: "2025-03-15",
//   endDate: "2025-03-22",
//   coverImageUrl: "https://...",
//   itinerary: [...],
//   meta: { highlights: [...], weather_note: "..." },
// };
//
// await downloadPremiumPDF(tripData, (step, progress) => {
//   console.log(`${step}: ${progress}%`);
// });
// ```
// ============================================================================

export {
  // Main functions
  generatePremiumTripPDF,
  downloadPremiumPDF,
  estimatePDFSize,
  // Types
  type PremiumTripForExport,
  type PDFConfig,
  type ImageCache,
  // Config
  PDF_CONFIG,
  TYPOGRAPHY,
  LAYOUT,
} from "./pdf/index";
