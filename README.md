# DrawCover

Draw something, press **GO**, and turn it into an album: a reimagined cover,
eight related track titles, and short original music. The drawing's recognized
subject stays behind the scenes. The original DrawSound app is at `/drawsound`.

## Run locally

Copy `.env.example` to `.env`, add `GEMINI_API_KEY` and `OPENROUTER_API_KEY`,
then run:

```powershell
npm ci --legacy-peer-deps
npm run dev -- -p 3001
```

Open http://localhost:3001. Keys and all provider requests stay server-side.

## Generation

- Gemini recognizes the drawing and creates album metadata. Set `GEMINI_MODEL`
  and optionally `DRAWCOVER_METADATA_MODEL` to override the defaults.
- `DRAWCOVER_IMAGE_MODEL` defaults to `gemini-3.1-flash-image`. It receives the
  original drawing plus editing instructions, preserving its composition.
  [Google's image generation guide](https://ai.google.dev/gemini-api/docs/image-generation)
  documents image inputs and image editing for this model.
- If Gemini image generation fails, OpenRouter tries `OPENROUTER_IMAGE_MODEL`
  (default `google/gemini-3.1-flash-image`) with the original drawing. Both model
  IDs were verified against their providers' model listings. Safe provider
  diagnostics stay in server logs; the UI only reports unavailable AI artwork
  if both image providers fail.
- If both image providers fail, the browser creates a gradient-backed,
  palette-colored remix of the actual drawing and clearly identifies the fallback.
- `OPENROUTER_MUSIC_MODEL` defaults to `google/lyria-3-clip-preview` (approximately
  30-second MP3 clips). Track 1 is generated immediately after the album appears;
  tracks 2–8 generate only when selected, with one request at a time. Native
  audio controls remain visible if autoplay is blocked.
- Music is requested as instrumental, without lyrics, vocals or speech. The
  cover's **content note** describes that request, not an official age
  certification or a fabricated explicit-content warning.
- Album and track results are cached in bounded server memory. They are not a
  permanent library: restarts, expiry, or another server instance can invalidate
  the album. Create another record if an album expires. No automatic provider retries.
- Generation uses paid provider quotas; failed tracks remain individually
  retryable and never discard the cover or tracklist.

## Album presentation

The drawing screen stays minimal. The album screen gets palette-driven glass
surfaces, a waveform player, ambient color and restrained hover effects.

- **Three.js:** a lazy-loaded physical album with printed front/back textures,
  title and fictional artist, a content-note box, and a matching back cover with
  a decorative tracklist, fictional label details and barcode. Click/tap the
  artwork, or focus it and press Enter/Space, to flip. The playable tracklist
  remains outside the artwork.
- **Canvas UI Particle Reveal:** a short dust-to-cover entrance and hover reveal.
- **Canvas UI Blaze:** low-intensity, palette-colored background sparks.
- **Tracklist and player:** CSS glass surfaces with static row hover/active
  tints, no cursor-following lens or moving overlay. Native audio controls
  remain ordinary HTML.

The two Canvas UI WebGL components were installed from the
[official shadcn registry](https://canvasui.dev/docs/installation) into
`components/canvasui/`. Native HTML capture requires Chrome 157+; other browsers
retain normal HTML. GPU embellishments are limited to motion-enabled desktop
pointer devices. Reduced motion and unavailable WebGL use static 2D covers with
a gentle crossfade. Render loops pause offscreen/in hidden tabs, textures and
GPU resources are disposed, and the 3D pixel ratio is capped at 1.5.
At desktop/laptop sizes, the result layout is sized to both viewport dimensions:
the whole record and player fit the page, with scrolling contained to the track
panel only if necessary. Narrow screens and genuinely short/zoomed viewports
retain normal page scrolling so controls are never clipped.

## Checks

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Browser tests mock provider endpoints and do not spend AI credits. Set
`E2E_BASE_URL` to reuse an existing server.
