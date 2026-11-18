import "server-only";
import type { Album } from "@/lib/drawcover";
import type { CriticId, CriticReview } from "@/lib/critics";

const profiles = {
  mara: {
    genres: ["jazz", "soul", "folk", "acoustic", "country", "piano", "analog"],
    moods: ["warm", "gentle", "intimate", "nostalgic", "dreamy", "tender", "mellow"],
    taste: "Warm soul, intimate folk and dusty jazz; gentle moods and earthy, golden artwork.",
    pleased: "This one stays in the record bag.",
    disappointed: "A nice sleeve. Not quite my shelf.",
    voice: "I've made room between the dog-eared sleeves",
  },
  jax: {
    genres: ["rock", "punk", "garage", "grunge", "guitar", "metal", "drums"],
    moods: ["raw", "loud", "rebellious", "restless", "driving", "gritty", "intense", "energetic"],
    taste: "Guitar-driven rock and garage punk; raw energy and dark, rough-edged artwork.",
    pleased: "Finally. Something for the front page.",
    disappointed: "The zine is keeping its cover story.",
    voice: "My battered notebook has survived worse",
  },
  nova: {
    genres: ["dance", "electronic", "synth", "disco", "techno", "house", "pop"],
    moods: ["bright", "futuristic", "cosmic", "euphoric", "glitter", "upbeat", "pulsing", "neon"],
    taste: "Synth-pop and dance-floor electronics; euphoric, futuristic moods and vivid neon artwork.",
    pleased: "The future has a new opening act.",
    disappointed: "Not quite cleared for the dance floor.",
    voice: "My imaginary dance floor has very real standards",
  },
} as const;

function contains(text: string, word: string) {
  return new RegExp(`\\b${word}\\b`, "i").test(text);
}

export function reviewAlbum(album: Album, criticId: CriticId): CriticReview {
  const profile = profiles[criticId];
  // Only metadata and palette are evidence: never imply the generated audio was heard.
  const direction = `${album.genre ?? ""} ${album.subtitle}`;
  const genre = profile.genres.find(word => contains(direction, word));
  const mood = profile.moods.find(word => contains(album.subtitle, word));
  const colors = album.palette.map(hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)));
  const artMatches = colors.filter(([r, g, b]) => criticId === "mara"
    ? r > b + 15 && g > b
    : criticId === "jax"
      ? (r + g + b) / 3 < 100
      : Math.max(r, g, b) - Math.min(r, g, b) > 110).length;
  const breakdown = { direction: genre ? 4 : 1, mood: mood ? 3 : 1, palette: Math.min(3, 1 + artMatches) };
  const score = breakdown.direction + breakdown.mood + breakdown.palette;
  const colorNote = criticId === "mara" ? "earthy warmth" : criticId === "jax" ? "inky darkness" : "neon contrast";
  return {
    criticId, basis: "concept", score, breakdown,
    headline: score >= 7 ? profile.pleased : profile.disappointed,
    text: `On paper, "${album.title}" by ${album.artist} gives me plenty to judge. ` +
      (genre ? `That ${genre} direction earns a place in my notebook. ` : "The musical direction sits outside my usual obsession. ") +
      (mood ? `The ${mood} mood is exactly my kind of atmosphere. ` : "I would push the mood closer to my own corner of the record shop. ") +
      `The sleeve palette ${artMatches ? "brings" : "could use more"} ${colorNote}. ` +
      `"${album.tracks[0].title}" is the opening chapter I'd inspect first. ${profile.voice}; ` +
      "this is a verdict on the concept, not a listening review.",
    preferences: profile.taste,
  };
}
