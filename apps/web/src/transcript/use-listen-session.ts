import type { ServerMessage } from "@tongyeok/protocol";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { DelayQueue } from "./delay-queue.ts";
import { ListenClient } from "./listen-client.ts";
import {
  initialTranscriptState,
  transcriptReducer,
  type TranscriptState,
} from "./transcript-store.ts";

export interface ListenSession {
  state: TranscriptState;
  /** Reconnect after a fatal `error` message; wired to the banner's retry. */
  retry: () => void;
}

export function useListenSession(opts: {
  lang: string;
  wsBaseUrl: string;
  transcriptDelayMs: number;
}): ListenSession {
  const [state, dispatch] = useReducer(transcriptReducer, initialTranscriptState);
  const clientRef = useRef<ListenClient | null>(null);

  useEffect(() => {
    // Each mount is a fresh language: any lines left over from a previous
    // session (or, in StrictMode dev, the previous invocation of this same
    // effect) must not linger on screen while the new socket connects.
    dispatch({ kind: "reset" });

    const queue = new DelayQueue<ServerMessage>(opts.transcriptDelayMs, (message) => {
      dispatch({ kind: "message", message });
    });

    const client = new ListenClient({
      lang: opts.lang,
      wsBaseUrl: opts.wsBaseUrl,
      onMessage: (message) => {
        // Only live transcript lines are held back — the fixed delay exists to
        // stop text running ahead of the <audio> buffer. History and state
        // messages are structural and land at once.
        if (message.type === "transcript") {
          queue.push(message);
          return;
        }
        if (message.type === "history") {
          // A replayed history is authoritative, so anything still waiting out
          // the delay is stale by definition.
          queue.clear();
        }
        dispatch({ kind: "message", message });
      },
      onStatus: (status) => {
        dispatch({ kind: "socket", open: status === "open" });
      },
    });

    clientRef.current = client;
    client.start();

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") client.onHidden();
      else client.onVisible();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      client.stop();
      queue.clear();
      clientRef.current = null;
    };
  }, [opts.lang, opts.wsBaseUrl, opts.transcriptDelayMs]);

  const retry = useCallback(() => {
    clientRef.current?.start();
  }, []);

  return { state, retry };
}
