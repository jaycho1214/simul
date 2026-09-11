import type { LaneStatus } from "@simul/protocol";
import {
  ReconnectingSocket,
  type ConnectionState,
  type SocketFactory,
} from "../net/reconnecting-socket.ts";
import { anyExternalListener } from "./lane-row.ts";
import { parseAdminMessage } from "./parse-admin-message.ts";

/**
 * Spec: ws://localhost:8080/admin. Always localhost — this is not a LAN feed.
 * Unlike /ingest, /admin takes no token and the server never closes it with a
 * special code, so the default always-retry backoff (no `shouldReconnect`
 * override) is correct here.
 */
export function adminUrl(port: number): string {
  return `ws://localhost:${port}/admin`;
}

export interface AdminSnapshot {
  state: ConnectionState;
  lanes: LaneStatus[];
  /** Latches true the first time any lane reports a listener. */
  externalListenerSeen: boolean;
}

export interface AdminClientOptions {
  url: string;
  factory: SocketFactory;
  schedule?: (fn: () => void, ms: number) => () => void;
}

/**
 * Wraps the `/admin` feed: parses each frame defensively and keeps the last
 * good lane table on anything malformed, so one bad second never blanks the
 * dashboard mid-event.
 */
export class AdminClient {
  private readonly socket: ReconnectingSocket;
  private readonly listeners = new Set<(snapshot: AdminSnapshot) => void>();
  private snapshot: AdminSnapshot = {
    state: "idle",
    lanes: [],
    externalListenerSeen: false,
  };

  constructor(opts: AdminClientOptions) {
    this.socket = new ReconnectingSocket({
      url: opts.url,
      factory: opts.factory,
      ...(opts.schedule ? { schedule: opts.schedule } : {}),
    });

    // Registered synchronously in the constructor, before start() is ever
    // called — there is no await between acquiring the socket and wiring its
    // events, so no push in that window can be lost.
    this.socket.onState((state) => this.emit({ state }));
    this.socket.onMessage((data) => {
      const message = parseAdminMessage(data);
      if (!message) return; // malformed frame: keep the last good table
      this.emit({
        lanes: message.lanes,
        externalListenerSeen:
          this.snapshot.externalListenerSeen || anyExternalListener(message.lanes),
      });
    });
  }

  get lanes(): LaneStatus[] {
    return this.snapshot.lanes;
  }

  get state(): ConnectionState {
    return this.snapshot.state;
  }

  getSnapshot(): AdminSnapshot {
    return this.snapshot;
  }

  subscribe(fn: (snapshot: AdminSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  start(): void {
    this.socket.start();
  }

  stop(): void {
    this.socket.stop();
  }

  private emit(patch: Partial<AdminSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const fn of this.listeners) {
      try {
        fn(this.snapshot);
      } catch (err) {
        console.error("admin snapshot listener threw", err);
      }
    }
  }
}
