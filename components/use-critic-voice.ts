"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CriticVoice } from "@/lib/audio/critic-voice";
import type { CriticId } from "@/lib/critics";

export function useCriticVoice(criticId: CriticId) {
  const voice = useRef<CriticVoice | null>(null);
  const enabled = useRef(false);
  const [muted, setMuted] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [audioError, setAudioError] = useState("");

  const stop = useCallback(() => voice.current?.stop(), []);
  const speak = useCallback((reaction: "pleased" | "neutral" | "disappointed" = "neutral", durationMs?: number) => {
    if (!enabled.current || document.hidden) return;
    voice.current ??= new CriticVoice(setSpeaking);
    void voice.current.speak(criticId, reaction, durationMs).catch(() => {
      enabled.current = false;
      setMuted(true);
      setAudioError("Critic sound is unavailable in this browser. The written review still works.");
    });
  }, [criticId]);

  function toggle() {
    enabled.current = !enabled.current;
    setMuted(!enabled.current);
    setAudioError("");
    if (enabled.current) speak();
    else stop();
  }

  useEffect(() => {
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hide);
    return () => { document.removeEventListener("visibilitychange", hide); stop(); };
  }, [criticId, stop]);

  useEffect(() => () => {
    void voice.current?.dispose()?.catch(() => {});
    voice.current = null;
  }, []);

  return { muted, speaking, audioError, toggle, speak, stop };
}
