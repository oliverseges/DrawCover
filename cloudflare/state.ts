import type { DurableObjectState } from "@cloudflare/workers-types";
import { DemoStore } from "./demo-store";

export class DrawCoverState {
  private store: DemoStore;

  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    this.store = new DemoStore(ctx.storage, {
      albums: env.DRAWCOVER_DAILY_ALBUM_LIMIT,
      tracks: env.DRAWCOVER_DAILY_TRACK_LIMIT,
    });
  }

  fetch(request: Request) {
    return this.store.fetch(request);
  }

  alarm() {
    return this.store.alarm();
  }
}
