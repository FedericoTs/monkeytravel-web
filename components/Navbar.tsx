import Image from 'next/image';
import { Link } from '@/lib/i18n/routing';
import { getTranslations } from 'next-intl/server';
import NavbarClient from './NavbarClient';

/**
 * Server-rendered Navbar shell.
 *
 * The static structure (logo + primary nav links) is emitted in SSR HTML
 * so Googlebot's first-pass crawl sees them and can flow PageRank to the
 * destinations / blog / SEO landing pages.
 *
 * Interactive bits (auth state, mobile menu toggle, scroll background)
 * live in NavbarClient as a small client island.
 */
export default async function Navbar() {
  const t = await getTranslations('common');

  const navLinks = [
    { href: '/#features', label: t('navigation.features') },
    { href: '/#how-it-works', label: t('navigation.howItWorks') },
    { href: '/destinations', label: t('navigation.destinations') },
    { href: '/blog', label: t('navigation.blog') },
  ];

  return (
    <nav
      data-monkey-nav
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-300 bg-white/80 backdrop-blur-md"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/images/logo.png"
              alt={t('logoAlt')}
              width={36}
              height={36}
              unoptimized
              className="w-9 h-9 object-contain"
            />
            <span className="text-lg font-bold text-[var(--primary)]">MonkeyTravel</span>
          </Link>

          {/* Desktop Navigation — server-rendered for SEO */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="px-4 py-2 rounded-full text-sm font-medium text-[var(--foreground-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/5 transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Client island: auth/CTA + mobile menu + scroll behavior */}
          <NavbarClient navLinks={navLinks} />
        </div>
      </div>
    </nav>
  );
}
