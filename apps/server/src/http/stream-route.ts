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
    let unsubscribe: (() => void) | undefined;
    /**
     * Whether this client is still connected. The close handler below can
     * fire during the `await` on acquire(), in which case the `unsubscribe`
     * handle it reaches for does not exist yet: it unsubscribes nothing, and
     * the subscribe path further down then registers a cluster callback into
     * a lane that will hold it — and this response object with it — for as
     * long as the lane lives, writing into a socket that is already gone.
     * Re-reading this flag after the await is what closes the window;
     * nothing between the check and the subscription awaits, so nothing can
     * slip between them.
     */
    let live = true;

    // Registered before acquire() is even awaited, not after it resolves.
    // Opening a translated lane is real network I/O (spinning up a Gemini
    // session), so a client can abort — lock their phone, navigate away,
    // switch languages — while that is still in flight. LaneManager.release()
    // is built to accept a release for a subscriber whose acquire() hasn't
    // resolved yet: it records the release against that specific in-flight
    // open (and is a documented no-op if there's neither an open nor an
    // entry to record it against, e.g. acquire() is about to reject) and
    // reconciles it once the open settles. Calling it unconditionally here,
    // even before `lane` exists, is therefore always safe. Registering this
    // handler only after acquire() resolved would miss a close that happened
    // during the wait entirely — an EventEmitter does not replay past events
    // to a listener added late — leaking a live, billing Gemini session for
    // the rest of the event.
    res.on("close", () => {
      live = false;
      unsubscribe?.();
      this.opts.manager.release(lang, subscriber);
    });

    let lane;
    try {
      lane = await this.opts.manager.acquire(lang, subscriber, "audio");
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
    // exactly once. The "close" handler registered above already covers the
    // normal case — it fires once this response finishes, however that
    // happens — but `release` is idempotent on the manager's side (a
    // Set.delete guarded by a "grace timer already pending" check), so
    // releasing again right here too, if setup itself fails, costs nothing
    // and closes the gap for a response object left in some state where
    // "close" is not reliably guaranteed to fire at all.
    // The client left while the lane was opening. Their release is already
    // recorded (see the close handler above); all that is left is to write
    // nothing to a response that is gone, and above all to subscribe nothing
    // on its behalf.
    if (!live) return;

    try {
      res.writeHead(200, {
        "content-type": "audio/webm",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
      });
      res.write(lane.initSegment);

      unsubscribe = lane.subscribeClusters((cluster) => {
        if (res.writableLength > this.maxBuffered) {
          this.drops.set(lang, this.listenerDrops(lang) + 1);
          return;
        }
        res.write(cluster);
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
