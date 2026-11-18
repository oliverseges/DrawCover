"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Album, DrawCoverTrack } from "@/lib/drawcover";
import { generationRequest } from "@/lib/generation-request";
import { showGenerationLimit } from "@/components/generation-limit-toast";

type TrackState = { status: "loading" | "ready" | "error"; message?: string };

export function useAlbumPlayer(album: Album | null) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const cache = useRef(new Map<number, string>());
  const busy = useRef(false);
  const version = useRef(0);
  const [tracks, setTracks] = useState<Record<number, TrackState>>({});
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  const select = useCallback(async (index: number) => {
    if (!album || busy.current) return;
    const currentVersion = version.current;
    busy.current = true;
    setLoading(true);
    setActive(index);
    setNotice("");
    audioRef.current?.pause();
    try {
      let dataUrl = cache.current.get(index);
      if (!dataUrl) {
        setTracks((old) => ({ ...old, [index]: { status: "loading" } }));
        const { response, body } = await generationRequest<DrawCoverTrack>(
          "/api/drawcover/track", { albumId: album.id, trackIndex: index }, 75_000,
        );
        if (currentVersion !== version.current) return;
        if (showGenerationLimit(response, body)) {
          setTracks((old) => {
            const next = { ...old };
            delete next[index];
            return next;
          });
          return;
        }
        if (!response.ok) throw new Error(body.message || "This track couldn't be generated.");
        dataUrl = body.dataUrl;
        if (!dataUrl?.startsWith("data:audio/")) throw new Error("The track returned no playable audio.");
        if (currentVersion !== version.current) return;
        cache.current.set(index, dataUrl);
      }
      if (currentVersion !== version.current) return;
      setTracks((old) => ({ ...old, [index]: { status: "ready" } }));
      const audio = audioRef.current;
      if (!audio) throw new Error("The audio player isn't available.");
      audio.src = dataUrl;
      try {
        await audio.play();
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== "NotAllowedError") {
          throw new Error("Audio couldn't play. Select the track again to reload it.");
        }
        if (currentVersion === version.current) setNotice("Your track is ready. Press play to listen.");
      }
    } catch (error) {
      if (currentVersion === version.current) {
        setTracks((old) => ({ ...old, [index]: { status: "error", message: error instanceof Error ? error.message : "The track couldn't load." } }));
      }
    } finally {
      if (currentVersion === version.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, [album]);

  useEffect(() => {
    const token = ++version.current;
    cache.current.clear();
    busy.current = false;
    setTracks({});
    setLoading(false);
    setNotice("");
    setActive(0);
    if (album) void select(0);
    return () => { version.current = token + 1; };
  }, [album, select]);

  return { audioRef, tracks, active, loading, notice, select };
}
