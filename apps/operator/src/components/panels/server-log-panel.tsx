import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/ui/panel";
import { ipc } from "../../ipc/manager.ts";

/**
 * The sixth surface, beyond the spec's five panels: the engineer launches one
 * app and has no terminal to read the forked server's console output from, so
 * ServerSupervisor (Task 7) captures it and this panel renders it. A plain
 * always-visible, fixed-height scroll region rather than a collapsible drawer
 * — a crash line is exactly the kind of thing that must not be one click away
 * from missed, and the bounded height keeps it from pushing the other five
 * panels around.
 */
export function ServerLogPanel() {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const logs = useQuery({
    queryKey: ["serverLogs"],
    // Polled like server.status above, rather than pushed: the supervisor
    // already bounds this to MAX_LOG_LINES, so re-sending the snapshot every
    // second is cheap and needs no second IPC channel next to oRPC's
    // request/response bridge.
    queryFn: () => ipc.client.server.logs(),
    refetchInterval: 1000,
  });

  const lines = logs.data ?? [];

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <Panel title={t("serverLog.title")}>
      <div
        ref={scrollRef}
        className="h-52 overflow-y-auto rounded-md bg-inset px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap"
      >
        {lines.length === 0 ? (
          <p className="text-muted-foreground">{t("serverLog.empty")}</p>
        ) : (
          lines.map((line, index) => (
            <div
              key={`${line.at}-${index}`}
              className={line.stream === "stderr" ? "text-error" : "text-foreground/85"}
            >
              {line.text}
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}
