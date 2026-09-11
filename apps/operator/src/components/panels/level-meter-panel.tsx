import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/utils/tailwind";
import { MAX_GAIN_DB, MIN_GAIN_DB, clampGainDb } from "../../capture/gain.ts";
import { captureController, useCapture } from "../../hooks/use-capture.ts";
import { ipc } from "../../ipc/manager.ts";

/** Maps -60..0 dBFS onto 0..100 % of the bar. */
function widthPercent(db: number): number {
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

/**
 * Where the bar changes colour. A translation feed wants a healthy average
 * well below full scale; the amber band marks where a hot signal starts to
 * cost intelligibility, the red band where it will clip.
 */
const AMBER_FROM_DB = -12;
const RED_FROM_DB = -6;

/** Tick labels along the scale. */
const TICKS = [-60, -40, -20, -12, -6, 0];

/**
 * How long after the slider stops moving the value is written to settings.
 * The trim itself is applied on every movement — that is the point of a
 * slider — but a drag fires dozens of events, and each write is a file.
 */
const GAIN_SAVE_DELAY_MS = 300;

/**
 * The trim under the meter. Every movement reaches the GainNode at once, so
 * the bar above answers the slider live; the setting is saved once the hand
 * comes to rest. The saved value is what the next start() opens with.
 */
function GainControl() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => ipc.client.settings.get() });
  const saved = settings.data?.inputGainDb;
  const [draft, setDraft] = useState<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** A value applied to the graph but not yet written; flushed on unmount. */
  const unsaved = useRef<number | null>(null);

  useEffect(() => {
    if (saved !== undefined && draft === null) setDraft(saved);
  }, [saved, draft]);

  function save(db: number) {
    unsaved.current = null;
    void ipc.client.settings
      .set({ inputGainDb: db })
      .then(() => queryClient.invalidateQueries({ queryKey: ["settings"] }));
  }

  // Leaving the section inside the delay must not lose the last movement:
  // the graph already has it, and a restart would otherwise open at the
  // value before it.
  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
      if (unsaved.current !== null) save(unsaved.current);
    },
    [],
  );

  function apply(db: number) {
    const next = clampGainDb(db);
    setDraft(next);
    captureController.setGainDb(next);
    unsaved.current = next;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(next), GAIN_SAVE_DELAY_MS);
  }

  const db = draft ?? 0;

  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-sm font-medium" htmlFor="input-gain">
          {t("level.gain")}
        </label>
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm tabular-nums">
            {db > 0 ? "+" : ""}
            {db.toFixed(1)} dB
          </span>
          <Button variant="ghost" size="xs" disabled={db === 0} onClick={() => apply(0)}>
            {t("level.gainReset")}
          </Button>
        </span>
      </div>
      <input
        id="input-gain"
        type="range"
        min={MIN_GAIN_DB}
        max={MAX_GAIN_DB}
        step={0.5}
        value={db}
        disabled={draft === null}
        onChange={(e) => apply(Number(e.target.value))}
        className="w-full accent-live"
      />
      <p className="text-xs leading-snug text-muted-foreground">{t("level.gainHint")}</p>
    </div>
  );
}

export function LevelMeterPanel() {
  const { t } = useTranslation();
  const { running } = useCapture();
  const coverRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const clipRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    // Hold the clip indicator for a second so a single sample is not missed.
    let clipUntil = 0;

    const tick = () => {
      const level = captureController.readLevel();
      // The zones are painted at full width underneath; the fill is revealed
      // by shrinking a cover from the right, so the colour under any point of
      // the bar is fixed to its level rather than stretching with the signal.
      if (coverRef.current) {
        coverRef.current.style.width = `${100 - widthPercent(level.rmsDb)}%`;
      }
      if (peakRef.current) peakRef.current.style.left = `${widthPercent(level.peakDb)}%`;
      if (readoutRef.current) {
        readoutRef.current.textContent = `${level.rmsDb.toFixed(1)} / ${level.peakDb.toFixed(1)} dBFS`;
      }
      if (level.clipping) clipUntil = performance.now() + 1000;
      if (clipRef.current) {
        clipRef.current.style.visibility = performance.now() < clipUntil ? "visible" : "hidden";
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      if (coverRef.current) coverRef.current.style.width = "100%";
      if (peakRef.current) peakRef.current.style.left = "0%";
      if (clipRef.current) clipRef.current.style.visibility = "hidden";
    };
  }, [running]);

  const zones = `linear-gradient(90deg, var(--live) 0 ${widthPercent(AMBER_FROM_DB)}%, var(--warn) ${widthPercent(AMBER_FROM_DB)}% ${widthPercent(RED_FROM_DB)}%, var(--error) ${widthPercent(RED_FROM_DB)}% 100%)`;

  return (
    <Panel
      title={t("panel.level")}
      aside={
        <span
          ref={clipRef}
          className="rounded-sm bg-error px-1.5 py-0.5 text-[11px] leading-none font-bold text-white"
          style={{ visibility: "hidden" }}
        >
          {t("level.clipping")}
        </span>
      }
    >
      <div className="grid gap-1.5">
        <div className="relative h-12 w-full overflow-hidden rounded-md bg-inset">
          <div className="absolute inset-0 opacity-90" style={{ background: zones }} />
          <div
            ref={coverRef}
            className="absolute inset-y-0 right-0 bg-inset"
            style={{ width: "100%" }}
          />
          {/* Zone boundaries stay visible through the cover so the engineer
              can see where amber and red begin even with no signal. */}
          {[AMBER_FROM_DB, RED_FROM_DB].map((db) => (
            <div
              key={db}
              className="absolute inset-y-0 w-px bg-foreground/15"
              style={{ left: `${widthPercent(db)}%` }}
            />
          ))}
          <div
            ref={peakRef}
            className={cn("absolute top-0 h-full w-0.5 bg-foreground", !running && "hidden")}
            style={{ left: "0%" }}
          />
        </div>

        <div className="relative h-4 font-mono text-[10px] text-muted-foreground tabular-nums">
          {TICKS.map((db, i) => (
            <span
              key={db}
              className="absolute top-0"
              style={{
                left: `${widthPercent(db)}%`,
                transform:
                  i === 0
                    ? "none"
                    : i === TICKS.length - 1
                      ? "translateX(-100%)"
                      : "translateX(-50%)",
              }}
            >
              {db}
            </span>
          ))}
        </div>
      </div>

      {/* The number the engineer actually reads, sized for a glance from
          the other end of the desk. */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {t("level.rms")} / {t("level.peak")}
        </span>
        <span
          ref={readoutRef}
          className={cn(
            "font-mono text-2xl font-medium tabular-nums",
            !running && "text-base text-muted-foreground",
          )}
        >
          {running ? "" : t("level.idle")}
        </span>
      </div>

      <GainControl />
    </Panel>
  );
}
