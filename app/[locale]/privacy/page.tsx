import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

export const metadata = {
  title: 'Privacy Policy - MonkeyTravel',
  description: 'Privacy Policy for MonkeyTravel - Learn how we collect, use, and protect your personal information.',
};

export default function PrivacyPolicy() {
  const lastUpdated = 'January 25, 2026';
  const contactEmail = 'privacy@monkeytravel.app';

  return (
    <>
      <Navbar />
      <main className="pt-24 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <Link
              href="/"
              className="text-[var(--primary)] hover:text-[var(--primary-light)] inline-flex items-center gap-2 mb-4"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Home
            </Link>
            <h1 className="text-3xl sm:text-4xl font-bold text-[var(--foreground)] mb-2">Privacy Policy</h1>
            <p className="text-[var(--foreground-muted)]">Last updated: {lastUpdated}</p>
          </div>

          <div className="prose prose-lg max-w-none">
            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">1. Introduction</h2>
              <p className="text-[var(--foreground-muted)] mb-4">
                MonkeyTravel ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our mobile application and website (collectively, the "Service").
              </p>
              <p className="text-[var(--foreground-muted)]">
                Please read this Privacy Policy carefully. By using the Service, you agree to the collection and use of information in accordance with this policy.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">2. Information We Collect</h2>

              <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">2.1 Personal Information</h3>
              <p className="text-[var(--foreground-muted)] mb-4">We may collect the following personal information:</p>
              <ul className="list-disc pl-6 text-[var(--foreground-muted)] mb-4 space-y-2">
                <li><strong>Account Information:</strong> Email address, name, and profile picture when you create an account</li>
                <li><strong>Travel Preferences:</strong> Your travel style preferences, budget preferences, and destination interests based on your swipe interactions</li>
                <li><strong>Trip Data:</strong> Destinations, dates, itineraries, and trip plans you create</li>
                <li><strong>Communication Data:</strong> Messages and feedback you send to us</li>
              </ul>

              <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">2.2 Automatically Collected Information</h3>
              <ul className="list-disc pl-6 text-[var(--foreground-muted)] mb-4 space-y-2">
                <li><strong>Device Information:</strong> Device type, operating system, unique device identifiers</li>
                <li><strong>Usage Data:</strong> App features used, time spent, interactions with the Service</li>
                <li><strong>Location Data:</strong> General location information to provide relevant travel recommendations (only with your consent)</li>
                <li><strong>Log Data:</strong> IP address, browser type, access times, and referring URLs</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">3. How We Use Your Information</h2>
              <p className="text-[var(--foreground-muted)] mb-4">We use the collected information to:</p>
              <ul className="list-disc pl-6 text-[var(--foreground-muted)] space-y-2">
                <li>Provide, maintain, and improve our Service</li>
                <li>Generate personalized AI-powered travel itineraries</li>
                <li>Learn your travel preferences to provide better recommendations</li>
                <li>Enable collaborative trip planning features</li>
                <li>Send you updates about our Service (with your consent)</li>
                <li>Respond to your comments, questions, and support requests</li>
                <li>Monitor and analyze usage patterns and trends</li>
                <li>Detect, prevent, and address technical issues and fraud</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">4. Data Sharing and Disclosure</h2>
              <p className="text-[var(--foreground-muted)] mb-4">We may share your information in the following circumstances:</p>
              <ul className="list-disc pl-6 text-[var(--foreground-muted)] space-y-2">
                <li><strong>Service Providers:</strong> Third-party vendors who assist in operating our Service (hosting, analytics, AI processing)</li>
                <li><strong>Collaborative Features:</strong> With other users you choose to share trips with</li>
                <li><strong>Legal Requirements:</strong> When required by law or to protect our rights</li>
                <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets</li>
              </ul>
              <p className="text-[var(--foreground-muted)] mt-4">
                <strong>We do not sell your personal information to third parties.</strong>
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">5. Cookies and Tracking Technologies</h2>
              <p className="text-[var(--foreground-muted)] mb-4">
                We use cookies and similar tracking technologies to collect and track information about your activity on our Service. You can manage your cookie preferences at any time through our cookie settings banner or by clicking "Cookie Settings" in the footer.
              </p>
              <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">Types of Cookies We Use:</h3>
              <ul className="list-disc pl-6 text-[var(--foreground-muted)] space-y-2 mb-4">
                <li><strong>Essential Cookies:</strong> Required for the Service to function (authentication, session management). These cannot be disabled.</li>
                <li><strong>Analytics Cookies:</strong> Help us understand how visitors use our Service. Requires your consent.</li>
                <li><strong>Session Recording:</strong> Records your browsing sessions to help us improve the user experience. Requires your explicit consent.</li>
                <li><strong>Marketing Cookies:</strong> Used for affiliate tracking and measuring marketing effectiveness. Requires your consent.</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">6. Third-Party Services</h2>
              <p className="text-[var(--foreground-muted)] mb-4">Our Service integrates with the following third-party services. Each service has its own privacy policy.</p>

              <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">6.1 Core Services</h3>
              <ul className="list-disc pl-6 text-[var(--foreground-muted)] space-y-2 mb-4">
                <li><strong>Google (Gemini AI):</strong> For generating personalized travel itineraries. <a href="https://policies.google.com/privacy" className="text-[var(--primary)] hover:underline" target="_blank" rel="noopener noreferrer">Privacy Policy</a></li>
                <li><strong>Supabase:</strong> For authentication and data storage (hosted in the EU). <a href="https://supabase.com/privacy" className="text-[var(--primary)] hover:underline" target="_blank" rel="noopener noreferrer">Privacy Policy</a></li>
                <li><strong>Vercel:</strong> For hosting and content delivery. <a href="https://vercel.com/legal/privacy-policy" className="text-[var(--primary)] hover:underline" target="_blank" rel="noopener noreferrer">Privacy Policy</a></li>
              </ul>

              <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">6.2 Analytics and Error Tracking</h3>
              <p className="text-[var(--foreground-muted)] mb-2">These services require your consent (except essential error tracking):</p>
              <ul className="list-disc pl-6 text-[var(--foreground-muted)] space-y-2 mb-4">
                <li><strong>PostHog:</strong> Analytics, feature flags, and A/B testing. May include session replay if you consent. <a href="https://posthog.com/privacy" className="text-[var(--primary)] hover:underline" target="_blank" rel="noopener noreferrer">Privacy Policy</a></li>
                <li><strong>Google Analytics 4:</strong> Website analytics and user behavior tracking. <a href="https://policies.google.com/privacy" className="text-[var(--primary)] hover:underline" target="_blank" rel="noopener noreferrer">Privacy Policy</a></li>
                <li><strong>Sentry:</strong> Error tracking and performance monitoring. May include session replay if you consent. <a href="https://sentry.io/privacy/" className="text-[var(--primary)] hover:underline" target="_blank" rel="noopener noreferrer">Privacy Policy</a></li>
              </ul>

              <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">6.3 Affiliate Partners</h3>
              <ul className="list-disc pl-6 text-[var(--foreground-muted)] space-y-2">
                <li><strong>Travelpayouts:</strong> Travel affiliate program for flight and hotel recommendations. <a href="https://www.travelpayouts.com/privacy" className="text-[var(--primary)] hover:underline" target="_blank" rel="noopener noreferrer">Privacy Policy</a></li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">7. Data Retention</h2>
              <p className="text-[var(--foreground-muted)] mb-4">
                We retain your personal information for as long as your account is active or as needed to provide you services. Specific retention periods:
              </p>
              <ul className="list-disc pl-6 text-[var(--foreground-muted)] space-y-2 mb-4">
                <li><strong>Account Data:</strong> Retained until you delete your account</li>
                <li><strong>Trip Data:</strong> Retained until you delete your account or the specific trip</li>
                <li><strong>Analytics Data:</strong> Anonymized after 26 months</li>
                <li><strong>Session Recordings:</strong> Automatically deleted after 30 days</li>
                <li><strong>Error Logs:</strong> Retained for 90 days for debugging purposes</li>
              </ul>
              <p className="text-[var(--foreground-muted)]">
                You may request deletion of your account and associated data at any time through your profile settings or by contacting us at <a href={`mailto:${contactEmail}`} className="text-[var(--primary)] hover:underline">{contactEmail}</a>.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">8. Your Rights and Choices (GDPR)</h2>
              <p className="text-[var(--foreground-muted)] mb-4">Under the General Data Protection Regulation (GDPR) and similar laws, you have the following rights:</p>
              <ul className="list-disc pl-6 text-[var(--foreground-muted)] space-y-2">
                <li><strong>Access (Art. 15):</strong> Request a copy of your personal data</li>
                <li><strong>Correction (Art. 16):</strong> Request correction of inaccurate data</li>
                <li><strong>Deletion (Art. 17):</strong> Request deletion of your personal data ("Right to be Forgotten")</li>
                <li><strong>Portability (Art. 20):</strong> Export your data in a machine-readable format via your profile settings</li>
                <li><strong>Restrict Processing (Art. 18):</strong> Request limitation of data processing</li>
                <li><strong>Object (Art. 21):</strong> Object to processing based on legitimate interests</li>
                <li><strong>Withdraw Consent (Art. 7):</strong> Withdraw consent at any time via cookie settings</li>
              </ul>
              <p className="text-[var(--foreground-muted)] mt-4">
                To exercise these rights, use the "Export My Data" button in your profile settings, or contact us at <a href={`mailto:${contactEmail}`} className="text-[var(--primary)] hover:underline">{contactEmail}</a>. We will respond within 30 days.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">9. Data Security</h2>
              <p className="text-[var(--foreground-muted)]">
                We implement appropriate technical and organizational security measures to protect your personal information. However, no method of transmission over the Internet or electronic storage is 100% secure. While we strive to protect your data, we cannot guarantee absolute security.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">10. Children's Privacy</h2>
              <p className="text-[var(--foreground-muted)]">
                Our Service is not intended for children under 13 years of age. We do not knowingly collect personal information from children under 13. If you are a parent or guardian and believe your child has provided us with personal information, please contact us at <a href={`mailto:${contactEmail}`} className="text-[var(--primary)] hover:underline">{contactEmail}</a>, and we will delete such information.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">11. International Data Transfers</h2>
              <p className="text-[var(--foreground-muted)]">
                Your information may be transferred to and processed in countries other than your country of residence. These countries may have different data protection laws. By using our Service, you consent to the transfer of your information to these countries.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">12. Changes to This Privacy Policy</h2>
              <p className="text-[var(--foreground-muted)]">
                We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last updated" date. You are advised to review this Privacy Policy periodically for any changes.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">13. Contact Us</h2>
              <p className="text-[var(--foreground-muted)] mb-4">
                If you have any questions about this Privacy Policy or our data practices, please contact us:
              </p>
              <ul className="text-[var(--foreground-muted)] space-y-2">
                <li><strong>Email:</strong> <a href={`mailto:${contactEmail}`} className="text-[var(--primary)] hover:underline">{contactEmail}</a></li>
                <li><strong>Website:</strong> <a href="/" className="text-[var(--primary)] hover:underline">monkeytravel.app</a></li>
              </ul>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
