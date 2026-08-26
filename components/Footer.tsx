import Image from 'next/image';
import { Link } from '@/lib/i18n/routing';
import { getTranslations, getLocale } from 'next-intl/server';
import { CookieSettingsButton } from '@/components/consent';
import { destinations } from '@/lib/destinations/data';
import { getAllFrontmatter } from '@/lib/blog/api';
import type { Locale } from '@/lib/destinations/types';

const socialLinks = [
  { label: 'X (formerly Twitter)', href: 'https://x.com/monkeytravel', icon: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z' },
  { label: 'Instagram', href: 'https://instagram.com/monkeytravel.app', icon: 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z' },
  { label: 'LinkedIn', href: 'https://linkedin.com/company/monkeytravel', icon: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z' },
];

// Featured destinations shown in the footer for sitewide internal linking.
// These flow PageRank to the most important destination pages on every render.
const FEATURED_DESTINATION_SLUGS = ['paris', 'rome', 'tokyo', 'barcelona', 'london', 'bali', 'lisbon', 'new-york'];

export default async function Footer() {
  const t = await getTranslations('common.footer');
  const tCommon = await getTranslations('common');
  const locale = (await getLocale()) as Locale;

  const footerLinks = {
    product: [
      { label: t('destinations'), href: '/destinations' },
      // **2026-05-29 (/explore Week 3)**: surface the community feed +
      // bookmarked-trips list site-wide. /saved had ZERO entry points
      // outside direct URL; /explore was only reachable via post-save
      // auto-prompt or the new Navbar entry. Sitewide footer link flows
      // PageRank to both and gives users a stable backstop.
      { label: t('explore'), href: '/explore' },
      { label: t('saved'), href: '/saved' },
      { label: t('blog'), href: '/blog' },
      // **2026-05-25**: Tools row added — previously the Packing List
      // and Visa Checker tools had no entry-points outside their own
      // URLs. Listing two specific tool deep-links keeps the Product
      // column scannable and gives both surfaces a footer-wide backlink.
      { label: t('packingList'), href: '/tools/packing-list' },
      { label: t('visaChecker'), href: '/tools/visa-checker' },
      { label: t('features'), href: '/#features' },
      { label: t('howItWorks'), href: '/#how-it-works' },
      { label: t('joinWaitlist'), href: '/#hero' },
    ],
    support: [
      // **2026-05-25 fix**: previously linked to `/#support` (no FAQ page
      // exists, anchor doesn't exist on /). Point users to /contact where
      // they can actually reach us; we can revisit when an FAQ page lands.
      { label: t('faq'), href: '/contact' },
      { label: t('contact'), href: '/contact' },
      { label: t('sendFeedback'), href: 'mailto:feedback@monkeytravel.app' },
    ],
    legal: [
      { label: t('privacyPolicy'), href: '/privacy' },
      { label: t('termsOfService'), href: '/terms' },
    ],
  };

  // Featured destinations (matched to slug list, preserving order)
  const featuredDestinations = FEATURED_DESTINATION_SLUGS
    .map((slug) => destinations.find((d) => d.slug === slug))
    .filter((d): d is NonNullable<typeof d> => d !== undefined);

  // Latest 6 blog posts (sorted desc by publishedAt in getAllFrontmatter)
  const latestPosts = getAllFrontmatter(locale).slice(0, 6);

  return (
    <footer className="bg-[var(--navy)] text-white">
      {/* Main Footer */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 lg:gap-12">
          {/* Brand */}
          <div className="col-span-2">
            <Link href="/" className="flex items-center gap-2.5 mb-5">
              <Image
                src="/images/logo.png"
                alt={tCommon('logoAlt')}
                width={36}
                height={36}
                className="w-9 h-9 object-contain"
              />
              <span className="text-lg font-bold">MonkeyTravel</span>
            </Link>
            <p className="text-white/70 mb-6 max-w-xs leading-relaxed">
              {t('description')}
            </p>
            {/* Social Links */}
            <div className="flex gap-3">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-[var(--accent)] hover:border-[var(--accent)] hover:text-[var(--foreground)] transition-all"
                  aria-label={social.label}
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d={social.icon} />
                  </svg>
                </a>
              ))}
            </div>

            {/* BuildHop launch badge. Fixed third-party asset (colors, path
                data, wordmark) — kept as-given rather than themed, the same
                way the social icons above are a fixed brand mark rather than
                a themed glyph. Not run through next-intl for the same reason
                the social aria-labels above aren't: it's BuildHop's own
                canonical badge, not sitewide UI copy. */}
            <a
              href="https://buildhop.io/discover/monkeytravel-6a52cf38-01c1-4cb9-9420-4a901acb64f5"
              target="_blank"
              rel="noopener noreferrer"
              title="Trending on BuildHop: MonkeyTravel"
              className="mt-6 inline-block"
            >
              <svg width="208" height="60" viewBox="0 0 208 60">
                <rect x="1.5" y="1.5" width="205" height="57" rx="12" fill="#FFFDF7" stroke="#78A7A2" strokeWidth="3" />
                <g transform="translate(13 9) scale(.104)">
                  <path
                    d="M328.7 93.9a50 50 0 0 0-37-33.4c-41.4-7.2-85.9 29.7-115 61.6a223 223 0 0 0-33-72.5c-19.1-27-49.9-56.2-86.1-48.3C32.5 7 16.9 30 9.5 52.7c-22 70.4-2.5 162.7 25.4 229 8.7 20.2 19 40 32 57.8 1 1.5 3.5.7 3.4-1.2a146 146 0 0 1 1-29l-.5-1c-22-45.4-33-96.3-35.5-146.6-1.2-32 .3-65.2 12-95a61 61 0 0 1 9.8-16.9q2.5-2.7 5.2-4.5c7.4-4.6 16.2 1.4 22.2 6.3 14.1 11.8 24 28.4 33.2 44.6q6.8 12 13.2 24.6a322 322 0 0 1 32 94.6c5.8 31.6 8 64 3.5 95.8a148 148 0 0 1-5 22q-2 6.3-4.8 12.3-3.6 7.5-9 13.3a24 24 0 0 1-12 7.2q-8.5 1.8-17.6-2.3-8.3-4.3-12.6-16c-11.2-34.6 6.8-83.3 22.2-115q9-17.8 19.6-34.8a3 3 0 0 0 .3-2.6q-3.6-9.7-7.4-17.2a3 3 0 0 0-5.1-.2C76 277.7 84 331.5 83.8 331.4c1.2 16.6 5.6 35.4 18.5 44.7h-.3c7.8 5.3 16.2 9 25 10a42 42 0 0 0 28.8-7 77 77 0 0 0 26.6-36.5q5.9-15.6 9-32.2c8.3-42.6 5-88.9-2-130.4a997 997 0 0 0-6-30.4 316 316 0 0 1 34-32.8c15-12 31.5-23.2 50-28.4q32.6-8.6 37.1 24.6c2 14.9 0 30.3-3.3 45.1-8 35.5-23.6 69.3-42.9 100.3a376 376 0 0 1-54.7 68.6c-5.6 15-12.4 27.2-18.8 36.6-1.1 1.7.9 3.8 2.7 2.8l.8-.6c37-24 66.7-57.5 91.1-93.8 21.8-33 40.2-69 49.5-107.5 5.2-23 7.8-47.9-.2-70.6"
                    fill="#006C67"
                  />
                </g>
                <text x="64" y="24" fill="#FFA100" fontSize="13" fontFamily="Avenir Next, Inter, ui-sans-serif, system-ui, sans-serif" fontWeight="700" letterSpacing=".08em">
                  TRENDING ON
                </text>
                <text x="64" y="43" fill="#053F43" fontSize="22" fontFamily="Avenir Next, Inter, ui-sans-serif, system-ui, sans-serif" fontWeight="800" letterSpacing=".06em">
                  BuildHop
                </text>
              </svg>
            </a>
          </div>

          {/* Product Links */}
          <div>
            <h3 className="font-semibold mb-4 text-white/90">{t('product')}</h3>
            <ul className="space-y-3">
              {footerLinks.product.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="text-white/70 underline decoration-white/30 underline-offset-2 hover:decoration-[var(--accent)] hover:text-[var(--accent)] transition-colors text-sm">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Support Links */}
          <div>
            <h3 className="font-semibold mb-4 text-white/90">{t('support')}</h3>
            <ul className="space-y-3">
              {footerLinks.support.map((link) => {
                const isExternal =
                  link.href.startsWith('mailto:') ||
                  link.href.startsWith('http') ||
                  link.href.startsWith('tel:');
                const className =
                  'text-white/70 underline decoration-white/30 underline-offset-2 hover:decoration-[var(--accent)] hover:text-[var(--accent)] transition-colors text-sm';
                return (
                  <li key={link.label}>
                    {/* **2026-05-25 fix**: in-app routes (/contact, /faq)
                        need next-intl's <Link> so the active locale is
                        prefixed (was rendering /contact instead of /es/contact
                        on the ES site). External/mailto stay as raw <a>. */}
                    {isExternal ? (
                      <a href={link.href} className={className}>
                        {link.label}
                      </a>
                    ) : (
                      <Link href={link.href} className={className}>
                        {link.label}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Legal Links */}
          <div>
            <h3 className="font-semibold mb-4 text-white/90">{t('legal')}</h3>
            <ul className="space-y-3">
              {footerLinks.legal.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="text-white/70 underline decoration-white/30 underline-offset-2 hover:decoration-[var(--accent)] hover:text-[var(--accent)] transition-colors text-sm">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Featured Destinations + Latest Articles — sitewide internal links for SEO */}
        <div className="mt-16 pt-12 border-t border-white/10 grid md:grid-cols-2 gap-12">
          <div>
            <h3 className="font-semibold mb-5 text-white/90">{t('popularDestinations')}</h3>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-3">
              {featuredDestinations.map((dest) => (
                <li key={dest.slug}>
                  <Link
                    href={`/destinations/${dest.slug}`}
                    className="text-white/65 hover:text-[var(--accent)] transition-colors text-sm"
                  >
                    {dest.name[locale]}
                    <span className="text-white/55 ml-1.5">{dest.country[locale]}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href="/destinations"
              className="inline-block mt-4 text-[var(--accent)] hover:text-[var(--accent-light)] transition-colors text-sm font-medium"
            >
              {t('viewAllDestinations')} →
            </Link>
          </div>

          <div>
            <h3 className="font-semibold mb-5 text-white/90">{t('featuredArticles')}</h3>
            <ul className="space-y-3">
              {latestPosts.map((post) => (
                <li key={post.slug}>
                  <Link
                    href={`/blog/${post.slug}`}
                    className="text-white/65 hover:text-[var(--accent)] transition-colors text-sm leading-snug block"
                  >
                    {post.title}
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href="/blog"
              className="inline-block mt-4 text-[var(--accent)] hover:text-[var(--accent-light)] transition-colors text-sm font-medium"
            >
              {t('viewAllArticles')} →
            </Link>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-white/60">
            <p>{t('copyright', { year: new Date().getFullYear() })}</p>
            <div className="flex items-center gap-6">
              <Link href="/privacy" className="underline decoration-white/30 underline-offset-2 hover:decoration-[var(--accent)] hover:text-[var(--accent)] transition-colors">{t('privacyPolicy')}</Link>
              <Link href="/terms" className="underline decoration-white/30 underline-offset-2 hover:decoration-[var(--accent)] hover:text-[var(--accent)] transition-colors">{t('termsOfService')}</Link>
              <CookieSettingsButton />
              <Link href="/contact" className="underline decoration-white/30 underline-offset-2 hover:decoration-[var(--accent)] hover:text-[var(--accent)] transition-colors">{t('contact')}</Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
