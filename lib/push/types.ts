/**
 * Shared types for push notifications (Phase B1).
 *
 * Stable across the API surface (/api/devices/*), the dispatcher
 * (lib/push/dispatch.ts), and the eventual client wrapper
 * (lib/native/push.ts). Single source of truth so the layer
 * boundaries stay consistent as we wire more notification types.
 */

/**
 * Native platform a device is running on. Drives which dispatcher
 * (APNs vs FCM) handles the send + which payload format we build.
 */
export type DevicePlatform = "ios" | "android";

/**
 * Row shape as we insert into / read from the `device_tokens` table.
 * Mirrors the migration in
 * supabase/migrations/20260601_device_tokens_push_log.sql.
 */
export interface DeviceTokenRow {
  id: string;
  user_id: string;
  token: string;
  platform: DevicePlatform;
  app_version: string | null;
  locale: string | null;
  created_at: string;
  last_seen_at: string;
  suppressed_at: string | null;
}

/**
 * Body of POST /api/devices/register. Validated server-side; client
 * sends after acquiring the token from @capacitor/push-notifications.
 */
export interface RegisterDeviceRequest {
  token: string;
  platform: DevicePlatform;
  appVersion?: string;
  locale?: string;
}

export interface RegisterDeviceResponse {
  /** True if a new row was created OR an existing row was refreshed. */
  ok: boolean;
  /** Echoes back the platform so the client can confirm. */
  platform?: DevicePlatform;
  /** ISO timestamp of last_seen_at after the upsert. */
  lastSeenAt?: string;
  /** Set on failure. */
  error?: string;
}

/**
 * Notification types we send. New types: add the literal here so all
 * call sites get TypeScript-narrowed payload shapes. Convention:
 * snake_case grouped by surface prefix.
 *
 * Keep this exhaustive — the dispatcher's switch should error on
 * unhandled cases so we don't accidentally ship pushes with no
 * routing logic.
 */
export type NotificationType =
  | "trip_reminder_3d"           // Trip starts in 3 days (daily cron)
  | "trip_reminder_1d"           // Trip starts tomorrow
  | "collab_activity_added"      // Someone added an activity to my trip
  | "collab_vote_needed"         // Group poll opened
  | "post_trip_review_prompt"    // 1 day after end_date
  | "trip_published"             // Confirmation when user publishes to /explore
  | "test";                      // Admin-panel test sends — never user-triggered

/**
 * Strongly-typed payload per notification type. Body always present;
 * data is optional structured metadata the client can read on tap
 * (e.g. {tripId} to route to /trips/{tripId}).
 *
 * Keep payloads small — APNs caps at 4KB, FCM at 4KB (data) / 4KB
 * (notification). Never put full itineraries in here.
 */
export interface NotificationPayload {
  type: NotificationType;
  /** User-visible title. Already localized — see locale in DeviceTokenRow. */
  title: string;
  /** User-visible body text. Already localized. */
  body: string;
  /** Optional badge count for iOS (number on app icon). */
  badge?: number;
  /** Optional sound name. iOS only. */
  sound?: string;
  /** Structured metadata for tap handling. Becomes APNs payload `data` / FCM `data`. */
  data?: {
    /** If set, the client deep-link listener routes here on tap. */
    url?: string;
    /** Convenience aliases used by the deep-link router. */
    tripId?: string;
    notificationType?: NotificationType;
    /** Free-form extras for future notification types. */
    [key: string]: string | number | boolean | undefined;
  };
}

/**
 * Result of a single dispatch attempt — what got sent, what bounced,
 * what we already suppressed. Used by the API layer for ack responses
 * + by tests for assertions.
 */
export interface DispatchResult {
  notificationType: NotificationType;
  userId: string;
  /** Devices the underlying provider accepted. */
  sentCount: number;
  /** Devices that returned terminal errors (suppressed in-flight). */
  bounceCount: number;
  /** Devices skipped because we already had them suppressed pre-call. */
  skippedSuppressed: number;
  /** True if at least one device successfully received the push. */
  ok: boolean;
  /** Populated on hard failure (e.g. missing env, network error). */
  error?: string;
}
