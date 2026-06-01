# Spot — "Off the Grid" · single voiced talking-head · ~10s

One continuous shot of the explorer talking to camera, deep in a remote forest
village, deadpan-fun. Ends on logo + tagline. Voiced (Veo dialogue).

## Reference assets (what Higgsfield leverages at each stage)
- **[REF:EXPLORER]** = trained Soul 2.0 `e10be608-4d2a-47b4-ad4a-e134a44795cb`
  → use to GENERATE the start frame so the face/identity is exact.
- **[REF:WARDROBE]** = `marketing/refs/06-fullbody.png` (exact khaki outfit) — keep consistent.
- **[REF:START_FRAME]** = the still we generate below → becomes the **Veo `input_image`**.
- **[REF:LOGO]** = `public/images/logo.png` → end card (real asset, added in edit).
- **[REF:MONKEY]** (optional) = `marketing/monkey/mascot.png` → small mascot on the end card.

## The scene
Golden-hour clearing in a lush rainforest village. Our explorer stands center,
talking straight to camera, dead serious. Behind him, a **warm, relaxed local
forest community** goes about a normal afternoon — chatting, cooking, a kid
running past — completely unbothered by him. The joke is that HE is the
out-of-place one; everyone else is chilled out. Handheld, cinematic, shallow
depth of field.

> Respect note (for the generation): depict the community as dignified, modern,
> friendly people in a forest village — NOT a costume/stereotype caricature. The
> comedy is 100% on the over-prepared explorer.

## The line (he says it, deadpan — pick one)
- **A (recommended):** "Everyone said you can't plan a trip this far off the grid. *(gestures around)* …Mine already did. I just had to show up."
- B: "I came to the middle of nowhere to disconnect. The app still booked me a treehouse, a canoe, and lunch."
- C: "No roads. No signal. No problem. It planned the whole thing before I left home."

## STAGE 1 — generate the start frame (Soul, ~0.12cr)
Model `text2image_soul_v2`, `--custom_reference_id e10be608…`, 9:16, prompt:
> "[REF:EXPLORER] in his khaki safari outfit and hat, standing center in a
> golden-hour rainforest village clearing, talking to camera with a deadpan
> half-smile, mouth slightly open mid-sentence. Behind him a warm, relaxed local
> forest community goes about daily life, softly blurred. Cinematic, handheld,
> shallow depth of field, vertical 9:16."
→ verify the frame, then:

## STAGE 2 — animate + VOICE it (Veo 3.1, dialogue mode, ~58–87cr)
Model `veo3_1`, `--input_image [REF:START_FRAME]`, `--model veo-3-1-preview`,
`--quality high`, 9:16, 8s. Prompt:
> "The explorer talks directly to camera, deadpan and confident, and says, in a
> dry deadpan voice: '<chosen line>'. Natural lip-sync and clear voice. Subtle
> handheld camera, he gestures once to the village behind him; the local
> community moves naturally in the soft-focus background; gentle breeze, birds,
> distant village ambience. Cinematic, warm golden light. Vertical 9:16."
→ QC frames before use.

## STAGE 3 — end card + finish (ffmpeg, ~0cr)
- Burn an optional caption of the punchline.
- Append 3s end card: cream bg + **[REF:LOGO]** + "MonkeyTravel" + tagline
  + "monkeytravel.app". (Optional small **[REF:MONKEY]** beside the logo.)
- Tagline options: **"Plans the unplannable."** / "The trip plans itself." / "Anywhere. Sorted."
- Keep Veo's voice/ambience; optional music bed.

## Output
~11s, 1080×1920, voiced, branded → `marketing/spot_jungle/spot_jungle_FINAL.mp4`.
