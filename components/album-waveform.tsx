"use client";

import { useEffect, useRef, type CSSProperties, type RefObject } from "react";

const BAR_COUNT = 36;
const REST_HEIGHT = 0.12;
const REST_OPACITY = 0.3;

type AudioGraph = {
  source: MediaElementAudioSourceNode;
  analyser: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
};

// A media element can only be attached once, even after disconnect/close.
// These routes live as long as their elements, not as long as a React effect.
const graphs = new WeakMap<HTMLAudioElement, AudioGraph>();
let context: AudioContext | undefined;

export function AlbumWaveform({
  audioRef,
  playing,
}: {
  audioRef: RefObject<HTMLAudioElement | null>;
  playing: boolean;
}) {
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = audioRef.current;
    const strip = stripRef.current;
    if (!element || !strip) return;
    const audio = element;

    const bars = Array.from(strip.querySelectorAll("i"));
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let frame: number | undefined;
    let listeningContext: AudioContext | undefined;
    let waiting = false;

    function rest() {
      for (const bar of bars) {
        bar.style.transform = `scaleY(${REST_HEIGHT})`;
        bar.style.opacity = String(REST_OPACITY);
      }
    }

    function stop() {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      rest();
    }

    function canDraw() {
      return !disposed && !audio.paused && !audio.ended && !audio.seeking &&
        !waiting && !document.hidden && !motion.matches;
    }

    function draw() {
      frame = undefined;
      const graph = graphs.get(audio);
      if (!canDraw() || !graph || context?.state !== "running") {
        stop();
        return;
      }

      graph.analyser.getFloatTimeDomainData(graph.samples);
      // Each bar is the RMS of a short slice of the *current* PCM window.
      // No random/time-based motion or smoothing tail through silence.
      for (let index = 0; index < bars.length; index++) {
        const start = Math.floor(index * graph.samples.length / BAR_COUNT);
        const end = Math.floor((index + 1) * graph.samples.length / BAR_COUNT);
        let energy = 0;
        for (let sample = start; sample < end; sample++) {
          energy += graph.samples[sample] ** 2;
        }
        const rms = Math.sqrt(energy / (end - start));
        const level = audio.muted || audio.volume === 0 || rms < 0.003 ? 0 : Math.min(1, rms * 3);
        bars[index].style.transform = `scaleY(${REST_HEIGHT + level * (1 - REST_HEIGHT)})`;
        bars[index].style.opacity = String(REST_OPACITY + level * 0.55);
      }
      frame = requestAnimationFrame(draw);
    }

    function sync() {
      if (!canDraw() || context?.state !== "running") {
        stop();
        return;
      }
      if (!graphs.has(audio)) {
        // Generated songs are data URLs. Do not silently mute native,
        // non-CORS cross-origin media by attaching a Web Audio source.
        const src = audio.currentSrc || audio.src;
        if (!src) return;
        const url = new URL(src, document.baseURI);
        if (!["data:", "blob:"].includes(url.protocol) &&
          url.origin !== window.location.origin && !audio.crossOrigin) return;
        try {
          const analyser = context.createAnalyser();
          analyser.fftSize = 2048;
          const source = context.createMediaElementSource(audio);
          // Audible passthrough is independent of the visual analyser.
          source.connect(context.destination);
          source.connect(analyser);
          graphs.set(audio, {
            source, analyser, samples: new Float32Array(analyser.fftSize),
          });
        } catch {
          // Unsupported/already-owned media must not break native controls.
          stop();
          return;
        }
      }
      if (frame === undefined) draw();
    }

    async function unlock() {
      if (disposed || document.hidden || motion.matches) return;
      try {
        const AudioContextClass = window.AudioContext ??
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) return;
        context ??= new AudioContextClass();
        if (listeningContext !== context) {
          listeningContext = context;
          context.addEventListener("statechange", sync);
        }
        // Never attach an element before resume succeeds: a suspended graph
        // would hijack otherwise-working native playback/autoplay.
        // Retry even if an earlier resume promise is still pending (Safari).
        if (context.state !== "running") await context.resume();
        if (!disposed) sync();
      } catch {
        if (!disposed) stop();
      }
    }

    function gesture(event: Event) {
      if (event.isTrusted) void unlock();
    }

    function start() {
      waiting = false;
      void unlock();
    }

    function suspend() {
      waiting = true;
      stop();
    }

    function visibility() {
      if (document.hidden || motion.matches) stop();
      else if (!audio.paused) void unlock();
    }

    const gestures = ["pointerdown", "touchend", "keydown", "click"];
    const starts = ["play", "playing", "seeked"];
    const stops = ["pause", "ended", "emptied", "loadstart", "seeking", "waiting", "error", "abort"];
    for (const name of gestures) document.addEventListener(name, gesture, true);
    for (const name of starts) audio.addEventListener(name, start);
    for (const name of stops) audio.addEventListener(name, suspend);
    audio.addEventListener("volumechange", sync);
    document.addEventListener("visibilitychange", visibility);
    motion.addEventListener("change", visibility);
    if (!audio.paused) start();
    else rest();

    return () => {
      disposed = true;
      stop();
      for (const name of gestures) document.removeEventListener(name, gesture, true);
      for (const name of starts) audio.removeEventListener(name, start);
      for (const name of stops) audio.removeEventListener(name, suspend);
      audio.removeEventListener("volumechange", sync);
      document.removeEventListener("visibilitychange", visibility);
      motion.removeEventListener("change", visibility);
      listeningContext?.removeEventListener("statechange", sync);
      // Do not close/suspend the context or disconnect the audible route.
      // The audio element may keep playing and may be mounted again later.
    };
  }, [audioRef, playing]);

  return (
    <div ref={stripRef} className="player-waveform" aria-hidden="true">
      {Array.from({ length: BAR_COUNT }, (_, index) => (
        <i key={index} style={{
          "--bar-height": "100%",
          transform: `scaleY(${REST_HEIGHT})`,
          opacity: REST_OPACITY,
        } as CSSProperties} />
      ))}
    </div>
  );
}
