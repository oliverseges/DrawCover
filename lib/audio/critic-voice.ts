import type { CriticId } from "@/lib/critics";

const voices: Record<CriticId, { pitch: number; wave: OscillatorType; pace: number }> = {
  mara: { pitch: 190, wave: "sine", pace: .16 },
  jax: { pitch: 105, wave: "triangle", pace: .19 },
  nova: { pitch: 310, wave: "square", pace: .12 },
};

/** Original oscillator syllables, not speech, recordings or a recreation of a game voice. */
export class CriticVoice {
  private context: AudioContext | null = null;
  private nodes: OscillatorNode[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private version = 0;

  constructor(private speaking: (value: boolean) => void) {}

  async speak(criticId: CriticId, reaction: "pleased" | "neutral" | "disappointed" = "neutral", durationMs?: number) {
    this.stop();
    const version = this.version;
    this.context ??= new AudioContext();
    const context = this.context;
    await context.resume();
    if (version !== this.version || document.hidden) return;
    const voice = voices[criticId];
    const pattern = reaction === "disappointed" ? [1, .82, .65, .6] : [1, 1.3, .9, 1.5, 1.15, 1.7];
    const count = durationMs === undefined ? pattern.length : Math.max(1, Math.ceil(Math.min(2400, durationMs) / 1000 / voice.pace));
    const syllables = Array.from({ length: count }, (_, index) => pattern[index % pattern.length]);
    const start = context.currentTime + .02;
    syllables.forEach((pitch, index) => {
      const time = start + index * voice.pace;
      const duration = voice.pace * .65;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      oscillator.type = voice.wave;
      oscillator.frequency.setValueAtTime(voice.pitch * pitch, time);
      oscillator.frequency.exponentialRampToValueAtTime(voice.pitch * pitch * .75, time + duration);
      filter.type = "lowpass";
      filter.frequency.value = criticId === "jax" ? 650 : 1250;
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(.035, time + .012);
      gain.gain.exponentialRampToValueAtTime(.001, time + duration);
      oscillator.connect(filter).connect(gain).connect(context.destination);
      oscillator.onended = () => { oscillator.disconnect(); filter.disconnect(); gain.disconnect(); };
      oscillator.start(time);
      oscillator.stop(time + duration);
      this.nodes.push(oscillator);
      this.timers.push(setTimeout(() => this.speaking(true), (time - start) * 1000));
      this.timers.push(setTimeout(() => this.speaking(false), (time - start + duration) * 1000));
    });
    this.timers.push(setTimeout(() => this.stop(), syllables.length * voice.pace * 1000 + 80));
  }

  stop() {
    this.version++;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    for (const node of this.nodes) {
      // stop() is valid on an already-ended scheduled source.
      node.stop();
      node.disconnect();
    }
    this.nodes = [];
    this.speaking(false);
  }

  dispose() {
    this.stop();
    const closing = this.context?.close();
    this.context = null;
    return closing;
  }
}
