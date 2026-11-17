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
  useSoundStore.setState({ preference: "auto" });
});

describe("Auto source order", () => {
  it("plays the AI-generated clip first and never looks up a recording", async () => {
    const f = mockApis(GEN, { recording: REC });
    await soundPlayer.start(SOUND);
    expect(state().status).toBe("playing");
    expect(state().source).toMatchObject({ kind: "generated", model: GEN.model });
    expect(audios[0].src).toBe(GEN.dataUrl);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it.each([["error"], ["timeout"]] as const)(
    "falls back to a public recording when generation fails (%s)",
    async (mode) => {
      mockApis(mode, { recording: REC });
      await soundPlayer.start(SOUND);
      expect(state().source).toMatchObject({ kind: "recording" });
      expect(state().status).toBe("playing");
      expect(state().note).toBeTruthy();
    },
  );

  it("falls back to synthesis when generation and recording both fail", async () => {
    mockApis("error", { recording: null });
    await soundPlayer.start(SOUND);
    expect(state().source).toMatchObject({ kind: "synth", preset: "meow" });
    expect(playSynth).toHaveBeenCalledWith("meow");
    expect(state().note).toContain("No suitable licensed recording");
  });

  it("falls back when the generated clip cannot be decoded", async () => {
    mockApis(GEN, { recording: REC });
    playBehavior = async (url) => {
      if (url.startsWith("data:")) throw err("NotSupportedError");
    };
    await soundPlayer.start(SOUND);
    expect(state().source).toMatchObject({ kind: "recording" });
  });

  it("rejects non-mp3 generated data and untrusted recording URLs", async () => {
    mockApis({ dataUrl: "data:text/html;base64,AAAA" }, { recording: { ...REC, url: "https://evil.example/a.ogg" } });
    await soundPlayer.start(SOUND);
    expect(audios).toHaveLength(0);
    expect(state().source).toMatchObject({ kind: "synth" });
  });

  it("surfaces unavailable audio when every source fails", async () => {
    mockApis("error", { recording: null });
    playSynth.mockRejectedValue(new Error("no audio"));
    await soundPlayer.start(SOUND);
    expect(state().status).toBe("unavailable");
    expect(state().message).toContain("Audio is unavailable");
  });
});

describe("source selector", () => {
  it("Synth only uses synthesis and makes no network calls", async () => {
    const f = mockApis(GEN, { recording: REC });
    useSoundStore.setState({ preference: "synth" });
    await soundPlayer.start(SOUND);
    expect(state().source?.kind).toBe("synth");
    expect(f).not.toHaveBeenCalled();
  });

  it("choosing a source replays with it, reusing already-fetched sources", async () => {
    const f = mockApis(GEN, { recording: REC });
    await soundPlayer.start(SOUND);
    await soundPlayer.setPreference("recording");
    expect(state().source).toMatchObject({ kind: "recording" });
    expect(audios[0].pause).toHaveBeenCalled();
    await soundPlayer.setPreference("generated");
    expect(state().source).toMatchObject({ kind: "generated" });
    expect(f.mock.calls.filter(([u]) => String(u).includes("/generate"))).toHaveLength(1);
  });

  it("an explicitly chosen source that fails does not silently switch", async () => {
    mockApis("error", { recording: REC });
    await soundPlayer.start(SOUND);
    await soundPlayer.setPreference("generated");
    expect(state().status).toBe("unavailable");
    expect(state().message).toContain("failed");
    expect(state().source).toBeNull();
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
    mockApis(GEN, null);
    await soundPlayer.start(SOUND);
    audios[0].listeners.ended();
    expect(state().status).toBe("stopped");
  });

  it("shows blocked on autoplay policy rejection, then plays after a user click", async () => {
    mockApis(GEN, null);
    playBehavior = async () => {
      throw err("NotAllowedError");
    };
    await soundPlayer.start(SOUND);
    expect(state().status).toBe("blocked");
    expect(state().source).toMatchObject({ kind: "generated" });
    playBehavior = async () => {};
    await soundPlayer.play();
    expect(state().status).toBe("playing");
  });

  it("shows blocked when synthesis is blocked by policy", async () => {
    useSoundStore.setState({ preference: "synth" });
    playSynth.mockRejectedValue(new AudioBlockedError());
    await soundPlayer.start(SOUND);
    expect(state().status).toBe("blocked");
  });

  it("stops stale audio on a new start and on reset", async () => {
    mockApis(GEN, null);
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
    resolve({ ok: true, json: async () => GEN });
    await p;
    expect(audios).toHaveLength(0);
    expect(state().status).toBe("idle");
  });
});
