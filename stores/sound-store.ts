import { create } from "zustand";
import type { SoundRecording } from "@/lib/recognition";
import type { SoundPreset } from "@/lib/sound-presets";

export type SoundStatus = "idle" | "loading" | "playing" | "stopped" | "blocked" | "unavailable";
export type SoundPreference = "auto" | "generated" | "recording" | "synth";

export type SoundSource =
  | { kind: "generated"; url: string; model: string }
  | { kind: "recording"; recording: SoundRecording }
  | { kind: "synth"; preset: SoundPreset };

type SoundState = {
  status: SoundStatus;
  source: SoundSource | null;
  /** Why an earlier source was skipped, or why nothing could play. */
  note: string | null;
  message: string | null;
  preference: SoundPreference;
};

export const useSoundStore = create<SoundState>(() => ({
  status: "idle",
  source: null,
  note: null,
  message: null,
  preference: "auto",
}));
