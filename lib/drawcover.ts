export type MusicMode = "instrumental" | "lyrics";
export const LYRICS_GENRES = ["pop", "rock", "hip-hop", "country", "dance", "R&B", "soul", "folk"] as const;

export function albumContentNote(mode?: MusicMode) {
  return mode === "lyrics" ? {
    title: "WITH LYRICS", detail: "VOCALS REQUESTED",
    label: "Content note: vocals and original lyrics requested. Not an official age certification or clean-content guarantee.",
  } : {
    title: "INSTRUMENTAL", detail: "NO LYRICS REQUESTED",
    label: "Content note: instrumental music, no lyrics requested. Not an official age certification.",
  };
}

export type Album = {
  id: string;
  title: string;
  artist: string;
  subtitle: string;
  musicMode?: MusicMode;
  genre?: typeof LYRICS_GENRES[number];
  palette: [string, string, string];
  tracks: { title: string }[];
  cover: {
    dataUrl: string | null;
    source: "ai" | "drawing";
    warning?: string;
  };
  models: { metadata: string; image: string; music: string };
};

export type DrawCoverTrack = { dataUrl: string; model: string };
