import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { captureController, useCapture } from "../../hooks/use-capture.ts";

/** Maps -60..0 dBFS onto 0..100 % of the bar. */
function widthPercent(db: number): number {
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

export function LevelMeterPanel() {
  const { t } = useTranslation();
  const { running } = useCapture();
  const rmsRef = useRef<HTMLDivElement>(null);
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
      if (rmsRef.current) rmsRef.current.style.width = `${widthPercent(level.rmsDb)}%`;
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
    return () => cancelAnimationFrame(frame);
  }, [running]);

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-3 text-lg font-semibold">{t("panel.level")}</h2>

      <div className="relative h-8 w-full overflow-hidden rounded bg-neutral-200">
        <div ref={rmsRef} className="h-full bg-emerald-500" style={{ width: "0%" }} />
        <div
          ref={peakRef}
          className="absolute top-0 h-full w-0.5 bg-neutral-900"
          style={{ left: "0%" }}
        />
      </div>

      <div className="mt-2 flex items-baseline justify-between text-sm">
        <span>
          {t("level.rms")} / {t("level.peak")}
        </span>
        <span ref={readoutRef} className="font-mono">
          {running ? "" : t("level.idle")}
        </span>
        <span ref={clipRef} className="font-semibold text-red-600" style={{ visibility: "hidden" }}>
          {t("level.clipping")}
        </span>
      </div>
    </section>
  );
}
