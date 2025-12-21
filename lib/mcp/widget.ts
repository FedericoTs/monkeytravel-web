/**
 * MCP Widget Generator
 * Generates HTML widgets for ChatGPT display
 *
 * IMPORTANT: This is a NEW file - does not modify existing code
 */

import type { MCPTripResponse, MCPDay, MCPActivity } from "./schema";

/**
 * Generate HTML widget for itinerary display in ChatGPT
 * Follows OpenAI widget UX guidelines:
 * - WCAG AA accessible
 * - Simple, clean design
 * - Mobile-responsive
 * - CTA to save in app
 */
export function generateItineraryWidget(trip: MCPTripResponse): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --primary: #0A4B73;
      --accent: #F2C641;
      --text: #1a1a1a;
      --text-light: #666;
      --bg: #f8f9fa;
      --card: #ffffff;
      --border: #e0e0e0;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      font-size: 14px;
    }
    .header {
      background: var(--primary);
      color: white;
      padding: 16px;
      text-align: center;
    }
    .header h1 { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
    .header p { font-size: 13px; opacity: 0.9; }
    .days { padding: 12px; }
    .day {
      background: var(--card);
      border-radius: 10px;
      margin-bottom: 12px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    .day-header {
      background: var(--bg);
      padding: 10px 14px;
      font-weight: 600;
      font-size: 13px;
      color: var(--primary);
      border-bottom: 1px solid var(--border);
    }
    .activities { padding: 8px 0; }
    .activity {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
    }
    .activity:last-child { border-bottom: none; }
    .activity-time {
      font-size: 11px;
      color: var(--text-light);
      font-weight: 500;
    }
    .activity-name {
      font-weight: 500;
      margin: 2px 0;
    }
    .activity-desc {
      font-size: 12px;
      color: var(--text-light);
    }
    .activity-tip {
      font-size: 11px;
      color: var(--accent);
      margin-top: 4px;
    }
    .activity-tip::before { content: "Tip: "; font-weight: 500; }
    .cta {
      display: block;
      margin: 16px 12px;
      padding: 14px;
      background: var(--primary);
      color: white;
      text-align: center;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 14px;
    }
    .cta:hover { opacity: 0.9; }
    .footer {
      text-align: center;
      padding: 12px;
      font-size: 11px;
      color: var(--text-light);
    }
  </style>
</head>
<body>
  <header class="header">
    <h1>${escapeHtml(trip.destination)}</h1>
    <p>${trip.days} Day Itinerary</p>
  </header>

  <div class="days">
    ${trip.itinerary.map((day) => renderDay(day)).join("")}
  </div>

  <a href="${escapeHtml(trip.saveUrl)}" class="cta" target="_blank" rel="noopener">
    Save & Edit in MonkeyTravel
  </a>

  <footer class="footer">
    Powered by MonkeyTravel AI
  </footer>
</body>
</html>`;
}

/**
 * Render a single day
 */
function renderDay(day: MCPDay): string {
  return `
    <div class="day">
      <div class="day-header">Day ${day.day}: ${escapeHtml(day.theme)}</div>
      <div class="activities">
        ${day.activities.map((act) => renderActivity(act)).join("")}
      </div>
    </div>`;
}

/**
 * Render a single activity
 */
function renderActivity(activity: MCPActivity): string {
  return `
    <div class="activity">
      <div class="activity-time">${escapeHtml(activity.time)}</div>
      <div class="activity-name">${escapeHtml(activity.name)}</div>
      <div class="activity-desc">${escapeHtml(activity.description)}</div>
      ${activity.tip ? `<div class="activity-tip">${escapeHtml(activity.tip)}</div>` : ""}
    </div>`;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str: string): string {
  const escapeMap: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return str.replace(/[&<>"']/g, (c) => escapeMap[c] || c);
}
