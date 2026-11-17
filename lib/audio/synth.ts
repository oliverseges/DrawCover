import type { SoundPreset } from "@/lib/sound-presets";

type Ctx = AudioContext;
export type SynthHandle = { stop: () => void; done: Promise<void> };

type Recipe = (ctx: Ctx, out: AudioNode, t: number) => number; // returns duration (s)

function osc(ctx: Ctx, out: AudioNode, type: OscillatorType, t: number, dur: number, f0: number, f1: number, gain = 0.5) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.03, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(ctx: Ctx, out: AudioNode, t: number, dur: number, freq: number, q: number, gain = 0.5, type: BiquadFilterType = "bandpass") {
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.15);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t);
}

const RECIPES: Record<SoundPreset, Recipe> = {
  meow: (c, o, t) => {
    osc(c, o, "sawtooth", t, 0.8, 500, 900, 0.3);
    osc(c, o, "sawtooth", t + 0.5, 0.5, 900, 450, 0.3);
    return 1.1;
  },
  bark: (c, o, t) => {
    osc(c, o, "sawtooth", t, 0.15, 400, 180, 0.5);
    osc(c, o, "sawtooth", t + 0.3, 0.15, 400, 180, 0.5);
    return 0.6;
  },
  chirp: (c, o, t) => {
    for (let i = 0; i < 3; i++) osc(c, o, "sine", t + i * 0.18, 0.1, 2400, 4000, 0.35);
    return 0.7;
  },
  roar: (c, o, t) => {
    osc(c, o, "sawtooth", t, 1.4, 120, 70, 0.5);
    noise(c, o, t, 1.4, 500, 0.7, 0.5);
    return 1.5;
  },
  engine: (c, o, t) => {
    osc(c, o, "sawtooth", t, 1.8, 60, 110, 0.4);
    osc(c, o, "square", t, 1.8, 30, 55, 0.2);
    return 1.9;
  },
  bell: (c, o, t) => {
    osc(c, o, "sine", t, 1.6, 880, 870, 0.4);
    osc(c, o, "sine", t, 1.2, 2200, 2180, 0.15);
    osc(c, o, "sine", t + 0.7, 1.4, 880, 870, 0.3);
    return 2.1;
  },
  water: (c, o, t) => {
    noise(c, o, t, 1.8, 1200, 0.8, 0.4);
    for (let i = 0; i < 6; i++) osc(c, o, "sine", t + i * 0.28, 0.1, 500 + i * 120, 1200 + i * 150, 0.15);
    return 1.9;
  },
  wind: (c, o, t) => {
    noise(c, o, t, 2.2, 600, 0.5, 0.5);
    return 2.3;
  },
  boom: (c, o, t) => {
    osc(c, o, "sine", t, 1, 120, 30, 0.8);
    noise(c, o, t, 0.8, 300, 0.4, 0.6, "lowpass");
    return 1.1;
  },
  buzz: (c, o, t) => {
    osc(c, o, "sawtooth", t, 1.2, 220, 230, 0.3);
    return 1.3;
  },
  beep: (c, o, t) => {
    osc(c, o, "square", t, 0.15, 1000, 1000, 0.2);
    osc(c, o, "square", t + 0.25, 0.15, 1000, 1000, 0.2);
    return 0.5;
  },
  tone: (c, o, t) => {
    osc(c, o, "triangle", t, 0.6, 440, 440, 0.4);
    return 0.7;
  },
};

export class AudioBlockedError extends Error {
  constructor() {
    super("The browser blocked audio until you interact with the page.");
  }
}

type CtxCtor = new () => AudioContext;
let shared: AudioContext | null = null;

function getContext(): AudioContext {
  const w = window as unknown as { AudioContext?: CtxCtor; webkitAudioContext?: CtxCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio is not supported in this browser.");
  if (!shared || shared.state === "closed") shared = new Ctor();
  return shared;
}

/** Plays a Web Audio approximation. Throws if audio cannot be produced. */
export async function playSynth(preset: SoundPreset): Promise<SynthHandle> {
  const ctx = getContext();
  if (ctx.state === "suspended") await ctx.resume();
  if (ctx.state !== "running") throw new AudioBlockedError();
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);
  const dur = RECIPES[preset](ctx, master, ctx.currentTime + 0.02);
  let finish!: () => void;
  const done = new Promise<void>((r) => (finish = r));
  const timer = setTimeout(() => {
    master.disconnect();
    finish();
  }, (dur + 0.1) * 1000);
  return {
    done,
    stop: () => {
      clearTimeout(timer);
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(0, ctx.currentTime);
      master.disconnect();
      finish();
    },
  };
}
