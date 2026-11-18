import "server-only";
import { cooldownResponse } from "@/lib/generation-limit";

type LocalLimit = { window: number; album: number; track: number; until: number };
declare global {
  var __drawcoverLocalLimit: LocalLimit | undefined;
}

export function localGenerationLimit(track = false): Response | null {
  if (process.env.DRAWCOVER_HOSTED === "true") return null;
  const now = Date.now();
  const state = globalThis.__drawcoverLocalLimit ??= { window: now, album: 0, track: 0, until: 0 };
  if (state.until > now) return cooldownResponse(state.until);
  if (now - state.window >= 60_000) {
    state.window = now;
    state.album = 0;
    state.track = 0;
  }
  const kind = track ? "track" : "album";
  if (++state[kind] <= (track ? 8 : 2)) return null;
  state.until = now + 15 * 60_000;
  return cooldownResponse(state.until);
}
