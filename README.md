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
- `DRAWCOVER_IMAGE_MODEL` defaults to `gemini-2.5-flash-image`. It receives the
  original drawing plus editing instructions, preserving its composition.
  [Google's image generation guide](https://ai.google.dev/gemini-api/docs/image-generation)
  documents image inputs and image editing for this model.
- If image generation is unavailable, the browser creates a gradient-backed,
  palette-colored remix of the actual drawing and clearly identifies the fallback.
- `OPENROUTER_MUSIC_MODEL` defaults to `google/lyria-3-clip-preview` (approximately
  30-second MP3 clips). Track 1 is generated immediately after the album appears;
  tracks 2–8 generate only when selected, with one request at a time. Native
  audio controls remain visible if autoplay is blocked.
- Album and track results are cached in bounded server memory. They are not a
  permanent library: restarts, expiry, or another server instance can invalidate
  the album. Create another record if an album expires. No automatic provider retries.
- Generation uses paid provider quotas; failed tracks remain individually
  retryable and never discard the cover or tracklist.

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
