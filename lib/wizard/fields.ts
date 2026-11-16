/**
 * The planner's fields, as its funnel names them (the first touch of each,
 * the step-1 heartbeat, the abandoned row). wizard_step_events.field's CHECK
 * constraint holds the same list, so a field added here needs a migration there.
 */
export const WIZARD_FIELDS = [
  "destination_autocomplete",
  "destination_pill",
  "start_date",
  "end_date",
  "vibe",
  "budget",
  "pace",
  "requirements",
  "flexible_dates",
  "express_plan",
  "read_request",
] as const;

export type WizardField = (typeof WIZARD_FIELDS)[number];

/** The field when it is one of the planner's, or undefined. */
export function wizardField(value: unknown): WizardField | undefined {
  return (WIZARD_FIELDS as readonly unknown[]).includes(value) ? (value as WizardField) : undefined;
}
