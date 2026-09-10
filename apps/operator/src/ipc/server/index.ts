import { os } from "@orpc/server";
import { supervisor } from "../../main.ts";
import type { ServerStatus } from "../../server-host/server-supervisor.ts";

export const status = os.handler((): ServerStatus => supervisor.status);

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
