import type { ServerResponse } from "node:http";
import type { LangCode } from "@tongyeok/protocol";
import { LaneCapError, UnknownLanguageError, type LaneManager } from "../lane/lane-manager.ts";

/** Roughly 2.5 s of Opus. Past this a client is dropped from, not buffered for. */
const DEFAULT_MAX_BUFFERED = 64 * 1024;

/**
 * Serves `GET /stream/<lang>.webm`: the init segment once, then live
 * clusters for as long as the client stays connected. The response object
 * is the subscription identity — one open HTTP stream maps to exactly one
 * `LaneManager` refcount entry.
 */
export class StreamRoute {
  private readonly drops = new Map<LangCode, number>();
  private readonly maxBuffered: number;

  constructor(private readonly opts: { manager: LaneManager; maxBufferedBytes?: number }) {
    this.maxBuffered = opts.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED;
  }

  listenerDrops(lang: LangCode): number {
    return this.drops.get(lang) ?? 0;
  }

  async handle(res: ServerResponse, lang: LangCode): Promise<void> {
    // The response object itself is the subscription identity, so refcounting
    // matches exactly one open HTTP stream.
    const subscriber = res;

    let lane;
    try {
      lane = await this.opts.manager.acquire(lang, subscriber);
    } catch (err) {
      if (err instanceof UnknownLanguageError) {
        this.respondError(res, 404, "알 수 없는 언어입니다 / Unknown language");
        return;
      }
      if (err instanceof LaneCapError) {
        this.respondError(res, 503, "이 언어는 지금 사용할 수 없습니다 / This language is unavailable right now");
        return;
      }
      // Anything else (e.g. the manager has been closed) still must not
      // escape as a rejected promise: the HTTP server wires this handler as
      // `void streamRoute.handle(res, lang)` and never awaits or catches
      // it, so an uncaught rejection here leaves the client hanging with no
      // response and risks taking the whole process down over one request.
      console.error(`stream route: unexpected error acquiring lane "${lang}"`, err);
      this.respondError(res, 500, "서버 오류입니다 / Internal server error");
      return;
    }

    // From here on the lane is acquired and MUST eventually be released
    // exactly once. `release` is idempotent on the manager's side (it's a
    // Set.delete guarded by a "grace timer already pending" check), so the
    // only real risk is never calling it at all — e.g. if something throws
    // between acquiring and registering the "close" handler that would
    // normally do it, which would otherwise leak a live (and, for a
    // translated lane, billing) Gemini session for the rest of the event.
    try {
      res.writeHead(200, {
        "content-type": "audio/webm",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
      });
      res.write(lane.initSegment);

      const unsubscribe = lane.subscribeClusters((cluster) => {
        if (res.writableLength > this.maxBuffered) {
          this.drops.set(lang, this.listenerDrops(lang) + 1);
          return;
        }
        res.write(cluster);
      });

      res.on("close", () => {
        unsubscribe();
        this.opts.manager.release(lang, subscriber);
      });
    } catch (err) {
      this.opts.manager.release(lang, subscriber);
      console.error(`stream route: failed to start streaming lane "${lang}"`, err);
      try {
        if (!res.headersSent) {
          this.respondError(res, 500, "서버 오류입니다 / Internal server error");
        } else {
          res.end();
        }
      } catch {
        // The response is already unusable; releasing the lane above is
        // the part that actually matters here.
      }
    }
  }

  private respondError(res: ServerResponse, status: number, message: string): void {
    res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
    res.end(message);
  }
}
