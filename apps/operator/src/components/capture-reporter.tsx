import type { TFunction } from "i18next";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { captureEvents } from "../capture/capture-events.ts";
import { captureErrorHint } from "../capture/capture-errors.ts";
import type { CaptureError, CaptureSnapshot } from "../capture/capture-controller.ts";
import { appLog } from "../hooks/use-app-log.ts";
import { captureController } from "../hooks/use-capture.ts";

/** The one sentence for a capture error, in the window's language. */
export function captureErrorText(t: TFunction, error: CaptureError): string {
  // CaptureError is a union with one string-table entry per `code`:
  // error.deviceOpenFailed / deviceLost / workletFailed, each taking the
  // error's own fields (name, reason) as its placeholders.
  return t(`error.${error.code}`, error as unknown as Record<string, string>);
}

/**
 * Renders nothing. Turns capture transitions into log lines and, for
 * anything that went wrong, a toast — so a failed 시작 is seen from whichever
 * section the engineer is on, not only as a dot on the rail. Mounted once,
 * in the layout, so the subscription outlives section changes.
 */
export function CaptureReporter() {
  const { t } = useTranslation();

  useEffect(() => {
    let prev: CaptureSnapshot = captureController.getSnapshot();
    // A server that is down makes the ingest socket cycle connecting →
    // reconnecting once a second. One line says that; sixty do not.
    let lastIngestLogged: string | undefined;
    return captureController.subscribe((next) => {
      for (const event of captureEvents(prev, next)) {
        switch (event.type) {
          case "started":
            appLog.info(
              event.report
                ? t("log.captureStarted", {
                    requested: event.report.requestedChannelCount,
                    achieved: event.report.achievedChannelCount,
                    channel: event.report.selectedChannelIndex + 1,
                    device: event.report.deviceSampleRate ?? 0,
                    processed: event.report.contextSampleRate,
                  })
                : t("log.captureStartedNoReport"),
            );
            break;
          case "stopped":
            appLog.info(t("log.captureStopped"));
            break;
          case "error": {
            const message = captureErrorText(t, event.error);
            const hint =
              event.error.code === "deviceOpenFailed"
                ? captureErrorHint(event.error.name)
                : undefined;
            appLog.error(t("log.captureError", { message }));
            if (hint) appLog.error(t(`hint.${hint}`));
            toast.error(message, {
              description: hint ? t(`hint.${hint}`) : undefined,
              duration: 15_000,
            });
            break;
          }
          case "ingest": {
            // connecting ↔ reconnecting is one retry loop: its first failure
            // and its eventual success are news, the attempts between are not.
            if (event.state === "connecting") {
              if (lastIngestLogged === undefined) appLog.info(t("log.ingest_connecting"));
            } else if (event.state === "reconnecting") {
              if (lastIngestLogged !== "reconnecting") appLog.error(t("log.ingest_reconnecting"));
              // Only a connection that was up and went away is worth a toast;
              // one that never opened is the server not running, which 제어
              // already says in red.
              if (event.from === "open") toast.warning(t("error.ingestDisconnected"));
            } else {
              appLog.info(t(`log.ingest_${event.state}`));
            }
            if (!(event.state === "connecting" && lastIngestLogged === "reconnecting")) {
              lastIngestLogged = event.state;
            }
            break;
          }
        }
      }
      prev = next;
    });
  }, [t]);

  return null;
}
