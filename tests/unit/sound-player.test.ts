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
const GEN = { dataUrl: "data:audio/mpeg;base64,SUQzAAAA", model: "google/lyria-3-clip-preview" };
const SOUND = { phrase: "cat meow", preset: "meow" as const };

let audios: FakeAudio[] = [];
let playBehavior: (url: string) => Promise<void>;
class FakeAudio {
  listeners: Record<string, () => void> = {};
  constructor(public src: string) {
    audios.push(this);
  }
  preload = "";
  play = vi.fn(() => playBehavior(this.src));
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn();
  addEventListener(n: string, cb: () => void) {
    this.listeners[n] = cb;
  }
}

type Api = unknown | "error" | "timeout";
// Routes by endpoint; "error" is an HTTP failure, "timeout" an aborted request.
function mockApis(generated: Api, recording: Api) {
  const fn = vi.fn(async (url: string) => {
    const v = url.includes("/generate") ? generated : recording;
    if (v === "timeout") throw new DOMException("aborted", "AbortError");
    if (v === "error") return { ok: false, json: async () => ({ message: "AI sound generation failed (HTTP 402) (credit or key limit)." }) };
    return { ok: true, json: async () => v };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const err = (name: string) => Object.assign(new Error(name), { name });
const state = () => useSoundStore.getState();

beforeEach(() => {
  audios = [];
  playBehavior = async () => {};
  playSynth.mockReset();
  playSynth.mockResolvedValue({ stop: vi.fn(), done: new Promise(() => {}) });
  vi.stubGlobal("Audio", FakeAudio);
  soundPlayer.reset();
  useSoundStore.setState({ aiEnabled: null });
});

const generateCalls = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls.filter(([u]) => String(u).includes("/generate"));

describe("default playback never calls AI", () => {
  it("plays the recording and makes no generation request", async () => {
    const f = mockApis(GEN, { recording: REC });
    await soundPlayer.start(SOUND);
    expect(state().source).toMatchObject({ kind: "recording" });
    expect(generateCalls(f)).toHaveLength(0);
  });

  it("falls back to synthesis without AI when no recording exists", async () => {
    const f = mockApis(GEN, { recording: null });
    await soundPlayer.start(SOUND);
    expect(state().source).toMatchObject({ kind: "synth", preset: "meow" });
    expect(playSynth).toHaveBeenCalledWith("meow");
    expect(state().note).toContain("No suitable licensed recording");
    expect(generateCalls(f)).toHaveLength(0);
  });

  it("replay, stop and new recognitions stay AI-free, even after AI was used", async () => {
    const f = mockApis(GEN, { recording: REC });
    useSoundStore.setState({ aiEnabled: true });
    await soundPlayer.start(SOUND);
    await soundPlayer.generate();
    expect(generateCalls(f)).toHaveLength(1);
    await soundPlayer.start({ phrase: "dog bark", preset: "bark" });
    expect(state().source).toMatchObject({ kind: "recording" });
    soundPlayer.stop();
    await soundPlayer.play();
    expect(generateCalls(f)).toHaveLength(1);
  });

  it("surfaces unavailable audio when recording and synth both fail", async () => {
    mockApis(GEN, { recording: null });
    playSynth.mockRejectedValue(new Error("no audio"));
    await soundPlayer.start(SOUND);
    expect(state().status).toBe("unavailable");
    expect(state().message).toContain("Audio is unavailable");
  });

  it("rejects untrusted recording URLs", async () => {
    mockApis(GEN, { recording: { ...REC, url: "https://evil.example/a.ogg" } });
    await soundPlayer.start(SOUND);
    expect(audios).toHaveLength(0);
    expect(state().source).toMatchObject({ kind: "synth" });
  });
});

describe("explicit AI generation", () => {
  beforeEach(() => useSoundStore.setState({ aiEnabled: true }));

  it("generates with a POST only on click, and replay reuses the clip", async () => {
    const f = mockApis(GEN, { recording: REC });
    await soundPlayer.start(SOUND);
    await soundPlayer.generate();
    expect(state().source).toMatchObject({ kind: "generated", model: GEN.model });
    expect(audios.at(-1)!.src).toBe(GEN.dataUrl);
    expect(generateCalls(f)).toHaveLength(1);
    const gen = f.mock.calls.find(([u]) => String(u).includes("/generate")) as unknown as [string, RequestInit];
    expect(gen[1]).toMatchObject({ method: "POST" });
    soundPlayer.stop();
    await soundPlayer.play();
    expect(state().source).toMatchObject({ kind: "generated" });
    await soundPlayer.generate();
    expect(generateCalls(f)).toHaveLength(1);
  });

  it.each([["error"], ["timeout"]] as const)(
    "shows the error and keeps free sources usable when generation fails (%s)",
    async (mode) => {
      mockApis(mode, { recording: REC });
      await soundPlayer.start(SOUND);
      await soundPlayer.generate();
      expect(state().source).toMatchObject({ kind: "recording" });
      expect(state().status).toBe("playing");
      expect(state().note).toBeTruthy();
    },
  );

  it("does nothing when AI is not configured", async () => {
    useSoundStore.setState({ aiEnabled: false });
    const f = mockApis(GEN, { recording: REC });
    await soundPlayer.start(SOUND);
    await soundPlayer.generate();
    expect(generateCalls(f)).toHaveLength(0);
  });

  it("rejects non-mp3 generated data and falls back", async () => {
    mockApis({ dataUrl: "data:text/html;base64,AAAA" }, { recording: REC });
    await soundPlayer.start(SOUND);
    await soundPlayer.generate();
    expect(state().source).toMatchObject({ kind: "recording" });
  });

  it("recording and synth can be chosen independently without falling back", async () => {
    mockApis(GEN, { recording: REC });
    await soundPlayer.start(SOUND);
    await soundPlayer.playSource("synth");
    expect(state().source?.kind).toBe("synth");
    await soundPlayer.playSource("recording");
    expect(state().source?.kind).toBe("recording");
    mockApis(GEN, { recording: null });
    await soundPlayer.start(SOUND);
    await soundPlayer.reset();
  });

  it("loadConfig exposes only a boolean", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ aiEnabled: false }) })));
    await soundPlayer.loadConfig();
    expect(state().aiEnabled).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    await soundPlayer.loadConfig();
    expect(state().aiEnabled).toBe(false);
  });
});

describe("playback control", () => {
  it("stop and replay work", async () => {
    mockApis(null, { recording: REC });
    await soundPlayer.start(SOUND);
    soundPlayer.stop();
    expect(state().status).toBe("stopped");
    await soundPlayer.play();
    expect(audios).toHaveLength(2);
    expect(state().status).toBe("playing");
  });

  it("marks ended playback as stopped", async () => {
    mockApis(null, { recording: REC });
    await soundPlayer.start(SOUND);
    audios[0].listeners.ended();
    expect(state().status).toBe("stopped");
  });

  it("shows blocked on autoplay policy rejection, then plays after a user click", async () => {
    mockApis(null, { recording: REC });
    playBehavior = async () => {
      throw err("NotAllowedError");
    };
    await soundPlayer.start(SOUND);
    expect(state().status).toBe("blocked");
    expect(state().source).toMatchObject({ kind: "recording" });
    playBehavior = async () => {};
    await soundPlayer.play();
    expect(state().status).toBe("playing");
  });

  it("shows blocked when synthesis is blocked by policy", async () => {
    mockApis(null, { recording: null });
    playSynth.mockRejectedValue(new AudioBlockedError());
    await soundPlayer.start(SOUND);
    expect(state().status).toBe("blocked");
  });

  it("stops stale audio on a new start and on reset", async () => {
    mockApis(null, { recording: REC });
    await soundPlayer.start(SOUND);
    const first = audios[0];
    await soundPlayer.start(SOUND);
    expect(first.pause).toHaveBeenCalled();
    soundPlayer.reset();
    expect(audios[1].pause).toHaveBeenCalled();
    expect(state().status).toBe("idle");
  });

  it("ignores a lookup that resolves after reset", async () => {
    let resolve!: (v: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((r) => (resolve = r))));
    const p = soundPlayer.start(SOUND);
    soundPlayer.reset();
    resolve({ ok: true, json: async () => ({ recording: REC }) });
    await p;
    expect(audios).toHaveLength(0);
    expect(state().status).toBe("idle");
  });
});
