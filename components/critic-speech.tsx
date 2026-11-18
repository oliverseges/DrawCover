"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type SpeechProps = {
  text: string;
  muted: boolean;
  onBabble: () => void;
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
  const instant = useSyncExternalStore(subscribe, quietDisplay, () => true);
  const [shown, setShown] = useState(0);
  const bubble = useRef<HTMLButtonElement>(null);
  const following = useRef(true);
  const callbacks = useRef({ onBabble, onQuiet, muted });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    callbacks.current = { onBabble, onQuiet, muted };
    if (muted) onQuiet();
  }, [onBabble, onQuiet, muted]);
  useEffect(() => {
    callbacks.current.onQuiet();
    if (instant) return;
    let position = 0;
    timer.current = setInterval(() => {
      position++;
      if (position % 5 === 1 && !callbacks.current.muted) callbacks.current.onBabble();
      setShown(position);
      if (position >= text.length && timer.current) { clearInterval(timer.current); timer.current = null; }
    }, 28);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      callbacks.current.onQuiet();
    };
  }, [text, instant]);
  useEffect(() => {
    if (!instant && following.current && bubble.current) {
      bubble.current.scrollTop = bubble.current.scrollHeight;
    }
  }, [shown, instant]);

  return <button ref={bubble} type="button" className="critic-bubble" aria-label="Show full critic message" onScroll={event => {
      const element = event.currentTarget;
      following.current = element.scrollHeight - element.clientHeight - element.scrollTop < 12;
    }} onClick={() => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      setShown(text.length);
      callbacks.current.onQuiet();
    }}><span aria-hidden="true">{instant ? text : text.slice(0, shown)}{!instant && shown < text.length && <i className="speech-cursor" />}</span></button>;
}

export function CriticSpeech(props: SpeechProps) {
  return <div className="critic-speech">
    <SpeechLine key={props.text} {...props} />
    <span className="sr-only" role="status">{props.text}</span>
  </div>;
}
