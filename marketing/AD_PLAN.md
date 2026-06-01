# MonkeyTravel — Viral Reels/TikTok Ad Plan

**Goal:** scroll-stopping short-form ads (9:16, 15–30s) that drive installs/signups.
**Product truth to sell:** *Type a destination → a full day-by-day itinerary with
real venues, real prices, walking times, and group voting — in ~30 seconds, free.*
**Assets:** see `marketing/screenshots/_INDEX.md`. **Engine:** Higgsfield CLI.

---

## 1. Why this can go viral (the levers)

1. **Speed payoff** — "7-day trip in 30 seconds" is an instantly satisfying before/after.
2. **Relatable pain** — group-chat trip-planning chaos. Everyone has the friend who never decides → *tag them* → shares.
3. **Hot take** — "stop using ChatGPT for trip planning" → comment-bait (curiosity + mild controversy).
4. **Save-bait** — "free app that does X, Y, Z you'd pay for" → high saves → algorithm boost.
5. **It's actually free** — removes the #1 objection in the hook itself.

The first **1.5 seconds** decide everything. Every concept below opens on motion + a pattern-interrupt + a bold on-screen line, native (no logo-first intros).

---

## 2. Hook bank (first line on screen / spoken — A/B these)

- "POV: you planned a 7-day trip in 30 seconds 😳"
- "Stop planning group trips in the group chat."
- "I deleted ChatGPT for trip planning. Here's what I use now."
- "This free app plans your entire trip — with real prices."
- "Your group chat has been planning this trip for 3 weeks. Watch this."
- "Travel agents hate this (it's free)."
- "Things this free trip app does that you'd 100% pay for:"

---

## 3. Three concepts

### Concept A — "30-Second Trip" (POV speed-reveal) — *primary, storyboarded below*
Fast, satisfying type→generate→full-itinerary reveal, ending on group voting + free CTA.
Broad appeal, shows the killer feature, clean CTA. Best all-rounder.

### Concept B — "Group Chat" (relatable skit)
Cold open on a chaotic fake group chat ("we still doing Lisbon??", 200 unread) → cut to app
generating + everyone voting → "decided in 5 minutes." Built on `07-group-trip-planner` +
`trip-barcelona-itinerary`. Highest *share/tag* potential.

### Concept C — "vs ChatGPT" (hot take / comparison)
Split-screen: ChatGPT wall-of-text vs MonkeyTravel's tappable day-by-day with maps/prices/booking.
Built on `10-from-chatgpt` + `03-ai-itinerary-generator` + `trip-barcelona-itinerary`.
Highest *comment* potential. (You already have a `/from-chatgpt` page — landing page matches the ad.)

---

## 4. PRIMARY storyboard — Concept A, 9:16, ~26s

Each shot = one Higgsfield clip (or composited). On-screen text is burned in during assembly.

| # | Dur | Visual / source asset | Motion (Higgsfield) | On-screen text | Audio |
|---|---|---|---|---|---|
| 1 | 0–2.5s | **Hook.** A traveler's hand holding a phone, a dull "planning" mess (tabs/notes) behind | `veo3_1` text-to-video, 9:16, audio on | "POV: you planned a 7-day trip in **30 seconds**" | trending upbeat beat starts; whoosh |
| 2 | 2.5–5s | `02-free-ai-planner-screen.png` — type a city into the planner | Kling 2.6 image→video, **low motion** (push-in, cursor/typing shimmer), keep UI crisp | "just type a city…" | keyboard taps; riser |
| 3 | 5–8s | **Generating** beat — destination montage flash (`05-destinations`, `06-templates` Eiffel/Tokyo/Barcelona) | `seedance_2_0` fast cuts / Veo, clouds + push-ins | "…and watch." | beat builds, anticipation |
| 4 | 8–14s | ⭐ **The reveal** — `trip-barcelona-itinerary.png` day-by-day plan | **Locked / low-motion** vertical scroll reveal (UI must stay crisp — see §6) | "real venues · real prices · walking times" (callouts ping onto cards) | beat **drop** on first card; UI tick SFX |
| 5 | 14–19s | `07-group-trip-planner-screen.png` → voting | Kling low-motion push-in; animate vote chips with overlay graphics in edit | "everyone votes. no more group chat ☠️" | crowd "ding" reactions |
| 6 | 19–23s | `06-templates-screen.png` Eiffel card (**your sample clip**) | Veo 3.1 Lite (already rendered) — clouds drift, golden push-in | "from Paris to Tokyo in seconds" | swell |
| 7 | 23–26s | `01-landing-screen.png` payoff card | Subtle zoom; logo + CTA overlay | "**MonkeyTravel** — plan free → monkeytravel.app" + "100% Free · Up to 8 Friends" | button click; outro |

**Pacing rule:** cut on the beat; never hold a shot >3s except the reveal (Shot 4).
**Captions:** burn in all text (85% watch muted). Keep ≤6 words per card, high-contrast, safe-zone (avoid bottom 12% / top 10% for TikTok UI).

---

## 5. Copy kit

**Caption (TikTok/IG):**
> I planned my whole trip in 30 seconds 😭✈️ real places, real prices, and my friends actually voted on it. it's free → link in bio #traveltok

**Hashtags (mix broad + niche):**
`#traveltok #tr availhack #triptok #aitravel #travelplanning #grouptrip #itinerary #traveltips #fyp #europeansummer` *(trim to 5–8; rotate)*

**On-screen CTA:** "Try it free — monkeytravel.app" (also pin a comment with the link).
**Spoken VO (optional, Concept A):** punchy, 1 line per shot, matches on-screen text.

**A/B test matrix:** 3 hooks (Shot 1 line) × 2 thumbnails × 2 CTAs. Ship 3–5 variants/week; let the algorithm pick.

---

## 6. UI-fidelity technique (critical)

AI video models **warp dense UI text**. Rules:
- **Photo-forward screens** (`06-templates` Eiffel, `05-destinations`, destination heroes) → safe for full generative motion (Veo/Seedance/Kling).
- **Text-critical screens** (`trip-barcelona-itinerary`, planner inputs) → either:
  - **Kling 2.6 with minimal motion** ("locked camera, only subtle parallax, do not alter UI/text"), short 5s, OR
  - **Composite**: keep the screenshot as a **crisp static PNG layer** in the edit (CapCut/Premiere/Canva) and animate it with simple keyframe scale/scroll over a Higgsfield-generated background. This keeps text pixel-perfect.
- **Reframe** model → convert any 16:9 generation to clean 9:16.
- **Topaz** model → upscale final clips to crisp 1080p+.

---

## 7. Higgsfield production pipeline (exact commands)

Auth/credits: `higgsfield account status` (you: ultra, ~2.8k credits). Media flags accept
local paths (auto-uploaded). Add `--wait` to block and print the result URL.

```bash
# Shot 1 — hook (text-to-video, premium + audio)
higgsfield generate create veo3_1 \
  --prompt "Vertical 9:16, close-up of hands holding a smartphone in a sunlit room, cluttered travel notes and browser tabs blurred behind, cinematic, anticipation, shallow depth of field" \
  --aspect_ratio 9:16 --duration 6 --generate_audio true --wait

# Shot 2 — planner input (low-motion, preserve UI)
higgsfield generate create kling2_6 \
  --prompt "Locked camera on a phone showing a travel app input screen; only a subtle push-in and soft screen glow; DO NOT alter the UI text or layout" \
  --image marketing/screenshots/02-free-ai-planner-screen.png \
  --aspect_ratio 9:16 --duration 5 --wait

# Shot 3 — destination montage (photo-forward, safe)
higgsfield generate create seedance_2_0 \
  --prompt "Cinematic fast push-ins across iconic destinations, drifting clouds, golden light, travel-reel energy" \
  --image marketing/screenshots/06-templates-screen.png \
  --aspect_ratio 9:16 --duration 6 --resolution 1080p --genre epic --wait

# Shot 4 — itinerary reveal (KEEP CRISP: low motion; or composite in editor)
higgsfield generate create kling2_6 \
  --prompt "Locked vertical camera slowly revealing an itinerary screen top-to-bottom; subtle parallax only; keep all UI text sharp and unchanged" \
  --image public/screenshots/trip-barcelona-itinerary.png \
  --aspect_ratio 9:16 --duration 5 --wait

# Shot 6 — Eiffel card (DONE — your sample): see marketing/sample-clip.log

# Optional — AI presenter (UGC vibe) talking over the app
higgsfield model get soul_cast        # then drive with a script + avatar
# Optional — full auto UGC ad
higgsfield model get marketing_studio_video   # mode=ugc, 9:16, feed it product screens

# Finish: reframe any 16:9 → 9:16, then upscale
higgsfield generate create reframe --video <job_or_upload_id> --aspect_ratio 9:16 --wait
higgsfield generate create topaz_video --video <job_or_upload_id> --wait
```

**Cost guide (9:16):** Veo 3.1 Lite 6s +audio ≈ **9 credits**; Seedance 1080p 6s ≈ **54**;
check any combo with `higgsfield generate cost <model> [params]` before batch runs.

---

## 8. Assembly & posting

- **Edit** in CapCut/Premiere: drop clips on the beat, burn captions, add 1 trending sound,
  keep total 15–27s. Export 1080×1920, ≥30fps.
- **Sound** = the single biggest reach lever on Reels/TikTok — use a *currently trending* audio,
  duck it under any VO.
- **Cadence:** 3–5 variants/week, same core, different hook+sound. Post 11:00–13:00 or 18:00–21:00 local.
- **First comment:** pin the link + a question ("which city should it plan next? 👇") to spike comments.
- **Repurpose:** same master → IG Reels, TikTok, YouTube Shorts; 1:1 + 4:5 cutdowns for feed via `reframe`.
- **Watch:** 3s view-through, watch-time %, saves, shares. Kill <20% retention hooks; scale winners.

---

## 9. Next actions

1. Review the **sample clip** (Shot 6, rendering now) → approve quality/direction.
2. Pick the lead concept (A / B / C) and the top 3 hooks.
3. I batch-generate the remaining shots, reframe+upscale, and hand you an edit-ready clip bin
   (or assemble a rough cut). Then iterate on winners.
