import { notFound } from "next/navigation";
import Image from "next/image";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { routing, Link } from "@/lib/i18n/routing";
import { getAllAuthors, getAuthorBySlug } from "@/lib/blog/authors";
import { getAllFrontmatter } from "@/lib/blog/api";
import {
  generatePersonSchema,
  generateBreadcrumbSchema,
  jsonLdScriptProps,
} from "@/lib/seo/structured-data";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { BlogCard } from "@/components/blog";

const SITE_URL = "https://monkeytravel.app";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    getAllAuthors().map((author) => ({ locale, slug: author.slug }))
  );
}

interface PageProps {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const author = getAuthorBySlug(slug);
  if (!author) return {};

  const localePrefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  const url = `${SITE_URL}${localePrefix}/about/authors/${slug}`;

  const languages: Record<string, string> = {};
  for (const l of routing.locales) {
    const p = l === routing.defaultLocale ? "" : `/${l}`;
    languages[l] = `${SITE_URL}${p}/about/authors/${slug}`;
  }
  languages["x-default"] = `${SITE_URL}/about/authors/${slug}`;

  return {
    title: `${author.name} — ${author.title} | MonkeyTravel`,
    description: author.shortBio,
    alternates: { canonical: url, languages },
    openGraph: {
      title: `${author.name} — ${author.title}`,
      description: author.shortBio,
      url,
      siteName: "MonkeyTravel",
      type: "profile",
      images: [{ url: `${SITE_URL}/images/authors/${author.slug}.jpg`, width: 400, height: 400, alt: author.name }],
    },
  };
}

export default async function AuthorPage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const author = getAuthorBySlug(slug);
  if (!author) notFound();

  const localePrefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  const url = `${SITE_URL}${localePrefix}/about/authors/${slug}`;
  const photoUrl = `/images/authors/${author.slug}.jpg`;

  // All posts authored by this person, in this locale
  const allPosts = getAllFrontmatter(locale);
  const authorPosts = allPosts.filter((fm) => fm.author === author.frontmatterId);

  const personSchema = generatePersonSchema({
    name: author.name,
    url,
    jobTitle: author.title,
    description: author.fullBio,
    image: `${SITE_URL}${photoUrl}`,
    knowsAbout: author.expertise,
    sameAs: [
      ...(author.twitter ? [`https://twitter.com/${author.twitter}`] : []),
      ...(author.linkedin ? [`https://linkedin.com/in/${author.linkedin}`] : []),
    ],
  });

  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: "Home", url: `${SITE_URL}${localePrefix}` },
    { name: "About", url: `${SITE_URL}${localePrefix}/about` },
    { name: author.name, url },
  ]);

  return (
    <>
      <script {...jsonLdScriptProps([personSchema, breadcrumbSchema])} />

      <Navbar />

      <main className="pt-20">
        {/* Header */}
        <section className="py-16 bg-gradient-to-b from-[var(--primary)]/5 to-white">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <nav className="flex items-center gap-2 text-sm text-[var(--foreground-muted)] mb-8">
              <Link href="/" className="hover:text-[var(--primary)] transition-colors">Home</Link>
              <span>/</span>
              <Link href="/blog" className="hover:text-[var(--primary)] transition-colors">Blog</Link>
              <span>/</span>
              <span className="text-[var(--foreground)] font-medium">{author.name}</span>
            </nav>

            <div className="flex flex-col sm:flex-row gap-8 items-start">
              {/* Photo — falls back to a placeholder gradient if no image yet */}
              <div className="shrink-0 w-32 h-32 sm:w-40 sm:h-40 rounded-full overflow-hidden bg-gradient-to-br from-[var(--primary)]/20 to-[var(--accent)]/30 ring-4 ring-white shadow-lg">
                <Image
                  src={photoUrl}
                  alt={author.name}
                  width={160}
                  height={160}
                  unoptimized
                  className="w-full h-full object-cover"
                  // If the file doesn't exist yet, the gradient fallback shows through
                />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold uppercase tracking-wider text-[var(--primary)] mb-2">
                  {author.title}
                </p>
                <h1 className="text-3xl sm:text-4xl font-bold text-[var(--foreground)] mb-3 tracking-tight">
                  {author.name}
                </h1>
                <p className="text-lg text-[var(--foreground-muted)] leading-relaxed">
                  {author.shortBio}
                </p>

                <div className="flex flex-wrap gap-x-6 gap-y-2 mt-6 text-sm">
                  <div>
                    <span className="font-semibold text-[var(--foreground)]">{author.countriesVisited}</span>{" "}
                    <span className="text-[var(--foreground-muted)]">countries visited</span>
                  </div>
                  <div>
                    <span className="font-semibold text-[var(--foreground)]">{authorPosts.length}</span>{" "}
                    <span className="text-[var(--foreground-muted)]">posts published</span>
                  </div>
                  <div>
                    <span className="text-[var(--foreground-muted)]">Writes in:</span>{" "}
                    <span className="font-semibold text-[var(--foreground)]">
                      {author.languages.map((l) => l.toUpperCase()).join(", ")}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Full bio */}
        <section className="py-12 bg-white">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-xl font-bold text-[var(--foreground)] mb-6">About {author.name.split(" ")[0]}</h2>
            <div className="prose prose-slate max-w-none">
              {author.fullBio.split("\n\n").map((para, i) => (
                <p key={i} className="text-base text-slate-700 leading-relaxed mb-4">
                  {para}
                </p>
              ))}
            </div>

            {author.expertise.length > 0 && (
              <div className="mt-10 pt-8 border-t border-slate-200">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--foreground-muted)] mb-3">
                  Areas of expertise
                </h3>
                <div className="flex flex-wrap gap-2">
                  {author.expertise.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center px-3 py-1 rounded-full bg-slate-100 text-sm text-slate-700"
                    >
                      {tag.replace(/-/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Posts by this author */}
        {authorPosts.length > 0 && (
          <section className="py-16 bg-[var(--background-alt)]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <h2 className="text-2xl font-bold text-[var(--foreground)] mb-8 text-center">
                Posts by {author.name.split(" ")[0]}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {authorPosts.slice(0, 12).map((post) => (
                  <BlogCard
                    key={post.slug}
                    post={post}
                    title={post.seo?.title || post.title || post.slug}
                    description={post.seo?.description || ""}
                    category={post.category}
                    readMoreLabel="Read more"
                    minuteReadLabel={`${post.readingTime} min read`}
                  />
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      <Footer />
    </>
  );
}
