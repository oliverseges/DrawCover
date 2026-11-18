import "server-only";
import { z } from "zod";
import type { MusicMode } from "@/lib/drawcover";

export type DrawCoverProvider = "gemini" | "openrouter";

export class DrawCoverConfigError extends Error {}

export function validateMusicMode(mode: MusicMode, selected: DrawCoverProvider, model: string) {
  if (mode !== "lyrics") return;
  const supported = selected === "gemini" ? "lyria-3-clip-preview" : "google/lyria-3-clip-preview";
  if (model !== supported) {
    const setting = selected === "gemini" ? "DRAWCOVER_MUSIC_MODEL" : "OPENROUTER_MUSIC_MODEL";
    throw new DrawCoverConfigError(`Lyrics mode requires the documented vocal-capable model ${supported}. Set ${setting}=${supported}, or choose Instrumental.`);
  }
}

const providerSchema = z.enum(["auto", "gemini", "openrouter"]);

function provider(name: string, preferred: DrawCoverProvider): DrawCoverProvider {
  const parsed = providerSchema.safeParse(process.env[name]?.trim() || "auto");
  if (!parsed.success) {
    throw new DrawCoverConfigError(`${name} must be auto, gemini, or openrouter.`);
  }
  if (parsed.data !== "auto") return parsed.data;
  const hasPreferred = process.env[preferred === "gemini" ? "GEMINI_API_KEY" : "OPENROUTER_API_KEY"]?.trim();
  return hasPreferred ? preferred : preferred === "gemini" ? "openrouter" : "gemini";
}

export function providerKey(selected: DrawCoverProvider): string {
  const name = selected === "gemini" ? "GEMINI_API_KEY" : "OPENROUTER_API_KEY";
  const key = process.env[name]?.trim();
  if (!key) throw new DrawCoverConfigError(`Set ${name} in your local environment for the selected ${selected} provider.`);
  return key;
}

export function drawCoverConfig() {
  if (process.env.DRAWCOVER_HOSTED === "true") {
    return {
      metadataProvider: "openrouter" as const,
      musicProvider: "openrouter" as const,
      imageProvider: "openrouter" as const,
      models: {
        metadata: "google/gemini-3.5-flash-lite",
        image: "gemini-3.1-flash-image",
        music: "google/lyria-3-clip-preview",
      },
    };
  }
  const metadataProvider = provider("DRAWCOVER_METADATA_PROVIDER", "gemini");
  const musicProvider = provider("DRAWCOVER_MUSIC_PROVIDER", "openrouter");
  const image = z.enum(["auto", "gemini", "openrouter", "drawing"])
    .safeParse(process.env.DRAWCOVER_IMAGE_PROVIDER?.trim() || "auto");
  if (!image.success) {
    throw new DrawCoverConfigError("DRAWCOVER_IMAGE_PROVIDER must be auto, gemini, openrouter, or drawing.");
  }
  return {
    metadataProvider,
    musicProvider,
    imageProvider: image.data,
    models: {
      metadata: metadataProvider === "gemini"
        ? process.env.DRAWCOVER_METADATA_MODEL?.trim() || process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite"
        : process.env.OPENROUTER_METADATA_MODEL?.trim() || "google/gemini-3.5-flash-lite",
      image: process.env.DRAWCOVER_IMAGE_MODEL?.trim() || "gemini-3.1-flash-image",
      music: musicProvider === "gemini"
        ? process.env.DRAWCOVER_MUSIC_MODEL?.trim() || "lyria-3-clip-preview"
        : process.env.OPENROUTER_MUSIC_MODEL?.trim() || "google/lyria-3-clip-preview",
    },
  };
}
