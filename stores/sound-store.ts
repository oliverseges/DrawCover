import { create } from "zustand";
import type { SoundRecording } from "@/lib/recognition";
import type { SoundPreset } from "@/lib/sound-presets";

export type SoundStatus = "idle" | "loading" | "playing" | "stopped" | "blocked" | "unavailable";

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
  /** Whether the server has an AI key configured; null until known. */
  aiEnabled: boolean | null;
};

export const useSoundStore = create<SoundState>(() => ({
  status: "idle",
  source: null,
  note: null,
  message: null,
  aiEnabled: null,
}));
