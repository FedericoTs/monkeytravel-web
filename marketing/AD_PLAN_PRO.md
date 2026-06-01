# MonkeyTravel — PRO Viral Ad System (Higgsfield-native)

The top-tier playbook. Where `AD_PLAN.md` storyboards one organic Reel, this is
the **paid-growth / agency-grade system**: how the most viral app ads are made
with Higgsfield in 2026, mapped to commands you can run today.

**Account:** ultra plan, ~2.8k credits. **Web product (Hermes-ingested):**
`f3a04109-bab8-4a1f-868c-0802a100adc5` ("MonkeyTravel" — created via
`webproducts fetch --url https://monkeytravel.app`).

---

## What actually goes viral with Higgsfield (research-backed)

Higgsfield's **Marketing Studio** (Hermes Agent) is purpose-built for this: import
a product by URL → it analyzes the site → drafts a creative brief + proven hooks →
generates **UGC-style** video ads with AI avatars, in seconds. The 2026 winning
pattern that agencies exploit: **spin 50+ UGC variants per launch** (one avatar +
one hook + one format each) and let the ad platform's algorithm find winners —
for less than the cost of a single human creator. (Sources at bottom.)

Three asset classes drive results — produce all three:

### 1) UGC avatar ads — the workhorse (mode=`ugc`)
An AI creator (100+ presets, or your own via Soul ID) talks to camera, intercut
with your app screens. Hook in the first 1.5s, 15–30s, vertical. This is the
flagship — one is rendering now.

```bash
# Avatar object shape is {id,type}; web product is an id string array.
A='[{"id":"aa9260cc-a888-47b2-8bfd-0a9c90558384","type":"preset"}]'   # Adriana
W='["f3a04109-bab8-4a1f-868c-0802a100adc5"]'                          # MonkeyTravel
higgsfield generate create marketing_studio_video \
  --mode ugc --aspect_ratio 9:16 --duration 15 --resolution 1080p --generate_audio true \
  --avatars "$A" --web_product_ids "$W" \
  --prompt "<creator script + what app screens to intercut>" --wait
```
Modes to A/B: `ugc`, `ugc_how_to`, `ugc_unboxing`, `product_showcase`, `product_review`, `tv_spot`.
Avatars (presets, sampled): Adriana `aa9260cc…`, Sofia `bba3087a…`, Valentina `cd6fb78c…`,
Mei `44ee57aa…`, Liam `734451fd…`, Felix `83711427…`, Malik `94950cff…`. (`marketing-studio avatars list` for all.)

### 2) DTC headline image ads — paid-feed scroll-stoppers (`dtc-ads`)
Static branded ad images in proven formats. Best for MonkeyTravel:

| Format | ID | Use |
|---|---|---|
| App Screenshot | `3462be30-d918-4602-992c-81298d0f31ab` | the itinerary screen, framed + headline |
| Then vs Now | `ad65db31-3e4f-4aa9-99a4-0e00b994580e` | "group chat chaos → decided in minutes" |
| Comparison Table | `4ac40ba6-79a7-4004-a9e4-95012f8737d5` | vs ChatGPT / vs spreadsheets |
| Social Proof | `30ab1615-9b6f-4d73-bf84-9436b0861cb4` | reviews / "100k trips planned" |
| Mystery Hook | `c5012751-8b86-4e28-8b31-f86f36c62085` | curiosity opener |
| UGC Side-by-Side | `50fa82ca-8a7e-4c8d-99dd-e1c3692a5787` | creator + app |
| Scroll Break | `01de1013-d33a-4c67-b658-799eac3aa11f` | feed pattern-interrupt |

```bash
# Needs a brand kit (auto-derives brand colors/logo). Create one from the site first:
higgsfield marketing-studio brand-kits   # (create/list — derive from monkeytravel.app)
higgsfield marketing-studio dtc-ads generate \
  --format-id 3462be30-d918-4602-992c-81298d0f31ab \
  --brand-kit-id <id> --prompt "MonkeyTravel itinerary, headline: Plan a 7-day trip in 30s — free" --wait
```

### 3) Cinematic hook clips — B-roll + pattern-interrupt openers
Veo 3.1 (premium + native audio) / Kling (best UI preservation) for the hero
beats in `AD_PLAN.md`. Higgsfield's **stunt hooks** library (e.g. `Product Hit`
`3d45fb46…`, `Product Crash` `8101cd3e…`) creates the "something flies into frame"
openers — great as a 1.5s cold-open before the app reveal.

### 4) Soul ID — a consistent brand face/mascot (series flywheel)
Train a reusable character (a recurring "MonkeyTravel girl", or the monkey mascot)
so every ad in the series shares one identity → builds recognition.
```bash
higgsfield soul-id create --name MonkeyGuide --soul-2 --image a.png --image b.png --image c.png --image d.png --image e.png
```

---

## The 50-variant test matrix (agency playbook)

Generate combinatorially, ship in batches, kill losers fast:

`mode {ugc, product_showcase, tv_spot} × avatar {Adriana, Liam, Mei} × hook {30-sec, group-chat, vs-ChatGPT} × format {talking-head, screen-first}`

Each variant changes ONLY the first 1.5s hook + avatar. Track 3-sec view-through,
saves, shares. Scale the top 10%; everything else is disposable.

## Cost table (9:16)
| Asset | Cost |
|---|---|
| UGC avatar video, 1080p, +audio | 10s ≈ **100 cr** · 15s ≈ **150 cr** |
| Veo 3.1 Lite, 6s, +audio | ≈ **9–15 cr** |
| Seedance 2.0, 1080p, 6s | ≈ **54 cr** |
| DTC headline image | run `generate cost dtc-ads …` |
Always `higgsfield generate cost <model> [params]` before batch runs.

## Flagship now rendering
15s UGC ad — avatar **Adriana** + ingested MonkeyTravel screens + voice, mode=ugc,
9:16, 1080p (~150 cr). Script: "I planned my entire 7-day trip in 30 seconds — free…
real places, real prices, walking times… my whole group voted… no more group chat."
→ `marketing/ugc-ad.log` (result URL) → downloaded to `marketing/ugc-ad-9x16.mp4`.

## Recommended top-level rollout
1. **1 hero UGC ad** (rendering) — the organic + paid centerpiece.
2. **3 UGC variants** (swap avatar + hook) for the matrix.
3. **4 DTC headline images** (App Screenshot, Then vs Now, Comparison Table, Social Proof) for paid feed.
4. **1 cinematic cut** (the `AD_PLAN.md` 7-shot Reel) for organic / brand.
5. Train **1 Soul ID** for series consistency.
Est. ≈ 150 + 450 + (images) + ~80 ≈ **<800 credits** for a full launch kit.

---

### Sources
- [Higgsfield Marketing Studio — UGC/CGI/cinematic ads](https://higgsfield.ai/marketing-studio-intro)
- [5 Steps: Launch Viral UGC Ads With Higgsfield Studio (2026) — VO3 AI](https://www.vo3ai.com/blog/5-steps-launch-viral-ugc-ads-with-higgsfield-studio-no-camera-needed-2026-04-23)
- [Build an entire brand's ad creative with Claude Code + Higgsfield — MindStudio](https://www.mindstudio.ai/blog/build-brand-ad-creative-claude-code-higgsfield-5-minutes)
- [Hermes Agent / Marketing Studio launch — VO3 AI](https://www.vo3ai.com/blog/higgsfield-marketing-studio-just-launched-5-ways-hermes-agent-is-changing-ai-ugc-2026-04-23)
