/**
 * Google's one-tap sign-in (Google Identity Services) for the save box: someone signed in to Google in this browser
 * keeps their plan with one tap on their account, on this page, instead of the full redirect through Google's pages.
 * Google answers with a credential (an ID token) that Supabase signs in with (signInWithIdToken), checking the nonce
 * the prompt was made with. Nothing shows for someone not signed in to Google here, or who turned the prompt off: the
 * box stays as it is for them.
 *
 * The client is the one Supabase's Google sign-in uses; its Authorized JavaScript origins must list the site.
 */

/** Public: it is in every Google sign-in redirect. */
export const GOOGLE_CLIENT_ID = "140131553801-kirjsn4vbq8hpbecbokcifgkialb9qkp.apps.googleusercontent.com";
const SCRIPT_URL = "https://accounts.google.com/gsi/client";
const SCRIPT_ID = "google-identity-services";
/** How long the box waits for Google's script before going on without it. */
export const LOAD_TIMEOUT_MS = 5000;

/** The part of Google's one-tap API the box uses. */
export interface GoogleId {
  initialize(config: Record<string, unknown>): void;
  prompt(): void;
  cancel(): void;
}

type WithGoogle = { google?: { accounts?: { id?: GoogleId } } };

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** A fresh nonce: the raw one for Supabase, and its SHA-256 in hex for Google, which writes it into the credential. */
export async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const raw = hex(crypto.getRandomValues(new Uint8Array(16)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return { raw, hashed: hex(new Uint8Array(digest)) };
}

/** Google's one-tap API, its script added once; null when it can't be had in time or fails to load. */
export function loadGoogleId(): Promise<GoogleId | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const api = () => (window as WithGoogle).google?.accounts?.id ?? null;
  if (api()) return Promise.resolve(api());
  return new Promise((resolve) => {
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }
    const timer = setTimeout(() => resolve(api()), LOAD_TIMEOUT_MS);
    script.addEventListener("load", () => (clearTimeout(timer), resolve(api())), { once: true });
    script.addEventListener("error", () => (clearTimeout(timer), resolve(null)), { once: true });
  });
}

/**
 * Asks Google to offer the person's account, in the browser's own sign-in prompt, and calls `onCredential` with the
 * credential when they tap it. The prompt carries the hashed nonce. Gives back a cancel, for when the box closes.
 */
export function offerOneTap(id: GoogleId, hashedNonce: string, onCredential: (credential: string) => void): () => void {
  id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (response: { credential?: string }) => {
      if (response?.credential) onCredential(response.credential);
    },
    nonce: hashedNonce,
    context: "signin",
    auto_select: false,
    cancel_on_tap_outside: false,
    use_fedcm_for_prompt: true,
    itp_support: true,
  });
  id.prompt();
  return () => id.cancel();
}
