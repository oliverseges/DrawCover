// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const playSynth = vi.fn();
vi.mock("@/lib/audio/synth", () => ({
  AudioBlockedError: class AudioBlockedError extends Error {},
  playSynth: (...a: unknown[]) => playSynth(...a),
}));

import { AudioBlockedError } from "@/lib/audio/synth";
import { soundPlayer } from "@/lib/audio/player";
import { useSoundStore } from "@/stores/sound-store";

const REC = {
  url: "https://upload.wikimedia.org/wikipedia/commons/6/62/Meow.ogg",
  title: "Meow.ogg",
  credit: "Someone",
  license: "CC0",
  pageUrl: "https://commons.wikimedia.org/wiki/File:Meow.ogg",
};
const SOUND = { phrase: "cat meow", preset: "meow" as const };

let audios: FakeAudio[] = [];
let playBehavior: () => Promise<void>;
class FakeAudio {
  listeners: Record<string, () => void> = {};
  paused = false;
  constructor(public src: string) {
    audios.push(this);
  }
  preload = "";
  play = vi.fn(() => playBehavior());
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
  removeAttribute = vi.fn();
  addEventListener(n: string, cb: () => void) {
    this.listeners[n] = cb;
  }
}

const mockLookup = (recording: unknown, ok = true) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => ({ recording }) })));
const err = (name: string) => Object.assign(new Error(name), { name });
const status = () => useSoundStore.getState().status;
const source = () => useSoundStore.getState().source;

beforeEach(() => {
  audios = [];
  playBehavior = async () => {};
  playSynth.mockReset();
  playSynth.mockResolvedValue({ stop: vi.fn(), done: new Promise(() => {}) });
  vi.stubGlobal("Audio", FakeAudio);
  soundPlayer.reset();
});

describe("soundPlayer", () => {
  it("plays a recording, then stop and replay work", async () => {
    mockLookup(REC);
    await soundPlayer.start(SOUND);
    expect(status()).toBe("playing");
    expect(source()).toMatchObject({ kind: "recording" });
    soundPlayer.stop();
    expect(status()).toBe("stopped");
    expect(audios[0].pause).toHaveBeenCalled();
    await soundPlayer.play();
    expect(audios).toHaveLength(2);
    expect(status()).toBe("playing");
  });

  it("marks ended playback as stopped", async () => {
    mockLookup(REC);
    await soundPlayer.start(SOUND);
    audios[0].listeners.ended();
    expect(status()).toBe("stopped");
  });

  it("shows blocked on autoplay policy rejection, and plays after a user click", async () => {
    mockLookup(REC);
    playBehavior = async () => {
      throw err("NotAllowedError");
    };
    await soundPlayer.start(SOUND);
    expect(status()).toBe("blocked");
    expect(source()).toMatchObject({ kind: "recording" });
    playBehavior = async () => {};
    await soundPlayer.play();
    expect(status()).toBe("playing");
  });

  it("falls back to labelled synthesis when the recording cannot play", async () => {
    mockLookup(REC);
    playBehavior = async () => {
      throw err("NotSupportedError");
    };
    await soundPlayer.start(SOUND);
    expect(status()).toBe("playing");
    expect(source()).toMatchObject({ kind: "synth", preset: "meow" });
    expect(playSynth).toHaveBeenCalledWith("meow");
  });

  it("uses synthesis when no recording is found or lookup fails", async () => {
    mockLookup(null);
    await soundPlayer.start(SOUND);
    expect(source()).toMatchObject({ kind: "synth" });
    mockLookup(null, false);
    await soundPlayer.start(SOUND);
    expect(status()).toBe("playing");
  });

  it("never plays an untrusted recording URL", async () => {
    mockLookup({ ...REC, url: "https://evil.example/a.ogg" });
    await soundPlayer.start(SOUND);
    expect(audios).toHaveLength(0);
    expect(source()).toMatchObject({ kind: "synth" });
  });

  it("surfaces unavailable audio when synthesis fails too", async () => {
    mockLookup(null);
    playSynth.mockRejectedValue(new Error("no audio"));
    await soundPlayer.start(SOUND);
    expect(status()).toBe("unavailable");
  });

  it("shows blocked when synthesis is blocked by policy", async () => {
    mockLookup(null);
    playSynth.mockRejectedValue(new AudioBlockedError());
    await soundPlayer.start(SOUND);
    expect(status()).toBe("blocked");
  });

  it("stops stale audio on a new start and on reset", async () => {
    mockLookup(REC);
    await soundPlayer.start(SOUND);
    const first = audios[0];
    await soundPlayer.start(SOUND);
    expect(first.pause).toHaveBeenCalled();
    soundPlayer.reset();
    expect(audios[1].pause).toHaveBeenCalled();
    expect(status()).toBe("idle");
  });

  it("ignores a lookup that resolves after reset", async () => {
    let resolve!: (v: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((r) => (resolve = r))));
    const p = soundPlayer.start(SOUND);
    soundPlayer.reset();
    resolve({ ok: true, json: async () => ({ recording: REC }) });
    await p;
    expect(audios).toHaveLength(0);
    expect(status()).toBe("idle");
  });
});
