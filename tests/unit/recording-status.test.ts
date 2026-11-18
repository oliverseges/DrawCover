import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RecordingStatus } from "@/components/recording-status";

it("rotates pending copy without repeated announcements and cleans up its timer", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(RecordingStatus)));
    expect(host.querySelector('[aria-hidden="true"] + .sr-only')?.textContent).toContain("Turning your lines");
    const accessible = host.querySelector(".sr-only")?.textContent;
    expect(host.textContent).toContain("Turning your lines into a record");
    await act(async () => vi.advanceTimersByTime(4500));
    expect(host.textContent).toContain("It's my credits");
    expect(host.querySelector(".sr-only")?.textContent).toBe(accessible);
    await act(async () => vi.advanceTimersByTime(4500));
    expect(host.textContent).toContain("not the speed");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
