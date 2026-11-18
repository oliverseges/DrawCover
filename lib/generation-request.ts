import { RECORDING_HEADER } from "@/lib/recording";

type FailureBody = { message?: string; reason?: string; retryAfterSeconds?: number };
class ConnectionTimeout extends Error {
  name = "ConnectionTimeout";
}

async function requestJson<T>(path: string, init: RequestInit, timeoutMs: number) {
  const requestId = crypto.randomUUID();
  const started = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ConnectionTimeout("The studio connection timed out. Your recording may still finish; retry to check its saved result."));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(path, {
          ...init, signal: controller.signal, cache: "no-store",
          headers: { ...init.headers, "X-DrawCover-Request-Id": requestId },
        });
        const body = await response.json() as T & FailureBody;
        return { response, body };
      })(),
      timeout,
    ]);
  } catch (error) {
    if (interrupted(error)) console.info("[DrawCover transport]", {
      requestId, path: path.split("?")[0], category: error.name, elapsedMs: Date.now() - started,
    });
    throw error;
  } finally {
    clearTimeout(timer!);
  }
}

const interrupted = (error: unknown): error is Error =>
  error instanceof TypeError || error instanceof SyntaxError || error instanceof ConnectionTimeout;

export async function generationRequest<T>(path: string, payload: unknown, timeoutMs = 120_000) {
  const recordingId = crypto.randomUUID();
  const started = Date.now();
  try {
    const result = await requestJson<T>(path, {
      method: "POST", headers: { "Content-Type": "application/json", [RECORDING_HEADER]: recordingId },
      body: JSON.stringify(payload),
    }, timeoutMs);
    if (result.response.status !== 409) return result;
  } catch (error) {
    if (!interrupted(error)) throw error;
    console.info("[DrawCover] Restoring interrupted recording", { category: error.name, elapsedMs: Date.now() - started });
  }
  // Only read the receipt created by the original POST. Never replay paid work.
  const until = Date.now() + Math.min(timeoutMs, 120_000);
  let transportFailures = 0;
  while (Date.now() < until) {
    try {
      const result = await requestJson<T>(`/api/drawcover/recording?id=${recordingId}`, {
        method: "GET",
      }, Math.min(10_000, until - Date.now()));
      if (result.response.status !== 202) return result;
      transportFailures = 0;
    } catch (error) {
      if (!interrupted(error)) throw error;
      if (++transportFailures >= 3) break;
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(1500, Math.max(0, until - Date.now()))));
  }
  throw new Error("The connection to your saved recording is still interrupted. Retry to check it; no extra song was generated.");
}
