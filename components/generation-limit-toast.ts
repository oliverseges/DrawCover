"use client";

import { toast } from "sonner";

export function showGenerationLimit(response: Response, body: { reason?: string; retryAfterSeconds?: number }): boolean {
  if (response.status !== 429) {
    if (response.ok) toast.dismiss("generation-limit");
    return false;
  }
  const seconds = Number(body.retryAfterSeconds ?? response.headers.get("Retry-After"));
  const minutes = Math.ceil(seconds / 60);
  const wait = Number.isFinite(seconds) && seconds > 0 ? minutes >= 60
    ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`
    : seconds >= 60 ? `${minutes} minute${minutes === 1 ? "" : "s"}` : `${Math.ceil(seconds)} second${Math.ceil(seconds) === 1 ? "" : "s"}`
    : "a little while";
  if (body.reason === "daily_limit") {
    toast.info("The shared demo allowance is used up", {
      id: "generation-limit", duration: Infinity,
      description: `This allowance is shared by everyone, not a personal cooldown. Resets at 00:00 UTC (in ${wait}).`,
    });
  } else if (body.reason === "cooldown") {
    toast.warning("Time for a break", {
      id: "generation-limit", duration: Infinity,
      description: `Your network is taking a short recording break. Try again in ${wait}.`,
    });
  } else {
    toast.warning("The studio is busy", {
      id: "generation-limit", description: wait ? `Please try again in ${wait}.` : "Please wait a moment before trying again.",
    });
  }
  return true;
}
