import jsPDF from "jspdf";
import type { ItineraryDay } from "@/types";

interface TripForExport {
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  budget?: { total: number; currency: string } | null;
  itinerary: ItineraryDay[];
}

/**
 * Format date for display
 */
function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Activity type emoji mapping
 */
const typeEmoji: Record<string, string> = {
  attraction: "📍",
  restaurant: "🍽️",
  activity: "🎯",
  transport: "🚗",
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

  // Colors
  const primaryColor = [10, 75, 115] as [number, number, number]; // #0A4B73
  const accentColor = [242, 198, 65] as [number, number, number]; // #F2C641
  const textColor = [30, 41, 59] as [number, number, number]; // slate-800
  const mutedColor = [100, 116, 139] as [number, number, number]; // slate-500

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

  // Logo/Brand
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.text("🐒 MonkeyTravel", margin, 15);

  // Title
  doc.setFontSize(28);
  doc.setFont("helvetica", "bold");
  const titleLines = doc.splitTextToSize(trip.title, contentWidth);
  doc.text(titleLines, margin, 35);

  // Date range
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text(`${formatDate(trip.startDate)} - ${formatDate(trip.endDate)}`, margin, 50);

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
    doc.text(formatDate(day.date), pageWidth - margin - 30, yPosition + 10);

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

      // Type emoji and name
      const emoji = typeEmoji[activity.type] || "📍";
      doc.setTextColor(...textColor);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text(`${emoji} ${activity.name}`, margin + 26, yPosition + 9);

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

      // Location
      doc.setTextColor(...mutedColor);
      doc.setFontSize(7);
      const locationText = activity.address || activity.location;
      doc.text(`📍 ${locationText.substring(0, 60)}${locationText.length > 60 ? "..." : ""}`, margin + 5, yPosition + 26);

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
 * Download PDF file
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
