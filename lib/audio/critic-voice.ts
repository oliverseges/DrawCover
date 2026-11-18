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
  private syllable = 0;

  constructor(private speaking: (value: boolean) => void) {}

  async unlock() {
    this.context ??= new AudioContext();
    await this.context.resume();
  }

  speak(criticId: CriticId, reaction: "pleased" | "neutral" | "disappointed" = "neutral") {
    const context = this.context;
    if (!context || context.state !== "running" || document.hidden) return;
    this.stop();
    const voice = voices[criticId];
    const pattern = reaction === "disappointed" ? [1, .82, .65, .6] : [1, 1.3, .9, 1.5, 1.15, 1.7];
    const pitch = pattern[this.syllable++ % pattern.length];
    const time = context.currentTime + .005;
    const duration = voice.pace * .5;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    oscillator.type = voice.wave;
    oscillator.frequency.setValueAtTime(voice.pitch * pitch, time);
    oscillator.frequency.exponentialRampToValueAtTime(voice.pitch * pitch * .75, time + duration);
    filter.type = "lowpass";
    filter.frequency.value = criticId === "jax" ? 650 : 1250;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(.025, time + .012);
    gain.gain.exponentialRampToValueAtTime(.001, time + duration);
    oscillator.connect(filter).connect(gain).connect(context.destination);
    oscillator.onended = () => { oscillator.disconnect(); filter.disconnect(); gain.disconnect(); };
    oscillator.start(time);
    oscillator.stop(time + duration);
    this.nodes.push(oscillator);
    this.speaking(true);
    this.timers.push(setTimeout(() => this.stop(), (duration + .01) * 1000));
  }

  stop() {
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
