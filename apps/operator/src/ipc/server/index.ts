import { os } from "@orpc/server";
import { supervisor } from "../../main.ts";
import type { LogLine, ServerStatus } from "../../server-host/server-supervisor.ts";

export const status = os.handler((): ServerStatus => supervisor.status);

/**
 * Polled by the 서버 로그 panel rather than pushed: the supervisor already
 * bounds this to MAX_LOG_LINES, so re-sending the whole snapshot every second
 * is cheap and avoids adding a second push channel next to the oRPC
 * request/response bridge the rest of this app uses.
 */
export const logs = os.handler((): LogLine[] => supervisor.logs.slice());

export const start = os.handler((): ServerStatus => {
  supervisor.start();
  return supervisor.status;
});

export const stop = os.handler(async (): Promise<ServerStatus> => {
  await supervisor.stop();
  return supervisor.status;
});

export const restart = os.handler((): ServerStatus => {
  supervisor.restart();
  return supervisor.status;
});
