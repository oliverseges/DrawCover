"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Blaze } from "@/components/canvasui/Blaze";
import { ParticleReveal } from "@/components/canvasui/ParticleReveal";

const effectsQuery = "(prefers-reduced-motion: no-preference) and (hover: hover) and (min-width: 768px)";

function subscribeEffects(onChange: () => void) {
  const media = window.matchMedia(effectsQuery);
  media.addEventListener("change", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    media.removeEventListener("change", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

function effectsSnapshot() {
  return !document.hidden && window.matchMedia(effectsQuery).matches;
}

function useEffectsEnabled() {
  return useSyncExternalStore(subscribeEffects, effectsSnapshot, () => false);
}

function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
}

export function AlbumAmbient({ palette }: { palette: [string, string, string] }) {
  const enabled = useEffectsEnabled();
  return (
    <div className="album-atmosphere" aria-hidden="true">
      <div className="ambient-orb orb-one" />
      <div className="ambient-orb orb-two" />
      <div className="ambient-orbit" />
      {enabled && (
        <Blaze className="album-embers" height={0.9} speed={0.18} sparks={0.18} sparkDensity={0.8} sparkSize={0.8} layers={2} smoke={0.08} glow={0.35} distortion={0} sparkColor={rgb(palette[2])} smokeColor={rgb(palette[1])}>
          <div className="ember-backdrop" />
        </Blaze>
      )}
    </div>
  );
}

export function CoverReveal({ children, background, animate = true }: { children: ReactNode; background: string; animate?: boolean }) {
  const effects = useEffectsEnabled();
  const enabled = effects && animate;
  const [threshold, setThreshold] = useState(0.02);
  const [arrived, setArrived] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const steps = [0.04, 0.1, 0.22, 0.4, 0.65, 1, 2];
    const timers = steps.map((value, index) => window.setTimeout(() => {
      setThreshold(value);
      if (index === steps.length - 1) setArrived(true);
    }, 350 + index * 130));
    return () => timers.forEach(window.clearTimeout);
  }, [enabled]);

  return (
    <div className="cover-reveal" data-arrived={arrived || !enabled} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
      {enabled ? (
        <ParticleReveal className="cover-particles" background={background} radius={290} softness={0.7} size={1.2} scatter={18} drift={arrived && !hovered ? 0 : 0.15} aberration={3} bend={5} fade={0.8} threshold={arrived && hovered ? 0.04 : threshold} smoothing={0.15}>
          {children}
        </ParticleReveal>
      ) : children}
      <div className="cover-particle-burst" aria-hidden="true">
        {Array.from({ length: 20 }, (_, index) => (
          <i key={index} style={{ "--particle-index": index } as React.CSSProperties} />
        ))}
      </div>
      <div className="cover-sheen" aria-hidden="true" />
    </div>
  );
}

export function AlbumTracklist({ children }: { children: ReactNode }) {
  return <div className="track-glass glass-surface">{children}</div>;
}
