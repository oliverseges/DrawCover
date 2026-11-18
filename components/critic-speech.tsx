"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type SpeechProps = {
  text: string;
  muted: boolean;
  onBabble: (durationMs: number) => void;
  onQuiet: () => void;
};

function subscribe(callback: () => void) {
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", callback);
  document.addEventListener("visibilitychange", callback);
  return () => { media.removeEventListener("change", callback); document.removeEventListener("visibilitychange", callback); };
}
const quietDisplay = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden;

function SpeechLine({ text, muted, onBabble, onQuiet }: SpeechProps) {
  const instant = useSyncExternalStore(subscribe, quietDisplay, () => true) || muted;
  const [shown, setShown] = useState(0);
  const callbacks = useRef({ onBabble, onQuiet });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => { callbacks.current = { onBabble, onQuiet }; }, [onBabble, onQuiet]);
  useEffect(() => {
    callbacks.current.onQuiet();
    if (instant) return;
    let position = 0;
    const duration = Math.min(2400, text.length * 24);
    callbacks.current.onBabble(duration);
    timer.current = setInterval(() => {
      position++;
      setShown(position);
      if (position >= text.length && timer.current) { clearInterval(timer.current); timer.current = null; }
    }, Math.max(4, duration / Math.max(1, text.length)));
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      callbacks.current.onQuiet();
    };
  }, [text, instant]);

  return <button type="button" className="critic-bubble" aria-label="Show full critic message" onClick={() => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      setShown(text.length);
      callbacks.current.onQuiet();
    }}><span aria-hidden="true">{instant ? text : text.slice(0, shown)}{!instant && shown < text.length && <i className="speech-cursor" />}</span></button>;
}

export function CriticSpeech(props: SpeechProps) {
  return <div className="critic-speech">
    <SpeechLine key={`${props.text}:${props.muted}`} {...props} />
    <span className="sr-only" role="status">{props.text}</span>
  </div>;
}
