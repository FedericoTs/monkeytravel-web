import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

export const metadata = {
  title: 'Privacy Policy - MonkeyTravel',
  description: 'Privacy Policy for MonkeyTravel - Learn how we collect, use, and protect your personal information.',
};

export default function PrivacyPolicy() {
  const lastUpdated = 'November 28, 2025';
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
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">5. Third-Party Services</h2>
              <p className="text-[var(--foreground-muted)] mb-4">Our Service may integrate with third-party services including:</p>
              <ul className="list-disc pl-6 text-[var(--foreground-muted)] space-y-2">
                <li><strong>Google (Gemini AI):</strong> For generating personalized travel itineraries</li>
                <li><strong>Supabase:</strong> For authentication and data storage</li>
                <li><strong>Analytics Providers:</strong> To understand how our Service is used</li>
              </ul>
              <p className="text-[var(--foreground-muted)] mt-4">
                These services have their own privacy policies, and we encourage you to review them.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">6. Data Retention</h2>
              <p className="text-[var(--foreground-muted)]">
                We retain your personal information for as long as your account is active or as needed to provide you services. You may request deletion of your account and associated data at any time by contacting us at <a href={`mailto:${contactEmail}`} className="text-[var(--primary)] hover:underline">{contactEmail}</a>.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">7. Your Rights and Choices</h2>
              <p className="text-[var(--foreground-muted)] mb-4">Depending on your location, you may have the following rights:</p>
              <ul className="list-disc pl-6 text-[var(--foreground-muted)] space-y-2">
                <li><strong>Access:</strong> Request a copy of your personal data</li>
                <li><strong>Correction:</strong> Request correction of inaccurate data</li>
                <li><strong>Deletion:</strong> Request deletion of your personal data</li>
                <li><strong>Portability:</strong> Request transfer of your data to another service</li>
                <li><strong>Opt-out:</strong> Opt out of marketing communications</li>
                <li><strong>Withdraw Consent:</strong> Withdraw consent for data processing</li>
              </ul>
              <p className="text-[var(--foreground-muted)] mt-4">
                To exercise these rights, contact us at <a href={`mailto:${contactEmail}`} className="text-[var(--primary)] hover:underline">{contactEmail}</a>.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">8. Data Security</h2>
              <p className="text-[var(--foreground-muted)]">
                We implement appropriate technical and organizational security measures to protect your personal information. However, no method of transmission over the Internet or electronic storage is 100% secure. While we strive to protect your data, we cannot guarantee absolute security.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">9. Children's Privacy</h2>
              <p className="text-[var(--foreground-muted)]">
                Our Service is not intended for children under 13 years of age. We do not knowingly collect personal information from children under 13. If you are a parent or guardian and believe your child has provided us with personal information, please contact us at <a href={`mailto:${contactEmail}`} className="text-[var(--primary)] hover:underline">{contactEmail}</a>, and we will delete such information.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">10. International Data Transfers</h2>
              <p className="text-[var(--foreground-muted)]">
                Your information may be transferred to and processed in countries other than your country of residence. These countries may have different data protection laws. By using our Service, you consent to the transfer of your information to these countries.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">11. Changes to This Privacy Policy</h2>
              <p className="text-[var(--foreground-muted)]">
                We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last updated" date. You are advised to review this Privacy Policy periodically for any changes.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">12. Contact Us</h2>
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
