import { useSyncExternalStore } from "react";
import { CaptureController, type CaptureSnapshot } from "../capture/capture-controller.ts";

/** One controller per window. The audio graph is a singleton by nature. */
export const captureController = new CaptureController();

export function useCapture(): CaptureSnapshot {
  return useSyncExternalStore(
    (fn) => captureController.subscribe(fn),
    () => captureController.getSnapshot(),
    () => captureController.getSnapshot(),
  );
}
