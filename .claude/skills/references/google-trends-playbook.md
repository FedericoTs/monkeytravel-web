# Google Trends Playbook for Travel Content

## How to Use Google Trends for Blog Topic Discovery

Google Trends is the primary tool for identifying what travelers are searching for right now. This playbook covers the exact workflow for finding, validating, and prioritizing topics.

---

## 1. Access Methods

### Direct URL Patterns

Google Trends explore URLs follow a predictable pattern:

```
Base: https://trends.google.com/trends/explore

Parameters:
  ?q={query}              — Search term (URL-encoded, comma-separate for comparison)
  &geo={country_code}     — Geographic filter (US, ES, IT, GB, etc.)
  &date={range}           — Time range (today 12-m, today 3-m, now 7-d)
  &cat={category_id}      — Category filter (67 = Travel, 179 = Air Travel)
  &gprop={property}       — Property (web, images, news, youtube)
```

### Useful Category IDs for Travel

| ID | Category |
|----|----------|
| 67 | Travel |
| 179 | Air Travel |
| 180 | Hotels & Accommodations |
| 206 | Tourist Destinations |
| 1003 | Trip Planning |
| 208 | Travel Guides & Travelogues |

### Example URLs to Fetch

```
# AI trip planning interest, US, past 12 months
https://trends.google.com/trends/explore?q=ai+trip+planner&geo=US&date=today+12-m&cat=67

# Compare tools, worldwide
https://trends.google.com/trends/explore?q=ai+trip+planner,travel+agent,trip+advisor&date=today+12-m

# Travel category trending, Spain
https://trends.google.com/trends/explore?geo=ES&date=today+3-m&cat=67

# Italy-specific travel searches
https://trends.google.com/trends/explore?geo=IT&date=today+3-m&cat=67

# Rising travel queries, US
https://trends.google.com/trends/explore?q=trip+planning&geo=US&date=today+3-m&cat=67
```

---

## 2. Interpreting Trends Data

### Interest Over Time

- **Numbers are relative** (0-100 scale, not absolute volume)
- **Trending up** = growing demand → write content NOW
- **Seasonal peaks** = plan content 4-6 weeks before the peak
- **Steady** = evergreen topic → good for pillar content
- **Declining** = avoid unless you have a fresh angle

### Related Queries

The most valuable section. Two types:

- **Top**: Highest volume related queries (good for primary keywords)
- **Rising**: Fastest growing related queries (gold for early-mover advantage)

**"Breakout" tag** = query grew by 5000%+ → Huge opportunity, write immediately.

### Related Topics

Similar to queries but broader. Useful for:
- Finding adjacent topics to cover
- Building topic clusters
- Identifying emerging destinations

---

## 3. Research Workflow

### Phase 1: Seed Discovery (15 min)

1. Open Google Trends for Travel category in target market (US, ES, IT)
2. Check "Trending Searches" for real-time buzz
3. Note the top 10 rising queries
4. Check if any are "Breakout" status

### Phase 2: Keyword Expansion (15 min)

For each promising seed query:

1. Enter it in Google Trends explore
2. Look at "Related queries" → Rising tab
3. Note long-tail variations
4. Compare against 2-3 competitor terms

### Phase 3: Volume Validation (15 min)

Google Trends shows relative interest, not volume. Cross-reference with:

```
WebSearch: "[keyword]" monthly search volume
WebSearch: "[keyword]" keyword difficulty ahrefs
WebSearch: "[keyword]" SEO competition analysis
```

### Phase 4: SERP Analysis (10 min)

For the top keyword candidates:

```
WebSearch: "[exact keyword phrase]"
```

Check page 1 results:
- **Dominated by Reddit/forums?** → Easy to outrank with quality content
- **Dominated by Lonely Planet/TripAdvisor?** → Hard, need unique angle
- **Outdated articles (pre-2025)?** → Great opportunity to rank with fresh content
- **"People Also Ask" boxes?** → Use those questions as FAQ items

---

## 4. Seasonal Content Calendar

### High-Value Publishing Windows

| Month | Topic Theme | Why |
|-------|-------------|-----|
| January | "Where to go in [Year]" destination round-ups | New Year planning surge |
| February | Spring break / Easter trip guides | 6-8 week lead time |
| March | Summer vacation planning | Peak "plan summer trip" searches |
| April | Budget travel guides | Pre-booking season, price-sensitive searches |
| May | "Last minute summer" + festival guides | Urgency queries spike |
| June | Fall trip planning + "shoulder season" | Forward planners start |
| July | "Weekend trips" + local getaways | Spontaneous travel peaks |
| August | Holiday season trip planning (Xmas, NYE) | Early planners start |
| September | "Fall foliage" + autumn destinations | Seasonal peak |
| October | Winter travel + ski trip planning | 8-week lead time |
| November | "Cheapest time to fly" + deal hunting | Black Friday travel deals |
| December | "New Year trip" + Year in Review | Last-minute + forward planning |

### Evergreen vs. Time-Sensitive

**Evergreen** (publish anytime, update annually):
- "How to plan a group trip"
- "AI trip planner vs travel agent"
- "First trip to [Country]" guides

**Time-sensitive** (publish 6-8 weeks before peak):
- "Best summer destinations [Year]"
- "Where to go for Christmas [Year]"
- "Spring break trips on a budget [Year]"

---

## 5. Competitor Content Monitoring

### Travel Blog Competitors to Track

| Site | Strength | Weakness |
|------|----------|----------|
| Nomadic Matt | Budget travel authority | Slow to cover AI tools |
| The Points Guy | Flight deals, credit cards | Not trip planning focused |
| Lonely Planet | Destination coverage | Generic, not personalized |
| Skyscanner blog | Cheap flights, data-driven | Narrow focus |
| TripAdvisor | UGC reviews | AI content is weak |

### How to Find Gaps

```
# Check what competitors DON'T cover
WebSearch: site:nomadicmatt.com "ai travel planner"   → Probably few results
WebSearch: site:lonelyplanet.com "ai itinerary"        → Probably generic

# Check their top pages
WebSearch: "[competitor] blog" most popular posts
WebSearch: site:[competitor] "[destination]" guide 2026
```

---

## 6. MonkeyTravel-Specific Angles

Every blog post should have a natural connection to MonkeyTravel. Map topics to product features:

| Blog Topic | MonkeyTravel Feature Tie-In |
|------------|---------------------------|
| AI trip planning | Core product — AI itinerary generation |
| Group trips | Collaborative planning, voting, proposals |
| Budget travel | 3 budget tiers (Budget/Balanced/Premium) |
| Destination guides | Destination pages + "Plan this trip" CTA |
| Itinerary planning | Day-by-day itineraries with real venues |
| Travel comparisons | Google Places verified data vs competitors |
| Time-saving | "30-second itinerary" speed angle |

### CTA Integration (Non-Pushy)

**Good** (contextual, adds value):
> "MonkeyTravel builds on exactly this workflow. Our AI generates a personalized itinerary using real Google-verified venues. Drop a destination and see what comes up."

**Bad** (salesy, interrupts):
> "MonkeyTravel is the BEST AI travel planner! Sign up NOW to get started!"

---

## 7. Tracking & Iteration

### What to Monitor Post-Publish

| Metric | Tool | Target |
|--------|------|--------|
| Indexed? | Google Search Console | Within 7 days |
| Impressions | Google Search Console | Growing week-over-week |
| Avg. position | Google Search Console | Under 20 within 30 days |
| Click-through rate | Google Search Console | > 3% |
| Scroll depth | PostHog | > 60% reach FAQ section |
| Time on page | PostHog | > 3 minutes |

### When to Update a Post

- Position 5-15 for target keyword → refresh with more content, better FAQ
- CTR below 2% → rewrite title and meta description
- New competitor outranking → add sections they covered that you didn't
- Seasonal update needed → update year, refresh data/sources
- Dead links or closed venues → fix and update `updatedAt` in frontmatter
