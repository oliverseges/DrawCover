import type { RecognitionResult, SoundRecording } from "@/lib/recognition";
import { AudioBlockedError, playSynth } from "@/lib/audio/synth";
import { useSoundStore, type SoundSource } from "@/stores/sound-store";

const LOOKUP_TIMEOUT_MS = 8000;

type Active = { stop: () => void };
let active: Active | null = null;
let token = 0;
let current: RecognitionResult["sound"] | null = null;

const set = useSoundStore.setState;

/** Re-checked on the client even though the server already validated it. */
export function isTrustedRecordingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "upload.wikimedia.org";
  } catch {
    return false;
  }
}

function stopActive() {
  const a = active;
  active = null;
  a?.stop();
}

async function playRecording(recording: SoundRecording, my: number): Promise<void> {
  const audio = new Audio(recording.url);
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
  } catch (e) {
    if (active?.stop === stop) active = null;
    stop();
    throw e;
  }
}

async function startSynth(source: Extract<SoundSource, { kind: "synth" }>, my: number) {
  const handle = await playSynth(source.preset);
  if (token !== my) {
    handle.stop();
    return;
  }
  const stop = () => handle.stop();
  active = { stop };
  void handle.done.then(() => {
    if (token === my && active?.stop === stop) {
      active = null;
      set({ status: "stopped" });
    }
  });
}

async function attempt(source: SoundSource, my: number, userInitiated: boolean) {
  const fail = (e: unknown) => {
    if (token !== my) return;
    if (!userInitiated && (e instanceof AudioBlockedError || (e as Error)?.name === "NotAllowedError")) {
      set({ status: "blocked", message: "Your browser blocked autoplay. Press Play to hear it." });
    } else {
      set({ status: "unavailable", message: "Audio is unavailable in this browser." });
    }
  };

  if (source.kind === "recording") {
    try {
      if (!isTrustedRecordingUrl(source.recording.url)) throw new Error("untrusted");
      await playRecording(source.recording, my);
      if (token === my) set({ status: "playing", source, message: null });
      else stopActive();
      return;
    } catch (e) {
      if (token !== my) return;
      if (!userInitiated && (e as Error)?.name === "NotAllowedError") return fail(e);
    }
    const fallback: SoundSource = {
      kind: "synth",
      preset: current?.preset ?? "tone",
      reason: "The recording could not be played.",
    };
    set({ source: fallback });
    return attempt(fallback, my, userInitiated);
  }

  try {
    await startSynth(source, my);
    if (token === my) set({ status: "playing", source, message: null });
  } catch (e) {
    fail(e);
  }
}

async function lookup(phrase: string, my: number): Promise<SoundRecording | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/sound?q=${encodeURIComponent(phrase)}`, { signal: ctrl.signal });
    if (!res.ok || token !== my) return null;
    const body = (await res.json()) as { recording?: SoundRecording | null };
    const rec = body.recording;
    return rec && isTrustedRecordingUrl(rec.url) ? rec : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const soundPlayer = {
  /** Finds and plays the sound for a recognition result. Never throws. */
  async start(sound: RecognitionResult["sound"] | undefined) {
    const my = ++token;
    stopActive();
    if (!sound) {
      current = null;
      set({ status: "idle", source: null, message: null });
      return;
    }
    current = sound;
    set({ status: "loading", source: null, message: null });
    const recording = await lookup(sound.phrase, my);
    if (token !== my) return;
    const source: SoundSource = recording
      ? { kind: "recording", recording }
      : {
          kind: "synth",
          preset: sound.preset,
          reason: "No suitable licensed recording was found.",
        };
    set({ source });
    await attempt(source, my, false);
  },

  /** Play or replay from a user gesture. */
  async play() {
    const { source } = useSoundStore.getState();
    if (!source) return;
    const my = ++token;
    stopActive();
    set({ status: "loading", message: null });
    await attempt(source, my, true);
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
    set({ status: "idle", source: null, message: null });
  },
};
