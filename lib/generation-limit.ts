export function cooldownResponse(until: number): Response {
  const retryAfterSeconds = Math.max(1, Math.ceil((until - Date.now()) / 1000));
  return Response.json({
    message: "Time for a break. Please wait before generating again.",
    reason: "cooldown", retryAfterSeconds, cooldownUntil: until,
  }, {
    status: 429,
    headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfterSeconds) },
  });
}
