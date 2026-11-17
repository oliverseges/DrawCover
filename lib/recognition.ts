import type { SoundPreset } from "@/lib/sound-presets";

export type RecognitionResult = {
  label: string;
  confidence: number;
  description: string;
  alternatives: string[];
  /** Separate from `label`: how to find or approximate the sound this thing makes. */
  sound: { phrase: string; preset: SoundPreset };
};

export type RecognizeErrorCode =
  | "invalid_image"
  | "image_too_large"
  | "missing_api_key"
  | "rate_limited"
  | "upstream_error";

export type SoundRecording = {
  url: string;
  title: string;
  credit: string;
  license: string;
  pageUrl: string;
};
