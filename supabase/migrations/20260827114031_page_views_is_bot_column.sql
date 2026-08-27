-- Mark automated traffic in page_views so analytics can exclude it.
--
-- WHY: measured 2026-08-26, 3,232 of 14,087 daily page views (23%) came from
-- self-declared bots, up 6.4x in a week, while engaged sessions (anyone
-- viewing more than one page) FELL from 1,187 to 777. The chart showed traffic
-- doubling while the audience shrank. Every aggregate built on the raw table
-- was reporting crawler volume as growth.
--
-- Across the whole table: 110,633 of 612,691 rows (18.1%) are bots, and 75,337
-- of those are ONE agent — SentryUptimeBot, our own uptime monitor. The
-- largest single "visitor" in this product's history is us. Per-path it is
-- far worse than the 18% average suggests: the homepage was 89,681 views of
-- which 79,282 (88.4%) were bots, leaving 10,399 real.
--
-- A partial fix already existed: 20260621_filter_bots_from_page_view_aggregations
-- added an inline user-agent regex to the four get_page_views_* RPCs, and
-- documented this same SentryUptimeBot problem. It never covered
-- count_unique_visitors, get_top_pages, get_conversion_funnel,
-- get_referrer_breakdown, get_engagement_metrics or get_page_views_daily_trend,
-- which is why the homepage still showed 89,681. This generalises it.
--
-- WHY A STORED COLUMN AND NOT A READ-TIME REGEX: the classifier lives in
-- TypeScript (lib/analytics/bot-detection.ts, 67 signatures) and the
-- aggregates live in SQL. Filtering at read time means maintaining the same
-- list in two languages, and they drift — which is exactly what happened to
-- the June fix. The verdict is computed once at write time; SQL reads a
-- boolean.
--
-- WHY BACKFILL RATHER THAN GOING FORWARD ONLY: page_views already carries one
-- discontinuity — public-page tracking only began 2026-08-23, so any window
-- spanning that date is not comparable. A second cut-over would compound it.
--
-- Rows are RECORDED, not dropped. Knowing how much crawler load we carry is
-- useful, and discarding it would be a one-way door.
--
-- The pattern below is GENERATED from BOT_SIGNATURE_LIST in
-- lib/analytics/bot-detection.ts. Regenerate rather than hand-editing.

alter table public.page_views
  add column if not exists is_bot boolean not null default false;

comment on column public.page_views.is_bot is
  'True when the user-agent self-identifies as automated. Set at write time from lib/analytics/bot-detection.ts. Conservative: only DECLARED bots. A crawler presenting a plain Chrome UA is indistinguishable from a person here, so is_bot=false means "not provably a bot", never "definitely human".';

update public.page_views
set is_bot = true
where is_bot = false
  and (
    user_agent is null
    or user_agent = ''
    or user_agent ~* 'bot|crawler|spider|crawling|slurp|duckduckgo|baiduspider|yandex|sogou|exabot|facebot|ia_archiver|headless|phantomjs|puppeteer|playwright|selenium|python-requests|python-urllib|aiohttp|httpx|curl/|wget|scrapy|go-http-client|java/|okhttp|axios|node-fetch|got \(|libwww-perl|guzzle|postmanruntime|uptimerobot|pingdom|statuscake|betteruptime|vercel-screenshot|vercelbot|lighthouse|chrome-lighthouse|pagespeed|gtmetrix|facebookexternalhit|whatsapp|telegrambot|slackbot|discordbot|linkedinbot|twitterbot|embedly|quora link preview|skypeuripreview|gptbot|oai-searchbot|chatgpt-user|claudebot|claude-user|anthropic-ai|perplexitybot|ccbot|bytespider|google-extended|applebot|amazonbot|meta-externalagent|diffbot'
  );

-- Partial index: every analytics query filters `where not is_bot`, so only the
-- human rows need to be findable. Smaller than a full index on the column.
create index if not exists idx_page_views_human_created_at
  on public.page_views (created_at)
  where is_bot = false;
