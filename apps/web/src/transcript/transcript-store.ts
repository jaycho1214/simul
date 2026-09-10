import type {
  LaneState,
  ServerMessage,
  TranscriptLine,
} from "@tongyeok/protocol";

/**
 * The spec caps the transcript DOM at ~50 visible lines. Truncating here rather
 * than in the component means React never renders more than this, no matter how
 * long the event runs.
 */
export const MAX_VISIBLE_LINES = 50;

export interface TranscriptError {
  code: "lane_cap" | "unknown_language";
  message: string;
}

export interface TranscriptState {
  /** Finalised lines, oldest first, at most MAX_VISIBLE_LINES of them. */
  lines: TranscriptLine[];
  /** The in-flight line, rendered lighter until it commits. */
  interim: TranscriptLine | null;
  laneState: LaneState | "connecting";
  error: TranscriptError | null;
}

export const initialTranscriptState: TranscriptState = {
  lines: [],
  interim: null,
  laneState: "connecting",
  error: null,
};

export type TranscriptAction =
  | { kind: "message"; message: ServerMessage }
  | { kind: "socket"; open: boolean }
  | { kind: "reset" };

export function applyServerMessage(
  state: TranscriptState,
  message: ServerMessage,
): TranscriptState {
  switch (message.type) {
    case "hello":
      // A fresh connection. Whatever error or half-line the previous one left
      // behind is no longer true.
      return { ...state, error: null, interim: null };

    case "history":
      // History is authoritative for this connection, so it replaces rather
      // than merges. That is what makes it safe to run this on every replay
      // (e.g. a backgrounded phone waking up) without duplicating lines that
      // were already shown live.
      return {
        ...state,
        lines: message.lines.slice(-MAX_VISIBLE_LINES),
        interim: null,
      };

    case "transcript": {
      const line = message.line;
      if (!line.isFinal) return { ...state, interim: line };
      if (state.lines.some((l) => l.seq === line.seq)) {
        return { ...state, interim: null };
      }
      return {
        ...state,
        lines: [...state.lines, line].slice(-MAX_VISIBLE_LINES),
        interim: null,
      };
    }

    case "lane":
      return { ...state, laneState: message.state };

    case "error":
      return {
        ...state,
        error: { code: message.code, message: message.message },
      };
  }
}

export function transcriptReducer(
  state: TranscriptState,
  action: TranscriptAction,
): TranscriptState {
  switch (action.kind) {
    case "reset":
      return initialTranscriptState;
    case "socket":
      // An open socket says nothing about the lane; the server sends a `lane`
      // message right after `hello`. A closed one does: we are not receiving.
      return action.open
        ? state
        : { ...state, laneState: "connecting", interim: null };
    case "message":
      return applyServerMessage(state, action.message);
  }
}
