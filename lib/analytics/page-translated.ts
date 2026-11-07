import { onPostHogReady } from "@/lib/posthog/client";

/** Chrome's translator and Google's mark <html> with this class, and set its lang to the new language. */
const TRANSLATED = /\btranslated-(ltr|rtl)\b/;

/** The class can come before the lang. */
const SETTLE_MS = 3_000;

/**
 * Reports once per page load that the browser is translating the page, and into
 * what: which languages people read us in when we don't offer them.
 */
export function reportPageTranslation(): void {
  const html = document.documentElement;
  const check = () => {
    if (!TRANSLATED.test(html.className)) return;
    observer.disconnect();
    setTimeout(() => {
      onPostHogReady((posthog) => posthog.capture("page_translated", { to: html.lang }));
    }, SETTLE_MS);
  };
  const observer = new MutationObserver(check);
  observer.observe(html, { attributes: true, attributeFilter: ["class"] });
  check();
}
