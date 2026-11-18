export const CRITIC_IDS = ["mara", "jax", "nova"] as const;
export type CriticId = typeof CRITIC_IDS[number];

export const CRITICS: Record<CriticId, { name: string }> = {
  mara: { name: "Mara Moss" },
  jax: { name: "Jax Static" },
  nova: { name: "Nova Vale" },
};

export type CriticReview = {
  criticId: CriticId;
  basis: "concept";
  score: number;
  headline: string;
  text: string;
  preferences: string;
  breakdown: { direction: number; mood: number; palette: number };
};
