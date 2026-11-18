import { cooldownResponse } from "../lib/generation-limit";

type Kind = "album" | "track";
type Job = {
  kind: Kind;
  status: "pending" | "ready" | "failed";
  lease: string;
  expires: number;
  parts: number;
  error?: { status: number; message: string };
};

export interface DemoStorage {
  kv: {
    get<T>(key: string): T | undefined;
    put(key: string, value: unknown): void;
    delete(key: string): unknown;
    list<T>(options: { prefix: string }): Iterable<[string, T]>;
  };
  transactionSync<T>(callback: () => T): T;
  setAlarm(time: number): Promise<void>;
}

const TTL = 30 * 60_000;
const FAILURE_TTL = 2 * 60_000;
const LEASE_TTL = 4 * 60_000;
const CHUNK_SIZE = 60_000;
const MAX_STORED_CHARS = 12 * 1024 * 1024;
const notFound = () => Response.json(
  { message: "This album is unavailable or expired. Create the album again." }, { status: 404 },
);
const failure = (status: number, message: string) => Response.json({ message }, { status });

function dailyLimit(value: string | undefined, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : 0;
}

/** One named SQLite Durable Object serializes reservations across every Worker isolate. */
export class DemoStore {
  constructor(
    private storage: DemoStorage,
    private limits: { albums?: string; tracks?: string },
  ) {}

  private remove(key: string, job: Job) {
    for (let part = 0; part < job.parts; part++) this.storage.kv.delete(`data:${key}:${part}`);
    this.storage.kv.delete(`job:${key}`);
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, job] of this.storage.kv.list<Job>({ prefix: "job:" })) {
      if (job.expires <= now) this.remove(key.slice(4), job);
    }
    for (const [key, entry] of this.storage.kv.list<{ expires: number }>({ prefix: "album:" })) {
      if (entry.expires <= now) this.storage.kv.delete(key);
    }
    for (const [key, until] of this.storage.kv.list<number>({ prefix: "ip:" })) {
      if (until <= now) this.storage.kv.delete(key);
    }
    const today = new Date(now).toISOString().slice(0, 10);
    for (const [key] of this.storage.kv.list({ prefix: "day:" })) {
      if (key !== `day:${today}`) this.storage.kv.delete(key);
    }
  }

  async alarm() {
    this.storage.transactionSync(() => this.cleanup());
    await this.scheduleCleanup();
  }

  private async scheduleCleanup() {
    const expires = [...this.storage.kv.list<Job>({ prefix: "job:" })].map(([, job]) => job.expires);
    expires.push(...[...this.storage.kv.list<number>({ prefix: "ip:" })].map(([, until]) => until));
    if (expires.length) await this.storage.setAlarm(Math.min(...expires));
  }

  private read(key: string, job: Job): unknown {
    let data = "";
    for (let part = 0; part < job.parts; part++) {
      const piece = this.storage.kv.get<string>(`data:${key}:${part}`);
      if (piece === undefined) throw new Error("Incomplete hosted cache");
      data += piece;
    }
    return JSON.parse(data);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/usage") {
      const day = new Date().toISOString().slice(0, 10);
      return Response.json({
        day,
        used: this.storage.kv.get<{ album: number; track: number }>(`day:${day}`) ?? { album: 0, track: 0 },
        limits: { album: dailyLimit(this.limits.albums, 100), track: dailyLimit(this.limits.tracks, 400) },
        resetsAt: new Date(Date.parse(day) + 86400_000).toISOString(),
      });
    }
    if (request.method === "GET" && url.pathname === "/album") {
      const id = url.searchParams.get("id") ?? "";
      if (!/^[a-f0-9-]{36}$/.test(id)) return notFound();
      const entry = this.storage.kv.get<{ key: string; expires: number }>(`album:${id}`);
      const job = entry && this.storage.kv.get<Job>(`job:${entry.key}`);
      return entry && entry.expires > Date.now() && job?.status === "ready"
        ? Response.json(this.read(entry.key, job)) : notFound();
    }
    if (request.method !== "POST") return failure(405, "Method not allowed.");
    const body: {
      key?: string; kind?: Kind; lease?: string; value?: unknown;
      error?: { status: number; message: string }; albumId?: string;
      network?: string; blocked?: boolean;
    } = await request.json();
    if (url.pathname === "/access") {
      if (!body.network || !/^[a-f0-9]{64}$/.test(body.network)) return failure(400, "Invalid network key.");
      const key = `ip:${body.network}`;
      const response = this.storage.transactionSync(() => {
        const until = this.storage.kv.get<number>(key);
        if (until && until > Date.now()) return cooldownResponse(until);
        if (body.blocked) {
          const expires = Date.now() + 15 * 60_000;
          this.storage.kv.put(key, expires);
          return cooldownResponse(expires);
        }
        this.storage.kv.delete(key);
        return Response.json({ allowed: true });
      });
      await this.scheduleCleanup();
      return response;
    }
    const { key } = body;
    if (!key || !/^(album:[a-f0-9]{64}|track:[a-f0-9-]{36}:[0-7])$/.test(key)) {
      return failure(400, "Invalid generation key.");
    }
    const response = this.storage.transactionSync(() => {
      this.cleanup();
      const job = this.storage.kv.get<Job>(`job:${key}`);
      if (url.pathname === "/claim") {
        const kind = body.kind;
        if (!kind || !key.startsWith(`${kind}:`)) return failure(400, "Invalid generation kind.");
        if (job?.status === "ready") return Response.json({ cached: this.read(key, job) });
        if (job?.status === "failed") return failure(job.error!.status, job.error!.message);
        if (job) return failure(409, "This request is already generating. Please wait a moment before retrying.");
        const inflight = [...this.storage.kv.list<Job>({ prefix: "job:" })].map(([, entry]) => entry)
          .filter((entry) => entry.kind === kind && entry.status === "pending").length;
        if (inflight >= (kind === "album" ? 2 : 4)) return failure(503, "DrawCover is busy. Please try again later.");
        const day = `day:${new Date().toISOString().slice(0, 10)}`;
        const counts = this.storage.kv.get<{ album: number; track: number }>(day) ?? { album: 0, track: 0 };
        const limit = kind === "album" ? dailyLimit(this.limits.albums, 100) : dailyLimit(this.limits.tracks, 400);
        if (counts[kind] >= limit) {
          const retryAfterSeconds = Math.ceil((Date.parse(new Date(Date.now() + 86400_000).toISOString().slice(0, 10)) - Date.now()) / 1000);
          return Response.json({
            message: "The public demo has reached today's generation limit. Please return after 00:00 UTC.",
            reason: "daily_limit", retryAfterSeconds,
          }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } });
        }
        counts[kind]++;
        this.storage.kv.put(day, counts);
        const lease = crypto.randomUUID();
        this.storage.kv.put(`job:${key}`, {
          kind, status: "pending", lease, expires: Date.now() + LEASE_TTL, parts: 0,
        } satisfies Job);
        return Response.json({ lease });
      }
      if (url.pathname !== "/complete" && url.pathname !== "/fail") return failure(404, "Not found.");
      if (!job || job.status !== "pending" || job.lease !== body.lease) {
        return failure(409, "The generation reservation has expired. Please try again.");
      }
      if (url.pathname === "/fail") {
        job.status = "failed";
        job.error = body.error ?? { status: 502, message: "Generation failed. Please try again later." };
        job.expires = Date.now() + FAILURE_TTL;
      } else {
        const data = JSON.stringify(body.value);
        if (!data || data.length > MAX_STORED_CHARS) return failure(502, "Generated result was too large.");
        job.parts = Math.ceil(data.length / CHUNK_SIZE);
        for (let part = 0; part < job.parts; part++) {
          this.storage.kv.put(`data:${key}:${part}`, data.slice(part * CHUNK_SIZE, (part + 1) * CHUNK_SIZE));
        }
        job.status = "ready";
        job.expires = Date.now() + TTL;
        if (job.kind === "album" && body.albumId && /^[a-f0-9-]{36}$/.test(body.albumId)) {
          this.storage.kv.put(`album:${body.albumId}`, { key, expires: job.expires });
        }
      }
      this.storage.kv.put(`job:${key}`, job);
      return Response.json({ ok: true });
    });
    await this.scheduleCleanup();
    return response;
  }
}
