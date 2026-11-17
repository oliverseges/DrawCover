import { NextResponse } from "next/server";
import { ApiError } from "@google/genai";
import {
  InvalidModelOutputError,
  MissingApiKeyError,
  recognizeDrawing,
} from "@/lib/gemini";
import type { RecognizeErrorCode } from "@/lib/recognition";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;

const MESSAGES: Record<RecognizeErrorCode, string> = {
  invalid_image: "The drawing couldn't be read. Please try again.",
  image_too_large: "The drawing is too large to send.",
  missing_api_key:
    "The Gemini API key isn't configured. Add GEMINI_API_KEY to the .env file and restart the dev server.",
  rate_limited: "Gemini is rate limiting requests. Wait a moment and try again.",
  upstream_error: "Gemini couldn't process the drawing. Please try again.",
};

function fail(code: RecognizeErrorCode, status: number) {
  return NextResponse.json({ error: code, message: MESSAGES[code] }, { status });
}

export async function POST(request: Request) {
  let image: unknown;
  try {
    image = (await request.json())?.image;
  } catch {
    return fail("invalid_image", 400);
  }
  if (typeof image !== "string") return fail("invalid_image", 400);
  // Reject before running the regex over arbitrarily large input.
  if (image.length > MAX_IMAGE_BYTES * 1.4) return fail("image_too_large", 413);
  const match = PNG_DATA_URL.exec(image);
  if (!match) return fail("invalid_image", 400);
  const base64 = match[1];
  if (Buffer.byteLength(base64, "base64") > MAX_IMAGE_BYTES) {
    return fail("image_too_large", 413);
  }

  try {
    return NextResponse.json(await recognizeDrawing(base64));
  } catch (err) {
    if (err instanceof MissingApiKeyError) return fail("missing_api_key", 500);
    if (err instanceof ApiError && err.status === 429) return fail("rate_limited", 429);
    if (!(err instanceof InvalidModelOutputError)) console.error("Gemini request failed:", err);
    return fail("upstream_error", 502);
  }
}
