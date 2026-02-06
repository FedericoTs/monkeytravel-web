import { Link } from '@/lib/i18n/routing';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

export const metadata = {
  title: 'Terms of Service - MonkeyTravel',
  description: 'Terms of Service for MonkeyTravel - Read our terms and conditions for using the app.',
};

export default function TermsOfService() {
  const lastUpdated = 'November 28, 2025';
  const contactEmail = 'legal@monkeytravel.app';

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
            <h1 className="text-3xl sm:text-4xl font-bold text-[var(--foreground)] mb-2">Terms of Service</h1>
            <p className="text-[var(--foreground-muted)]">Last updated: {lastUpdated}</p>
          </div>

          <div className="prose prose-lg max-w-none">
            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">1. Acceptance of Terms</h2>
              <p className="text-[var(--foreground-muted)] mb-4">
                By accessing or using the MonkeyTravel mobile application and website (the "Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Service.
              </p>
              <p className="text-[var(--foreground-muted)]">
                We reserve the right to modify these Terms at any time. Your continued use of the Service after any changes indicates your acceptance of the modified Terms.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">2. Description of Service</h2>
              <p className="text-[var(--foreground-muted)]">
                MonkeyTravel is an AI-powered travel planning application that helps users discover destinations, create personalized itineraries, and plan trips. The Service includes features such as preference-based discovery, AI-generated day-by-day itineraries, collaborative trip planning, and budget management tools.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">3. User Accounts</h2>
              <p className="text-[var(--foreground-muted)] mb-4">To use certain features of the Service, you must create an account. You agree to:</p>
              <ul className="list-disc pl-6 text-[var(--foreground-muted)] space-y-2">
                <li>Provide accurate, current, and complete information</li>
                <li>Maintain and update your information to keep it accurate</li>
                <li>Keep your password secure and confidential</li>
                <li>Be responsible for all activities under your account</li>
                <li>Notify us immediately of any unauthorized access</li>
              </ul>
              <p className="text-[var(--foreground-muted)] mt-4">
                You must be at least 13 years old to create an account. If you are under 18, you must have parental or guardian consent.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">4. Acceptable Use</h2>
              <p className="text-[var(--foreground-muted)] mb-4">You agree NOT to use the Service to:</p>
              <ul className="list-disc pl-6 text-[var(--foreground-muted)] space-y-2">
                <li>Violate any applicable laws or regulations</li>
                <li>Infringe on the rights of others</li>
                <li>Upload malicious code, viruses, or harmful content</li>
                <li>Attempt to gain unauthorized access to the Service</li>
                <li>Interfere with or disrupt the Service's operation</li>
                <li>Collect or harvest user data without consent</li>
                <li>Use the Service for commercial purposes without authorization</li>
                <li>Create multiple accounts for abusive purposes</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">5. AI-Generated Content</h2>
              <p className="text-[var(--foreground-muted)] mb-4">
                The Service uses artificial intelligence to generate travel itineraries and recommendations. You acknowledge that:
              </p>
              <ul className="list-disc pl-6 text-[var(--foreground-muted)] space-y-2">
                <li>AI-generated content is for informational and planning purposes only</li>
                <li>Recommendations may not always be accurate, complete, or up-to-date</li>
                <li>You should verify important information (prices, availability, safety) independently</li>
                <li>We are not responsible for decisions made based on AI-generated content</li>
                <li>Travel conditions, prices, and availability may change without notice</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">6. User Content</h2>
              <p className="text-[var(--foreground-muted)] mb-4">
                You retain ownership of content you create or upload to the Service ("User Content"). By submitting User Content, you grant us a non-exclusive, worldwide, royalty-free license to use, display, and distribute your content in connection with operating the Service.
              </p>
              <p className="text-[var(--foreground-muted)]">
                You are solely responsible for your User Content and represent that you have all necessary rights to submit it.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">7. Intellectual Property</h2>
              <p className="text-[var(--foreground-muted)]">
                The Service and its original content (excluding User Content), features, and functionality are owned by MonkeyTravel and are protected by international copyright, trademark, patent, trade secret, and other intellectual property laws. You may not copy, modify, distribute, sell, or lease any part of our Service without our express written permission.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">8. Third-Party Services</h2>
              <p className="text-[var(--foreground-muted)]">
                The Service may contain links to third-party websites or services. We are not responsible for the content, privacy policies, or practices of any third-party sites or services. Your use of third-party services is at your own risk.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">9. Disclaimer of Warranties</h2>
              <p className="text-[var(--foreground-muted)]">
                THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, SECURE, OR ERROR-FREE. WE MAKE NO WARRANTIES REGARDING THE ACCURACY OR RELIABILITY OF ANY INFORMATION OBTAINED THROUGH THE SERVICE.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">10. Limitation of Liability</h2>
              <p className="text-[var(--foreground-muted)]">
                TO THE MAXIMUM EXTENT PERMITTED BY LAW, MONKEYTRAVEL SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, OR USE, ARISING OUT OF OR RELATED TO YOUR USE OF THE SERVICE.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">11. Indemnification</h2>
              <p className="text-[var(--foreground-muted)]">
                You agree to indemnify and hold harmless MonkeyTravel and its officers, directors, employees, and agents from any claims, damages, losses, or expenses (including reasonable attorneys' fees) arising from your use of the Service or violation of these Terms.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">12. Termination</h2>
              <p className="text-[var(--foreground-muted)]">
                We may terminate or suspend your account and access to the Service immediately, without prior notice, for any reason, including breach of these Terms. Upon termination, your right to use the Service will cease immediately. You may also delete your account at any time through the app settings or by contacting support.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">13. Governing Law</h2>
              <p className="text-[var(--foreground-muted)]">
                These Terms shall be governed by and construed in accordance with the laws of the jurisdiction in which MonkeyTravel operates, without regard to its conflict of law provisions.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">14. Dispute Resolution</h2>
              <p className="text-[var(--foreground-muted)]">
                Any disputes arising from these Terms or your use of the Service shall first be attempted to be resolved through informal negotiation. If informal resolution is not possible, disputes shall be resolved through binding arbitration in accordance with applicable arbitration rules.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">15. Changes to Terms</h2>
              <p className="text-[var(--foreground-muted)]">
                We reserve the right to modify these Terms at any time. We will notify users of material changes by posting the updated Terms on this page and updating the "Last updated" date. Your continued use of the Service after changes constitutes acceptance of the modified Terms.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">16. Contact Us</h2>
              <p className="text-[var(--foreground-muted)] mb-4">
                If you have any questions about these Terms, please contact us:
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
