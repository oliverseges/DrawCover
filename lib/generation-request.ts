type FailureBody = { message?: string; reason?: string; retryAfterSeconds?: number };

export async function generationRequest<T>(path: string, payload: unknown, timeoutMs = 120_000) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("The studio connection timed out. Your recording may still finish; retry to check its saved result."));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(path, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload), signal: controller.signal,
        });
        const body = await response.json() as T & FailureBody;
        return { response, body };
      })(),
      timeout,
    ]);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("The connection to the studio was interrupted. Retry to check for your saved recording.");
    }
    if (error instanceof SyntaxError) {
      throw new Error("The studio response was interrupted. Retry to check for your saved recording.");
    }
    throw error;
  } finally {
    clearTimeout(timer!);
  }
}
