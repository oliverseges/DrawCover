import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const isHostedDemo = () => process.env.DRAWCOVER_HOSTED === "true";

export class HostedDemoError extends Error {
  constructor(public status: number, message: string, public reason?: string, public retryAfterSeconds?: number) {
    super(message);
  }
}

async function stateRequest<T>(path: string, body?: unknown): Promise<T> {
  try {
    const { env } = getCloudflareContext();
    const namespace = env.DRAWCOVER_STATE;
    if (!namespace) throw new Error("Missing state binding");
    const stub = namespace.get(namespace.idFromName("public-demo-v1"));
    const response = await stub.fetch(`https://state${path}`, body === undefined ? undefined : {
      method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
    });
    const result = await response.json() as { message?: string; reason?: string; retryAfterSeconds?: number } & T;
    if (!response.ok) throw new HostedDemoError(response.status, result.message ?? "The public demo is unavailable.", result.reason, result.retryAfterSeconds);
    return result;
  } catch (error) {
    if (error instanceof HostedDemoError) throw error;
    console.error("[DrawCover] Shared public-demo state is unavailable.");
    throw new HostedDemoError(503, "The public demo is temporarily unavailable. Please try again later.");
  }
}

export function hostedAlbum<T>(id: string): Promise<T> {
  return stateRequest(`/album?id=${encodeURIComponent(id)}`);
}

export async function hostedGeneration<T>(
  kind: "album" | "track", key: string,
  create: () => Promise<T>,
  errorInfo: (error: unknown) => { status: number; message: string },
  albumId?: (value: T) => string,
): Promise<T> {
  const claim = await stateRequest<{ cached?: T; lease?: string }>("/claim", { kind, key });
  if ("cached" in claim) return claim.cached!;
  if (!claim.lease) throw new HostedDemoError(503, "The public demo couldn't reserve this generation.");
  let value: T;
  try {
    value = await create();
  } catch (error) {
    await stateRequest("/fail", { key, lease: claim.lease, error: errorInfo(error) });
    throw error;
  }
  await stateRequest("/complete", { key, lease: claim.lease, value, albumId: albumId?.(value) });
  return value;
}
