export type Album = {
  id: string;
  title: string;
  artist: string;
  subtitle: string;
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
