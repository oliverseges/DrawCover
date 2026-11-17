import { create } from "zustand";
import type { SoundRecording } from "@/lib/recognition";
import type { SoundPreset } from "@/lib/sound-presets";

export type SoundStatus = "idle" | "loading" | "playing" | "stopped" | "blocked" | "unavailable";

export type SoundSource =
  | { kind: "recording"; recording: SoundRecording }
  | { kind: "synth"; preset: SoundPreset; reason: string };

type SoundState = {
  status: SoundStatus;
  source: SoundSource | null;
  message: string | null;
};

export const useSoundStore = create<SoundState>(() => ({
  status: "idle",
  source: null,
  message: null,
}));
