import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { reviewAlbum } from "@/lib/critic-review";
import type { Album } from "@/lib/drawcover";
import { useCriticVoice } from "@/components/use-critic-voice";
import type { CriticId } from "@/lib/critics";
import { CriticSpeech } from "@/components/critic-speech";

const record: Album = {
  id: "original", title: "Golden Paper", artist: "The Fold", subtitle: "Warm intimate folk with acoustic guitar",
  palette: ["#af7932", "#ead6a1", "#463229"], tracks: [{ title: "Fold One" }],
  cover: { source: "drawing", dataUrl: null }, models: { metadata: "mock", image: "mock", music: "mock" },
};

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("grounds stable scores in the server's distinct tastes without claiming audio listening", () => {
  const warm = reviewAlbum(record, "mara");
  expect(warm).toEqual(reviewAlbum(record, "mara"));
  expect(warm.score).toBe(10);
  expect(reviewAlbum(record, "jax").score).toBeLessThan(warm.score);
  expect(warm.text).toContain(record.title);
  expect(warm.text).toContain(record.tracks[0].title);
  expect(warm.text).toContain("not a listening review");
  expect(warm.basis).toBe("concept");
  const neon = reviewAlbum({ ...record, genre: "dance", subtitle: "Euphoric futuristic electronic dance", palette: ["#ff00aa", "#00ffcc", "#5522ff"] }, "nova");
  expect(neon.score).toBe(10);
  const rock = reviewAlbum({ ...record, subtitle: "Raw driving garage rock", palette: ["#110b0a", "#29252a", "#332222"] }, "jax");
  expect(rock.score).toBe(10);
});

it("types silently while muted, preserves progress on mute, and skips or reduces motion without repeated announcements", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let reduced = false;
  vi.stubGlobal("matchMedia", () => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const babble = vi.fn();
  const quiet = vi.fn();
  const host = document.createElement("div");
  const root = createRoot(host);
  const render = (text: string, muted = false) => root.render(createElement(CriticSpeech, { text, muted, onBabble: babble, onQuiet: quiet }));
  try {
    await act(async () => render("Hello record."));
    const button = () => host.querySelector("button")!;
    expect(button().textContent).toBe("");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Hello record.");
    expect(babble).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(56));
    expect(button().textContent).toBe("He");
    expect(babble).toHaveBeenCalledOnce();
    await act(async () => button().click());
    expect(button().textContent).toBe("Hello record.");
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => render("A different critic."));
    await act(async () => vi.advanceTimersByTime(56));
    const progress = button().textContent;
    await act(async () => render("A different critic.", true));
    expect(button().textContent).toBe(progress);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    const calls = babble.mock.calls.length;
    await act(async () => vi.advanceTimersByTime(140));
    expect(button().textContent!.length).toBeGreaterThan(progress!.length);
    expect(babble).toHaveBeenCalledTimes(calls);
    reduced = true;
    await act(async () => render("No animation.", false));
    expect(button().textContent).toBe("No animation.");
    expect(babble).toHaveBeenCalledTimes(calls);
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    expect(quiet).toHaveBeenCalled();
    host.remove();
  }
});

it("follows revealing speech until the reader scrolls up, then resumes only at the bottom", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(CriticSpeech, {
      text: "A long review with many lines. ".repeat(20), muted: true, onBabble: vi.fn(), onQuiet: vi.fn(),
    })));
    const bubble = host.querySelector("button")!;
    let height = 300;
    Object.defineProperties(bubble, { scrollHeight: { get: () => height }, clientHeight: { value: 100 } });
    await act(async () => vi.advanceTimersByTime(28));
    expect(bubble.scrollTop).toBe(300);
    bubble.scrollTop = 20;
    await act(async () => bubble.dispatchEvent(new Event("scroll", { bubbles: true })));
    height = 400;
    await act(async () => vi.advanceTimersByTime(56));
    expect(bubble.scrollTop).toBe(20);
    bubble.scrollTop = 300;
    await act(async () => bubble.dispatchEvent(new Event("scroll", { bubbles: true })));
    height = 500;
    await act(async () => vi.advanceTimersByTime(28));
    expect(bubble.scrollTop).toBe(500);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("starts babble only on a gesture, mutes/stops, and cleans up on critic changes, hiding and unmount", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const oscillators: { stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
  const close = vi.fn().mockResolvedValue(undefined);
  const resume = vi.fn().mockResolvedValue(undefined);
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  vi.stubGlobal("AudioContext", class {
    currentTime = 1;
    state = "suspended";
    destination = {};
    async resume() { resume(); this.state = "running"; }
    close = close;
    createOscillator() {
      const oscillator = { type: "", frequency: param(), connect: (node: unknown) => node, start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() };
      oscillators.push(oscillator);
      return oscillator;
    }
    createGain() { return { gain: param(), connect: (node: unknown) => node, disconnect: vi.fn() }; }
    createBiquadFilter() { return { type: "", frequency: param(), connect: (node: unknown) => node, disconnect: vi.fn() }; }
  });
  let latest!: ReturnType<typeof useCriticVoice>;
  function Harness({ id }: { id: CriticId }) { latest = useCriticVoice(id); return null; }
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(Harness, { id: "mara" })));
    expect(latest.muted).toBe(false);
    expect(oscillators).toHaveLength(0);
    await act(async () => latest.speak());
    expect(oscillators).toHaveLength(0);
    await act(async () => document.dispatchEvent(new Event("pointerdown")));
    expect(resume).toHaveBeenCalledOnce();
    await act(async () => latest.speak());
    expect(oscillators).toHaveLength(1);
    expect(latest.speaking).toBe(true);
    await act(async () => latest.toggle());
    expect(latest.muted).toBe(true);
    expect(localStorage.getItem("drawcover:critic-sound")).toBe("off");
    expect(latest.speaking).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(oscillators.every(node => node.stop.mock.calls.length >= 2)).toBe(true);
    await act(async () => latest.speak());
    expect(oscillators).toHaveLength(1);
    await act(async () => root.render(null));
    await act(async () => root.render(createElement(Harness, { id: "mara" })));
    expect(latest.muted).toBe(true);
    await act(async () => latest.toggle());
    expect(latest.muted).toBe(false);
    await act(async () => root.render(createElement(Harness, { id: "jax" })));
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => latest.speak("disappointed"));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(vi.getTimerCount()).toBe(0);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    await act(async () => latest.speak());
  } finally {
    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    expect(close).toHaveBeenCalledTimes(2);
    host.remove();
  }
});
