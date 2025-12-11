'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { isAdmin } from '@/lib/admin';
import type { User } from '@supabase/supabase-js';
import ReferralModal from '@/components/referral/ReferralModal';
import { Gift } from 'lucide-react';

const navLinks = [
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How It Works' },
];

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [referralModalOpen, setReferralModalOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const supabase = createClient();

    // Get initial user
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-white/95 backdrop-blur-xl shadow-sm'
          : 'bg-white/80 backdrop-blur-md'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/images/logo.png"
              alt="MonkeyTravel Logo"
              width={36}
              height={36}
              className="w-9 h-9 object-contain"
            />
            <span className="text-lg font-bold text-[var(--primary)]">MonkeyTravel</span>
          </Link>

          {/* Desktop Navigation */}
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

          {/* CTA Button */}
          <div className="hidden md:flex items-center gap-3">
            {loading ? (
              <div className="w-24 h-10 bg-slate-100 rounded-full animate-pulse" />
            ) : user ? (
              <>
                {isAdmin(user.email) && (
                  <Link
                    href="/admin"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-slate-900 text-white font-medium text-sm hover:bg-slate-800 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    Admin
                  </Link>
                )}
                <button
                  onClick={() => setReferralModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-white font-medium text-sm hover:from-amber-600 hover:to-orange-600 transition-colors shadow-md"
                >
                  <Gift className="w-4 h-4" />
                  Invite Friends
                </button>
                <Link
                  href="/trips"
                  className="inline-flex items-center px-5 py-2.5 rounded-full bg-[var(--primary)] text-white font-medium text-sm hover:bg-[var(--primary-light)] transition-colors shadow-md"
                >
                  My Trips
                </Link>
                <Link
                  href="/profile"
                  className="p-2 rounded-full text-[var(--foreground-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/5 transition-colors"
                  title="Profile"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/auth/login"
                  className="px-4 py-2 rounded-full text-sm font-medium text-[var(--primary)] hover:bg-[var(--primary)]/5 transition-colors"
                >
                  Sign in
                </Link>
                <Link
                  href="/trips/new"
                  className="inline-flex items-center px-5 py-2.5 rounded-full bg-[var(--primary)] text-white font-medium text-sm hover:bg-[var(--primary-light)] transition-colors shadow-md"
                >
                  Start Planning
                </Link>
              </>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden p-2 rounded-lg text-[var(--foreground)] hover:bg-gray-100 transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-gray-100 bg-white">
            <div className="flex flex-col gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="px-4 py-3 rounded-xl font-medium text-[var(--foreground-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/5 transition-colors"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
              {user ? (
                <>
                  {isAdmin(user.email) && (
                    <Link
                      href="/admin"
                      className="mt-2 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-slate-900 text-white font-medium"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      Admin Dashboard
                    </Link>
                  )}
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setReferralModalOpen(true);
                    }}
                    className="mt-2 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-medium"
                  >
                    <Gift className="w-5 h-5" />
                    Invite Friends
                  </button>
                  <Link
                    href="/trips"
                    className="mt-2 inline-flex items-center justify-center px-5 py-3 rounded-xl bg-[var(--primary)] text-white font-medium"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    My Trips
                  </Link>
                  <Link
                    href="/profile"
                    className="mt-2 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-slate-200 text-[var(--foreground)] font-medium hover:bg-slate-50 transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    Profile
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    href="/auth/login"
                    className="px-4 py-3 rounded-xl font-medium text-[var(--primary)] hover:bg-[var(--primary)]/5 transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/trips/new"
                    className="mt-2 inline-flex items-center justify-center px-5 py-3 rounded-xl bg-[var(--primary)] text-white font-medium"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Start Planning
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Referral Modal */}
      <ReferralModal
        isOpen={referralModalOpen}
        onClose={() => setReferralModalOpen(false)}
      />
    </nav>
  );
}
