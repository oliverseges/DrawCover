import type { RecognitionResult, SoundRecording } from "@/lib/recognition";
import { AudioBlockedError, playSynth } from "@/lib/audio/synth";
import { useSoundStore, type SoundPreference, type SoundSource } from "@/stores/sound-store";

const LOOKUP_TIMEOUT_MS = 8000;
const GENERATE_TIMEOUT_MS = 30000;

type Kind = SoundSource["kind"];
type Resolved = { source: SoundSource } | { reason: string };

const CHAIN: Record<SoundPreference, Kind[]> = {
  auto: ["generated", "recording", "synth"],
  generated: ["generated"],
  recording: ["recording"],
  synth: ["synth"],
};
const LABEL: Record<Kind, string> = {
  generated: "AI-generated sound",
  recording: "Recording",
  synth: "Synthesized sound",
};

let active: { stop: () => void } | null = null;
let token = 0;
let current: RecognitionResult["sound"] | null = null;
let resolved: Partial<Record<Kind, Resolved>> = {};

const set = useSoundStore.setState;

export function isTrustedRecordingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "upload.wikimedia.org";
  } catch {
    return false;
  }
}

const isGeneratedUrl = (url: unknown): url is string =>
  typeof url === "string" && url.startsWith("data:audio/mpeg;base64,");

function stopActive() {
  const a = active;
  active = null;
  a?.stop();
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<{ ok: boolean; body: T | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return { ok: res.ok, body: (await res.json().catch(() => null)) as T | null };
  } catch {
    return { ok: false, body: null };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveKind(kind: Kind, sound: NonNullable<typeof current>): Promise<Resolved> {
  if (kind === "synth") return { source: { kind, preset: sound.preset } };
  const q = encodeURIComponent(sound.phrase);
  if (kind === "generated") {
    const { ok, body } = await fetchJson<{ dataUrl?: string; model?: string; message?: string }>(
      `/api/sound/generate?q=${q}`,
      GENERATE_TIMEOUT_MS,
    );
    if (ok && isGeneratedUrl(body?.dataUrl)) {
      return { source: { kind, url: body.dataUrl, model: body.model ?? "unknown model" } };
    }
    return { reason: body?.message ?? "AI sound generation is unavailable." };
  }
  const { ok, body } = await fetchJson<{ recording?: SoundRecording | null }>(
    `/api/sound?q=${q}`,
    LOOKUP_TIMEOUT_MS,
  );
  const rec = body?.recording;
  if (ok && rec && isTrustedRecordingUrl(rec.url)) return { source: { kind, recording: rec } };
  return { reason: "No suitable licensed recording was found." };
}

type PlayResult = "playing" | "blocked" | "failed";

async function tryPlay(source: SoundSource, my: number): Promise<PlayResult> {
  if (source.kind === "synth") {
    try {
      const handle = await playSynth(source.preset);
      if (token !== my) {
        handle.stop();
        return "failed";
      }
      const stop = () => handle.stop();
      active = { stop };
      void handle.done.then(() => {
        if (token === my && active?.stop === stop) {
          active = null;
          set({ status: "stopped" });
        }
      });
      return "playing";
    } catch (e) {
      return e instanceof AudioBlockedError ? "blocked" : "failed";
    }
  }
  const url = source.kind === "generated" ? source.url : source.recording.url;
  const audio = new Audio(url);
  audio.preload = "auto";
  const stop = () => {
    audio.pause();
    audio.removeAttribute("src");
    audio.load?.();
  };
  active = { stop };
  audio.addEventListener("ended", () => {
    if (token === my && active?.stop === stop) {
      active = null;
      set({ status: "stopped" });
    }
  });
  try {
    await audio.play();
    return "playing";
  } catch (e) {
    if (active?.stop === stop) active = null;
    stop();
    return (e as Error)?.name === "NotAllowedError" ? "blocked" : "failed";
  }
}

/** Walks the source chain for the current preference; each failure falls through to the next source. */
async function run(my: number, userInitiated: boolean) {
  const sound = current;
  if (!sound) return;
  const notes: string[] = [];
  for (const kind of CHAIN[useSoundStore.getState().preference]) {
    if (token !== my) return;
    set({ status: "loading", message: null });
    resolved[kind] ??= await resolveKind(kind, sound);
    if (token !== my) return;
    const r = resolved[kind]!;
    if ("reason" in r) {
      notes.push(r.reason);
      continue;
    }
    const result = await tryPlay(r.source, my);
    if (token !== my) {
      if (result === "playing") stopActive();
      return;
    }
    const note = notes.join(" ") || null;
    if (result === "playing") {
      set({ status: "playing", source: r.source, note, message: null });
      return;
    }
    if (result === "blocked" && !userInitiated) {
      set({
        status: "blocked",
        source: r.source,
        note,
        message: "Your browser blocked autoplay. Press Play to hear it.",
      });
      return;
    }
    notes.push(`${LABEL[kind]} could not be played.`);
  }
  set({
    status: "unavailable",
    source: null,
    note: null,
    message: `Audio is unavailable. ${notes.join(" ")}`.trim(),
  });
}

export const soundPlayer = {
  /** Finds and plays the sound for a recognition result. Never throws. */
  async start(sound: RecognitionResult["sound"] | undefined) {
    const my = ++token;
    stopActive();
    resolved = {};
    current = sound ?? null;
    if (!sound) {
      set({ status: "idle", source: null, note: null, message: null });
      return;
    }
    set({ status: "loading", source: null, note: null, message: null });
    await run(my, false);
  },

  /** Play or replay from a user gesture. */
  async play() {
    if (!current) return;
    const my = ++token;
    stopActive();
    await run(my, true);
  },

  /** Choose the sound source; replays immediately if a result is showing. */
  async setPreference(preference: SoundPreference) {
    set({ preference });
    if (!current) return;
    const my = ++token;
    stopActive();
    set({ source: null, note: null });
    await run(my, true);
  },

  stop() {
    ++token;
    stopActive();
    if (useSoundStore.getState().source) set({ status: "stopped", message: null });
  },

  reset() {
    ++token;
    stopActive();
    current = null;
    resolved = {};
    set({ status: "idle", source: null, note: null, message: null });
  },
};
