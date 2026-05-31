/**
 * Native push-notification client wrapper (Phase B1 — last layer).
 *
 * Bridges @capacitor/push-notifications with the server-side schema
 * shipped in commits 8159868 + b1980e6. Flow on cold launch (only
 * when the user is already signed in):
 *
 *   1. Check current iOS/Android permission via PushNotifications.checkPermissions()
 *   2. If not yet granted AND not denied, fire the OS prompt via .requestPermissions()
 *   3. On grant, call PushNotifications.register() — this asks APNs/FCM
 *      for a token
 *   4. The "registration" event fires with the token; POST it to
 *      /api/devices/register (upsert keyed on token UNIQUE)
 *   5. The "pushNotificationActionPerformed" event fires when the user
 *      taps a notification; pull the data.url and route via
 *      window.location (deep-link handler from B2 catches this and
 *      converts to soft transition)
 *
 * Permission strategy is deliberate:
 *
 *   - iOS lets you ask EXACTLY ONCE without going to Settings. If
 *     denied, the only way back to "allow" is the user manually
 *     toggling it in iOS Settings → MonkeyTravel → Notifications.
 *     This makes a stale "Allow MonkeyTravel to send notifications?"
 *     cold-launch prompt catastrophically expensive — most users
 *     hit "Don't Allow" because they don't know what the app is yet.
 *   - Booking.com / Airbnb pattern: NEVER show the OS prompt cold.
 *     Show a custom in-app sheet first ("Get reminders for your
 *     trip and price alerts") that primes intent. Only if the user
 *     taps the soft-CTA do we trigger the real OS prompt. Result:
 *     ~70% opt-in vs ~25% for cold prompts (industry data).
 *
 * For v1 of B1 the wrapper exposes:
 *   - `initPushOnce()` — call from NativeBoot once per cold launch.
 *     Idempotent. Skips entirely if the user hasn't yet seen the
 *     soft-prompt (we honor a localStorage flag set by the prompt
 *     component, NOT shipped in this commit — see follow-up).
 *   - `requestPushPermissionAndRegister()` — call from the soft-
 *     prompt component's "Yes, notify me" handler. Does the actual
 *     OS prompt → register → POST flow. Returns a promise that
 *     resolves to true/false based on the user's permission choice.
 *   - `unregisterPushOnSignOut()` — call from the sign-out flow
 *     BEFORE the Supabase session is cleared (the DELETE endpoint
 *     needs auth). DELETE /api/devices/[token] cleans up the row.
 *
 * Web bundle impact: ZERO. Dynamic-import gates
 * @capacitor/push-notifications behind isNativePlatform(). The plugin
 * code never lands in the regular web bundle.
 */

const SOFT_PROMPT_GRANTED_KEY = "mt_push_soft_prompt_granted";
const REGISTERED_TOKEN_KEY = "mt_push_registered_token";

/**
 * Module-scoped init guards. initPushOnce() can be called from multiple
 * paths (NativeBoot cold launch, AuthProvider on every SIGNED_IN, and
 * the tail of requestPushPermissionAndRegister). Without these guards
 * each call would attach a fresh set of listeners and a single
 * notification tap would route N times.
 *
 *   - `hasInit`                  — set on first successful init. Reset
 *                                  only in unregisterPushOnSignOut()
 *                                  so a new user can re-init on next
 *                                  SIGNED_IN.
 *   - `registrationListenerAttached` — registration + registrationError
 *                                  listeners may be attached early by
 *                                  requestPushPermissionAndRegister() to
 *                                  avoid racing register() against
 *                                  listener attachment. This dedupes the
 *                                  second attach attempt from
 *                                  initPushOnce().
 *   - `actionListenerAttached`   — pushNotificationActionPerformed is
 *                                  only ever attached by initPushOnce.
 *                                  Tracked separately so the listener
 *                                  attach itself is idempotent even if
 *                                  the function is somehow re-entered
 *                                  before hasInit flips.
 */
let hasInit = false;
let registrationListenerAttached = false;
let actionListenerAttached = false;

/**
 * Stable module-scoped listener callbacks. Factored out of initPushOnce
 * so requestPushPermissionAndRegister() can attach the registration
 * pair BEFORE calling register() without diverging from the cold-launch
 * code path. Identical-reference doesn't matter for Capacitor's
 * addListener (each call attaches a new handle), so the dedupe is
 * enforced via the *_ListenerAttached flags above.
 */
const onRegistration = (token: { value: string }): void => {
  // eslint-disable-next-line no-console
  console.log("[push] registration token received");
  void registerTokenWithServer(token.value);
};

const onRegistrationError = (error: unknown): void => {
  // eslint-disable-next-line no-console
  console.error("[push] registration error:", error);
};

const onActionPerformed = (action: {
  notification: { data?: { url?: string } };
}): void => {
  // User tapped a notification. Pull the deep-link URL if the
  // payload included one (data.url is conventional across APNs +
  // FCM in our dispatcher).
  const url = action.notification.data?.url;
  if (typeof url === "string" && url.startsWith("/")) {
    // eslint-disable-next-line no-console
    console.log("[push] notification tap → routing to:", url);
    // The deep-link handler (lib/native/deep-links.ts B2) won't fire
    // for in-app tap routing — appUrlOpen is only for URL-scheme
    // launches. So we directly assign to the same-origin path. Next
    // App Router intercepts and soft-transitions.
    window.location.assign(url);
  }
};

/**
 * Reuse the isNativePlatform check from the existing native helpers.
 * Inline to keep this module loadable without depending on the back-
 * button / share modules.
 */
function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (
    window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

/**
 * Has the user explicitly opted in via our soft-prompt? Honored to
 * avoid surprising the user with a cold OS prompt before they've
 * seen the value proposition.
 */
function userOptedInViaSoftPrompt(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(SOFT_PROMPT_GRANTED_KEY) === "true";
}

/**
 * Mark the user as having opted in via the soft-prompt. Called by
 * the soft-prompt component when the user taps "Yes, notify me."
 */
export function markSoftPromptGranted(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SOFT_PROMPT_GRANTED_KEY, "true");
}

/**
 * Idempotent cold-launch init. No-op on web. No-op on native if the
 * user hasn't yet opted in via the soft-prompt. When opted in, runs
 * the full check-permissions → register → POST flow.
 *
 * The soft-prompt component (not in this commit — see follow-up) is
 * responsible for calling requestPushPermissionAndRegister() the
 * first time. After that, this function takes over on subsequent
 * cold launches to refresh the token if needed.
 */
export async function initPushOnce(): Promise<void> {
  if (!isNativePlatform()) return;
  if (!userOptedInViaSoftPrompt()) return;

  // Idempotency guard. Without this, a single notification tap fires
  // window.location.assign(url) N times — once per init call across
  // NativeBoot cold launch, every SIGNED_IN from AuthProvider (session
  // restore, sign-in, sometimes token refresh), and the tail of
  // requestPushPermissionAndRegister(). The flag stays set for the
  // lifetime of the app process — reset ONLY in unregisterPushOnSignOut
  // so a fresh user can re-init on the next SIGNED_IN.
  //
  // Capture the prior value before we flip it: when the opt-in path
  // pre-flips hasInit (so registration listeners can race-safely attach
  // before it calls register() itself), wasFirstInit is false here and
  // we MUST NOT call register() a second time below. On a true cold
  // launch wasFirstInit is true and the conditional register() runs.
  const wasFirstInit = !hasInit;
  hasInit = true;

  try {
    const { PushNotifications } = await import(
      "@capacitor/push-notifications"
    );

    // Set up the registration listeners BEFORE calling register(). The
    // event can fire synchronously enough that listeners attached
    // after .register() miss it on some Android builds. The opt-in
    // path attaches these directly (and flips the flag) BEFORE its own
    // register() call to defeat the same race; this dedupe keeps that
    // pre-attach from double-handling the event.
    if (!registrationListenerAttached) {
      registrationListenerAttached = true;
      await PushNotifications.addListener("registration", onRegistration);
      await PushNotifications.addListener(
        "registrationError",
        onRegistrationError
      );
    }

    if (!actionListenerAttached) {
      actionListenerAttached = true;
      await PushNotifications.addListener(
        "pushNotificationActionPerformed",
        onActionPerformed
      );
    }

    // Check current permission state without prompting.
    const perm = await PushNotifications.checkPermissions();
    if (wasFirstInit && perm.receive === "granted") {
      // Cold-launch path: nothing else has called register() this
      // session, so we own the registration. The opt-in path skips
      // this branch (wasFirstInit === false) because it already called
      // PushNotifications.register() itself — without this gate, the
      // sequence requestPushPermissionAndRegister →
      // markSoftPromptGranted → register() → initPushOnce() would hit
      // register() a second time on the same opt-in.
      await PushNotifications.register();
    } else if (perm.receive === "denied") {
      // User denied. Don't re-prompt; only Settings can grant now.
      // eslint-disable-next-line no-console
      console.log("[push] permission denied — skipping register");
    } else if (wasFirstInit) {
      // "prompt" or "prompt-with-rationale" — the OS hasn't asked
      // yet. We rely on the soft-prompt component to call
      // requestPushPermissionAndRegister() at the right moment.
      // eslint-disable-next-line no-console
      console.log("[push] permission state pending soft-prompt:", perm.receive);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[push] initPushOnce failed:", err);
  }
}

/**
 * Show the OS permission prompt + register the device. Call this
 * from the soft-prompt component's "Yes" handler — NEVER from cold
 * launch. Returns true if permission was granted AND a token was
 * obtained, false otherwise.
 */
export async function requestPushPermissionAndRegister(): Promise<boolean> {
  if (!isNativePlatform()) return false;

  try {
    const { PushNotifications } = await import(
      "@capacitor/push-notifications"
    );

    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") {
      return false;
    }

    markSoftPromptGranted();

    // Defeat the registration race: APNs/FCM can fire the "registration"
    // event before listeners attached AFTER register() can catch it
    // (some Android builds dispatch it synchronously enough during the
    // register() call). Attach BEFORE calling register(), using the
    // same module-scoped callbacks initPushOnce uses so we don't
    // double-handle on the next cold launch.
    if (!registrationListenerAttached) {
      registrationListenerAttached = true;
      await PushNotifications.addListener("registration", onRegistration);
      await PushNotifications.addListener(
        "registrationError",
        onRegistrationError
      );
    }

    // Pre-flip hasInit BEFORE calling initPushOnce so that initPushOnce
    // sees wasFirstInit=false and skips its own conditional register()
    // call below. Without this, register() would be invoked twice on
    // every opt-in (once here, once inside initPushOnce because
    // markSoftPromptGranted made perm.receive evaluate to "granted").
    hasInit = true;

    await PushNotifications.register();

    // Run the rest of the init flow — primarily to attach
    // onActionPerformed for notification taps. The hasInit + listener
    // dedupes above make this a safe no-op for the registration side.
    void initPushOnce();
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[push] requestPushPermissionAndRegister failed:", err);
    return false;
  }
}

/**
 * POST the token to /api/devices/register. Idempotent on the server
 * (upsert by UNIQUE(token)). Cached in localStorage so we skip the
 * POST when nothing changed across launches.
 */
async function registerTokenWithServer(token: string): Promise<void> {
  if (!token) return;

  // Skip if we already registered this exact token recently. The
  // server upsert is idempotent so this is purely a network-cost
  // optimization on every cold launch.
  if (
    typeof localStorage !== "undefined" &&
    localStorage.getItem(REGISTERED_TOKEN_KEY) === token
  ) {
    return;
  }

  try {
    const platform = await getPlatformLabel();
    const res = await fetch("/api/devices/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        token,
        platform,
        // Optional metadata that helps the dispatcher localize copy
        // and the admin dashboard debug per-version issues.
        locale: typeof navigator !== "undefined" ? navigator.language : undefined,
        appVersion: undefined, // can be filled from @capacitor/app later
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "<unreadable>");
      // eslint-disable-next-line no-console
      console.error(
        "[push] device-register API returned",
        res.status,
        text.slice(0, 200)
      );
      return;
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(REGISTERED_TOKEN_KEY, token);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[push] device-register POST failed:", err);
  }
}

/**
 * Best-effort guess of the running platform. Capacitor's Device
 * plugin would be cleaner but we already gate everything on
 * isNativePlatform() and the platform is exposed on window.Capacitor.
 */
async function getPlatformLabel(): Promise<"ios" | "android"> {
  const cap = (
    window as unknown as {
      Capacitor?: { getPlatform?: () => string };
    }
  ).Capacitor;
  const plat = cap?.getPlatform?.();
  if (plat === "ios") return "ios";
  if (plat === "android") return "android";
  // Fallback shouldn't be possible because isNativePlatform() already
  // filtered out web — defensive default to android (no APNs token
  // would ever look like an FCM token, so the dispatcher will fail
  // loud rather than silently misroute).
  return "android";
}

/**
 * Clear the device token from the server before sign-out clears the
 * Supabase session. Call from the sign-out flow.
 *
 * After this, the user is removed from the dispatch list. If a stale
 * push was already in-flight when they signed out, they may still
 * see it on their device — accepted trade-off vs. retaining tokens
 * for an indefinite time.
 */
export async function unregisterPushOnSignOut(): Promise<void> {
  if (!isNativePlatform()) return;

  const token =
    typeof localStorage !== "undefined"
      ? localStorage.getItem(REGISTERED_TOKEN_KEY)
      : null;
  if (!token) return;

  try {
    await fetch(`/api/devices/${encodeURIComponent(token)}`, {
      method: "DELETE",
      credentials: "include",
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[push] device-unregister DELETE failed:", err);
  } finally {
    // Always clear the local cache so a re-signin re-registers.
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(REGISTERED_TOKEN_KEY);
      localStorage.removeItem(SOFT_PROMPT_GRANTED_KEY);
    }
    // Reset the in-memory init guards so a NEW user signing in on the
    // same app process can re-init from scratch on the next SIGNED_IN.
    // The Capacitor listeners themselves stay attached (we don't have
    // a handle to remove them and they reference module-scoped
    // callbacks that handle the new session correctly); the flags exist
    // to dedupe addListener calls and gate the conditional register().
    hasInit = false;
  }
}
