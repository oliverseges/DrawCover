// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { generationRequest } from "@/lib/generation-request";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("recovers a stalled HTTP 200 body using only a saved-recording GET", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(new ReadableStream()))
    .mockResolvedValueOnce(Response.json({ dataUrl: "data:audio/mpeg;base64,SUQz" }));
  vi.stubGlobal("fetch", fetcher);
  const attempt = generationRequest("/track", { trackIndex: 0 }, 75_000);
  await vi.advanceTimersByTimeAsync(75_000);
  expect((await attempt).body).toHaveProperty("dataUrl");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  expect(fetcher.mock.calls[1][0]).toMatch(/^\/api\/drawcover\/recording\?id=/);
  expect(fetcher.mock.calls[1][1].method).toBe("GET");
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps structured server limits intact without making recovery requests", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ reason: "daily_limit", retryAfterSeconds: 100 }, { status: 429 }));
  vi.stubGlobal("fetch", fetcher);
  expect((await generationRequest("/record", {})).body).toMatchObject({ reason: "daily_limit", retryAfterSeconds: 100 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("polls a pending receipt after a truncated response, without re-POSTing or swallowing provider failures", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response("{", { status: 200 }))
    .mockResolvedValueOnce(Response.json({ pending: true }, { status: 202 }))
    .mockResolvedValueOnce(Response.json({ message: "Music failed" }, { status: 502 }));
  vi.stubGlobal("fetch", fetcher);
  const attempt = generationRequest("/track", {});
  await vi.advanceTimersByTimeAsync(2_000);
  const result = await attempt;
  expect(result.response.status).toBe(502);
  expect(result.body).toEqual({ message: "Music failed" });
  expect(fetcher.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
  const recording = fetcher.mock.calls[0][1].headers["X-DrawCover-Recording"];
  expect(fetcher.mock.calls[1][0]).toContain(recording);
  expect(fetcher.mock.calls[2][0]).toContain(recording);
  expect(vi.getTimerCount()).toBe(0);
});

it("stops after three failed receipt reads without another generation or leftover timers", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  vi.stubGlobal("fetch", fetcher);
  const failed = expect(generationRequest("/record", {})).rejects.toThrow("saved recording is still interrupted");
  await vi.advanceTimersByTimeAsync(3000);
  await failed;
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(fetcher.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});
