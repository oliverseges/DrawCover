import { NextResponse } from "next/server";
import { GenerationError, generateSound } from "@/lib/sound-generate";
import { sanitizeSoundPhrase } from "@/lib/sound-presets";

export async function GET(request: Request) {
  const phrase = sanitizeSoundPhrase(new URL(request.url).searchParams.get("q"));
  if (phrase.length < 2) {
    return NextResponse.json({ error: "invalid_query", message: "Missing sound phrase." }, { status: 400 });
  }
  try {
    const sound = await generateSound(phrase);
    return NextResponse.json({ phrase, ...sound });
  } catch (e) {
    const err = e instanceof GenerationError ? e : new GenerationError("upstream_error", "Sound generation failed.");
    const status = err.code === "not_configured" ? 503 : err.code === "timeout" ? 504 : 502;
    return NextResponse.json({ error: err.code, message: err.message }, { status });
  }
}
