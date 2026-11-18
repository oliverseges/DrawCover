import { connection, NextResponse } from "next/server";

// Exposes only whether AI generation is configured, never the key itself.
export async function GET() {
  await connection(); // read the env at request time, not build time
  const aiEnabled = process.env.DRAWCOVER_HOSTED !== "true" && Boolean(process.env.OPENROUTER_API_KEY?.trim());
  return NextResponse.json({ aiEnabled }, { headers: { "Cache-Control": "no-store" } });
}
