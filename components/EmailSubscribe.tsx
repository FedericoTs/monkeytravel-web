'use client';

import { useState } from 'react';

interface EmailSubscribeProps {
  variant?: 'hero' | 'inline' | 'footer' | 'dark';
  source?: string;
  className?: string;
}

export default function EmailSubscribe({ variant = 'hero', source, className = '' }: EmailSubscribeProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !email.includes('@')) {
      setStatus('error');
      setMessage('Please enter a valid email address');
      return;
    }

    setStatus('loading');

    try {
      const response = await fetch('/api/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          source: source || variant,
        }),
      });

      const data = await response.json();

      if (!response.ok && response.status !== 200) {
        throw new Error(data.error || 'Failed to subscribe');
      }

      setStatus('success');
      setMessage(data.message || "You're on the list! We'll notify you when we launch.");
      setEmail('');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
    }
  };

  // Hero variant - light background
  if (variant === 'hero') {
    return (
      <div className={`w-full max-w-md mx-auto ${className}`}>
        <form onSubmit={handleSubmit} className="relative">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                className="w-full px-5 py-4 rounded-xl border-2 border-gray-200 bg-white text-[var(--foreground)] placeholder:text-gray-400 focus:outline-none focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary)]/10 transition-all"
                disabled={status === 'loading' || status === 'success'}
                suppressHydrationWarning
              />
            </div>
            <button
              type="submit"
              disabled={status === 'loading' || status === 'success'}
              className="px-8 py-4 bg-[var(--accent)] text-[var(--primary-dark)] font-bold rounded-xl hover:bg-[var(--accent-light)] transition-all shadow-lg shadow-[var(--accent)]/30 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap"
            >
              {status === 'loading' ? (
                <>
                  <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Joining...</span>
                </>
              ) : status === 'success' ? (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>You're In!</span>
                </>
              ) : (
                'Get Early Access'
              )}
            </button>
          </div>

          {/* Status Message */}
          {message && (
            <p className={`mt-3 text-sm ${status === 'error' ? 'text-red-500' : 'text-green-600'}`}>
              {message}
            </p>
          )}
        </form>
      </div>
    );
  }

  // Dark variant - for dark backgrounds (CTA section)
  if (variant === 'dark') {
    return (
      <div className={`w-full max-w-md mx-auto ${className}`}>
        <form onSubmit={handleSubmit} className="relative">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                className="w-full px-5 py-4 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-all"
                disabled={status === 'loading' || status === 'success'}
                suppressHydrationWarning
              />
            </div>
            <button
              type="submit"
              disabled={status === 'loading' || status === 'success'}
              className="px-8 py-4 bg-[var(--accent)] text-[var(--primary-dark)] font-bold rounded-xl hover:bg-[var(--accent-light)] transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap"
            >
              {status === 'loading' ? (
                <>
                  <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Joining...</span>
                </>
              ) : status === 'success' ? (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>You're In!</span>
                </>
              ) : (
                'Join Waitlist'
              )}
            </button>
          </div>

          {/* Status Message */}
          {message && (
            <p className={`mt-3 text-sm ${status === 'error' ? 'text-red-400' : 'text-green-400'}`}>
              {message}
            </p>
          )}
        </form>
      </div>
    );
  }

  // Footer/inline variant
  return (
    <form onSubmit={handleSubmit} className={`flex w-full md:w-auto gap-3 ${className}`}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Enter your email"
        className="flex-1 md:w-80 px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        disabled={status === 'loading' || status === 'success'}
        suppressHydrationWarning
      />
      <button
        type="submit"
        disabled={status === 'loading' || status === 'success'}
        className="px-6 py-3 bg-[var(--accent)] text-[var(--primary-dark)] font-semibold rounded-xl hover:bg-[var(--accent-light)] transition-colors disabled:opacity-70"
      >
        {status === 'loading' ? 'Joining...' : status === 'success' ? 'Joined!' : 'Subscribe'}
      </button>
    </form>
  );
}
