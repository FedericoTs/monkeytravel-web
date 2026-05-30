/**
 * Native-aware haptic feedback helpers.
 *
 * Inside the Capacitor mobile shell:
 *   - Calls @capacitor/haptics — the platform API that triggers
 *     iOS Taptic Engine / Android VibrationEffect patterns.
 *
 * In the regular web browser:
 *   - All functions are no-ops. The Web Vibration API exists but
 *     is patchy on iOS Safari (Apple disabled it) and has worse
 *     UX than just doing nothing on desktop/mobile-web.
 *
 * Why this lives in lib/native/:
 *   Matches the share.ts / back-button.ts pattern — dynamic-import
 *   gated by isNativePlatform() so the @capacitor/haptics plugin
 *   code never lands in the web bundle. Saves ~3 KB gzip + avoids
 *   the platform-detection branch evaluating to false 99% of the
 *   time on web traffic.
 *
 * Pattern from Booking + Airbnb iOS apps: haptics on load-bearing
 * actions only, NEVER on every tap. Cheap haptics = annoying. The
 * mental model is "you just did something the app considers
 * meaningful, here's a confirmation tap."
 *
 * Usage:
 *   import { hapticSuccess } from "@/lib/native/haptics";
 *   await saveTripToDb();
 *   hapticSuccess(); // user feels success without needing to look
 */

/**
 * Detect whether we're running inside the Capacitor native shell.
 * Same check as share.ts — kept duplicated rather than imported to
 * keep this module loadable without share.ts. If we ever consolidate
 * into a lib/native/platform.ts, fold these.
 */
function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (
    window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

/**
 * Internal: dynamic-import the plugin only when we're inside the
 * native shell. Returns null on web (caller should treat as no-op).
 *
 * Errors are swallowed because haptics aren't critical — failing to
 * vibrate should never break the user's actual interaction.
 */
async function getHaptics() {
  if (!isNativePlatform()) return null;
  try {
    const mod = await import("@capacitor/haptics");
    return mod;
  } catch {
    return null;
  }
}

/**
 * Selection-change feedback. Tiny, neutral. Use for:
 *   - Opening a popup / menu
 *   - Cycling a toggle
 *   - Picker / slider step changes
 *
 * Avoid for navigation — the OS already plays a tiny haptic on tab
 * transitions, ours would double-tap.
 */
export async function hapticSelection(): Promise<void> {
  const haptics = await getHaptics();
  if (!haptics) return;
  try {
    await haptics.Haptics.selectionStart();
  } catch {
    /* swallow — haptics are best-effort */
  }
}

/**
 * Light impact. Use for:
 *   - Trip saved successfully (low-stakes confirmation)
 *   - Item added to packing list
 *   - Day-card switched
 *
 * iOS feels this as a very brief tap, indistinguishable from
 * selection on most users.
 */
export async function hapticLight(): Promise<void> {
  const haptics = await getHaptics();
  if (!haptics) return;
  try {
    const { Haptics, ImpactStyle } = haptics;
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    /* swallow */
  }
}

/**
 * Medium impact. Use for:
 *   - Vote cast on a group decision
 *   - Activity marked complete (gamification reward)
 *   - Booking opened in external browser
 *
 * Slightly more weight than Light — feels like a deliberate action
 * landed. Don't overuse; the contrast with Light is what gives it
 * meaning.
 */
export async function hapticMedium(): Promise<void> {
  const haptics = await getHaptics();
  if (!haptics) return;
  try {
    const { Haptics, ImpactStyle } = haptics;
    await Haptics.impact({ style: ImpactStyle.Medium });
  } catch {
    /* swallow */
  }
}

/**
 * Heavy impact. Use sparingly. Only for:
 *   - Trip published to /explore (one-shot, high-commitment)
 *   - Major XP milestone unlocked
 *
 * On iOS this is the same haptic as triggering a 3D-touch peek.
 * Users notice. Save for moments worth noticing.
 */
export async function hapticHeavy(): Promise<void> {
  const haptics = await getHaptics();
  if (!haptics) return;
  try {
    const { Haptics, ImpactStyle } = haptics;
    await Haptics.impact({ style: ImpactStyle.Heavy });
  } catch {
    /* swallow */
  }
}

/**
 * Success notification haptic. Two quick taps. Use for:
 *   - Trip generation complete (most natural fit — user just waited)
 *   - Email confirmation received
 *   - Onboarding step completed
 *
 * iOS plays a distinct "success" pattern, NOT just an impact —
 * users have been trained by every native app to interpret it as
 * "the thing you wanted happened."
 */
export async function hapticSuccess(): Promise<void> {
  const haptics = await getHaptics();
  if (!haptics) return;
  try {
    const { Haptics, NotificationType } = haptics;
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    /* swallow */
  }
}

/**
 * Warning notification haptic. Use sparingly for:
 *   - Action that succeeded but with a caveat (e.g. trip saved
 *     but offline-cached only)
 *   - Quota approaching limit
 *
 * Don't use for validation errors — those should use hapticError.
 */
export async function hapticWarning(): Promise<void> {
  const haptics = await getHaptics();
  if (!haptics) return;
  try {
    const { Haptics, NotificationType } = haptics;
    await Haptics.notification({ type: NotificationType.Warning });
  } catch {
    /* swallow */
  }
}

/**
 * Error notification haptic. Use for:
 *   - Form submission failed
 *   - Auth error
 *   - API call returned 5xx
 *
 * Distinct "something went wrong" pattern. Pair with a visible
 * error message — the haptic alone isn't enough information.
 */
export async function hapticError(): Promise<void> {
  const haptics = await getHaptics();
  if (!haptics) return;
  try {
    const { Haptics, NotificationType } = haptics;
    await Haptics.notification({ type: NotificationType.Error });
  } catch {
    /* swallow */
  }
}
