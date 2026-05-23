# Content TODO — ongoing work outside the codebase

Tracks the non-code follow-ups from the conversion audit + 5-feature plans.
Not a roadmap — a checklist. Update or delete items as they ship.

## High priority (E-E-A-T + content quality)

### 1. Author photos
- [ ] `/public/images/authors/federico-s.jpg` (founder — bilingual EN/IT)
- [ ] `/public/images/authors/enrico-e.jpg` (Asia/SE Asia editor)
- [ ] `/public/images/authors/francesca-a.jpg` (Europe/romance/wellness editor)
- [ ] `/public/images/authors/giuseppe-g.jpg` (group travel/practical editor)
- [ ] `/public/images/authors/riccardo-p.jpg` (AI tech/comparison editor)
- [ ] `/public/images/authors/emanuela-p.jpg` (seasonal/cultural editor)

**Spec:** square, 400×400 minimum, JPG or WebP, < 80 KB each.
**Why:** the Author schema, OpenGraph, byline avatar, and bio pages all
reference `/images/authors/{slug}.jpg`. Until a file exists, the avatar
falls back to a gradient placeholder. Real photos are a measurable
E-E-A-T signal — Google's helpful-content classifier explicitly weights
named-author imagery.

### 2. Pillar translations to ES + IT
- [ ] `content/blog/es/2026-travel-calendar.md` (source: ~8.7k EN words)
- [ ] `content/blog/it/2026-travel-calendar.md`
- [ ] `content/blog/es/spring-summer-travel-guide.md` (source: ~4.6k EN words)
- [ ] `content/blog/it/spring-summer-travel-guide.md`
- [ ] `content/blog/es/honeymoon-planning-guide.md` (source: ~6.8k EN words)
- [ ] `content/blog/it/honeymoon-planning-guide.md`

**Total**: ~40k words of translation (20.1k EN × 2 languages).
**Right now**: Spanish/Italian visitors to these pillar URLs get the EN
content via locale-fallback. The canonical correctly points to the EN
URL so it doesn't get demoted as duplicate — but they're invisible to
ES/IT search. Real translations unlock 2 additional language markets.

**Cost guidance**: don't ship LLM-translated content without an editorial
pass — that re-creates the "thin/duplicate locale content" problem the
audit just fixed. Pay a human translator OR commit to a careful LLM +
human-review workflow.

## Medium priority (distribution + reach)

### 3. Per-pillar hero images
- [ ] `/public/images/blog/2026-travel-calendar.jpg`
- [ ] `/public/images/blog/spring-summer-travel-guide.jpg`
- [ ] `/public/images/blog/honeymoon-planning-guide.jpg`

Specified in the frontmatter (`imageAlt` text already exists). 1200×630
for OG, JPG ≤ 200 KB.

### 4. Replace blog hero stock images with annotated app screenshots
For the 5-10 most-trafficked posts (see indexed-pages report in GSC),
replace the generic stock photo with a screenshot of the MonkeyTravel
itinerary for that destination with annotations. Signals first-hand
experience AND ties the blog content to the product.

### 5. HARO / podcast pitches for the 6 author personas
Off-site E-E-A-T compounds. Each author has a topical specialty; pitch
2-3 industry contacts (HARO requests, niche podcasts, link-roundup
roundups). Successful placements get a link back to `/about/authors/{slug}`.

## Per-post deepening (Week 3-4 of original audit plan)

For the 54 DEEPEN posts in `.audit/blog-quality-audit.md`:
- [ ] Inject one named-author first-person paragraph each ("When I planned
      my own X trip…") — needs real author input, can't be fabricated.
- [ ] Verify each comparison post has a table (most do).
- [ ] Audit internal-link count; aim for ≥5 per post.

## Operational

### 6. Email service decision
- [ ] Choose: Resend (recommended for React Email integration) vs Postmark.
- [ ] Provide API key as `RESEND_API_KEY` or `POSTMARK_API_KEY` in Vercel env.
- [ ] Configure SPF/DKIM/DMARC on `monkeytravel.app` (DNS records).
- [ ] Verify sender domain in chosen service.

Once done, the email-invites + notifications work-plan in
`.audit/implementation-plans.md` can execute.

### 7. Mobile App Store assets (for the Capacitor wrap)
- [ ] App icon (1024×1024 master, PNG, no transparency)
- [ ] iOS launch screen (Storyboard or static image set)
- [ ] App Store screenshots: 6.7" iPhone (1290×2796), iPad 12.9" (2048×2732)
- [ ] Privacy nutrition labels (no tracking SDKs other than PostHog)
- [ ] App description copy + keywords (App Store metadata)

## Done (kept for reference)

- ✅ Trip wizard collapsed from 4 → 2 steps (76% drop-off → ~50% reduction)
- ✅ Named authors assigned to all 237 frontmatters (across 3 locales)
- ✅ 3 consolidation pillars written (20.1k words)
- ✅ Anonymous generation enabled (the conversion fix)
- ✅ AI Assistant foregrounded with auto-open + pulse
- ✅ Per-day regeneration shipped
- ✅ Anonymous voting code shipped (migration apply pending)
