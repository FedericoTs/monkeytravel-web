import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import MatchActions from "@/components/match/MatchActions";
import MatchPercent from "@/components/match/MatchPercent";
import styles from "@/components/match/match.module.css";
import type { Locale } from "@/lib/destinations/types";
import { Link } from "@/lib/i18n/routing";
import { PLACE_PHOTOS, photoUrl } from "@/lib/match/photos";
import { MATCH_PLACES, matchDestination } from "@/lib/match/places";
import { parseCode, parseCompanions, MAX_COMPANIONS, type Person } from "@/lib/match/questions";
import { planHref, rankPlaces, travelType, whyKeys } from "@/lib/match/score";
import { buildAlternates, SITE_URL } from "@/lib/seo/canonical";

export const dynamicParams = true;

type Props = {
  params: Promise<{ locale: string; code: string }>;
  searchParams: Promise<{ new?: string; with?: string | string[] }>;
};

/** Everyone in a link, the person it belongs to first. */
function readLink(code: string, rawWith: string | string[] | undefined): { me: Person; friends: string[]; people: Person[] } | null {
  const me = parseCode(code);
  if (!me) return null;
  const friends = parseCompanions(rawWith, code);
  return { me, friends, people: [me, ...friends.map((friend) => parseCode(friend) as Person)] };
}

const withParam = (friends: string[]) => (friends.length ? `?with=${friends.join(",")}` : "");

function cardUrl(code: string, friends: string[], locale: string, format?: "story"): string {
  const params = new URLSearchParams({ c: code, locale });
  if (friends.length) params.set("with", friends.join(","));
  if (format) params.set("format", format);
  return `/api/og/match?${params.toString()}`;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale, code } = await params;
  const { with: rawWith } = await searchParams;
  const link = readLink(code, rawWith);
  if (!link) return {};
  const t = await getTranslations({ locale, namespace: "match" });
  const best = rankPlaces(MATCH_PLACES, link.people)[0];
  const name = matchDestination(best.place.slug).name[locale as Locale];
  const title = `${name}: ${t("result.percent", { percent: best.percent })}`;
  const image = `${SITE_URL}${cardUrl(code, link.friends, locale)}`;
  const alternates = buildAlternates(`/where-should-i-go/${code}`, { locale });
  return {
    title: { absolute: title },
    description: t("result.cardInvite"),
    // A result is one person's link, not a page to be found in search.
    robots: { index: false, follow: true },
    alternates,
    openGraph: {
      siteName: "MonkeyTravel",
      title,
      description: t("result.cardInvite"),
      // With its friends, or Facebook would preview the link without them.
      url: `${alternates.canonical}${withParam(link.friends)}`,
      type: "website",
      images: [{ url: image, width: 1200, height: 630, alt: title }],
    },
    twitter: { card: "summary_large_image", title, description: t("result.cardInvite"), images: [image] },
  };
}

const COST = { 1: "low", 2: "mid", 3: "high" } as const;

export default async function MatchResultPage({ params, searchParams }: Props) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  const { new: fresh, with: rawWith } = await searchParams;
  const link = readLink(code, rawWith);
  if (!link) notFound();
  const { me, friends, people } = link;
  const together = people.length > 1;

  const t = await getTranslations("match");
  const lang = locale as Locale;
  const ranked = rankPlaces(MATCH_PLACES, people);
  const best = ranked[0];
  const destination = matchDestination(best.place.slug);
  const name = destination.name[lang];
  const photo = PLACE_PHOTOS[best.place.slug];
  const type = travelType(me);
  const typeName = t(`types.${type}.name`);
  const why = together ? [] : whyKeys(best.place, me);
  const months = [...best.place.bestMonths]
    .sort((a, b) => a - b)
    .map((month) => new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(Date.UTC(2027, month - 1, 15)));
  const prefix = locale === "en" ? "" : `/${locale}`;
  const everyone = [code, ...friends].slice(0, MAX_COMPANIONS).join(",");

  return (
    <main className="min-h-[100dvh] bg-[#14181a] lg:flex lg:h-[100dvh] lg:min-h-[640px]">
      <section className="relative isolate flex h-[64dvh] min-h-[420px] flex-col overflow-hidden text-white lg:h-auto lg:flex-1">
        <picture>
          <source media="(min-width: 1024px)" srcSet={photoUrl(photo.id, 1400, 1100)} />
          <img src={photoUrl(photo.id, 828, 1200)} alt={name} fetchPriority="high" className={`absolute inset-0 -z-10 h-full w-full object-cover ${styles.heroPhoto}`} />
        </picture>
        <div className={`-z-10 ${styles.scrim}`} />
        <header className="flex items-center px-5 pt-5 sm:px-10 sm:pt-8">
          <Link href="/" className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold tracking-wide text-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-512.png" alt="" width={28} height={28} className="rounded-lg" />
            MonkeyTravel
          </Link>
        </header>
        <div className={`mt-auto flex items-end justify-between gap-4 px-5 pb-12 sm:px-10 lg:pb-12 ${styles.rise}`}>
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-white/85">
              {together ? t("result.together") : typeName}
            </p>
            <h1 className={`mt-1 font-semibold leading-[1.02] tracking-tight text-white sm:text-7xl ${name.length > 8 ? "text-[2.6rem]" : "text-[3.25rem]"}`}>{name}</h1>
            <p className="mt-1 text-xl text-white/90">{destination.country[lang]}</p>
          </div>
          <MatchPercent percent={best.percent} label={t("result.percent", { percent: best.percent })} animate={fresh === "1"} />
        </div>
      </section>

      <section className="relative -mt-7 rounded-t-[28px] bg-[var(--background)] px-5 pb-10 pt-7 text-[var(--foreground)] sm:px-10 lg:mt-0 lg:w-[480px] lg:shrink-0 lg:overflow-y-auto lg:rounded-none lg:pt-10">
        <div className="mx-auto max-w-xl">
          {together ? (
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--foreground-muted)]">{t("result.whoIsIn")}</p>
              <ul className="mt-3 flex flex-col gap-2">
                {people.map((person, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 text-lg">
                    <span className="text-[var(--foreground-muted)]">{t("result.person", { n: i + 1 })}</span>
                    <span className="font-semibold">{t(`types.${travelType(person)}.name`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <h2 className="text-[1.65rem] font-semibold leading-[1.22] tracking-tight">{t(`types.${type}.line`)}</h2>
          )}

          {why.length > 0 ? (
            <ul className="mt-5 flex flex-wrap gap-2">
              {why.map((key) => (
                <li key={key} className="rounded-full bg-[var(--foreground)]/[0.06] px-3.5 py-1.5 text-base font-medium">
                  {t(`why.${key}`)}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-7">
            <MatchActions
              code={code}
              isNew={fresh === "1"}
              place={best.place.slug}
              type={type}
              together={together}
              planHref={planHref(best.place, me, together)}
              findMineHref={`/where-should-i-go?with=${everyone}`}
              shareUrl={`${SITE_URL}${prefix}/where-should-i-go/${code}${withParam(friends)}`}
              shareText={
                together
                  ? t("result.shareTextTogether", { place: name, percent: best.percent, count: people.length })
                  : t("result.shareText", { type: typeName, place: name, percent: best.percent })
              }
              imageUrl={cardUrl(code, friends, locale, "story")}
              copy={{
                plan: together ? t("result.planTogether", { place: name }) : t("result.plan", { place: name }),
                planPlain: t("result.planPlain", { place: name }),
                share: together ? t("result.shareTogether") : t("result.share"),
                shareHint: t("result.shareHint"),
                friendHeadline: together ? t("result.friendTogether") : t("result.friendHeadline"),
                findMine: t("result.findMine"),
                whatsapp: t("result.whatsapp"),
                copy: t("result.copy"),
                copied: t("result.copied"),
                saveImage: t("result.saveImage"),
              }}
            />
          </div>

          <dl className="mt-8 grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-[var(--foreground-muted)]">{t("result.bestIn")}</dt>
              <dd className="mt-0.5 font-semibold">{months.join(", ")}</dd>
            </div>
            <div>
              <dt className="text-sm text-[var(--foreground-muted)]">{t("result.cost")}</dt>
              <dd className="mt-0.5 font-semibold">{t(`result.costLevels.${COST[best.place.budgetLevel]}`)}</dd>
            </div>
          </dl>

          <h2 className="mt-9 text-2xl font-semibold tracking-tight">{t("result.runnersUp")}</h2>
          <ul className="mt-4 grid grid-cols-2 gap-3">
            {ranked.slice(1, 3).map(({ place, percent }) => {
              const other = matchDestination(place.slug);
              return (
                <li key={place.slug}>
                  <Link href={`/destinations/${place.slug}`} className="group relative block aspect-[3/4] overflow-hidden rounded-2xl bg-[#14181a] text-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoUrl(PLACE_PHOTOS[place.slug].id, 480, 640)} alt={other.name[lang]} loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    <span className={styles.scrim} />
                    <span className="absolute inset-x-3 bottom-3 block">
                      <span className="block text-xl font-semibold leading-tight" style={{ fontFamily: "var(--font-display), Georgia, serif" }}>
                        {other.name[lang]}
                      </span>
                      <span className="mt-0.5 block text-sm text-white/90">{t("result.percent", { percent })}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="mt-9 flex flex-col gap-2 text-sm text-[var(--foreground-muted)]">
            <Link href="/where-should-i-go" className="inline-flex min-h-[44px] items-center font-semibold text-[var(--foreground)] underline underline-offset-4">
              {t("result.startOver")}
            </Link>
            <p>{t("result.about", { count: MATCH_PLACES.length })}</p>
            <p>{t("result.photo", { name: photo.by })}</p>
          </div>
        </div>
      </section>
    </main>
  );
}
