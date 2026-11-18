"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CriticVoice } from "@/lib/audio/critic-voice";
import type { CriticId } from "@/lib/critics";

const preferenceKey = "drawcover:critic-sound";
const preferenceListeners = new Set<() => void>();
let memoryMuted = false;
let warned = false;
function preferenceFailure() {
  if (!warned) console.warn("[DrawCover critic] Sound preference storage is unavailable; using this tab's setting.");
  warned = true;
}
function readMuted() {
  if (warned) return memoryMuted;
  try { memoryMuted = localStorage.getItem(preferenceKey) === "off"; return memoryMuted; }
  catch { preferenceFailure(); return memoryMuted; }
}
function subscribe(callback: () => void) {
  preferenceListeners.add(callback);
  window.addEventListener("storage", callback);
  return () => { preferenceListeners.delete(callback); window.removeEventListener("storage", callback); };
}

export function useCriticVoice(criticId: CriticId, active = true) {
  const voice = useRef<CriticVoice | null>(null);
  const muted = useSyncExternalStore(subscribe, readMuted, () => false);
  const [speaking, setSpeaking] = useState(false);
  const [audioError, setAudioError] = useState("");

  const stop = useCallback(() => voice.current?.stop(), []);
  const unlock = useCallback(() => {
    if (!active || readMuted()) return;
    voice.current ??= new CriticVoice(setSpeaking);
    void voice.current.unlock().catch(() => {
      setAudioError("Critic sound is unavailable in this browser. The written review still works.");
    });
  }, [active]);
  const speak = useCallback((reaction: "pleased" | "neutral" | "disappointed" = "neutral") => {
    if (!active || readMuted() || document.hidden) return;
    voice.current?.speak(criticId, reaction);
  }, [criticId, active]);

  function toggle() {
    memoryMuted = !muted;
    try { localStorage.setItem(preferenceKey, memoryMuted ? "off" : "on"); }
    catch { preferenceFailure(); setAudioError("Sound preference cannot be saved in this browser."); }
    preferenceListeners.forEach(callback => callback());
    if (memoryMuted) stop();
    else unlock();
  }

  useEffect(() => {
    if (!active) return;
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener("pointerdown", unlock, true);
    document.addEventListener("keydown", unlock, true);
    document.addEventListener("visibilitychange", hide);
    if (navigator.userActivation?.hasBeenActive) unlock();
    return () => {
      document.removeEventListener("pointerdown", unlock, true);
      document.removeEventListener("keydown", unlock, true);
      document.removeEventListener("visibilitychange", hide);
      stop();
    };
  }, [active, unlock, stop]);
  useEffect(() => stop, [criticId, stop]);
  useEffect(() => { if (muted) stop(); }, [muted, stop]);
  useEffect(() => () => {
    void voice.current?.dispose()?.catch(cause => console.warn("[DrawCover critic] Audio cleanup failed.", cause));
    voice.current = null;
  }, []);

  return { muted, speaking, audioError, toggle, speak, stop };
}
