export const SOUND_PRESETS = [
  "meow",
  "bark",
  "chirp",
  "roar",
  "engine",
  "bell",
  "water",
  "wind",
  "boom",
  "buzz",
  "beep",
  "tone",
] as const;

export type SoundPreset = (typeof SOUND_PRESETS)[number];

export const isSoundPreset = (v: unknown): v is SoundPreset =>
  typeof v === "string" && (SOUND_PRESETS as readonly string[]).includes(v);

/** Reduces model text to a short, plain search phrase. */
export function sanitizeSoundPhrase(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .trim();
}
