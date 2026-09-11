import { useSyncExternalStore } from "react";
import { AppLog, type AppLogLine } from "../app-log/app-log.ts";

/** One log per window, like captureController. */
export const appLog = new AppLog();

export function useAppLog(): readonly AppLogLine[] {
  return useSyncExternalStore(
    (fn) => appLog.subscribe(fn),
    () => appLog.getSnapshot(),
    () => appLog.getSnapshot(),
  );
}
