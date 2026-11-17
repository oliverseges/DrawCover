import { NextResponse } from "next/server";
import { findRecording } from "@/lib/sound-lookup";
import { sanitizeSoundPhrase } from "@/lib/sound-presets";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("q");
  const phrase = sanitizeSoundPhrase(raw);
  if (phrase.length < 2) {
    return NextResponse.json({ error: "invalid_query", message: "Missing sound phrase." }, { status: 400 });
  }
  const recording = await findRecording(phrase);
  return NextResponse.json({ phrase, recording });
}
