import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/utils/tailwind";
import { useAppLog } from "../../hooks/use-app-log.ts";
import { ipc } from "../../ipc/manager.ts";

type Tab = "server" | "app";

/** A line either tab can render: red for stderr or an error, plain otherwise. */
interface Row {
  key: string;
  text: string;
  alarm: boolean;
  at: number;
}

const time = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/**
 * The sixth surface, beyond the spec's five panels: the engineer launches one
 * app and has no terminal to read anything from, so this panel is where both
 * processes say what happened. Two tabs: 서버 is the forked server's stdout
 * and stderr (ServerSupervisor captures it, plus the main process's own notes
 * — update checks, restarts); 앱 is this window's log — capture starts and
 * stops, what the device actually opened at, every capture error with its
 * name, the ingest socket's comings and goings. The second tab exists
 * because a failed 시작 used to leave no trace anywhere an engineer would
 * look. A plain, fixed-height scroll region rather than a drawer: a crash
 * line must not be one click away from missed.
 */
export function ServerLogPanel() {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>("server");

  const serverLogs = useQuery({
    queryKey: ["serverLogs"],
    // Polled like server.status, rather than pushed: the supervisor already
    // bounds this to MAX_LOG_LINES, so re-sending the snapshot every second
    // is cheap and needs no second IPC channel next to oRPC's bridge.
    queryFn: () => ipc.client.server.logs(),
    refetchInterval: 1000,
  });
  const appLines = useAppLog();

  const rows: Row[] =
    tab === "server"
      ? (serverLogs.data ?? []).map((line, i) => ({
          key: `${line.at}-${i}`,
          text: line.text,
          alarm: line.stream === "stderr",
          at: line.at,
        }))
      : appLines.map((line, i) => ({
          key: `${line.at}-${i}`,
          text: line.text,
          alarm: line.level === "error",
          at: line.at,
        }));

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length, tab]);

  const appErrors = appLines.filter((line) => line.level === "error").length;

  return (
    <Panel
      title={t("serverLog.title")}
      aside={
        <div role="tablist" className="flex gap-1 rounded-md bg-inset p-0.5">
          {(["server", "app"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "inline-flex h-6 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors",
                tab === id
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(id === "server" ? "serverLog.tabServer" : "serverLog.tabApp")}
              {id === "app" && appErrors > 0 ? (
                <span className="rounded-sm bg-error px-1 text-[10px] leading-4 font-bold text-white">
                  {appErrors}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      }
    >
      <div
        ref={scrollRef}
        className="h-52 overflow-y-auto rounded-md bg-inset px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap"
      >
        {rows.length === 0 ? (
          <p className="text-muted-foreground">{t("serverLog.empty")}</p>
        ) : (
          rows.map((row) => (
            <div key={row.key} className={row.alarm ? "text-error" : "text-foreground/85"}>
              {tab === "app" ? (
                <span className="text-muted-foreground">{time.format(row.at)} </span>
              ) : null}
              {row.text}
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}
