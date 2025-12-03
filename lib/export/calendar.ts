import type { ItineraryDay, Activity } from "@/types";

interface TripForExport {
  title: string;
  startDate: string;
  endDate: string;
  itinerary: ItineraryDay[];
}

/**
 * Format date and time for ICS (YYYYMMDDTHHmmss format)
 */
function formatICSDateTime(date: string, time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  const dateObj = new Date(date);
  dateObj.setHours(hours, minutes, 0, 0);

  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const day = String(dateObj.getDate()).padStart(2, "0");
  const hour = String(dateObj.getHours()).padStart(2, "0");
  const minute = String(dateObj.getMinutes()).padStart(2, "0");

  return `${year}${month}${day}T${hour}${minute}00`;
}

/**
 * Calculate end time from start time and duration
 */
function calculateEndTime(startTime: string, durationMinutes: number): string {
  const [hours, minutes] = startTime.split(":").map(Number);
  const totalMinutes = hours * 60 + minutes + durationMinutes;
  const endHours = Math.floor(totalMinutes / 60) % 24;
  const endMinutes = totalMinutes % 60;
  return `${String(endHours).padStart(2, "0")}:${String(endMinutes).padStart(2, "0")}`;
}

/**
 * Escape special characters for ICS format
 */
function escapeICS(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * Generate ICS content for a trip
 */
export function generateICS(trip: TripForExport): string {
  const events: string[] = [];
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  trip.itinerary.forEach((day) => {
    day.activities.forEach((activity, index) => {
      const startDateTime = formatICSDateTime(day.date, activity.start_time);
      const endTime = calculateEndTime(activity.start_time, activity.duration_minutes);
      const endDateTime = formatICSDateTime(day.date, endTime);

      const uid = `${day.date}-${index}-${Date.now()}@monkeytravel.app`;

      const description = [
        activity.description,
        "",
        `Type: ${activity.type}`,
        `Duration: ${activity.duration_minutes} minutes`,
        activity.estimated_cost.amount > 0
          ? `Estimated cost: ${activity.estimated_cost.currency} ${activity.estimated_cost.amount}`
          : "Free entry",
        "",
        ...(activity.tips?.length ? ["Tips:", ...activity.tips.map((t) => `- ${t}`)] : []),
      ]
        .filter(Boolean)
        .join("\\n");

      const location = activity.address || activity.location;

      events.push(`BEGIN:VEVENT
DTSTART:${startDateTime}
DTEND:${endDateTime}
DTSTAMP:${timestamp}
UID:${uid}
SUMMARY:${escapeICS(activity.name)}
DESCRIPTION:${escapeICS(description)}
LOCATION:${escapeICS(location)}
STATUS:CONFIRMED
TRANSP:OPAQUE
END:VEVENT`);
    });
  });

  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//MonkeyTravel//Trip Export//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:${escapeICS(trip.title)}
${events.join("\n")}
END:VCALENDAR`;
}

/**
 * Download ICS file
 */
export function downloadICS(trip: TripForExport): void {
  const ics = generateICS(trip);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `${trip.title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-itinerary.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generate Google Calendar URL for a single activity
 */
export function getGoogleCalendarUrl(activity: Activity, date: string): string {
  const startDateTime = formatICSDateTime(date, activity.start_time);
  const endTime = calculateEndTime(activity.start_time, activity.duration_minutes);
  const endDateTime = formatICSDateTime(date, endTime);

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: activity.name,
    dates: `${startDateTime}/${endDateTime}`,
    details: activity.description,
    location: activity.address || activity.location,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Generate Google Calendar URL for entire trip
 */
export function getGoogleCalendarUrlForTrip(trip: TripForExport): string {
  // For full trip, we'll just use the first activity as a starting point
  // Google Calendar doesn't support importing multiple events via URL
  const firstDay = trip.itinerary[0];
  const firstActivity = firstDay?.activities[0];

  if (!firstActivity || !firstDay) {
    return "https://calendar.google.com/calendar";
  }

  return getGoogleCalendarUrl(firstActivity, firstDay.date);
}
