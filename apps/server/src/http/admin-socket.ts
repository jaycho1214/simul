import type { AdminMessage } from "@simul/protocol";
import type { Clock, TimerHandle } from "../clock.ts";
import type { LaneManager } from "../lane/lane-manager.ts";
import type { StreamRoute } from "./stream-route.ts";

export interface AdminWebSocket {
  send(data: string): void;
  on(event: "close", fn: () => void): void;
}

const PUSH_INTERVAL_MS = 1000;

/** Pushes a lane table to the operator dashboard once a second. */
export class AdminSocket {
  private readonly clients = new Set<AdminWebSocket>();
  private timer: TimerHandle | undefined;

  constructor(
    private readonly opts: {
      manager: LaneManager;
      streamRoute: StreamRoute;
      clock: Clock;
    },
  ) {}

  handleConnection(ws: AdminWebSocket): void {
    this.clients.add(ws);
    ws.on("close", () => {
      this.clients.delete(ws);
      if (this.clients.size === 0) this.stop();
    });
    this.push();
    this.schedule();
  }

  stop(): void {
    if (this.timer) {
      this.opts.clock.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private schedule(): void {
    if (this.timer || this.clients.size === 0) return;
    this.timer = this.opts.clock.setTimeout(() => {
      this.timer = undefined;
      this.push();
      this.schedule();
    }, PUSH_INTERVAL_MS);
  }

  private push(): void {
    const lanes = this.opts.manager.statuses().map((status) => ({
      ...status,
      listenerDrops: this.opts.streamRoute.listenerDrops(status.lang),
    }));
    const message: AdminMessage = { type: "lanes", lanes, usage: this.opts.manager.usage() };
    const payload = JSON.stringify(message);

    for (const ws of this.clients) {
      try {
        ws.send(payload);
      } catch {
        this.clients.delete(ws);
      }
    }
  }
}
