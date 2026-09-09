import type { LangCode, ServerMessage } from "@tongyeok/protocol";
import { LaneCapError, UnknownLanguageError, type LaneManager } from "../lane/lane-manager.ts";

export interface ListenWebSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "close", fn: () => void): void;
}

/**
 * There is no WebSocket status-code equivalent to picking an HTTP status:
 * the client just gets a close frame. 1011 is RFC 6455's own "server
 * encountered an unexpected condition" code — the closest thing to the
 * stream route's 500 for a rejection that is neither UnknownLanguageError
 * nor LaneCapError.
 */
const INTERNAL_ERROR_CLOSE_CODE = 1011;

/**
 * Serves `ws://host:8080/listen?lang=<code>`: bilingual JSON messages only,
 * never audio. The WebSocket connection *is* the lane subscription — a
 * listener who mutes their phone but keeps the page open must keep the lane
 * alive, exactly like `StreamRoute`'s response object for the audio side.
 */
export class ListenSocket {
  constructor(private readonly opts: { manager: LaneManager }) {}

  async handleConnection(ws: ListenWebSocket, lang: LangCode): Promise<void> {
    const send = (message: ServerMessage) => {
      try {
        ws.send(JSON.stringify(message));
      } catch {
        // The socket died mid-write; the close handler below still runs and
        // releases the lane.
      }
    };

    const subscriber = ws;
    let offTranscript: (() => void) | undefined;

    // Registered before acquire() is even awaited, not after it resolves.
    // Opening a translated lane is real network I/O (spinning up a Gemini
    // session), so a listener can disconnect while that is still in flight.
    // LaneManager.release() is built to accept a release for a subscriber
    // whose acquire() hasn't resolved yet — it records the release against
    // that specific in-flight open and reconciles it once the open settles
    // — so calling it unconditionally here, even before `lane` exists, is
    // safe. Registering this handler only after acquire() resolved would
    // miss a close that happened during the wait entirely (an EventEmitter
    // does not replay past events to a listener added late), leaking a
    // live, billing Gemini session for the rest of the event — the exact
    // bug two earlier tasks in this plan shipped.
    ws.on("close", () => {
      offTranscript?.();
      this.opts.manager.release(lang, subscriber);
    });

    let lane;
    try {
      lane = await this.opts.manager.acquire(lang, subscriber);
    } catch (err) {
      if (err instanceof UnknownLanguageError) {
        send({
          type: "error",
          code: "unknown_language",
          message: "알 수 없는 언어입니다 / Unknown language",
        });
        ws.close(4404, "unknown language");
        return;
      }
      if (err instanceof LaneCapError) {
        send({
          type: "error",
          code: "lane_cap",
          message: "이 언어는 지금 사용할 수 없습니다 / This language is unavailable right now",
        });
        ws.close(4503, "lane cap");
        return;
      }
      // Anything else (e.g. the manager has been closed) must still not
      // escape as a rejected promise: nothing awaits this method's result
      // from the WebSocket server's upgrade handler, so an uncaught
      // rejection here would leave the attendee connected with no lane, no
      // explanation, and no way to know anything went wrong.
      console.error(`listen socket: unexpected error acquiring lane "${lang}"`, err);
      ws.close(INTERNAL_ERROR_CLOSE_CODE, "서버 오류입니다 / Internal server error");
      return;
    }

    const history = lane.transcripts.history();
    send({ type: "hello", lang, historyLines: history.length });
    send({ type: "history", lines: history });
    send({ type: "lane", state: lane.state });

    offTranscript = lane.transcripts.subscribe((line) => {
      send({ type: "transcript", line });
    });
  }
}
