// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { generationRequest } from "@/lib/generation-request";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("bounds a stalled HTTP 200 response body and permits an explicit cached retry", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(new ReadableStream()))
    .mockResolvedValueOnce(Response.json({ dataUrl: "data:audio/mpeg;base64,SUQz" }));
  vi.stubGlobal("fetch", fetcher);
  const attempt = generationRequest("/track", { trackIndex: 0 }, 75_000);
  const failed = expect(attempt).rejects.toThrow("connection timed out");
  await vi.advanceTimersByTimeAsync(75_000);
  await failed;
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  expect((await generationRequest<{ dataUrl: string }>("/track", { trackIndex: 0 })).body.dataUrl).toContain("data:audio/");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps structured server limits intact and does not retry transport errors automatically", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ reason: "daily_limit", retryAfterSeconds: 100 }, { status: 429 }))
    .mockRejectedValueOnce(new TypeError("Failed to fetch"));
  vi.stubGlobal("fetch", fetcher);
  expect((await generationRequest("/record", {})).body).toMatchObject({ reason: "daily_limit", retryAfterSeconds: 100 });
  await expect(generationRequest("/record", {})).rejects.toThrow("connection to the studio was interrupted");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
